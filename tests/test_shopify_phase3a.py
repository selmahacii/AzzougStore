"""
Tests for Shopify Phase 3A: API Versioning (2026-10), GraphQL @idempotent Directive,
Idempotency Key Lifecycle, Concurrency Resilience, and Version Upgrade Migration.
"""
import uuid
import pytest
from unittest.mock import MagicMock, patch
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.store import Store
from app.models.product import Product
from app.models.user import User
from app.models.shopify import ShopifyConnection, ShopifyInventorySyncQueue, SHOPIFY_API_VERSION_DEFAULT
from app.services.shopify_client import (
    ShopifyGraphQLClient,
    ShopifyCompareQuantityMismatchError,
    ShopifyUserError,
)
from app.services.shopify_inventory_service import (
    generate_inventory_idempotency_key,
    enqueue_inventory_sync,
    process_inventory_queue_task,
)


@pytest.fixture
def db():
    session = SessionLocal()
    session.info["skip_tenant_isolation"] = True
    yield session
    session.close()


@pytest.fixture
def test_store_and_product(db: Session):
    suffix = uuid.uuid4().hex[:6]
    user = User(
        id=str(uuid.uuid4()),
        email=f"user_3a_{suffix}@test.com",
        name=f"User 3A {suffix}",
        hashed_password="pw",
        role="ADMIN",
    )
    db.add(user)
    db.flush()

    store = Store(
        id=str(uuid.uuid4()),
        name=f"Store 3A {suffix}",
        slug=f"store-3a-{suffix}",
        domain=f"store3a-{suffix}.myshopify.com",
        owner_id=user.id,
    )
    db.add(store)
    db.flush()

    conn = ShopifyConnection(
        id=str(uuid.uuid4()),
        store_id=store.id,
        shop_domain=f"test-3a-{suffix}.myshopify.com",
        status="CONNECTED",
        api_version="2026-10",
        sync_inventory=True,
        settings={"location_id": "loc_test_3a"},
    )
    conn.set_access_token("shpat_test_token_phase_3a")
    db.add(conn)

    product = Product(
        id=str(uuid.uuid4()),
        store_id=store.id,
        name=f"Produit 3A {suffix}",
        slug=f"produit-3a-{suffix}",
        sku=f"SKU-3A-{suffix}",
        price=3500.0,
        stock=25,
        reserved_stock=5,  # available = 20
        is_active=True,
    )
    db.add(product)
    from app.models.shopify import ShopifyMapping
    db.add(ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store.id,
        entity_type="PRODUCT",
        internal_id=product.id,
        shopify_id="sh_prod_test_3a",
        shopify_secondary_id="inv_item_test_3a",
        extra_data={"inventory_item_id": "inv_item_test_3a"},
    ))
    db.commit()

    return store, conn, product


# ─── 1. API Version Verification ─────────────────────────────────────────────

def test_default_api_version_is_2026_10():
    """Verify that models, defaults, and client instantiate with '2026-10'."""
    assert SHOPIFY_API_VERSION_DEFAULT == "2026-10"
    conn = ShopifyConnection(
        id=str(uuid.uuid4()),
        store_id=str(uuid.uuid4()),
        shop_domain="default-ver.myshopify.com",
    )
    assert conn.api_version == "2026-10"

    client = ShopifyGraphQLClient(
        shop_domain="default-ver.myshopify.com",
        access_token="shpat_test",
    )
    assert client.api_version == "2026-10"
    assert client.endpoint == "https://default-ver.myshopify.com/admin/api/2026-10/graphql.json"


def test_client_constructs_url_with_configured_api_version():
    """Verify that configured version is accurately reflected in request URL."""
    custom_ver = "2026-07"
    client = ShopifyGraphQLClient(
        shop_domain="custom-ver.myshopify.com",
        access_token="shpat_test",
        api_version=custom_ver,
    )
    assert client.api_version == custom_ver
    assert client.endpoint == f"https://custom-ver.myshopify.com/admin/api/{custom_ver}/graphql.json"


def test_client_detects_x_shopify_api_version_header_fallback():
    """Verify inspection of X-Shopify-API-Version header to detect automatic version fallback."""
    client = ShopifyGraphQLClient(
        shop_domain="fallback-test.myshopify.com",
        access_token="shpat_test",
        api_version="2026-10",
    )

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {"X-Shopify-API-Version": "2026-07"}  # Shopify rolled back
    mock_response.json.return_value = {"data": {"shop": {"name": "Test"}}}

    with patch("httpx.Client.post", return_value=mock_response):
        data = client.execute_graphql("query { shop { name } }")
        assert data == {"shop": {"name": "Test"}}
        assert client.last_api_version == "2026-07"


# ─── 2. GraphQL @idempotent Directive & Idempotency Key ──────────────────────

def test_mutation_uses_idempotent_directive_and_passes_key():
    """Verify mutation uses @idempotent(key: $idempotencyKey) and passes key in variables."""
    client = ShopifyGraphQLClient(
        shop_domain="idemp-test.myshopify.com",
        access_token="shpat_test",
        api_version="2026-10",
    )

    executed_query = None
    executed_vars = None

    def fake_execute(query, variables):
        nonlocal executed_query, executed_vars
        executed_query = query
        executed_vars = variables
        return {
            "inventorySetQuantities": {
                "inventoryAdjustmentGroup": {"id": "gid://shopify/Group/1", "changes": []},
                "userErrors": [],
            }
        }

    client.execute_graphql = fake_execute

    client.set_inventory_quantities(
        inventory_item_id="111222",
        location_id="333444",
        quantity=15,
        compare_quantity=10,
        idempotency_key="idemp_key_custom_123",
    )

    assert "@idempotent(key: $idempotencyKey)" in executed_query
    assert "$idempotencyKey: String!" in executed_query
    assert executed_vars["idempotencyKey"] == "idemp_key_custom_123"
    assert executed_vars["input"]["quantities"][0]["quantity"] == 15
    assert executed_vars["input"]["quantities"][0]["changeFromQuantity"] == 10
    assert "ignoreCompareQuantity" not in executed_vars["input"]


def test_mutation_uses_change_from_quantity_for_2026_10_and_compare_quantity_for_legacy():
    """Verify schema differences: 2026-10 uses changeFromQuantity, legacy uses compareQuantity + ignoreCompareQuantity."""
    executed_2026 = None
    client_2026 = ShopifyGraphQLClient("store.myshopify.com", "tok", api_version="2026-10")
    client_2026.execute_graphql = lambda q, v: (setattr(client_2026, "_last_vars", v), {"inventorySetQuantities": {}})[1]

    client_2026.set_inventory_quantities("1", "2", quantity=20, compare_quantity=18)
    assert client_2026._last_vars["input"]["quantities"][0]["changeFromQuantity"] == 18
    assert "ignoreCompareQuantity" not in client_2026._last_vars["input"]

    # Legacy 2024-01
    client_2024 = ShopifyGraphQLClient("store.myshopify.com", "tok", api_version="2024-01")
    client_2024.execute_graphql = lambda q, v: (setattr(client_2024, "_last_vars", v), {"inventorySetQuantities": {}})[1]

    client_2024.set_inventory_quantities("1", "2", quantity=20, compare_quantity=18)
    assert client_2024._last_vars["input"]["quantities"][0]["compareQuantity"] == 18
    assert client_2024._last_vars["input"]["ignoreCompareQuantity"] is False


def test_idempotency_key_stability_and_retry_reuse():
    """Verify idempotency key is deterministic and stable across retries of the same revision."""
    key1 = generate_inventory_idempotency_key(
        store_id="store_1",
        product_id="prod_1",
        variant_sku="SKU-A",
        shopify_inventory_item_id="inv_1",
        shopify_location_id="loc_1",
        stock_revision=1,
        target_quantity=10,
    )
    key2 = generate_inventory_idempotency_key(
        store_id="store_1",
        product_id="prod_1",
        variant_sku="SKU-A",
        shopify_inventory_item_id="inv_1",
        shopify_location_id="loc_1",
        stock_revision=1,
        target_quantity=10,
    )
    assert key1 == key2


def test_idempotency_key_changes_on_new_revision():
    """Verify that incrementing stock revision produces a distinct key."""
    key_rev1 = generate_inventory_idempotency_key(
        store_id="store_1",
        product_id="prod_1",
        variant_sku="SKU-A",
        shopify_inventory_item_id="inv_1",
        shopify_location_id="loc_1",
        stock_revision=1,
        target_quantity=10,
    )
    key_rev2 = generate_inventory_idempotency_key(
        store_id="store_1",
        product_id="prod_1",
        variant_sku="SKU-A",
        shopify_inventory_item_id="inv_1",
        shopify_location_id="loc_1",
        stock_revision=2,
        target_quantity=10,
    )
    assert key_rev1 != key_rev2


def test_idempotency_key_never_reused_for_different_parameters():
    """Verify that different parameters (quantities, SKUs, locations) yield different keys."""
    key_qty10 = generate_inventory_idempotency_key(
        store_id="store_1", product_id="prod_1", variant_sku="SKU-A",
        shopify_inventory_item_id="inv_1", shopify_location_id="loc_1",
        stock_revision=1, target_quantity=10,
    )
    key_qty12 = generate_inventory_idempotency_key(
        store_id="store_1", product_id="prod_1", variant_sku="SKU-A",
        shopify_inventory_item_id="inv_1", shopify_location_id="loc_1",
        stock_revision=1, target_quantity=12,
    )
    key_sku_b = generate_inventory_idempotency_key(
        store_id="store_1", product_id="prod_1", variant_sku="SKU-B",
        shopify_inventory_item_id="inv_1", shopify_location_id="loc_1",
        stock_revision=1, target_quantity=10,
    )
    assert key_qty10 != key_qty12
    assert key_qty10 != key_sku_b


# ─── 3. Concurrency & Queue Resilience ───────────────────────────────────────

def test_concurrency_new_revision_while_task_processing(db: Session, test_store_and_product):
    """Verify that when a task is PROCESSING, a new stock change enqueues with revision + 1."""
    store, conn, product = test_store_and_product

    # Task A is created and set to PROCESSING
    task_a = enqueue_inventory_sync(db, product_id=product.id)
    assert task_a is not None
    assert task_a.stock_revision == 1
    task_a.status = "PROCESSING"
    db.commit()

    # Product stock changes in ERP
    product.stock = 30  # available = 30 - 5 = 25
    db.commit()

    # New stock movement enqueues
    task_b = enqueue_inventory_sync(db, product_id=product.id)
    assert task_b is not None
    assert task_b.id != task_a.id
    assert task_b.stock_revision == 2
    assert task_b.target_quantity == 25
    assert task_b.idempotency_key != task_a.idempotency_key
    assert task_b.status == "PENDING"


def test_late_http_response_does_not_override_newer_success(db: Session, test_store_and_product):
    """Verify that an obsolete response does not corrupt state if a newer revision already succeeded."""
    store, conn, product = test_store_and_product

    task_a = ShopifyInventorySyncQueue(
        id=str(uuid.uuid4()),
        store_id=store.id,
        product_id=product.id,
        shopify_inventory_item_id="inv_1",
        shopify_location_id="loc_test_3a",
        target_quantity=20,
        status="PENDING",
        stock_revision=1,
        idempotency_key="key_rev_1",
    )
    db.add(task_a)
    db.commit()

    # While Task A's HTTP call is in flight, Task B completes with SUCCESS
    def side_effect_success(*args, **kwargs):
        task_b = ShopifyInventorySyncQueue(
            id=str(uuid.uuid4()),
            store_id=store.id,
            product_id=product.id,
            shopify_inventory_item_id="inv_1",
            shopify_location_id="loc_test_3a",
            target_quantity=25,
            status="SUCCESS",
            stock_revision=2,
            idempotency_key="key_rev_2",
        )
        db.add(task_b)
        db.commit()
        return {"inventoryAdjustmentGroup": {}}

    mock_client = MagicMock()
    mock_client.set_inventory_quantities.side_effect = side_effect_success

    # Late response from Task A completes
    success = process_inventory_queue_task(db, task_a.id, client=mock_client)
    assert success is True

    db.refresh(task_a)
    # Task A was detected as superseded and marked COALESCED
    assert task_a.status == "COALESCED"
    assert "déjà publiée" in (task_a.last_error or "")


def test_late_http_response_syncs_previous_quantity_to_pending(db: Session, test_store_and_product):
    """Verify that when Task A completes, a newer PENDING Task B gets its previous_quantity aligned."""
    store, conn, product = test_store_and_product

    task_a = ShopifyInventorySyncQueue(
        id=str(uuid.uuid4()),
        store_id=store.id,
        product_id=product.id,
        shopify_inventory_item_id="inv_1",
        shopify_location_id="loc_test_3a",
        target_quantity=20,
        status="PENDING",
        stock_revision=1,
        idempotency_key="key_rev_1",
    )
    db.add(task_a)
    db.commit()

    # While Task A's HTTP call is in flight, Task B arrives in PENDING state
    def side_effect_pending(*args, **kwargs):
        task_b = ShopifyInventorySyncQueue(
            id=str(uuid.uuid4()),
            store_id=store.id,
            product_id=product.id,
            shopify_inventory_item_id="inv_1",
            shopify_location_id="loc_test_3a",
            target_quantity=25,
            status="PENDING",
            stock_revision=2,
            idempotency_key="key_rev_2",
        )
        db.add(task_b)
        db.commit()
        return {"inventoryAdjustmentGroup": {}}

    mock_client = MagicMock()
    mock_client.set_inventory_quantities.side_effect = side_effect_pending

    process_inventory_queue_task(db, task_a.id, client=mock_client)

    db.refresh(task_a)
    assert task_a.status == "SUCCESS"
    assert "en attente" in (task_a.last_error or "")

    # Retrieve Task B and check that previous_quantity was aligned
    task_b = db.query(ShopifyInventorySyncQueue).filter(
        ShopifyInventorySyncQueue.store_id == store.id,
        ShopifyInventorySyncQueue.stock_revision == 2,
    ).first()
    assert task_b is not None
    assert task_b.previous_quantity == 20


# ─── 4. Safe Upgrade Procedure for Obsolete API Versions ─────────────────────

def test_upgrade_obsolete_api_versions_endpoint(db: Session):
    """Test explicit upgrade procedure upgrades obsolete versions and preserves valid ones."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.security import create_access_token

    # Create admin user
    suffix = uuid.uuid4().hex[:6]
    admin = User(
        id=str(uuid.uuid4()),
        email=f"admin_{suffix}@test.com",
        name=f"Admin {suffix}",
        hashed_password="pw",
        role="SUPER_ADMIN",
    )
    db.add(admin)
    db.flush()

    store_old = Store(id=str(uuid.uuid4()), name=f"Store Old {suffix}", slug=f"old-{suffix}", owner_id=admin.id)
    store_modern = Store(id=str(uuid.uuid4()), name=f"Store Modern {suffix}", slug=f"modern-{suffix}", owner_id=admin.id)
    db.add_all([store_old, store_modern])
    db.flush()

    # Connection with obsolete version 2024-04
    conn_old = ShopifyConnection(
        id=str(uuid.uuid4()),
        store_id=store_old.id,
        shop_domain=f"old-{suffix}.myshopify.com",
        api_version="2024-04",
        status="CONNECTED",
    )
    # Connection with custom modern version 2026-07
    conn_modern = ShopifyConnection(
        id=str(uuid.uuid4()),
        store_id=store_modern.id,
        shop_domain=f"modern-{suffix}.myshopify.com",
        api_version="2026-07",
        status="CONNECTED",
    )
    db.add_all([conn_old, conn_modern])
    db.commit()

    token = create_access_token(subject=admin.id)
    client = TestClient(app)

    response = client.post(
        "/api/v1/shopify/connections/upgrade-versions?target_version=2026-10",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["status"] == "success"
    assert res_data["target_version"] == "2026-10"

    db.refresh(conn_old)
    db.refresh(conn_modern)
    # Obsolete version upgraded to 2026-10
    assert conn_old.api_version == "2026-10"
    # Modern version preserved without blind overwrite
    assert conn_modern.api_version == "2026-07"


# ─── 5. Scénario Requis : Révision 10 Tardive & Révision 11 Traitée ───────────

def test_scenario_rev_10_late_response_and_rev_11_processed(db: Session, test_store_and_product):
    """
    Test strictly validating the requested scenario:
      1. La révision 10 est envoyée vers Shopify (état PROCESSING).
      2. Une nouvelle opération crée la révision 11 (état PENDING).
      3. La réponse tardive de la révision 10 arrive.
      4. La révision 11 reste à synchroniser et finit par être traitée (quantité ERP finale publiée).
    """
    store, conn, product = test_store_and_product

    # Step 1: Révision 10 envoyée vers Shopify
    task_10 = ShopifyInventorySyncQueue(
        id=str(uuid.uuid4()),
        store_id=store.id,
        product_id=product.id,
        shopify_inventory_item_id="inv_item_test_3a",
        shopify_location_id="loc_test_3a",
        target_quantity=20,
        status="PROCESSING",
        stock_revision=10,
        idempotency_key="idemp_rev_10",
        attempts=1,
    )
    db.add(task_10)
    db.commit()

    # Step 2: Une nouvelle opération crée la révision 11
    product.stock = 33  # available = 33 - 5 = 28
    db.commit()

    task_11 = enqueue_inventory_sync(db, product_id=product.id)
    assert task_11 is not None
    assert task_11.stock_revision == 11
    assert task_11.status == "PENDING"
    assert task_11.target_quantity == 28
    assert task_11.idempotency_key != task_10.idempotency_key
    db.commit()

    # Step 3: La réponse tardive de la révision 10 arrive
    published_quantities = []

    mock_client = MagicMock()
    def fake_set_quantities(**kwargs):
        published_quantities.append(kwargs["quantity"])
        return {"inventoryAdjustmentGroup": {"id": "adj_1"}}

    mock_client.set_inventory_quantities.side_effect = fake_set_quantities

    # Exécution de la réponse tardive de la tâche 10
    success_10 = process_inventory_queue_task(db, task_10.id, client=mock_client)
    assert success_10 is True

    db.refresh(task_10)
    db.refresh(task_11)

    # Révision 10 complétée sans corrompre ni marquer terminée la révision 11
    assert task_10.status == "SUCCESS"
    assert "révision 11 est en attente" in task_10.last_error

    # Révision 11 DOIT rester en attente de synchronisation !
    assert task_11.status == "PENDING"
    assert task_11.stock_revision == 11
    # previous_quantity de la révision 11 a été alignée sur la quantité appliquée par la 10 (20)
    assert task_11.previous_quantity == 20

    # Step 4: La révision 11 reste à synchroniser et finit par être traitée
    success_11 = process_inventory_queue_task(db, task_11.id, client=mock_client)
    assert success_11 is True

    db.refresh(task_11)
    assert task_11.status == "SUCCESS"
    assert task_11.target_quantity == 28

    # Vérification que la dernière quantité de l'ERP (28) a bien été publiée sur Shopify
    assert published_quantities == [20, 28]
    assert published_quantities[-1] == 28


# ─── 6. Reprise après interruption (Crash Recovery) ──────────────────────────

def test_crash_recovery_after_http_send_before_db_commit(db: Session, test_store_and_product):
    """
    Vérifie la reprise après une interruption survenue après l'envoi HTTP
    mais avant l'enregistrement du succès en PostgreSQL :
      - Tâche bloquée en PROCESSING lors d'un crash.
      - reclaim_stuck_processing_inventory_syncs la replace en PENDING.
      - La clé d'idempotence originale est strictement conservée.
      - Au rejeu, Shopify applique la directive @idempotent sans double-ajustement de stock.
    """
    from app.services.shopify_inventory_service import reclaim_stuck_processing_inventory_syncs
    store, conn, product = test_store_and_product

    original_key = "idemp_crash_safe_999"
    stuck_task = ShopifyInventorySyncQueue(
        id=str(uuid.uuid4()),
        store_id=store.id,
        product_id=product.id,
        shopify_inventory_item_id="inv_item_crash",
        shopify_location_id="loc_test_3a",
        target_quantity=20,
        status="PROCESSING",  # Resté bloqué lors de l'arrêt du processus
        stock_revision=5,
        idempotency_key=original_key,
        attempts=1,
    )
    db.add(stuck_task)
    db.commit()

    # Récupération automatique des tâches bloquées
    reclaimed_count = reclaim_stuck_processing_inventory_syncs(db, store_id=store.id, max_age_seconds=0)
    assert reclaimed_count == 1

    db.refresh(stuck_task)
    assert stuck_task.status == "PENDING"
    # Clé d'idempotence originale conservée
    assert stuck_task.idempotency_key == original_key
    assert "Reprise après interruption" in stuck_task.last_error

    # Rejeu par le worker
    mock_client = MagicMock()
    mock_client.set_inventory_quantities.return_value = {"inventoryAdjustmentGroup": {"id": "adj_replayed"}}

    res = process_inventory_queue_task(db, stuck_task.id, client=mock_client)
    assert res is True

    # Vérification que la clé d'idempotence passée au client Shopify est bien la clé originale
    mock_client.set_inventory_quantities.assert_called_once()
    call_kwargs = mock_client.set_inventory_quantities.call_args.kwargs
    assert call_kwargs["idempotency_key"] == original_key
    assert call_kwargs["quantity"] == 20

    db.refresh(stuck_task)
    assert stuck_task.status == "SUCCESS"

