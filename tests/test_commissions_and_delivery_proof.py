"""
Tests for the new no-migration ERP features added to the orders module:
commissions (confirmatrice/livreur, stored in Store.operations_config) and
delivery-proof photo upload (stored via AuditLog.diff).

Also regression-tests the exact route-ordering bug class fixed twice this
session (GET /orders/commissions vs GET /orders/{id}) — a request to
/orders/commissions must never be swallowed by the {id} wildcard route.

Real Postgres (row locks, JSON mutation tracking) — no SQLite, matching the
rest of this test suite's convention.
"""
import os
import sys
import uuid

import pytest
from httpx import AsyncClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
from app.core.config import settings

INTERNAL_KEY_HEADER = {"x-internal-key": settings.INTERNAL_API_KEY}


@pytest.fixture(scope="session", autouse=True)
def _seed_superadmin():
    from app.db.session import SessionLocal
    from app.models.user import User
    from app.core.security import get_password_hash

    db = SessionLocal()
    try:
        if not db.query(User).filter(User.role == "SUPER_ADMIN").first():
            db.add(User(
                id=str(uuid.uuid4()), email="commissions-test@azzougshop.test",
                name="Commissions Test", hashed_password=get_password_hash("test-only"),
                role="SUPER_ADMIN", is_active=True,
            ))
            db.commit()
    finally:
        db.close()


@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


def _get_admin_user_and_token():
    from app.db.session import SessionLocal
    from app.models.user import User
    from app.core.security import create_access_token

    db = SessionLocal()
    try:
        u = db.query(User).filter(User.role == "SUPER_ADMIN").first()
        return u.id, create_access_token(subject=u.id)
    finally:
        db.close()


async def _make_store(client, suffix):
    r = await client.post(
        f"{settings.API_V1_STR}/stores/",
        json={"name": f"Commission Store {suffix}", "slug": f"commission-store-{suffix}",
              "domain": f"commission-store-{suffix}.com", "template_id": "modern", "owner_id": "SYSTEM_ADMIN"},
        headers=INTERNAL_KEY_HEADER,
    )
    assert r.status_code == 200
    return r.json()["id"]


async def _make_product(client, store_id, suffix, stock=20):
    r = await client.post(
        f"{settings.API_V1_STR}/products/",
        json={"name": f"Product {suffix}", "description": "x", "price": 5000, "stock": stock,
              "category": "General", "sku": f"SKU-COM-{suffix}", "store_id": store_id, "is_active": True},
        headers=INTERNAL_KEY_HEADER,
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _make_order(client, store_id, suffix, product, assigned_to=None, livreur_id=None):
    payload = {
        "store_id": store_id, "customer_name": "Client Commission",
        "customer_phone": "072" + suffix[:7],
        "customer_address": "Alger", "customer_wilaya": "Alger",
        "delivery_type": "HOME", "delivery_fee": 0,
        "subtotal": 5000, "discount": 0, "total": 5000,
        "source": "landing_page",
        "items": [{"product_id": product["id"], "product_name": product["name"], "quantity": 1, "unit_price": 5000}],
    }
    r = await client.post(f"{settings.API_V1_STR}/orders/", json=payload, headers=INTERNAL_KEY_HEADER)
    assert r.status_code == 201, r.text
    order = r.json()
    if assigned_to or livreur_id:
        from app.db.session import SessionLocal
        from app.models.order import Order
        db = SessionLocal()
        try:
            o = db.query(Order).filter(Order.id == order["id"]).first()
            if assigned_to:
                o.assigned_to = assigned_to
            if livreur_id:
                o.livreur_id = livreur_id
            db.commit()
        finally:
            db.close()
    return order


async def _patch_status(client, order_id, status, token):
    return await client.patch(
        f"{settings.API_V1_STR}/orders/{order_id}",
        json={"status": status},
        headers={"Authorization": f"Bearer {token}"},
    )


# ─── 1. Route ordering: /orders/commissions must not be caught by /orders/{id} ──

@pytest.mark.asyncio
async def test_commissions_route_not_shadowed_by_order_id_route(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    _, token = _get_admin_user_and_token()

    r = await client.get(
        f"{settings.API_V1_STR}/orders/commissions?store_id={store_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    # A regression back to the old ordering would return 404 (OrderNotFoundError,
    # "commissions" treated as an order id) or a 422 UUID-parsing error instead
    # of the commissions payload.
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    assert "confirmatrices" in body["data"]
    assert "livreurs" in body["data"]


# ─── 2. Commission computation uses defaults when nothing configured ────────

@pytest.mark.asyncio
async def test_commission_computed_with_default_rates(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix)
    admin_id, token = _get_admin_user_and_token()

    order = await _make_order(client, store_id, suffix, product, assigned_to=admin_id, livreur_id=admin_id)
    for status in ("CONFIRMED", "SHIPPED", "DELIVERED"):
        r = await _patch_status(client, order["id"], status, token)
        assert r.status_code == 200, r.text

    r = await client.get(
        f"{settings.API_V1_STR}/orders/commissions?store_id={store_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["total_commandes_livrees"] == 1
    # Default: 2% of order total (5000) = 100 DA for the confirmatrice.
    assert len(data["confirmatrices"]) == 1
    assert data["confirmatrices"][0]["commission"] == pytest.approx(100.0)
    # Default: fixed 100 DA for the livreur.
    assert len(data["livreurs"]) == 1
    assert data["livreurs"][0]["commission"] == pytest.approx(100.0)


# ─── 3. Updating commission config changes subsequent computations ──────────

@pytest.mark.asyncio
async def test_commission_config_update_changes_rates(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix)
    admin_id, token = _get_admin_user_and_token()

    r = await client.patch(
        f"{settings.API_V1_STR}/orders/commissions/config",
        json={"store_id": store_id, "commission_confirmatrice_pct": 10.0, "commission_livreur_fixed": 500},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["commission_confirmatrice_pct"] == 10.0

    order = await _make_order(client, store_id, suffix, product, assigned_to=admin_id, livreur_id=admin_id)
    for status in ("CONFIRMED", "SHIPPED", "DELIVERED"):
        r = await _patch_status(client, order["id"], status, token)
        assert r.status_code == 200, r.text

    r = await client.get(
        f"{settings.API_V1_STR}/orders/commissions?store_id={store_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = r.json()["data"]
    assert data["rates"]["commission_confirmatrice_pct"] == 10.0
    # 10% of 5000 = 500 DA.
    assert data["confirmatrices"][0]["commission"] == pytest.approx(500.0)
    assert data["livreurs"][0]["commission"] == pytest.approx(500.0)


# ─── 4. Delivery-proof upload + retrieval round-trip ─────────────────────────

@pytest.mark.asyncio
async def test_delivery_proof_upload_and_retrieve(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix)
    _, token = _get_admin_user_and_token()
    order = await _make_order(client, store_id, suffix, product)

    # Before any upload, the list must be empty (not an error).
    r0 = await client.get(
        f"{settings.API_V1_STR}/orders/{order['id']}/delivery-proof",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r0.status_code == 200, r0.text
    assert r0.json()["data"] == []

    fake_jpeg = b"\xff\xd8\xff\xe0fake-jpeg-bytes"
    r1 = await client.post(
        f"{settings.API_V1_STR}/orders/{order['id']}/delivery-proof",
        files={"file": ("proof.jpg", fake_jpeg, "image/jpeg")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["url"].startswith("/uploads/delivery_proofs/")

    r2 = await client.get(
        f"{settings.API_V1_STR}/orders/{order['id']}/delivery-proof",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code == 200, r2.text
    proofs = r2.json()["data"]
    assert len(proofs) == 1
    assert proofs[0]["url"] == r1.json()["url"]

    # Must be recorded in AuditLog for the order's traceability, not a
    # silent side-channel — this is the whole point of reusing AuditLog.diff
    # instead of inventing a one-off table.
    from app.db.session import SessionLocal
    from app.models.audit import AuditLog
    db = SessionLocal()
    try:
        log = db.query(AuditLog).filter(
            AuditLog.entity == "order", AuditLog.entity_id == order["id"],
            AuditLog.action == "delivery_proof_uploaded",
        ).first()
        assert log is not None
        assert log.diff["url"] == r1.json()["url"]
    finally:
        db.close()
