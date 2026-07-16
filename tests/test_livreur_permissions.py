"""
Tests for the livreur permission audit:
1. A livreur can never self-assign an order (POST /internal/assign).
2. A livreur can only update the status of a delivery assigned to THEM,
   and only to an allowed status (POST /internal/deliveries/{id}/status).
3. actor_role is persisted on OrderEvent (GET /orders/{id}/events) so the
   history timeline can show which role performed each action.
4. The RETURNED stock-restock fix (from the previous chantier) still works
   when reached through this internal-delivery status path specifically
   as a livreur, not just as an admin.

Real Postgres — no SQLite.
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
        if not db.query(User).first():
            db.add(User(
                id=str(uuid.uuid4()), email="livreur-perm@azzougshop.test",
                name="Livreur Perm Test", hashed_password=get_password_hash("test-only"),
                role="SUPER_ADMIN", is_active=True,
            ))
            db.commit()
    finally:
        db.close()


@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


def _make_user(role, suffix):
    from app.db.session import SessionLocal
    from app.models.user import User
    from app.core.security import get_password_hash, create_access_token
    db = SessionLocal()
    try:
        user_id = str(uuid.uuid4())
        db.add(User(
            id=user_id, email=f"{role.lower()}-{suffix}@azzougshop.test", name=f"{role} {suffix}",
            hashed_password=get_password_hash("test-only"), role=role, is_active=True,
        ))
        db.commit()
        return user_id, create_access_token(subject=user_id)
    finally:
        db.close()


def _make_internal_partner(store_id):
    from app.db.session import SessionLocal
    from app.models.delivery_partner import DeliveryPartner
    db = SessionLocal()
    try:
        partner_id = str(uuid.uuid4())
        db.add(DeliveryPartner(
            id=partner_id, store_id=store_id, carrier_id="internal", name="Livreur Interne",
            type="INTERNAL", commission_type="FIXED", commission_value=0.0,
        ))
        db.commit()
        return partner_id
    finally:
        db.close()


async def _make_store(client, suffix):
    r = await client.post(
        f"{settings.API_V1_STR}/stores/",
        json={"name": f"Livreur Store {suffix}", "slug": f"livreur-store-{suffix}",
              "domain": f"livreur-store-{suffix}.com", "template_id": "modern", "owner_id": "SYSTEM_ADMIN"},
        headers=INTERNAL_KEY_HEADER,
    )
    assert r.status_code == 200
    return r.json()["id"]


async def _make_product(client, store_id, suffix, stock=15):
    r = await client.post(
        f"{settings.API_V1_STR}/products/",
        json={"name": f"Product {suffix}", "description": "x", "price": 1000, "stock": stock,
              "category": "General", "sku": f"SKU-LIV-{suffix}", "store_id": store_id, "is_active": True},
        headers=INTERNAL_KEY_HEADER,
    )
    assert r.status_code == 200
    return r.json()


async def _make_order(client, store_id, suffix, product):
    r = await client.post(
        f"{settings.API_V1_STR}/orders/",
        json={
            "store_id": store_id, "customer_name": "Client Livreur",
            "customer_phone": "072" + suffix[:8],
            "customer_address": "Alger", "customer_wilaya": "Alger",
            "delivery_type": "HOME", "delivery_fee": 0,
            "subtotal": 1000, "discount": 0, "total": 1000,
            "source": "landing_page",
            "items": [{"product_id": product["id"], "product_name": product["name"], "quantity": 2, "unit_price": 1000}],
        },
        headers=INTERNAL_KEY_HEADER,
    )
    assert r.status_code == 201
    return r.json()


def _get_product_stock(product_id):
    from app.db.session import SessionLocal
    from app.models.product import Product
    db = SessionLocal()
    try:
        return db.query(Product).filter(Product.id == product_id).first()
    finally:
        db.close()


# ─── 1. A livreur can never self-assign ─────────────────────────────────────

@pytest.mark.asyncio
async def test_livreur_cannot_self_assign(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix)
    order = await _make_order(client, store_id, suffix, product)
    partner_id = _make_internal_partner(store_id)
    livreur_id, livreur_token = _make_user("LIVREUR", suffix)

    r = await client.post(
        f"{settings.API_V1_STR}/delivery-partners/internal/assign",
        json={"order_id": order["id"], "driver_id": livreur_id, "partner_id": partner_id},
        headers={"Authorization": f"Bearer {livreur_token}"},
    )
    assert r.status_code == 403, f"a livreur must never be able to self-assign, got {r.status_code}: {r.text}"

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


@pytest.mark.asyncio
async def test_confirmatrice_can_assign_livreur(client):
    """The same endpoint must still work normally for a legitimate assigner."""
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix)
    order = await _make_order(client, store_id, suffix, product)
    partner_id = _make_internal_partner(store_id)
    livreur_id, _ = _make_user("LIVREUR", suffix)
    _, confirmatrice_token = _make_user("CONFIRMATEUR", suffix)

    r = await client.post(
        f"{settings.API_V1_STR}/delivery-partners/internal/assign",
        json={"order_id": order["id"], "driver_id": livreur_id, "partner_id": partner_id},
        headers={"Authorization": f"Bearer {confirmatrice_token}"},
    )
    assert r.status_code == 200, r.text

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


# ─── 2. A livreur can only update a delivery assigned to THEM ───────────────

@pytest.mark.asyncio
async def test_livreur_cannot_update_someone_elses_delivery(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix)
    order = await _make_order(client, store_id, suffix, product)
    partner_id = _make_internal_partner(store_id)
    owner_id, _ = _make_user("LIVREUR", suffix + "a")
    other_id, other_token = _make_user("LIVREUR", suffix + "b")
    _, admin_token = _make_user("SUPER_ADMIN", suffix)

    assign = await client.post(
        f"{settings.API_V1_STR}/delivery-partners/internal/assign",
        json={"order_id": order["id"], "driver_id": owner_id, "partner_id": partner_id},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert assign.status_code == 200
    delivery_id = assign.json()["data"]["delivery_id"]

    r = await client.post(
        f"{settings.API_V1_STR}/delivery-partners/internal/deliveries/{delivery_id}/status",
        json={"status": "DELIVERED"},
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert r.status_code == 403, f"a livreur must not update another livreur's delivery, got {r.status_code}: {r.text}"

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


@pytest.mark.asyncio
async def test_livreur_can_update_own_delivery_to_allowed_status(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix, stock=15)
    order = await _make_order(client, store_id, suffix, product)
    partner_id = _make_internal_partner(store_id)
    owner_id, owner_token = _make_user("LIVREUR", suffix)
    _, admin_token = _make_user("SUPER_ADMIN", suffix)

    assign = await client.post(
        f"{settings.API_V1_STR}/delivery-partners/internal/assign",
        json={"order_id": order["id"], "driver_id": owner_id, "partner_id": partner_id},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert assign.status_code == 200
    from app.db.session import SessionLocal
    from app.models.internal_delivery import InternalDelivery
    db = SessionLocal()
    delivery_id = db.query(InternalDelivery).filter(InternalDelivery.order_id == order["id"]).first().id
    db.close()

    # Progress to CONFIRMED first so DELIVERED->stock deduction has something
    # to restock later (mirrors a real flow: assign -> confirm -> deliver).
    confirm = await client.patch(
        f"{settings.API_V1_STR}/orders/{order['id']}", json={"status": "CONFIRMED"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert confirm.status_code == 200, confirm.text
    assert _get_product_stock(product["id"]).stock == 13

    r = await client.post(
        f"{settings.API_V1_STR}/delivery-partners/internal/deliveries/{delivery_id}/status",
        json={"status": "DELIVERED"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert r.status_code == 200, r.text

    # Now the livreur marks it RETURNED — stock must come back through this
    # exact internal-delivery path (the bug this whole chantier started from).
    r2 = await client.post(
        f"{settings.API_V1_STR}/delivery-partners/internal/deliveries/{delivery_id}/status",
        json={"status": "RETURNED"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert r2.status_code == 200, r2.text
    assert _get_product_stock(product["id"]).stock == 15, "stock must be restocked via the livreur-driven internal delivery path"

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


@pytest.mark.asyncio
async def test_livreur_cannot_set_disallowed_status_on_own_delivery(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix)
    order = await _make_order(client, store_id, suffix, product)
    partner_id = _make_internal_partner(store_id)
    owner_id, owner_token = _make_user("LIVREUR", suffix)
    _, admin_token = _make_user("SUPER_ADMIN", suffix)

    assign = await client.post(
        f"{settings.API_V1_STR}/delivery-partners/internal/assign",
        json={"order_id": order["id"], "driver_id": owner_id, "partner_id": partner_id},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert assign.status_code == 200
    from app.db.session import SessionLocal
    from app.models.internal_delivery import InternalDelivery
    db = SessionLocal()
    delivery_id = db.query(InternalDelivery).filter(InternalDelivery.order_id == order["id"]).first().id
    db.close()

    r = await client.post(
        f"{settings.API_V1_STR}/delivery-partners/internal/deliveries/{delivery_id}/status",
        json={"status": "REASSIGNED_TO_SOMEONE_ELSE"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert r.status_code == 403, f"a livreur must not be able to set an arbitrary status string, got {r.status_code}"

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


# ─── 3. actor_role persisted on the order history timeline ──────────────────

@pytest.mark.asyncio
async def test_actor_role_persisted_on_order_event(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix)
    order = await _make_order(client, store_id, suffix, product)
    livreur_id, livreur_token = _make_user("LIVREUR", suffix)

    # Assign the order's livreur_id directly (admin-level action normally,
    # simplified here) so the livreur passes _assert_order_access.
    from app.db.session import SessionLocal
    from app.models.order import Order as OrderModel
    db = SessionLocal()
    db.query(OrderModel).filter(OrderModel.id == order["id"]).update({"livreur_id": livreur_id, "status": "CONFIRMED"})
    db.commit()
    db.close()

    r = await client.patch(
        f"{settings.API_V1_STR}/orders/{order['id']}", json={"status": "SHIPPED", "notes": "En route"},
        headers={"Authorization": f"Bearer {livreur_token}"},
    )
    assert r.status_code == 200, r.text

    events = await client.get(
        f"{settings.API_V1_STR}/orders/{order['id']}/events",
        headers={"Authorization": f"Bearer {livreur_token}"},
    )
    assert events.status_code == 200, events.text
    data = events.json()
    shipped_event = next((e for e in data if e["to_status"] == "SHIPPED"), None)
    assert shipped_event is not None, f"no SHIPPED event found in {data}"
    assert shipped_event["actor_role"] == "LIVREUR", f"expected actor_role=LIVREUR, got {shipped_event['actor_role']}"
    assert shipped_event["actor"]["role"] == "LIVREUR"

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)
