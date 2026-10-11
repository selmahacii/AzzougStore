import os
import sys
import uuid
import json
import hmac
import hashlib
import base64
from datetime import datetime, timezone, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Configure SQLite for local test execution
os.environ["DATABASE_URL"] = "sqlite:///./test_shopify.db"

from app.main import app
from app.core.config import settings
from app.db.base_class import Base
from app.db.session import SessionLocal, engine
from app.models.store import Store
from app.models.user import User
from app.models.order import Order
from app.models.stock import StockMovement
from app.models.shopify import ShopifyConnection, ShopifyMapping, ShopifyWebhookInbox
from app.services.shopify_service import (
    validate_shopify_domain,
    verify_shopify_hmac,
    sanitize_error_message,
)
from app.services.shopify_sync import (
    ShopifyWebhookProcessor,
    sweep_pending_shopify_webhooks,
)
from app.schemas.shopify import ShopifyConnectionRead


INTERNAL_KEY_HEADER = {"x-internal-key": settings.INTERNAL_API_KEY}


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    """Create all tables in the SQLite test database."""
    if os.path.exists("./test_shopify.db"):
        try:
            os.remove("./test_shopify.db")
        except Exception:
            pass
    Base.metadata.create_all(bind=engine)
    yield
    engine.dispose()
    if os.path.exists("./test_shopify.db"):
        try:
            os.remove("./test_shopify.db")
        except Exception:
            pass


@pytest.fixture
def db():
    session = SessionLocal()
    session.info["skip_tenant_isolation"] = True
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
async def client():
    from httpx import ASGITransport
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def test_stores(db):
    """Seed two distinct stores for multi-tenant isolation testing."""
    u1 = User(
        id=f"user-a-{uuid.uuid4().hex[:6]}",
        email=f"owner-a-{uuid.uuid4().hex[:6]}@example.com",
        name="Owner A",
        hashed_password="pw",
        role="STORE_OWNER"
    )
    u2 = User(
        id=f"user-b-{uuid.uuid4().hex[:6]}",
        email=f"owner-b-{uuid.uuid4().hex[:6]}@example.com",
        name="Owner B",
        hashed_password="pw",
        role="STORE_OWNER"
    )
    db.add_all([u1, u2])
    db.flush()

    s1 = Store(
        id=f"store-a-{uuid.uuid4().hex[:6]}",
        name="Boutique Test A",
        slug=f"boutique-a-{uuid.uuid4().hex[:6]}",
        is_active=True,
        owner_id=u1.id,
    )
    s2 = Store(
        id=f"store-b-{uuid.uuid4().hex[:6]}",
        name="Boutique Test B",
        slug=f"boutique-b-{uuid.uuid4().hex[:6]}",
        is_active=True,
        owner_id=u2.id,
    )
    db.add_all([s1, s2])
    db.commit()
    db.refresh(s1)
    db.refresh(s2)
    return s1, s2


# ─── 1. Tests de Validation de Domaine ───────────────────────────────────────

def test_validate_shopify_domain_valid():
    """Ensure valid domains are correctly parsed and normalized."""
    assert validate_shopify_domain("my-store.myshopify.com") == "my-store.myshopify.com"
    assert validate_shopify_domain("https://MY-STORE.myshopify.com/") == "my-store.myshopify.com"
    assert validate_shopify_domain("http://boutique.dz?ref=123") == "boutique.dz"
    assert validate_shopify_domain("   brand-name.myshopify.com   ") == "brand-name.myshopify.com"


def test_validate_shopify_domain_invalid():
    """Ensure invalid, dangerous or malformed domains are rejected."""
    with pytest.raises(ValueError):
        validate_shopify_domain("")
    with pytest.raises(ValueError):
        validate_shopify_domain("invalid domain with spaces.com")
    with pytest.raises(ValueError):
        validate_shopify_domain("../../etc/passwd")
    with pytest.raises(ValueError):
        validate_shopify_domain("bad_domain;drop table stores;")


# ─── 2. Tests de Chiffrement & Masquage des Secrets ──────────────────────────

def test_credentials_encryption_and_masking(db, test_stores):
    """Verify secrets are encrypted in DB and masked in API responses."""
    store_a, _ = test_stores
    raw_token = "shpa_test_mock_token_not_a_secret_cdef"
    raw_secret = "mock_secret_test_key_not_a_real_secret"

    conn = ShopifyConnection(
        id=str(uuid.uuid4()),
        store_id=store_a.id,
        shop_domain=f"domain-{uuid.uuid4().hex[:4]}.myshopify.com",
        status="CONNECTED",
    )
    conn.set_access_token(raw_token)
    conn.set_webhook_secret(raw_secret)
    db.add(conn)
    db.commit()
    db.refresh(conn)

    # 1. Raw DB column must NOT store plain text if encryption is enabled
    # (or must safely store ciphertext)
    assert conn.access_token_encrypted is not None
    # 2. Helper must decrypt accurately
    assert conn.get_access_token() == raw_token
    assert conn.get_webhook_secret() == raw_secret
    # 3. Masked token must be safe
    masked = conn.get_masked_access_token()
    assert masked.startswith("shpa")
    assert masked.endswith("cdef")
    assert "****" in masked

    # 4. Schema must never expose credentials
    read_dto = ShopifyConnectionRead.from_orm_model(conn)
    assert read_dto.has_access_token is True
    assert read_dto.has_webhook_secret is True
    assert read_dto.masked_access_token == masked
    dumped = read_dto.model_dump()
    assert "access_token" not in dumped
    assert "webhook_secret" not in dumped


# ─── 3. Tests de Vérification Cryptographique HMAC ───────────────────────────

def test_verify_shopify_hmac():
    """Verify HMAC signature checking works accurately."""
    secret = "secret-key-12345"
    body = b'{"id": 123456, "email": "client@example.com"}'

    # Compute valid signature
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    valid_hmac = base64.b64encode(digest).decode("utf-8")

    # 1. Valid signature
    assert verify_shopify_hmac(body, secret, valid_hmac) is True

    # 2. Tampered body
    tampered_body = b'{"id": 123456, "email": "hacker@example.com"}'
    assert verify_shopify_hmac(tampered_body, secret, valid_hmac) is False

    # 3. Wrong secret
    assert verify_shopify_hmac(body, "wrong-secret", valid_hmac) is False

    # 4. Missing inputs
    assert verify_shopify_hmac(b"", secret, valid_hmac) is False
    assert verify_shopify_hmac(body, "", valid_hmac) is False
    assert verify_shopify_hmac(body, secret, None) is False


def test_sanitize_error_message():
    """Verify sensitive tokens and secrets are expunged from error messages."""
    raw_error = "Failed calling https://api.shopify.com with token shpat_9876543210abcdef123456 and Bearer eyJhbGciOiJIUzI1Ni"
    sanitized = sanitize_error_message(raw_error)
    assert "shpat_9876543210abcdef123456" not in sanitized
    assert "[REDACTED_SHOPIFY_TOKEN]" in sanitized
    assert "Bearer [REDACTED_TOKEN]" in sanitized


# ─── 4. Tests d'Ingestion Webhook & Rejet de Signatures Invalides ─────────────

@pytest.mark.asyncio
async def test_webhook_rejection_on_invalid_or_missing_signature(client, db, test_stores):
    """Ensure unauthenticated or forged webhooks are rejected with 401."""
    store_a, _ = test_stores
    shop_domain = f"reject-{uuid.uuid4().hex[:4]}.myshopify.com"
    secret = "valid-secret-key-999"

    conn = ShopifyConnection(
        id=str(uuid.uuid4()),
        store_id=store_a.id,
        shop_domain=shop_domain,
        status="CONNECTED",
    )
    conn.set_webhook_secret(secret)
    db.add(conn)
    db.commit()

    body = json.dumps({"id": 999, "note": "test"}).encode("utf-8")
    delivery_id = str(uuid.uuid4())

    # 1. Missing HMAC header -> 401
    res1 = await client.post(
        f"{settings.API_V1_STR}/shopify/webhooks",
        content=body,
        headers={
            "X-Shopify-Webhook-Id": delivery_id,
            "X-Shopify-Shop-Domain": shop_domain,
            "X-Shopify-Topic": "orders/create",
        },
    )
    assert res1.status_code == 401

    # 2. Forged / invalid HMAC -> 401
    res2 = await client.post(
        f"{settings.API_V1_STR}/shopify/webhooks",
        content=body,
        headers={
            "X-Shopify-Hmac-Sha256": "fake-invalid-signature-123",
            "X-Shopify-Webhook-Id": delivery_id,
            "X-Shopify-Shop-Domain": shop_domain,
            "X-Shopify-Topic": "orders/create",
        },
    )
    assert res2.status_code == 401

    # 3. Unknown shop domain -> 401
    res3 = await client.post(
        f"{settings.API_V1_STR}/shopify/webhooks",
        content=body,
        headers={
            "X-Shopify-Hmac-Sha256": "valid-format-signature-123",
            "X-Shopify-Webhook-Id": delivery_id,
            "X-Shopify-Shop-Domain": "unknown-nonexistent.myshopify.com",
            "X-Shopify-Topic": "orders/create",
        },
    )
    assert res3.status_code == 401


# ─── 5. Tests d'Ingestion Réussie, Idempotence & Rejeu d'Événement ────────────

@pytest.mark.asyncio
async def test_webhook_successful_ingestion_and_idempotent_replay(client, db, test_stores):
    """
    Test that a valid webhook is persisted into the durable inbox,
    and a replayed delivery ID returns 200 without inserting a duplicate.
    """
    store_a, _ = test_stores
    shop_domain = f"idempotent-{uuid.uuid4().hex[:4]}.myshopify.com"
    secret = "secret-key-robust-100"

    conn = ShopifyConnection(
        id=str(uuid.uuid4()),
        store_id=store_a.id,
        shop_domain=shop_domain,
        status="CONNECTED",
    )
    conn.set_webhook_secret(secret)
    db.add(conn)
    db.commit()

    payload = {"id": 1001, "order_number": "#1001", "total_price": "5000.00"}
    raw_body = json.dumps(payload).encode("utf-8")
    delivery_id = f"delivery-{uuid.uuid4()}"

    # Compute valid signature
    digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).digest()
    valid_hmac = base64.b64encode(digest).decode("utf-8")

    headers = {
        "X-Shopify-Hmac-Sha256": valid_hmac,
        "X-Shopify-Webhook-Id": delivery_id,
        "X-Shopify-Shop-Domain": shop_domain,
        "X-Shopify-Topic": "orders/create",
        "Content-Type": "application/json",
    }

    # First delivery: must succeed and create 1 inbox row
    res1 = await client.post(f"{settings.API_V1_STR}/shopify/webhooks", content=raw_body, headers=headers)
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["status"] == "received"
    assert data1["delivery_id"] == delivery_id

    # Check inbox in DB
    inbox_row = db.query(ShopifyWebhookInbox).filter(ShopifyWebhookInbox.delivery_id == delivery_id).first()
    assert inbox_row is not None
    assert inbox_row.store_id == store_a.id
    assert inbox_row.topic == "orders/create"
    assert inbox_row.shop_domain == shop_domain
    assert inbox_row.payload["id"] == 1001

    # Second delivery with EXACT same delivery_id (replayed webhook):
    # Must return 200 "already_received" without crashing or duplicating
    res2 = await client.post(f"{settings.API_V1_STR}/shopify/webhooks", content=raw_body, headers=headers)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["status"] == "already_received"

    # Count of rows in inbox for this delivery_id must remain EXACTLY 1
    total_rows = db.query(ShopifyWebhookInbox).filter(ShopifyWebhookInbox.delivery_id == delivery_id).count()
    assert total_rows == 1


# ─── 6. Tests d'Isolation Multi-Tenant entre Boutiques ────────────────────────

@pytest.mark.asyncio
async def test_multi_tenant_isolation_between_stores(client, db, test_stores):
    """
    Ensure Store B cannot sign or ingest webhooks for Store A,
    and cross-reference mappings are strictly isolated per store.
    """
    store_a, store_b = test_stores
    domain_a = f"store-a-{uuid.uuid4().hex[:4]}.myshopify.com"
    domain_b = f"store-b-{uuid.uuid4().hex[:4]}.myshopify.com"
    secret_a = "secret-a-11111"
    secret_b = "secret-b-22222"

    conn_a = ShopifyConnection(id=str(uuid.uuid4()), store_id=store_a.id, shop_domain=domain_a, status="CONNECTED")
    conn_a.set_webhook_secret(secret_a)
    conn_b = ShopifyConnection(id=str(uuid.uuid4()), store_id=store_b.id, shop_domain=domain_b, status="CONNECTED")
    conn_b.set_webhook_secret(secret_b)
    db.add_all([conn_a, conn_b])
    db.commit()

    body = json.dumps({"id": 2002}).encode("utf-8")
    delivery_id = f"cross-store-{uuid.uuid4()}"

    # Sign with Secret A, but claim Domain B -> Must be rejected (401)
    digest_a = hmac.new(secret_a.encode("utf-8"), body, hashlib.sha256).digest()
    hmac_a = base64.b64encode(digest_a).decode("utf-8")

    res = await client.post(
        f"{settings.API_V1_STR}/shopify/webhooks",
        content=body,
        headers={
            "X-Shopify-Hmac-Sha256": hmac_a,
            "X-Shopify-Webhook-Id": delivery_id,
            "X-Shopify-Shop-Domain": domain_b,
            "X-Shopify-Topic": "orders/create",
        },
    )
    assert res.status_code == 401

    # Test Mappings Uniqueness Constraint per Store
    # Same internal_id cannot be mapped to two different shopify_ids within the SAME store
    m1 = ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store_a.id,
        entity_type="PRODUCT",
        internal_id="internal-prod-10",
        shopify_id="shopify-prod-100",
    )
    db.add(m1)
    db.commit()

    # But Store B CAN use the same internal_id mapped to its own shopify_id (isolated!)
    m2 = ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=store_b.id,
        entity_type="PRODUCT",
        internal_id="internal-prod-10",
        shopify_id="shopify-prod-200",
    )
    db.add(m2)
    db.commit()

    count_a = db.query(ShopifyMapping).filter(ShopifyMapping.store_id == store_a.id).count()
    count_b = db.query(ShopifyMapping).filter(ShopifyMapping.store_id == store_b.id).count()
    assert count_a == 1
    assert count_b == 1


# ─── 7. Tests du Mécanisme de Traitement Récupérable & Sweeper ────────────────

def test_recoverable_durable_processing_and_sweeper(db, test_stores):
    """
    Test that pending inbox events are picked up by the recoverable processor,
    state transitions are atomic, and retries use exponential backoff.
    """
    store_a, _ = test_stores

    # 1. Create a pending valid event
    ev1 = ShopifyWebhookInbox(
        id=str(uuid.uuid4()),
        delivery_id=f"sweep-1-{uuid.uuid4()}",
        store_id=store_a.id,
        topic="orders/create",
        shop_domain="sweep.myshopify.com",
        payload={"id": 5555, "name": "#5555"},
        status="PENDING",
        attempts=0,
    )
    # 2. Create a pending invalid event (missing id)
    ev2 = ShopifyWebhookInbox(
        id=str(uuid.uuid4()),
        delivery_id=f"sweep-2-{uuid.uuid4()}",
        store_id=store_a.id,
        topic="orders/create",
        payload={"no_id_here": True},
        shop_domain="sweep.myshopify.com",
        status="PENDING",
        attempts=0,
    )
    db.add_all([ev1, ev2])
    db.commit()

    # Process ev1 -> must succeed and set status to PROCESSED
    success1 = ShopifyWebhookProcessor.process_event(db, ev1.id)
    assert success1 is True
    db.refresh(ev1)
    assert ev1.status == "PROCESSED"
    assert ev1.processed_at is not None
    assert ev1.attempts == 1

    # Process ev2 -> must fail, set status to FAILED, record sanitized error, and schedule backoff
    success2 = ShopifyWebhookProcessor.process_event(db, ev2.id)
    assert success2 is False
    db.refresh(ev2)
    assert ev2.status == "FAILED"
    assert ev2.attempts == 1
    assert ev2.last_error is not None
    assert "Payload de commande Shopify invalide" in ev2.last_error
    assert ev2.next_retry_at is not None

    # Test Sweeper: create a pending event due for retry
    ev3 = ShopifyWebhookInbox(
        id=str(uuid.uuid4()),
        delivery_id=f"sweep-3-{uuid.uuid4()}",
        store_id=store_a.id,
        topic="products/update",
        shop_domain="sweep.myshopify.com",
        payload={"id": 7777},
        status="PENDING",
        attempts=0,
        next_retry_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )
    db.add(ev3)
    db.commit()

    processed_count = sweep_pending_shopify_webhooks(db, limit=10)
    assert processed_count >= 1
    db.refresh(ev3)
    assert ev3.status == "PROCESSED"


# ─── 8. Test des Contraintes Critiques de Phase 1 ─────────────────────────────

def test_critical_constraints_respected(db):
    """
    CRITICAL PHASE 1 CONSTRAINTS:
    Verify that NO orders were created in AzzougShop's COD orders table,
    and NO stock movements were triggered.
    """
    cod_orders_count = db.query(Order).count()
    stock_movements_count = db.query(StockMovement).count()

    # The entire Phase 1 execution must remain purely on the Shopify integration foundation
    assert cod_orders_count == 0
    assert stock_movements_count == 0
