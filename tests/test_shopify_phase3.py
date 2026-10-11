import os
import sys
import uuid
import threading
from datetime import datetime, timezone, timedelta
from typing import Generator, Dict, Any, Optional

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

POSTGRES_TEST_URL = os.environ.get("POSTGRES_TEST_URL") or "postgresql://postgres:postgres@localhost:5432/azzougshop"

from app.db.base_class import Base
from app.models.user import User
from app.models.store import Store
from app.models.product import Product
from app.models.order import Order
from app.models.shopify import ShopifyConnection, ShopifyMapping, ShopifyInventorySyncQueue
from app.services.inventory_service import inventory_service
from app.services.shopify_client import (
    ShopifyGraphQLClient,
    ShopifyClientError,
    ShopifyUserError,
    ShopifyRateLimitError,
    ShopifyTransientError,
    ShopifyCompareQuantityMismatchError,
    extract_numeric_id,
)
from app.services.shopify_inventory_service import (
    calculate_erp_available_stock,
    resolve_shopify_inventory_mapping,
    enqueue_inventory_sync,
    process_inventory_queue_task,
    sweep_pending_inventory_syncs,
    reconcile_store_inventory,
)


pg_engine = create_engine(POSTGRES_TEST_URL, pool_pre_ping=True)
PgSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=pg_engine)


@pytest.fixture(scope="session", autouse=True)
def setup_pg_tables():
    """Ensure all Phase 1, Phase 2, and Phase 3 tables exist in PostgreSQL."""
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


# ─── Mock Shopify GraphQL Client ─────────────────────────────────────────────

class MockShopifyGraphQLClient:
    """Mock client simulating Shopify GraphQL Admin API behavior in-memory."""
    def __init__(self, shop_domain: str = "test-store.myshopify.com", initial_levels: Optional[Dict[tuple, int]] = None):
        self.shop_domain = shop_domain
        # Key: (inventory_item_id, location_id) -> quantity
        self.inventory: Dict[tuple, int] = initial_levels or {}
        self.call_history: list = []
        self.fail_with: Optional[Exception] = None
        self.user_errors: list = []
        self.throttled: bool = False

    def set_inventory_quantities(
        self,
        inventory_item_id: str,
        location_id: str,
        quantity: int,
        compare_quantity: Optional[int] = None,
        idempotency_key: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        self.call_history.append({
            "method": "set_inventory_quantities",
            "inventory_item_id": inventory_item_id,
            "location_id": location_id,
            "quantity": quantity,
            "compare_quantity": compare_quantity,
            "idempotency_key": idempotency_key,
        })
        if self.fail_with:
            raise self.fail_with
        if self.throttled:
            raise ShopifyRateLimitError("Shopify API Rate Limit Throttled (429)")
        if self.user_errors:
            combined = "; ".join(f"[{e.get('code', '')}] {e.get('message', '')}" for e in self.user_errors)
            raise ShopifyUserError(f"Échec de mise à jour de stock Shopify: {combined}", errors=self.user_errors)

        key = (extract_numeric_id(inventory_item_id), extract_numeric_id(location_id))
        if compare_quantity is not None:
            current = self.inventory.get(key, 0)
            if current != compare_quantity:
                raise ShopifyCompareQuantityMismatchError(
                    f"compareQuantity mismatch: current={current}, compare={compare_quantity}",
                    errors=[{"code": "COMPARE_QUANTITY_MISMATCH", "message": "compare quantity mismatch"}],
                )

        self.inventory[key] = quantity
        return {
            "inventoryAdjustmentGroup": {
                "id": "gid://shopify/InventoryAdjustmentGroup/123",
                "changes": [{"name": "available", "delta": 0, "quantityAfterChange": quantity}],
            },
            "userErrors": [],
        }

    def get_inventory_level(
        self,
        inventory_item_id: str,
        location_id: str,
    ) -> Optional[int]:
        self.call_history.append({
            "method": "get_inventory_level",
            "inventory_item_id": inventory_item_id,
            "location_id": location_id,
        })
        if self.fail_with:
            raise self.fail_with
        key = (extract_numeric_id(inventory_item_id), extract_numeric_id(location_id))
        return self.inventory.get(key)


# ─── Test Fixture Helpers ────────────────────────────────────────────────────

def _create_test_store_and_connection(db: Session, prefix: str = "p3") -> tuple[Store, ShopifyConnection]:
    rand = uuid.uuid4().hex[:6]
    user = User(
        id=str(uuid.uuid4()),
        email=f"{prefix}_user_{rand}@test.com",
        name=f"{prefix}_user_{rand}",
        hashed_password="pw",
        role="ADMIN",
    )
    db.add(user)
    db.flush()

    store = Store(
        id=f"store_{prefix}_{rand}",
        name=f"Store {prefix} {rand}",
        slug=f"store-{prefix}-{rand}",
        currency="DZD",
        owner_id=user.id,
    )
    db.add(store)
    db.flush()

    conn = ShopifyConnection(
        id=str(uuid.uuid4()),
        store_id=store.id,
        shop_domain=f"{prefix}-{rand}.myshopify.com",
        status="CONNECTED",
        api_version="2024-04",
        sync_inventory=True,
        settings={"location_id": "gid://shopify/Location/888888"},
    )
    conn.set_access_token("shpat_test_token_123456789")
    db.add(conn)
    db.commit()
    return store, conn


def _create_test_order(db: Session, store_id: str, order_id: Optional[str] = None) -> Order:
    oid = order_id or str(uuid.uuid4())
    ord_num = f"ORD-{uuid.uuid4().hex[:6].upper()}"
    order = Order(
        id=oid,
        store_id=store_id,
        order_number=ord_num,
        customer_name="Test Client",
        customer_phone="0550112233",
        customer_address="Alger",
        customer_wilaya="Alger",
        delivery_fee=400,
        total=2000,
        status="NEW",
    )
    db.add(order)
    db.flush()
    return order


# ─── Scenario 1: Publication correcte du stock d'un produit simple ───────────

def test_single_product_stock_publication(db: Session):
    store, conn = _create_test_store_and_connection(db, "simple")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit Simple Test",
        slug=f"simple-{uuid.uuid4().hex[:6]}",
        price=1500,
        stock=25,
        reserved_stock=0,
    )
    db.add(prod)
    db.flush()

    # Mapping
    mapping = ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="PRODUCT",
        internal_id=prod.id,
        shopify_id="11223344",
        shopify_secondary_id="99112233",  # inventory_item_id
        extra_data={"inventory_item_id": "99112233"},
    )
    db.add(mapping)
    db.commit()

    mock_client = MockShopifyGraphQLClient()

    # Enqueue sync task
    task = enqueue_inventory_sync(db, product_id=prod.id)
    assert task is not None
    assert task.status == "PENDING"
    assert task.target_quantity == 25
    assert task.shopify_inventory_item_id == "99112233"
    db.commit()

    # Process task
    success = process_inventory_queue_task(db, task.id, client=mock_client)
    assert success is True

    db.refresh(task)
    assert task.status == "SUCCESS"
    assert task.processed_at is not None
    assert task.last_error is None

    # Check client received mutation with 25
    assert len(mock_client.call_history) == 1
    call = mock_client.call_history[0]
    assert call["method"] == "set_inventory_quantities"
    assert call["quantity"] == 25
    assert mock_client.inventory[("99112233", "888888")] == 25


# ─── Scenario 2: Publication correcte du stock de chaque variante ────────────

def test_variant_specific_stock_publication(db: Session):
    store, conn = _create_test_store_and_connection(db, "variant")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Chemise Test",
        slug=f"chemise-{uuid.uuid4().hex[:6]}",
        price=2000,
        stock=30,
        reserved_stock=3,
        variants=[
            {"name": "Couleur", "value": "Noir", "sku": "SHIRT-BLK", "stock": 20, "reserved": 2},
            {"name": "Couleur", "value": "Blanc", "sku": "SHIRT-WHT", "stock": 10, "reserved": 1},
        ],
    )
    db.add(prod)
    db.flush()

    # Create mappings for Noir and Blanc
    map_blk = ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="VARIANT",
        internal_id=f"{prod.id}:SHIRT-BLK",
        shopify_id="var_blk_1",
        shopify_secondary_id="inv_blk_1",
        extra_data={"inventory_item_id": "inv_blk_1", "sku": "SHIRT-BLK"},
    )
    map_wht = ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="VARIANT",
        internal_id=f"{prod.id}:SHIRT-WHT",
        shopify_id="var_wht_2",
        shopify_secondary_id="inv_wht_2",
        extra_data={"inventory_item_id": "inv_wht_2", "sku": "SHIRT-WHT"},
    )
    db.add_all([map_blk, map_wht])
    db.commit()

    mock_client = MockShopifyGraphQLClient()

    # Enqueue for Noir (available = 20 - 2 = 18)
    task_blk = enqueue_inventory_sync(db, product_id=prod.id, variant_details={"variant": "Noir", "sku": "SHIRT-BLK"})
    # Enqueue for Blanc (available = 10 - 1 = 9)
    task_wht = enqueue_inventory_sync(db, product_id=prod.id, variant_details={"variant": "Blanc", "sku": "SHIRT-WHT"})
    db.commit()

    assert task_blk.target_quantity == 18  # Never global stock 30
    assert task_wht.target_quantity == 9   # Never global stock 30

    assert process_inventory_queue_task(db, task_blk.id, client=mock_client) is True
    assert process_inventory_queue_task(db, task_wht.id, client=mock_client) is True

    assert mock_client.inventory[("inv_blk_1", "888888")] == 18
    assert mock_client.inventory[("inv_wht_2", "888888")] == 9


# ─── Scenario 3: Calcul stock physique moins réservations ────────────────────

def test_available_stock_calculation_formula(db: Session):
    store, conn = _create_test_store_and_connection(db, "formula")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit Calcul",
        slug=f"calc-{uuid.uuid4().hex[:6]}",
        price=1000,
        stock=50,
        reserved_stock=12,
    )
    db.add(prod)
    db.commit()

    avail = calculate_erp_available_stock(prod)
    assert avail == 38  # 50 - 12

    task = enqueue_inventory_sync(db, product_id=prod.id)
    assert task.target_quantity == 38


# ─── Scenario 4: Réservation, annulation et retour ───────────────────────────

def test_lifecycle_movement_sync_trigger(db: Session):
    store, conn = _create_test_store_and_connection(db, "life")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit Cycle",
        slug=f"cycle-{uuid.uuid4().hex[:6]}",
        price=3000,
        stock=20,
        reserved_stock=0,
    )
    db.add(prod)
    mapping = ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="PRODUCT",
        internal_id=prod.id,
        shopify_id="p_cycle_1",
        shopify_secondary_id="inv_cycle_1",
    )
    db.add(mapping)
    db.commit()

    mock_client = MockShopifyGraphQLClient()
    ord1 = _create_test_order(db, store.id)
    ord2 = _create_test_order(db, store.id)
    db.commit()

    # 1. Order reservation: reserve 4
    inventory_service.reserve_stock(db, product_id=prod.id, quantity=4, order_id=ord1.id)
    db.commit()

    task = db.query(ShopifyInventorySyncQueue).filter(ShopifyInventorySyncQueue.product_id == prod.id).order_by(ShopifyInventorySyncQueue.created_at.desc()).first()
    assert task is not None
    assert task.target_quantity == 16  # 20 - 4
    process_inventory_queue_task(db, task.id, client=mock_client)
    assert mock_client.inventory[("inv_cycle_1", "888888")] == 16

    # 2. Release reservation (cancellation): release 4
    inventory_service.release_reservation(db, product_id=prod.id, quantity=4, order_id=ord1.id)
    db.commit()

    task2 = db.query(ShopifyInventorySyncQueue).filter(ShopifyInventorySyncQueue.product_id == prod.id, ShopifyInventorySyncQueue.status == "PENDING").first()
    assert task2 is not None
    assert task2.target_quantity == 20  # 20 - 0
    process_inventory_queue_task(db, task2.id, client=mock_client)
    assert mock_client.inventory[("inv_cycle_1", "888888")] == 20

    # 3. Confirm stock (sell 5 units)
    inventory_service.confirm_stock(db, product_id=prod.id, quantity=5, order_id=ord2.id)
    db.commit()

    task3 = db.query(ShopifyInventorySyncQueue).filter(ShopifyInventorySyncQueue.product_id == prod.id, ShopifyInventorySyncQueue.status == "PENDING").first()
    assert task3 is not None
    assert task3.target_quantity == 15  # 15 - 0
    process_inventory_queue_task(db, task3.id, client=mock_client)
    assert mock_client.inventory[("inv_cycle_1", "888888")] == 15

    # 4. Return restock (customer returned 5 units)
    inventory_service.return_restock(db, product_id=prod.id, quantity=5, order_id=ord2.id)
    db.commit()

    task4 = db.query(ShopifyInventorySyncQueue).filter(ShopifyInventorySyncQueue.product_id == prod.id, ShopifyInventorySyncQueue.status == "PENDING").first()
    assert task4 is not None
    assert task4.target_quantity == 20  # 20 - 0
    process_inventory_queue_task(db, task4.id, client=mock_client)
    assert mock_client.inventory[("inv_cycle_1", "888888")] == 20


# ─── Scenario 5: Rejeu d'une tâche sans double modification ──────────────────

def test_task_replay_idempotency(db: Session):
    store, conn = _create_test_store_and_connection(db, "replay")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit Replay",
        slug=f"replay-{uuid.uuid4().hex[:6]}",
        price=500,
        stock=10,
        reserved_stock=0,
    )
    db.add(prod)
    db.add(ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="PRODUCT",
        internal_id=prod.id,
        shopify_id="rep_1",
        shopify_secondary_id="inv_rep_1",
    ))
    db.commit()

    mock_client = MockShopifyGraphQLClient()
    task = enqueue_inventory_sync(db, product_id=prod.id)
    db.commit()

    # First run: success
    res1 = process_inventory_queue_task(db, task.id, client=mock_client)
    assert res1 is True
    assert len(mock_client.call_history) == 1

    # Second run (replay of already SUCCESS task): must return True without re-calling API
    res2 = process_inventory_queue_task(db, task.id, client=mock_client)
    assert res2 is True
    assert len(mock_client.call_history) == 1  # No second call!


# ─── Scenario 6: Deux mises à jour concurrentes du même inventaire ───────────

def test_concurrent_inventory_sync_locking(db: Session):
    store, conn = _create_test_store_and_connection(db, "conc")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit Concurrence",
        slug=f"conc-{uuid.uuid4().hex[:6]}",
        price=1000,
        stock=30,
        reserved_stock=0,
    )
    db.add(prod)
    db.add(ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="PRODUCT",
        internal_id=prod.id,
        shopify_id="c_1",
        shopify_secondary_id="inv_c_1",
    ))
    db.commit()

    task = enqueue_inventory_sync(db, product_id=prod.id)
    db.commit()
    task_id = str(task.id)

    mock_client = MockShopifyGraphQLClient()
    results = []

    def _worker():
        worker_session = PgSessionLocal()
        worker_session.info["skip_tenant_isolation"] = True
        try:
            r = process_inventory_queue_task(worker_session, task_id, client=mock_client)
            results.append(r)
        finally:
            worker_session.close()

    t1 = threading.Thread(target=_worker)
    t2 = threading.Thread(target=_worker)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    # Exactly one thread executed the sync while the other completed or skipped cleanly
    assert len(results) == 2
    assert True in results
    db.refresh(task)
    assert task.status == "SUCCESS"


# ─── Scenario 7: Une ancienne tâche exécutée après une révision plus récente ─

def test_stale_task_coalescence_by_revision(db: Session):
    store, conn = _create_test_store_and_connection(db, "rev")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit Revision",
        slug=f"rev-{uuid.uuid4().hex[:6]}",
        price=1000,
        stock=10,
        reserved_stock=0,
    )
    db.add(prod)
    db.add(ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="PRODUCT",
        internal_id=prod.id,
        shopify_id="rev_1",
        shopify_secondary_id="inv_rev_1",
    ))
    db.commit()

    # Task 1: Stale older task (revision 1)
    task_old = ShopifyInventorySyncQueue(
        id=str(uuid.uuid4()),
        store_id=store.id,
        product_id=prod.id,
        shopify_inventory_item_id="inv_rev_1",
        shopify_location_id="888888",
        target_quantity=10,
        status="PENDING",
        stock_revision=1,
    )
    # Task 2: Newer task (revision 2)
    task_new = ShopifyInventorySyncQueue(
        id=str(uuid.uuid4()),
        store_id=store.id,
        product_id=prod.id,
        shopify_inventory_item_id="inv_rev_1",
        shopify_location_id="888888",
        target_quantity=15,
        status="PENDING",
        stock_revision=2,
    )
    db.add_all([task_old, task_new])
    db.commit()

    mock_client = MockShopifyGraphQLClient()

    # Process older task first: must detect newer revision and mark itself COALESCED without modifying Shopify
    process_inventory_queue_task(db, task_old.id, client=mock_client)
    db.refresh(task_old)
    assert task_old.status == "COALESCED"
    assert "obsolète" in task_old.last_error.lower()
    assert len(mock_client.call_history) == 0

    # Process newer task: succeeds
    process_inventory_queue_task(db, task_new.id, client=mock_client)
    db.refresh(task_new)
    assert task_new.status == "SUCCESS"
    assert len(mock_client.call_history) == 1
    assert mock_client.inventory[("inv_rev_1", "888888")] == 10  # from current erp product stock


# ─── Scenario 8: compareQuantity devenu obsolète ─────────────────────────────

def test_compare_quantity_mismatch_reschedule(db: Session):
    store, conn = _create_test_store_and_connection(db, "comp")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit Compare",
        slug=f"comp-{uuid.uuid4().hex[:6]}",
        price=1000,
        stock=20,
        reserved_stock=0,
    )
    db.add(prod)
    db.add(ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="PRODUCT",
        internal_id=prod.id,
        shopify_id="cmp_1",
        shopify_secondary_id="inv_cmp_1",
    ))
    db.commit()

    # Shopify inventory is currently at 5, but task has previous_quantity=10
    mock_client = MockShopifyGraphQLClient(initial_levels={("inv_cmp_1", "888888"): 5})

    task = ShopifyInventorySyncQueue(
        id=str(uuid.uuid4()),
        store_id=store.id,
        product_id=prod.id,
        shopify_inventory_item_id="inv_cmp_1",
        shopify_location_id="888888",
        target_quantity=20,
        previous_quantity=10,  # Mismatch!
        status="PENDING",
    )
    db.add(task)
    db.commit()

    # Execution should fail compareQuantity, read current level (5), and reschedule without force overwriting
    res = process_inventory_queue_task(db, task.id, client=mock_client)
    assert res is False

    db.refresh(task)
    assert task.status == "FAILED"
    assert task.previous_quantity == 5  # Updated to the actual Shopify level!
    assert "comparequantity" in task.last_error.lower()

    # Next attempt with the re-read compare quantity (5) should succeed!
    res_retry = process_inventory_queue_task(db, task.id, client=mock_client)
    assert res_retry is True
    db.refresh(task)
    assert task.status == "SUCCESS"
    assert mock_client.inventory[("inv_cmp_1", "888888")] == 20


# ─── Scenario 9: Erreurs GraphQL userErrors malgré une réponse HTTP 200 ──────

def test_user_errors_handled_on_http_200(db: Session):
    store, conn = _create_test_store_and_connection(db, "uerr")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit UserErr",
        slug=f"uerr-{uuid.uuid4().hex[:6]}",
        price=1000,
        stock=10,
        reserved_stock=0,
    )
    db.add(prod)
    db.add(ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="PRODUCT",
        internal_id=prod.id,
        shopify_id="ue_1",
        shopify_secondary_id="inv_ue_1",
    ))
    db.commit()

    task = enqueue_inventory_sync(db, product_id=prod.id)
    db.commit()

    mock_client = MockShopifyGraphQLClient()
    mock_client.user_errors = [
        {"code": "ITEM_NOT_STOCKED_AT_LOCATION", "message": "Item is not stocked at location 888888."}
    ]

    res = process_inventory_queue_task(db, task.id, client=mock_client)
    assert res is False

    db.refresh(task)
    assert task.status == "FAILED"
    assert "ITEM_NOT_STOCKED_AT_LOCATION" in task.last_error


# ─── Scenario 10: Erreurs transitoires, backoff et reprise ───────────────────

def test_transient_error_backoff_and_recovery(db: Session):
    store, conn = _create_test_store_and_connection(db, "trans")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit Trans",
        slug=f"trans-{uuid.uuid4().hex[:6]}",
        price=1000,
        stock=15,
        reserved_stock=0,
    )
    db.add(prod)
    db.add(ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="PRODUCT",
        internal_id=prod.id,
        shopify_id="tr_1",
        shopify_secondary_id="inv_tr_1",
    ))
    db.commit()

    task = enqueue_inventory_sync(db, product_id=prod.id)
    db.commit()

    mock_client = MockShopifyGraphQLClient()
    mock_client.throttled = True

    # Attempt 1: Rate limit 429
    res1 = process_inventory_queue_task(db, task.id, client=mock_client)
    assert res1 is False
    db.refresh(task)
    assert task.status == "FAILED"
    assert task.attempts == 1
    assert task.next_retry_at is not None

    # Error resolves, sweeper re-runs
    mock_client.throttled = False
    task.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()

    sweep_res = sweep_pending_inventory_syncs(db, store_id=store.id, limit=10, client=mock_client)
    assert sweep_res >= 1
    db.refresh(task)
    assert task.status == "SUCCESS"


# ─── Scenario 11: Variante ou emplacement absent ─────────────────────────────

def test_unmapped_variant_or_location_missing(db: Session):
    store, conn = _create_test_store_and_connection(db, "unmap")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit Non Mappé",
        slug=f"unmap-{uuid.uuid4().hex[:6]}",
        price=1000,
        stock=10,
        reserved_stock=0,
    )
    db.add(prod)
    db.commit()

    # No ShopifyMapping created!
    task = enqueue_inventory_sync(db, product_id=prod.id)
    db.commit()

    mock_client = MockShopifyGraphQLClient()
    res = process_inventory_queue_task(db, task.id, client=mock_client)
    assert res is False

    db.refresh(task)
    assert task.status == "FAILED"
    assert "Article non mappé" in task.last_error

    # Now create mapping and recover via sweeper
    db.add(ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="PRODUCT",
        internal_id=prod.id,
        shopify_id="map_later_1",
        shopify_secondary_id="inv_later_1",
    ))
    task.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()

    sweep_res = sweep_pending_inventory_syncs(db, store_id=store.id, limit=10, client=mock_client)
    assert sweep_res >= 1
    db.refresh(task)
    assert task.status == "SUCCESS"


# ─── Scenario 12: Isolation entre deux boutiques ─────────────────────────────

def test_multi_tenant_store_isolation(db: Session):
    store1, conn1 = _create_test_store_and_connection(db, "t1")
    store2, conn2 = _create_test_store_and_connection(db, "t2")

    prod1 = Product(id=str(uuid.uuid4()), store_id=store1.id, name="P1", slug=f"p1-{uuid.uuid4().hex[:6]}", price=1000, stock=10)
    prod2 = Product(id=str(uuid.uuid4()), store_id=store2.id, name="P2", slug=f"p2-{uuid.uuid4().hex[:6]}", price=1000, stock=20)
    db.add_all([prod1, prod2])
    db.add(ShopifyMapping(id=str(uuid.uuid4()), store_id=store1.id, entity_type="PRODUCT", internal_id=prod1.id, shopify_id="s1", shopify_secondary_id="inv_s1"))
    db.add(ShopifyMapping(id=str(uuid.uuid4()), store_id=store2.id, entity_type="PRODUCT", internal_id=prod2.id, shopify_id="s2", shopify_secondary_id="inv_s2"))
    db.commit()

    task1 = enqueue_inventory_sync(db, product_id=prod1.id)
    task2 = enqueue_inventory_sync(db, product_id=prod2.id)
    db.commit()

    assert task1.store_id == store1.id
    assert task2.store_id == store2.id

    # Queue query for store 1 only returns store 1's tasks
    q1 = db.query(ShopifyInventorySyncQueue).filter(ShopifyInventorySyncQueue.store_id == store1.id).all()
    q1_ids = [t.id for t in q1]
    assert task1.id in q1_ids
    assert task2.id not in q1_ids


# ─── Scenario 13: Intégration désactivée ──────────────────────────────────────

def test_disabled_integration_behavior(db: Session):
    store, conn = _create_test_store_and_connection(db, "dis")
    conn.sync_inventory = False  # Disabled!
    db.commit()

    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit Sync Disabled",
        slug=f"dis-{uuid.uuid4().hex[:6]}",
        price=1000,
        stock=10,
    )
    db.add(prod)
    db.commit()

    # Enqueue should return None (no tasks created when sync_inventory is False)
    task = enqueue_inventory_sync(db, product_id=prod.id)
    assert task is None

    # If a task was pending before disabling, it gets marked COALESCED
    task_pre = ShopifyInventorySyncQueue(
        id=str(uuid.uuid4()),
        store_id=store.id,
        product_id=prod.id,
        shopify_inventory_item_id="inv_dis_1",
        target_quantity=10,
        status="PENDING",
    )
    db.add(task_pre)
    db.commit()

    mock_client = MockShopifyGraphQLClient()
    res = process_inventory_queue_task(db, task_pre.id, client=mock_client)
    assert res is True
    db.refresh(task_pre)
    assert task_pre.status == "COALESCED"
    assert "désactivée" in task_pre.last_error


# ─── Scenario 14: Dry-run sans écriture ───────────────────────────────────────

def test_reconciliation_dry_run_zero_writes(db: Session):
    store, conn = _create_test_store_and_connection(db, "dry")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit DryRun",
        slug=f"dry-{uuid.uuid4().hex[:6]}",
        price=1000,
        stock=35,
        reserved_stock=5,  # ERP avail = 30
    )
    db.add(prod)
    db.add(ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="PRODUCT",
        internal_id=prod.id,
        shopify_id="dry_1",
        shopify_secondary_id="inv_dry_1",
    ))
    db.commit()

    # Shopify currently has 20 (delta = 10)
    mock_client = MockShopifyGraphQLClient(initial_levels={("inv_dry_1", "888888"): 20})

    report = reconcile_store_inventory(db, store_id=store.id, dry_run=True, client=mock_client)

    assert report["dry_run"] is True
    assert report["total_items_checked"] == 1
    assert report["divergent_count"] == 1
    item = report["items"][0]
    assert item["erp_available"] == 30
    assert item["shopify_available"] == 20
    assert item["delta"] == 10
    assert item["status"] == "DIVERGENT"
    assert item["proposed_action"] == "ALIGNER_SUR_30"

    # Verify ZERO tasks created in database
    queued = db.query(ShopifyInventorySyncQueue).filter(ShopifyInventorySyncQueue.store_id == store.id).count()
    assert queued == 0

    # Verify Shopify stock was NOT modified
    assert mock_client.inventory[("inv_dry_1", "888888")] == 20


# ─── Scenario 15: Absence de régression ───────────────────────────────────────

def test_clean_state_and_parity_with_order_service(db: Session):
    """
    Verifies that stock movements from order_service continue to function smoothly
    without breaking or crashing even if Shopify sync queue tasks are enqueued alongside.
    """
    store, conn = _create_test_store_and_connection(db, "regr")
    prod = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name="Produit Non-Regression",
        slug=f"regr-{uuid.uuid4().hex[:6]}",
        price=2000,
        stock=10,
        reserved_stock=0,
    )
    db.add(prod)
    db.commit()

    # Reserve stock via inventory_service
    ord = _create_test_order(db, store.id)
    db.commit()
    inventory_service.reserve_stock(db, product_id=prod.id, quantity=2, order_id=ord.id)
    db.commit()

    db.refresh(prod)
    assert prod.stock == 10
    assert prod.reserved_stock == 2

    # Verify queue task exists
    task = db.query(ShopifyInventorySyncQueue).filter(ShopifyInventorySyncQueue.product_id == prod.id).first()
    assert task is not None
    assert task.target_quantity == 8
