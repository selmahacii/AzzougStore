import os
import sys
import uuid
import json
import threading
from datetime import datetime, timezone, timedelta
from typing import Generator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Target live local PostgreSQL for true ACID, locking, and concurrency guarantees
POSTGRES_TEST_URL = os.environ.get("POSTGRES_TEST_URL") or "postgresql://postgres:postgres@localhost:5432/azzougshop"

from app.db.base_class import Base
from app.models.user import User
from app.models.store import Store
from app.models.product import Product
from app.models.order import Order, OrderItem
from app.models.stock import StockMovement
from app.models.events import OrderEvent
from app.models.shopify import ShopifyConnection, ShopifyMapping, ShopifyWebhookInbox
from app.services.shopify_order_service import (
    ShopifyOrderService,
    ShopifyOrderValidationError,
    ShopifyUnmappedVariantError,
    ShopifyProductNotFoundError,
    ShopifyUnsupportedCurrencyError,
    ShopifyMonetaryValidationError,
)
from app.services.shopify_sync import (
    ShopifyWebhookProcessor,
    sweep_pending_shopify_webhooks,
)
from app.services.order_service import order_service, auto_merge_duplicates


pg_engine = create_engine(POSTGRES_TEST_URL, pool_pre_ping=True)
PgSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=pg_engine)


@pytest.fixture(scope="session", autouse=True)
def setup_pg_tables():
    """Ensure all tables and constraints exist on PostgreSQL."""
    Base.metadata.create_all(bind=pg_engine)
    yield


@pytest.fixture
def db() -> Generator[Session, None, None]:
    """Isolated session fixture with skip_tenant_isolation set for test setup."""
    session = PgSessionLocal()
    session.info["skip_tenant_isolation"] = True
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def seeded_env(db: Session):
    """
    Seeds a clean, isolated multi-tenant environment on PostgreSQL:
    Store A and Store B, with active products and Shopify connections.
    """
    uid = uuid.uuid4().hex[:6]

    owner = User(
        id=f"user-owner-{uid}",
        email=f"owner-{uid}@example.com",
        name=f"Owner {uid}",
        hashed_password="hashed_pw_test",
        role="ADMIN",
    )
    db.add(owner)
    db.flush()

    # Store A (DZD)
    store_a = Store(
        id=f"store-a-{uid}",
        name=f"Boutique A {uid}",
        slug=f"shop-a-{uid}",
        currency="DZD",
        is_active=True,
        owner_id=owner.id,
    )
    # Store B (DZD)
    store_b = Store(
        id=f"store-b-{uid}",
        name=f"Boutique B {uid}",
        slug=f"shop-b-{uid}",
        currency="DZD",
        is_active=True,
        owner_id=owner.id,
    )
    db.add_all([store_a, store_b])
    db.flush()

    # Product in Store A
    prod_a = Product(
        id=f"prod-a-{uid}",
        store_id=store_a.id,
        name="Produit Sacoche Cuir",
        slug=f"sacoche-cuir-{uid}",
        sku=f"SKU-SAC-{uid}",
        price=4000,
        stock=50,
        reserved_stock=0,
        is_active=True,
    )
    # Product in Store B
    prod_b = Product(
        id=f"prod-b-{uid}",
        store_id=store_b.id,
        name="Produit Montre Luxe",
        slug=f"montre-luxe-{uid}",
        sku=f"SKU-MNT-{uid}",
        price=7500,
        stock=30,
        reserved_stock=0,
        is_active=True,
    )
    db.add_all([prod_a, prod_b])
    db.flush()

    # Shopify Connections
    conn_a = ShopifyConnection(
        id=f"conn-a-{uid}",
        store_id=store_a.id,
        shop_domain=f"boutique-a-{uid}.myshopify.com",
        status="CONNECTED",
    )
    conn_a.set_webhook_secret("secret-a-key")
    conn_b = ShopifyConnection(
        id=f"conn-b-{uid}",
        store_id=store_b.id,
        shop_domain=f"boutique-b-{uid}.myshopify.com",
        status="CONNECTED",
    )
    conn_b.set_webhook_secret("secret-b-key")
    db.add_all([conn_a, conn_b])
    db.flush()

    # Shopify Variant Mapping for Product A
    map_var_a = ShopifyMapping(
        id=f"map-var-{uid}",
        store_id=store_a.id,
        entity_type="VARIANT",
        internal_id=prod_a.id,
        shopify_id=f"shp-var-{uid}",
        extra_data={"product_id": prod_a.id, "sku": prod_a.sku, "variant": "Noir / Standard"},
    )
    db.add(map_var_a)
    db.commit()

    return {
        "owner": owner,
        "store_a": store_a,
        "store_b": store_b,
        "prod_a": prod_a,
        "prod_b": prod_b,
        "conn_a": conn_a,
        "map_var_a": map_var_a,
        "uid": uid,
    }


# ─── 1. Test Import Réussi d'une Commande ────────────────────────────────────

def test_1_successful_shopify_order_import(db: Session, seeded_env: dict):
    """
    Scenario 1: Successful end-to-end import of a valid Shopify order.
    Verifies order fields, line items, stock reservation, and mappings.
    """
    store_a = seeded_env["store_a"]
    prod_a = seeded_env["prod_a"]
    map_var_a = seeded_env["map_var_a"]
    uid = seeded_env["uid"]

    shp_order_id = f"shp-ord-success-{uid}"
    payload = {
        "id": shp_order_id,
        "name": "#1001",
        "order_number": 1001,
        "currency": "DZD",
        "financial_status": "pending",
        "fulfillment_status": "unfulfilled",
        "total_price": "8500.00",
        "subtotal_price": "8000.00",
        "total_discounts": "0.00",
        "customer": {
            "first_name": "Tariq",
            "last_name": "Benali",
            "phone": "0555998877",
            "email": "tariq@test.dz",
        },
        "shipping_address": {
            "first_name": "Tariq",
            "last_name": "Benali",
            "phone": "0555998877",
            "address1": "12 Rue Didouche Mourad",
            "province": "Alger",
            "city": "Alger-Centre",
        },
        "shipping_lines": [{"price": "500.00", "title": "Livraison Domicile"}],
        "line_items": [
            {
                "id": 11223344,
                "variant_id": map_var_a.shopify_id,
                "title": "Sacoche Cuir",
                "variant_title": "Noir / Standard",
                "quantity": 2,
                "price": "4000.00",
            }
        ],
    }

    initial_stock = prod_a.stock
    initial_reserved = prod_a.reserved_stock or 0

    order = ShopifyOrderService.import_shopify_order(
        db=db,
        store_id=store_a.id,
        payload=payload,
        delivery_id="deliv-001",
    )

    assert order is not None
    assert order.store_id == store_a.id
    assert order.source == "shopify"
    assert order.shopify_order_id == shp_order_id
    assert order.shopify_order_number == "1001"
    assert order.shopify_financial_status == "pending"
    assert order.status == "NEW"
    assert order.customer_name == "Tariq Benali"
    assert order.customer_phone == "0555998877"
    assert order.subtotal == 8000
    assert order.delivery_fee == 500
    assert order.total == 8500
    assert len(order.items) == 1
    assert order.items[0].product_id == prod_a.id
    assert order.items[0].quantity == 2
    assert order.items[0].unit_price == 4000

    # Verify Stock Reservation
    db.refresh(prod_a)
    assert prod_a.stock == initial_stock
    assert prod_a.reserved_stock == initial_reserved + 2

    # Verify StockMovement record
    movement = (
        db.query(StockMovement)
        .filter(StockMovement.order_id == order.id, StockMovement.type == "ORDER_RESERVE")
        .first()
    )
    assert movement is not None
    assert movement.quantity == 2
    assert movement.product_id == prod_a.id

    # Verify Order Mapping
    ord_map = (
        db.query(ShopifyMapping)
        .filter(ShopifyMapping.store_id == store_a.id, ShopifyMapping.shopify_id == shp_order_id)
        .first()
    )
    assert ord_map is not None
    assert ord_map.internal_id == order.id

    # Verify Traceability OrderEvent
    event = db.query(OrderEvent).filter(OrderEvent.order_id == order.id).first()
    assert event is not None
    assert "Commande Shopify #1001" in event.note


# ─── 2. Test Rejeu du Même Événement (Idempotence Absolue) ────────────────────

def test_2_shopify_order_replay_idempotence(db: Session, seeded_env: dict):
    """
    Scenario 2: Sending the exact same order event a second time.
    Verifies that the same order is returned without duplicating rows or reserving more stock.
    """
    store_a = seeded_env["store_a"]
    prod_a = seeded_env["prod_a"]
    map_var_a = seeded_env["map_var_a"]
    uid = seeded_env["uid"]

    shp_order_id = f"shp-ord-replay-{uid}"
    payload = {
        "id": shp_order_id,
        "name": "#1002",
        "currency": "DZD",
        "financial_status": "pending",
        "total_price": "4000.00",
        "subtotal_price": "4000.00",
        "line_items": [
            {
                "variant_id": map_var_a.shopify_id,
                "title": "Sacoche Cuir",
                "quantity": 1,
                "price": "4000.00",
            }
        ],
    }

    # First call: creates order
    order_1 = ShopifyOrderService.import_shopify_order(db=db, store_id=store_a.id, payload=payload)
    db.refresh(prod_a)
    reserved_after_first = prod_a.reserved_stock

    # Second call (replay): must return existing order
    order_2 = ShopifyOrderService.import_shopify_order(db=db, store_id=store_a.id, payload=payload)
    assert order_2.id == order_1.id

    # Count of orders in DB with this shopify_order_id must be EXACTLY 1
    orders_count = db.query(Order).filter(Order.shopify_order_id == shp_order_id).count()
    assert orders_count == 1

    # Stock must NOT be reserved twice
    db.refresh(prod_a)
    assert prod_a.reserved_stock == reserved_after_first


# ─── 3. Test Deux Événements Différents Pour la Même Commande ────────────────

def test_3_two_different_events_same_order(db: Session, seeded_env: dict):
    """
    Scenario 3: Delivery of two distinct webhooks for the same order (e.g. orders/create then orders/updated).
    """
    store_a = seeded_env["store_a"]
    prod_a = seeded_env["prod_a"]
    map_var_a = seeded_env["map_var_a"]
    uid = seeded_env["uid"]

    shp_order_id = f"shp-ord-lifecycle-{uid}"
    order_payload = {
        "id": shp_order_id,
        "name": "#1003",
        "currency": "DZD",
        "financial_status": "pending",
        "fulfillment_status": "unfulfilled",
        "total_price": "4000.00",
        "subtotal_price": "4000.00",
        "line_items": [{"variant_id": map_var_a.shopify_id, "quantity": 1, "price": "4000.00"}],
    }

    # Event 1: orders/create in Inbox
    ev1 = ShopifyWebhookInbox(
        id=str(uuid.uuid4()),
        delivery_id=f"deliv-ev1-{uid}",
        store_id=store_a.id,
        topic="orders/create",
        shop_domain=seeded_env["conn_a"].shop_domain,
        payload=order_payload,
        status="PENDING",
    )
    # Event 2: orders/updated in Inbox with changed financial_status
    updated_payload = dict(order_payload)
    updated_payload["financial_status"] = "paid"
    ev2 = ShopifyWebhookInbox(
        id=str(uuid.uuid4()),
        delivery_id=f"deliv-ev2-{uid}",
        store_id=store_a.id,
        topic="orders/updated",
        shop_domain=seeded_env["conn_a"].shop_domain,
        payload=updated_payload,
        status="PENDING",
    )
    db.add_all([ev1, ev2])
    db.commit()

    # Process first event
    res1 = ShopifyWebhookProcessor.process_event(db=db, event_id=ev1.id)
    assert res1 is True
    db.refresh(ev1)
    assert ev1.status == "PROCESSED"

    # Process second event
    res2 = ShopifyWebhookProcessor.process_event(db=db, event_id=ev2.id)
    assert res2 is True
    db.refresh(ev2)
    assert ev2.status == "PROCESSED"

    # Total orders must still be 1
    assert db.query(Order).filter(Order.shopify_order_id == shp_order_id).count() == 1


# ─── 4. Test Deux Commandes Légitimes du Même Client (Anti-Merge) ─────────────

def test_4_two_legitimate_orders_same_customer_no_merge(db: Session, seeded_env: dict):
    """
    Scenario 4: Two genuine orders placed by the same customer (same phone number)
    within the COD deduplication window must NEVER be auto-merged into each other!
    """
    store_a = seeded_env["store_a"]
    prod_a = seeded_env["prod_a"]
    map_var_a = seeded_env["map_var_a"]
    uid = seeded_env["uid"]
    phone = "0661223344"

    # Order 1
    payload_1 = {
        "id": f"shp-cust-1-{uid}",
        "name": "#2001",
        "currency": "DZD",
        "total_price": "4000.00",
        "subtotal_price": "4000.00",
        "customer": {"phone": phone, "name": "Brahim"},
        "shipping_address": {"phone": phone},
        "line_items": [{"variant_id": map_var_a.shopify_id, "quantity": 1, "price": "4000.00"}],
    }
    # Order 2 placed 1 minute later
    payload_2 = {
        "id": f"shp-cust-2-{uid}",
        "name": "#2002",
        "currency": "DZD",
        "total_price": "8000.00",
        "subtotal_price": "8000.00",
        "customer": {"phone": phone, "name": "Brahim"},
        "shipping_address": {"phone": phone},
        "line_items": [{"variant_id": map_var_a.shopify_id, "quantity": 2, "price": "4000.00"}],
    }

    ord1 = ShopifyOrderService.import_shopify_order(db=db, store_id=store_a.id, payload=payload_1)
    ord2 = ShopifyOrderService.import_shopify_order(db=db, store_id=store_a.id, payload=payload_2)

    assert ord1.id != ord2.id
    assert ord1.status == "NEW"
    assert ord2.status == "NEW"
    assert ord1.parent_order_id is None
    assert ord2.parent_order_id is None
    assert ord1.is_deleted is False
    assert ord2.is_deleted is False
    assert ord1.is_duplicate is False
    assert ord2.is_duplicate is False

    # Also test that calling auto_merge_duplicates on a shopify order returns 0
    merge_count = auto_merge_duplicates(db=db, order=ord2)
    assert merge_count == 0
    assert ord2.status == "NEW"


# ─── 5. Test Variante Shopify Inconnue (Erreur Explicable et Récupérable) ─────

def test_5_unmapped_variant_raises_actionable_error(db: Session, seeded_env: dict):
    """
    Scenario 5: Line item references an unmapped Shopify variant.
    Must raise ShopifyUnmappedVariantError with clear diagnostic information,
    and must not create a partial order or leave orphaned stock.
    """
    store_a = seeded_env["store_a"]
    uid = seeded_env["uid"]

    unmapped_payload = {
        "id": f"shp-ord-unmapped-{uid}",
        "currency": "DZD",
        "total_price": "5000.00",
        "subtotal_price": "5000.00",
        "line_items": [
            {
                "variant_id": "ghost_variant_99999",
                "title": "Produit Inexistant",
                "variant_title": "Bleu / XL",
                "quantity": 1,
                "price": "5000.00",
            }
        ],
    }

    with pytest.raises(ShopifyUnmappedVariantError) as exc_info:
        ShopifyOrderService.import_shopify_order(db=db, store_id=store_a.id, payload=unmapped_payload)

    assert "ghost_variant_99999" in str(exc_info.value)
    assert "non mappé" in str(exc_info.value)

    # Verify no order was inserted
    assert db.query(Order).filter(Order.shopify_order_id == f"shp-ord-unmapped-{uid}").first() is None


# ─── 6. Test Montant ou Devise Non Pris en Charge ─────────────────────────────

def test_6_unsupported_currency_and_fractional_cents(db: Session, seeded_env: dict):
    """
    Scenario 6:
      6A: Currency mismatch (e.g. order in EUR, store in DZD) -> ShopifyUnsupportedCurrencyError.
      6B: Non-integer fractional cents in DZD -> ShopifyMonetaryValidationError.
    """
    store_a = seeded_env["store_a"]
    map_var_a = seeded_env["map_var_a"]
    uid = seeded_env["uid"]

    # 6A: Currency mismatch
    payload_eur = {
        "id": f"shp-eur-{uid}",
        "currency": "EUR",
        "total_price": "45.00",
        "subtotal_price": "45.00",
        "line_items": [{"variant_id": map_var_a.shopify_id, "quantity": 1, "price": "45.00"}],
    }
    with pytest.raises(ShopifyUnsupportedCurrencyError) as exc_curr:
        ShopifyOrderService.import_shopify_order(db=db, store_id=store_a.id, payload=payload_eur)
    assert "EUR" in str(exc_curr.value)
    assert "DZD" in str(exc_curr.value)

    # 6B: Fractional cents in DZD
    payload_cents = {
        "id": f"shp-cents-{uid}",
        "currency": "DZD",
        "total_price": "4500.75",  # .75 cents in DZD
        "subtotal_price": "4500.75",
        "line_items": [{"variant_id": map_var_a.shopify_id, "quantity": 1, "price": "4500.75"}],
    }
    with pytest.raises(ShopifyMonetaryValidationError) as exc_cents:
        ShopifyOrderService.import_shopify_order(db=db, store_id=store_a.id, payload=payload_cents)
    assert "fractionnaires" in str(exc_cents.value)


# ─── 7. Test Isolation Multi-Tenant entre Boutiques ──────────────────────────

def test_7_store_isolation_protection(db: Session, seeded_env: dict):
    """
    Scenario 7: Store B cannot import an order referencing Store A's mapping or products.
    """
    store_b = seeded_env["store_b"]
    map_var_a = seeded_env["map_var_a"]  # Belongs to Store A
    uid = seeded_env["uid"]

    payload = {
        "id": f"shp-cross-store-{uid}",
        "currency": "DZD",
        "total_price": "4000.00",
        "subtotal_price": "4000.00",
        "line_items": [{"variant_id": map_var_a.shopify_id, "quantity": 1, "price": "4000.00"}],
    }

    # Attempting to import for Store B with Store A's variant ID must fail
    with pytest.raises(ShopifyUnmappedVariantError):
        ShopifyOrderService.import_shopify_order(db=db, store_id=store_b.id, payload=payload)


# ─── 8. Test Concurrence et Course Critique sur PostgreSQL ────────────────────

def test_8_concurrent_order_ingestion_race_condition(seeded_env: dict):
    """
    Scenario 8: True PostgreSQL concurrency test using multiple threads.
    Two concurrent workers receive the same Shopify order simultaneously.
    PostgreSQL's row lock and unique constraint must guarantee that:
      - Exactly 1 order is created in the database.
      - Stock is reserved only once.
      - Neither thread crashes with an unhandled exception.
    """
    store_a = seeded_env["store_a"]
    prod_a = seeded_env["prod_a"]
    map_var_a = seeded_env["map_var_a"]
    uid = seeded_env["uid"]

    shp_order_id = f"shp-race-{uid}"
    payload = {
        "id": shp_order_id,
        "name": "#9999",
        "currency": "DZD",
        "total_price": "4000.00",
        "subtotal_price": "4000.00",
        "line_items": [{"variant_id": map_var_a.shopify_id, "quantity": 2, "price": "2000.00"}],
    }

    results = []
    errors = []

    def _worker():
        s = PgSessionLocal()
        s.info["skip_tenant_isolation"] = True
        try:
            res = ShopifyOrderService.import_shopify_order(db=s, store_id=store_a.id, payload=payload)
            results.append(res.id)
        except Exception as e:
            errors.append(e)
        finally:
            s.close()

    t1 = threading.Thread(target=_worker)
    t2 = threading.Thread(target=_worker)

    t1.start()
    t2.start()
    t1.join()
    t2.join()

    # Both threads must succeed and resolve to the SAME order ID
    assert len(errors) == 0, f"Concurrent execution generated unhandled errors: {errors}"
    assert len(results) == 2
    assert results[0] == results[1]

    # Verify exactly one row in PostgreSQL
    verify_session = PgSessionLocal()
    verify_session.info["skip_tenant_isolation"] = True
    try:
        count = verify_session.query(Order).filter(Order.shopify_order_id == shp_order_id).count()
        assert count == 1
    finally:
        verify_session.close()


# ─── 9. Test Échec de Transaction et Reprise depuis l'Inbox ──────────────────

def test_9_transaction_failure_and_inbox_recovery(db: Session, seeded_env: dict):
    """
    Scenario 9: An inbox event fails initially (unmapped variant).
    When the merchant creates the mapping, the background sweeper recovers
    the event, transitions it to PROCESSED, and creates the order.
    """
    store_a = seeded_env["store_a"]
    prod_a = seeded_env["prod_a"]
    uid = seeded_env["uid"]

    ghost_var_id = f"var-to-fix-{uid}"
    payload = {
        "id": f"shp-recovery-{uid}",
        "currency": "DZD",
        "total_price": "4000.00",
        "subtotal_price": "4000.00",
        "line_items": [{"variant_id": ghost_var_id, "quantity": 1, "price": "4000.00"}],
    }

    inbox_event = ShopifyWebhookInbox(
        id=str(uuid.uuid4()),
        delivery_id=f"deliv-recovery-{uid}",
        store_id=store_a.id,
        topic="orders/create",
        shop_domain=seeded_env["conn_a"].shop_domain,
        payload=payload,
        status="PENDING",
    )
    db.add(inbox_event)
    db.commit()

    # 1. First process: fails because variant is unmapped
    res1 = ShopifyWebhookProcessor.process_event(db=db, event_id=inbox_event.id)
    assert res1 is False
    db.refresh(inbox_event)
    assert inbox_event.status == "FAILED"
    assert inbox_event.attempts == 1
    assert "non mappé" in inbox_event.last_error

    # 2. Merchant creates the missing mapping in the ERP
    prod_rec = Product(
        id=f"prod-rec-{uid}",
        store_id=store_a.id,
        name="Produit Recovery",
        slug=f"rec-{uid}",
        sku=f"SKU-REC-{uid}",
        price=4000,
        stock=50,
        reserved_stock=0,
        is_active=True,
    )
    db.add(prod_rec)
    db.flush()

    new_map = ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store_a.id,
        entity_type="VARIANT",
        internal_id=prod_rec.id,
        shopify_id=ghost_var_id,
        extra_data={"product_id": prod_rec.id},
    )
    db.add(new_map)
    # Manually reset next_retry_at to past to simulate timeout expiry
    inbox_event.next_retry_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()

    # 3. Sweeper runs
    recovered_count = sweep_pending_shopify_webhooks(db=db, limit=10)
    assert recovered_count >= 1

    db.refresh(inbox_event)
    assert inbox_event.status == "PROCESSED"
    assert inbox_event.last_error is None

    # Order is now successfully created in DB
    created_order = db.query(Order).filter(Order.shopify_order_id == f"shp-recovery-{uid}").first()
    assert created_order is not None
    assert created_order.status == "NEW"


# ─── 10. Test Absence de Double Réservation de Stock ─────────────────────────

def test_10_no_double_stock_reservation(db: Session, seeded_env: dict):
    """
    Scenario 10: Rigorously verifies StockMovement records.
    Ensures that for a given Shopify order, only 1 ORDER_RESERVE movement is created per line item.
    """
    store_a = seeded_env["store_a"]
    prod_a = seeded_env["prod_a"]
    map_var_a = seeded_env["map_var_a"]
    uid = seeded_env["uid"]

    shp_order_id = f"shp-nodouble-{uid}"
    payload = {
        "id": shp_order_id,
        "currency": "DZD",
        "total_price": "4000.00",
        "subtotal_price": "4000.00",
        "line_items": [{"variant_id": map_var_a.shopify_id, "quantity": 3, "price": "4000.00"}],
    }

    # Run import multiple times
    ord1 = ShopifyOrderService.import_shopify_order(db=db, store_id=store_a.id, payload=payload)
    ord2 = ShopifyOrderService.import_shopify_order(db=db, store_id=store_a.id, payload=payload)
    ord3 = ShopifyOrderService.import_shopify_order(db=db, store_id=store_a.id, payload=payload)

    # Count movements
    movements = (
        db.query(StockMovement)
        .filter(StockMovement.order_id == ord1.id, StockMovement.type == "ORDER_RESERVE")
        .all()
    )
    assert len(movements) == 1
    assert movements[0].quantity == 3


# ─── 11. Test Préservation des Statuts et Transitions COD ────────────────────

def test_11_preserve_cod_workflow_and_status_transitions(db: Session, seeded_env: dict):
    """
    Scenario 11:
      - COD (financial_status='pending') orders are initialized in 'NEW'.
      - They can transition cleanly through the operational pipeline (NEW -> CONFIRMED).
      - Paid orders (financial_status='paid') are initialized in 'NEW' with status distinct.
    """
    store_a = seeded_env["store_a"]
    map_var_a = seeded_env["map_var_a"]
    uid = seeded_env["uid"]

    # COD Order
    payload_cod = {
        "id": f"shp-cod-{uid}",
        "currency": "DZD",
        "financial_status": "pending",
        "total_price": "4000.00",
        "subtotal_price": "4000.00",
        "line_items": [{"variant_id": map_var_a.shopify_id, "quantity": 1, "price": "4000.00"}],
    }
    # Paid Order
    payload_paid = {
        "id": f"shp-paid-{uid}",
        "currency": "DZD",
        "financial_status": "paid",
        "total_price": "4000.00",
        "subtotal_price": "4000.00",
        "line_items": [{"variant_id": map_var_a.shopify_id, "quantity": 1, "price": "4000.00"}],
    }

    order_cod = ShopifyOrderService.import_shopify_order(db=db, store_id=store_a.id, payload=payload_cod)
    order_paid = ShopifyOrderService.import_shopify_order(db=db, store_id=store_a.id, payload=payload_paid)

    # Operational status must both be NEW
    assert order_cod.status == "NEW"
    assert order_paid.status == "NEW"

    # Financial statuses must remain distinct
    assert order_cod.shopify_financial_status == "pending"
    assert order_paid.shopify_financial_status == "paid"

    # Transition COD order: NEW -> CONFIRMED via order_service
    order_service.update_order(
        db=db,
        order=order_cod,
        update_data={"status": "CONFIRMED"},
        actor_id=seeded_env["owner"].id,
    )
    db.refresh(order_cod)
    assert order_cod.status == "CONFIRMED"
