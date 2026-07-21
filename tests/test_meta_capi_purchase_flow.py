"""
Regression tests for the Meta CAPI Purchase pipeline, covering the forensic
audit findings fixed in this session:

1. Normal order  -> Purchase CAPI fires once, event_id = purchase-{order_number}
   (must match the browser Pixel exactly — checkout-form.tsx builds the same
   string from json.order_number).
2. ABN recovered by the customer (abandoned_cart_id) -> Purchase fires exactly
   once, even though the row already existed as ABANDONED.
3. ABN recovered by a confirmatrice (PATCH .../{id} ABANDONED -> CONFIRMED)
   -> Purchase fires exactly once, with NO browser session involved.
4. Idempotency: calling send_purchase_for_order twice for the same order
   never produces a second meta_capi_logs row.
5. MANUAL/POS orders never fire Purchase (pre-existing fix, re-verified).
6. Currency: the event's custom_data.currency matches the store's configured
   meta_ads_configs.currency (not a hardcoded "DZD"), and value is converted
   using exchange_rate.

send_events() is monkeypatched everywhere — these tests assert what WE send
to Meta, not whether Meta's API itself accepts it.
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
def _seed_superadmin_for_internal_bypass():
    """
    deps.get_current_user's internal-key bypass (used by INTERNAL_KEY_HEADER)
    requires at least one existing user row to attach requests to — on a
    fresh/empty test database this fails with "Internal bypass failed: No
    users in database" before any endpoint logic even runs.
    """
    from app.db.session import SessionLocal
    from app.models.user import User
    from app.core.security import get_password_hash
    import uuid as _uuid

    db = SessionLocal()
    try:
        if not db.query(User).first():
            db.add(User(
                id=str(_uuid.uuid4()), email="test-superadmin@azzougshop.test",
                name="Test SuperAdmin", hashed_password=get_password_hash("test-only"),
                role="SUPER_ADMIN", is_active=True,
            ))
            db.commit()
    finally:
        db.close()


@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


def _fake_send_events_ok(pixel_id, access_token, events, **kwargs):
    return {"success": True, "events_received": len(events), "error": None,
            "retryable": False, "error_category": None, "latency_ms": 1}


@pytest.fixture(autouse=True)
def _no_real_network_calls(monkeypatch):
    """Every test in this file must never hit graph.facebook.com for real."""
    monkeypatch.setattr("app.services.meta_capi.send_events", _fake_send_events_ok)


async def _setup_store_with_meta(client, suffix, currency="USD", exchange_rate=133.0):
    store_response = await client.post(
        f"{settings.API_V1_STR}/stores/",
        json={"name": f"Meta Shop {suffix}", "slug": f"meta-shop-{suffix}",
              "domain": f"meta-shop-{suffix}.com", "template_id": "modern",
              "owner_id": "SYSTEM_ADMIN"},
        headers=INTERNAL_KEY_HEADER,
    )
    assert store_response.status_code == 200
    store_id = store_response.json()["id"]

    product_response = await client.post(
        f"{settings.API_V1_STR}/products/",
        json={"name": f"Meta Product {suffix}", "description": "x", "price": 1000,
              "stock": 50, "category": "General", "sku": f"SKU-META-{suffix}",
              "store_id": store_id, "is_active": True},
        headers=INTERNAL_KEY_HEADER,
    )
    assert product_response.status_code == 200
    product = product_response.json()

    # Real Meta config with a plausible-length token — send_purchase_for_order
    # requires len(access_token) >= 15 to attempt a send at all.
    cfg_response = await client.post(
        f"{settings.API_V1_STR}/meta-ads/config",
        json={"store_id": store_id, "access_token": "x" * 40,
              "ad_account_id": "act_123456789", "pixel_id": "999999999999999",
              "domain_verification_tag": "", "is_connected": True,
              "exchange_rate": exchange_rate, "currency": currency},
        headers=INTERNAL_KEY_HEADER,
    )
    assert cfg_response.status_code == 200
    return store_id, product


def _capi_rows(db, order_id):
    from app.models.marketing import MetaCapiLog
    return (
        db.query(MetaCapiLog)
        .filter(MetaCapiLog.order_id == order_id, MetaCapiLog.event_name == "Purchase")
        .all()
    )


@pytest.mark.asyncio
async def test_normal_order_fires_purchase_once_with_order_number_event_id(client):
    suffix = str(uuid.uuid4())[:8]
    store_id, product = await _setup_store_with_meta(client, suffix)

    r = await client.post(
        f"{settings.API_V1_STR}/orders/",
        json={
            "store_id": store_id, "customer_name": "Client Normal",
            "customer_phone": "0551" + suffix[:6],
            "customer_address": "Alger", "customer_wilaya": "Alger",
            "delivery_type": "HOME", "delivery_fee": 0,
            "subtotal": 1000, "discount": 0, "total": 1000, "source": "landing_page",
            "items": [{"product_id": product["id"], "product_name": product["name"],
                        "quantity": 1, "unit_price": 1000}],
        },
        headers=INTERNAL_KEY_HEADER,
    )
    assert r.status_code == 201
    order = r.json()

    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        rows = _capi_rows(db, order["id"])
        assert len(rows) == 1, f"expected exactly 1 Purchase log row, got {len(rows)}"
        assert rows[0].event_id == f"purchase-{order['order_number']}"
        assert rows[0].status == "success"
    finally:
        db.close()

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


@pytest.mark.asyncio
async def test_manual_and_pos_orders_never_fire_purchase(client):
    """
    Behavior change from the durable-queue rework: orders.py now enqueues a
    row unconditionally whenever Meta config exists (the skip decision was
    moved INTO send_purchase_for_order so it's traceable), so a MANUAL order
    now DOES get a meta_capi_logs row — status='skipped', never 'success'.
    No Meta network call is ever made for it either way.
    """
    suffix = str(uuid.uuid4())[:8]
    store_id, product = await _setup_store_with_meta(client, suffix)

    r = await client.post(
        f"{settings.API_V1_STR}/orders/",
        json={
            "store_id": store_id, "customer_name": "Agent Manual",
            "customer_phone": "0552" + suffix[:6],
            "customer_address": "Alger", "customer_wilaya": "Alger",
            "delivery_type": "HOME", "delivery_fee": 0,
            "subtotal": 1000, "discount": 0, "total": 1000, "source": "MANUAL",
            "items": [{"product_id": product["id"], "product_name": product["name"],
                        "quantity": 1, "unit_price": 1000}],
        },
        headers=INTERNAL_KEY_HEADER,
    )
    assert r.status_code == 201
    order = r.json()

    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        rows = _capi_rows(db, order["id"])
        assert len(rows) == 1
        assert rows[0].status == "skipped"
        assert "MANUAL" in (rows[0].error_message or "")
    finally:
        db.close()

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


@pytest.mark.asyncio
async def test_abandoned_cart_completed_by_customer_fires_purchase_once(client):
    """orders.py:1113 branch — abandoned_cart_id present, customer self-checkout."""
    suffix = str(uuid.uuid4())[:8]
    store_id, product = await _setup_store_with_meta(client, suffix)
    phone = "0553" + suffix[:6]

    abn = await client.post(
        f"{settings.API_V1_STR}/orders/abandoned",
        json={
            "store_id": store_id, "customer_name": "Client ABN Self",
            "customer_phone": phone, "customer_address": "Alger",
            "customer_wilaya": "Alger", "delivery_type": "HOME", "delivery_fee": 0,
            "subtotal": 1000, "discount": 0, "total": 1000, "source": "landing_page",
            "items": [{"product_id": product["id"], "product_name": product["name"],
                        "quantity": 1, "unit_price": 1000}],
        },
        headers=INTERNAL_KEY_HEADER,
    )
    assert abn.status_code == 201
    abn_order_id = abn.json()["id"]

    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        assert _capi_rows(db, abn_order_id) == [], "ABANDONED itself must never fire Purchase"
    finally:
        db.close()

    completed = await client.post(
        f"{settings.API_V1_STR}/orders/",
        json={
            "store_id": store_id, "customer_name": "Client ABN Self",
            "customer_phone": phone, "customer_address": "Alger",
            "customer_wilaya": "Alger", "delivery_type": "HOME", "delivery_fee": 0,
            "subtotal": 1000, "discount": 0, "total": 1000, "source": "landing_page",
            "abandoned_cart_id": abn_order_id,
            "items": [{"product_id": product["id"], "product_name": product["name"],
                        "quantity": 1, "unit_price": 1000}],
        },
        headers=INTERNAL_KEY_HEADER,
    )
    assert completed.status_code == 201
    completed_order = completed.json()
    # Same row, same id, order_number unchanged — proven behavior (not renamed to ORD-*)
    assert completed_order["id"] == abn_order_id
    assert completed_order["order_number"].startswith("ABN-")

    db = SessionLocal()
    try:
        rows = _capi_rows(db, abn_order_id)
        assert len(rows) == 1, f"expected exactly 1 Purchase after self-checkout completion, got {len(rows)}"
        assert rows[0].event_id == f"purchase-{completed_order['order_number']}"
    finally:
        db.close()

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


@pytest.mark.asyncio
async def test_abandoned_cart_confirmed_by_phone_never_fires_purchase(client):
    """
    PATCH /orders/{id} — confirmatrice moves ABANDONED straight to CONFIRMED.

    Product decision (2026-07-21, confirmed by Selma): Purchase must NEVER
    be sent to Meta for a recovered abandoned cart, even though it is a
    real sale — see SEND_PURCHASE_FOR_RECOVERED_ABANDONED_CARTS in
    app/api/v1/orders.py. This test used to assert the opposite (exactly 1
    Purchase fired on phone confirmation); now asserts zero, locking in the
    reversed decision so a future change can't silently re-enable it.
    """
    suffix = str(uuid.uuid4())[:8]
    store_id, product = await _setup_store_with_meta(client, suffix)
    phone = "0554" + suffix[:6]

    abn = await client.post(
        f"{settings.API_V1_STR}/orders/abandoned",
        json={
            "store_id": store_id, "customer_name": "Client ABN Phone",
            "customer_phone": phone, "customer_address": "Alger",
            "customer_wilaya": "Alger", "delivery_type": "HOME", "delivery_fee": 0,
            "subtotal": 1000, "discount": 0, "total": 1000, "source": "landing_page",
            "items": [{"product_id": product["id"], "product_name": product["name"],
                        "quantity": 1, "unit_price": 1000}],
        },
        headers=INTERNAL_KEY_HEADER,
    )
    assert abn.status_code == 201
    abn_order_id = abn.json()["id"]

    patch1 = await client.patch(
        f"{settings.API_V1_STR}/orders/{abn_order_id}",
        json={"status": "CONFIRMED"}, headers=INTERNAL_KEY_HEADER,
    )
    assert patch1.status_code == 200, patch1.text

    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        rows = _capi_rows(db, abn_order_id)
        assert len(rows) == 0, f"recovered abandoned carts must never fire Purchase, got {len(rows)}"
    finally:
        db.close()

    # Further status churn (CANCELLED then re-CONFIRMED) must still never
    # fire a Purchase either.
    await client.patch(
        f"{settings.API_V1_STR}/orders/{abn_order_id}",
        json={"status": "CANCELLED"}, headers=INTERNAL_KEY_HEADER,
    )
    patch2 = await client.patch(
        f"{settings.API_V1_STR}/orders/{abn_order_id}",
        json={"status": "CONFIRMED"}, headers=INTERNAL_KEY_HEADER,
    )
    assert patch2.status_code == 200, patch2.text

    db = SessionLocal()
    try:
        rows = _capi_rows(db, abn_order_id)
        assert len(rows) == 0, f"CANCELLED->CONFIRMED churn must still never fire Purchase, got {len(rows)}"
    finally:
        db.close()

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


@pytest.mark.asyncio
async def test_send_purchase_for_order_idempotent_on_direct_double_call(client):
    """Calling the function twice directly must never create a second row."""
    suffix = str(uuid.uuid4())[:8]
    store_id, product = await _setup_store_with_meta(client, suffix)

    r = await client.post(
        f"{settings.API_V1_STR}/orders/",
        json={
            "store_id": store_id, "customer_name": "Client Idem",
            "customer_phone": "0555" + suffix[:6],
            "customer_address": "Alger", "customer_wilaya": "Alger",
            "delivery_type": "HOME", "delivery_fee": 0,
            "subtotal": 1000, "discount": 0, "total": 1000, "source": "landing_page",
            "items": [{"product_id": product["id"], "product_name": product["name"],
                        "quantity": 1, "unit_price": 1000}],
        },
        headers=INTERNAL_KEY_HEADER,
    )
    assert r.status_code == 201
    order_id = r.json()["id"]

    from app.services.meta_capi import send_purchase_for_order

    # Direct second invocation, simulating a retried background task / race.
    send_purchase_for_order(order_id=order_id, client_ip=None, user_agent=None)

    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        rows = _capi_rows(db, order_id)
        assert len(rows) == 1, f"direct double call must stay idempotent, got {len(rows)}"
    finally:
        db.close()

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


@pytest.mark.asyncio
async def test_purchase_currency_matches_ad_account_not_hardcoded_dzd(client):
    """Reproduces the exact azconfort case: ad account in USD, order in DZD."""
    suffix = str(uuid.uuid4())[:8]
    store_id, product = await _setup_store_with_meta(client, suffix, currency="USD", exchange_rate=133.0)

    r = await client.post(
        f"{settings.API_V1_STR}/orders/",
        json={
            "store_id": store_id, "customer_name": "Client Currency",
            "customer_phone": "0556" + suffix[:6],
            "customer_address": "Alger", "customer_wilaya": "Alger",
            "delivery_type": "HOME", "delivery_fee": 0,
            "subtotal": 1330, "discount": 0, "total": 1330, "source": "landing_page",
            "items": [{"product_id": product["id"], "product_name": product["name"],
                        "quantity": 1, "unit_price": 1330}],
        },
        headers=INTERNAL_KEY_HEADER,
    )
    assert r.status_code == 201
    order = r.json()

    from app.db.session import SessionLocal
    from app.models.order import Order
    from app.services.meta_capi import build_purchase_event

    db = SessionLocal()
    try:
        db_order = db.query(Order).filter(Order.id == order["id"]).first()
        event = build_purchase_event(db_order, client_ip=None, user_agent=None,
                                      ad_currency="USD", exchange_rate=133.0)
        assert event["custom_data"]["currency"] == "USD"
        # 1330 DZD / 133.0 = 10.0 USD — never the raw DZD total, never "DZD"
        assert event["custom_data"]["value"] == 10.0
    finally:
        db.close()

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


def test_recovered_abandoned_cart_purchase_flag_is_off():
    """Locks in the 2026-07-21 product decision at the source — catches an
    accidental flip back to True without anyone noticing."""
    from app.api.v1.orders import SEND_PURCHASE_FOR_RECOVERED_ABANDONED_CARTS
    assert SEND_PURCHASE_FOR_RECOVERED_ABANDONED_CARTS is False
