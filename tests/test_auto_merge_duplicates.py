"""
E2E regression tests for the automatic duplicate-merge workflow:
- two orders with the same phone in the same store fuse into one
  operational parent (child = MERGED, history preserved),
- a normal order beats an abandoned cart as the parent,
- the DUPLICATE_MERGED notification is created.
"""

import pytest
from httpx import AsyncClient
import uuid
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
from app.core.config import settings

@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac

INTERNAL_KEY_HEADER = {"x-internal-key": settings.INTERNAL_API_KEY}


async def _create_store_and_product(client, suffix: str):
    store_response = await client.post(
        f"{settings.API_V1_STR}/stores/",
        json={
            "name": f"Merge Shop {suffix}",
            "slug": f"merge-shop-{suffix}",
            "domain": f"merge-shop-{suffix}.com",
            "template_id": "modern",
            "owner_id": "SYSTEM_ADMIN",
        },
        headers=INTERNAL_KEY_HEADER,
    )
    assert store_response.status_code == 200
    store_id = store_response.json()["id"]

    product_response = await client.post(
        f"{settings.API_V1_STR}/products/",
        json={
            "name": f"Merge Product {suffix}",
            "description": "x",
            "price": 2000,
            "stock": 50,
            "category": "General",
            "sku": f"SKU-MERGE-{suffix}",
            "store_id": store_id,
            "is_active": True,
        },
        headers=INTERNAL_KEY_HEADER,
    )
    assert product_response.status_code == 200
    product = product_response.json()
    return store_id, product


def _order_payload(store_id: str, product: dict, phone: str):
    return {
        "store_id": store_id,
        "customer_name": "Client Doublon",
        "customer_phone": phone,
        "customer_address": "Alger",
        "customer_wilaya": "Alger",
        "delivery_type": "HOME",
        "delivery_fee": 500.0,
        "subtotal": 2000.0,
        "discount": 0.0,
        "total": 2500.0,
        "source": "landing_page",
        "items": [{
            "product_id": product["id"],
            "product_name": product["name"],
            "quantity": 1,
            "unit_price": 2000.0,
        }],
    }


@pytest.mark.asyncio
async def test_same_phone_orders_auto_merge(client):
    suffix = str(uuid.uuid4())[:8]
    phone = "0561" + suffix[:6].replace("-", "0")
    store_id, product = await _create_store_and_product(client, suffix)

    # First order — stays operational
    r1 = await client.post(f"{settings.API_V1_STR}/orders/",
                           json=_order_payload(store_id, product, phone),
                           headers=INTERNAL_KEY_HEADER)
    assert r1.status_code == 201
    first = r1.json()

    # Second order, same phone — must be auto-merged
    r2 = await client.post(f"{settings.API_V1_STR}/orders/",
                           json=_order_payload(store_id, product, phone),
                           headers=INTERNAL_KEY_HEADER)
    assert r2.status_code == 201
    second = r2.json()

    from app.db.session import SessionLocal
    from app.models.order import Order
    db = SessionLocal()
    try:
        o1 = db.query(Order).filter(Order.id == first["id"]).first()
        o2 = db.query(Order).filter(Order.id == second["id"]).first()

        statuses = {str(o1.status), str(o2.status)}
        assert "MERGED" in statuses, f"expected one MERGED order, got {statuses}"

        child = o1 if str(o1.status) == "MERGED" else o2
        parent = o2 if child is o1 else o1
        assert str(child.parent_order_id) == str(parent.id)
        assert child.status_before_merge is not None
        assert child.is_duplicate is True
        # History preserved: the child keeps its items (audit copy untouched)
        assert len(child.items) == 1
        assert int(child.items[0].quantity) == 1

        # Merged basket on the parent: same product + same variant → summed
        assert len(parent.items) == 1, "same product/variant must merge into one line"
        assert int(parent.items[0].quantity) == 2
        # Totals recomputed: 2 × 2000 + 500 delivery
        assert float(parent.subtotal) == 4000.0
        assert float(parent.total) == 4500.0

        # Notification created
        from app.models.notification import Notification
        notif = db.query(Notification).filter(
            Notification.type == "DUPLICATE_MERGED",
            Notification.order_id == parent.id,
        ).first()
        assert notif is not None
    finally:
        db.close()

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


@pytest.mark.asyncio
async def test_normal_order_beats_abandoned_cart_as_parent(client):
    suffix = str(uuid.uuid4())[:8]
    phone = "0562" + suffix[:6].replace("-", "0")
    store_id, product = await _create_store_and_product(client, suffix)

    # Abandoned cart first
    ab_payload = _order_payload(store_id, product, phone)
    r_ab = await client.post(f"{settings.API_V1_STR}/orders/abandoned",
                             json=ab_payload, headers=INTERNAL_KEY_HEADER)
    assert r_ab.status_code == 201
    abandoned_id = r_ab.json()["id"]

    # Then a real order from the same phone
    r_new = await client.post(f"{settings.API_V1_STR}/orders/",
                              json=_order_payload(store_id, product, phone),
                              headers=INTERNAL_KEY_HEADER)
    assert r_new.status_code == 201
    normal_id = r_new.json()["id"]

    from app.db.session import SessionLocal
    from app.models.order import Order
    db = SessionLocal()
    try:
        abandoned = db.query(Order).filter(Order.id == abandoned_id).first()
        normal = db.query(Order).filter(Order.id == normal_id).first()

        # The abandoned cart becomes the MERGED child, the normal order stays operational
        assert str(abandoned.status) == "MERGED"
        assert str(abandoned.status_before_merge) == "ABANDONED"
        assert str(abandoned.parent_order_id) == str(normal.id)
        assert str(normal.status) != "MERGED"

        # The normal parent absorbed the abandoned basket (aggregated line)
        assert len(normal.items) == 1
        assert int(normal.items[0].quantity) == 2
        assert float(normal.subtotal) == 4000.0
    finally:
        db.close()

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


@pytest.mark.asyncio
async def test_cancelled_normal_order_restores_as_normal(client):
    """Case 5: Normal order NEW -> CONFIRMED -> CANCELLED -> CONFIRMED again
    must stay a Normal order (is_abandoned_cart False, recovered_at unset)."""
    suffix = str(uuid.uuid4())[:8]
    phone = "0563" + suffix[:6].replace("-", "0")
    store_id, product = await _create_store_and_product(client, suffix)

    r = await client.post(f"{settings.API_V1_STR}/orders/",
                          json=_order_payload(store_id, product, phone),
                          headers=INTERNAL_KEY_HEADER)
    assert r.status_code == 201
    order_id = r.json()["id"]

    r1 = await client.patch(f"{settings.API_V1_STR}/orders/{order_id}",
                            json={"status": "CONFIRMED"}, headers=INTERNAL_KEY_HEADER)
    assert r1.status_code == 200
    r2 = await client.patch(f"{settings.API_V1_STR}/orders/{order_id}",
                            json={"status": "CANCELLED"}, headers=INTERNAL_KEY_HEADER)
    assert r2.status_code == 200
    r3 = await client.patch(f"{settings.API_V1_STR}/orders/{order_id}",
                            json={"status": "CONFIRMED"}, headers=INTERNAL_KEY_HEADER)
    assert r3.status_code == 200
    body = r3.json()
    assert body["status"] == "CONFIRMED"
    assert body["is_abandoned_cart"] is False
    assert not body.get("recovered_at")

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


@pytest.mark.asyncio
async def test_cancelled_abandoned_cart_restores_as_recovered(client):
    """Case 6: Abandoned cart -> CANCELLED -> CONFIRMED again must become a
    Recovered Cart (is_abandoned_cart True, recovered_at now set)."""
    suffix = str(uuid.uuid4())[:8]
    phone = "0564" + suffix[:6].replace("-", "0")
    store_id, product = await _create_store_and_product(client, suffix)

    r = await client.post(f"{settings.API_V1_STR}/orders/abandoned",
                          json=_order_payload(store_id, product, phone),
                          headers=INTERNAL_KEY_HEADER)
    assert r.status_code == 201
    order_id = r.json()["id"]

    r1 = await client.patch(f"{settings.API_V1_STR}/orders/{order_id}",
                            json={"status": "CANCELLED"}, headers=INTERNAL_KEY_HEADER)
    assert r1.status_code == 200
    assert r1.json()["is_abandoned_cart"] is True  # origin untouched by cancellation

    r2 = await client.patch(f"{settings.API_V1_STR}/orders/{order_id}",
                            json={"status": "CONFIRMED"}, headers=INTERNAL_KEY_HEADER)
    assert r2.status_code == 200
    body = r2.json()
    assert body["status"] == "CONFIRMED"
    assert body["is_abandoned_cart"] is True
    assert body.get("recovered_at")  # now marked RECOVERED forever

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


@pytest.mark.asyncio
async def test_duplicate_merge_independent_of_operational_status(client):
    """Case 4 / item 2: an NRP'd order (IN_PROGRESS) and a fresh NEW order of
    the same phone must resolve to ONE operational order — detection must not
    care that one of them is mid-workflow (NRP) rather than freshly created."""
    suffix = str(uuid.uuid4())[:8]
    phone = "0565" + suffix[:6].replace("-", "0")
    store_id, product = await _create_store_and_product(client, suffix)

    r1 = await client.post(f"{settings.API_V1_STR}/orders/",
                           json=_order_payload(store_id, product, phone),
                           headers=INTERNAL_KEY_HEADER)
    assert r1.status_code == 201
    first_id = r1.json()["id"]

    # Put the first order mid-NRP workflow before the duplicate shows up
    r_nrp = await client.patch(f"{settings.API_V1_STR}/orders/{first_id}",
                               json={"call_result": "NRP"}, headers=INTERNAL_KEY_HEADER)
    assert r_nrp.status_code == 200
    assert r_nrp.json()["status"] == "IN_PROGRESS"

    r2 = await client.post(f"{settings.API_V1_STR}/orders/",
                           json=_order_payload(store_id, product, phone),
                           headers=INTERNAL_KEY_HEADER)
    assert r2.status_code == 201
    second_id = r2.json()["id"]

    from app.db.session import SessionLocal
    from app.models.order import Order
    db = SessionLocal()
    try:
        o1 = db.query(Order).filter(Order.id == first_id).first()
        o2 = db.query(Order).filter(Order.id == second_id).first()
        statuses = {str(o1.status), str(o2.status)}
        assert "MERGED" in statuses, f"expected exactly one operational order, got {statuses}"
        # The NRP'd order (already being processed) must be the parent —
        # a fresh, untouched NEW order does not outrank in-progress work.
        parent = o1 if str(o1.status) != "MERGED" else o2
        assert parent.id == first_id, "the order already being worked (NRP) should stay the parent"
        assert parent.nrp_count == 1
    finally:
        db.close()

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)
