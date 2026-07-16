"""
Tests for automatic stock reintegration on the RETURNED order status.

The core logic already existed in order_service.update_order() before this
session (CONFIRMED/SHIPPED/DELIVERED -> RETURNED calls
inventory_service.return_restock per item) — these tests PROVE it behaves
correctly rather than assume it, and cover the specific scenarios asked
for: single product, multiple products, variants, packs, double-click /
repeated status, the RETURNED terminal-state guarantee, historical-anomaly
detection, and the admin backfill tool's idempotency.

Real Postgres (row locks, JSON mutation tracking) — no SQLite.
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
                id=str(uuid.uuid4()), email="stock-return@azzougshop.test",
                name="Stock Return Test", hashed_password=get_password_hash("test-only"),
                role="SUPER_ADMIN", is_active=True,
            ))
            db.commit()
    finally:
        db.close()


@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


async def _make_store(client, suffix):
    r = await client.post(
        f"{settings.API_V1_STR}/stores/",
        json={"name": f"Return Store {suffix}", "slug": f"return-store-{suffix}",
              "domain": f"return-store-{suffix}.com", "template_id": "modern", "owner_id": "SYSTEM_ADMIN"},
        headers=INTERNAL_KEY_HEADER,
    )
    assert r.status_code == 200
    return r.json()["id"]


async def _make_product(client, store_id, suffix, stock=20, variants=None, is_pack=False, pack_items=None):
    payload = {
        "name": f"Product {suffix}", "description": "x", "price": 1000, "stock": stock,
        "category": "General", "sku": f"SKU-RET-{suffix}", "store_id": store_id, "is_active": True,
    }
    if variants is not None:
        payload["variants"] = variants
    if is_pack:
        payload["is_pack"] = True
        payload["pack_items"] = pack_items or []
    r = await client.post(f"{settings.API_V1_STR}/products/", json=payload, headers=INTERNAL_KEY_HEADER)
    assert r.status_code == 200, r.text
    return r.json()


async def _make_order(client, store_id, suffix, items, phone_prefix="071"):
    r = await client.post(
        f"{settings.API_V1_STR}/orders/",
        json={
            "store_id": store_id, "customer_name": "Client Retour",
            "customer_phone": phone_prefix + suffix[:7],
            "customer_address": "Alger", "customer_wilaya": "Alger",
            "delivery_type": "HOME", "delivery_fee": 0,
            "subtotal": sum(i["unit_price"] * i["quantity"] for i in items),
            "discount": 0, "total": sum(i["unit_price"] * i["quantity"] for i in items),
            "source": "landing_page", "items": items,
        },
        headers=INTERNAL_KEY_HEADER,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _patch_status(client, order_id, status, token):
    return await client.patch(
        f"{settings.API_V1_STR}/orders/{order_id}",
        json={"status": status},
        headers={"Authorization": f"Bearer {token}"},
    )


def _get_admin_token():
    from app.db.session import SessionLocal
    from app.models.user import User
    from app.core.security import create_access_token
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.role == "SUPER_ADMIN").first()
        return create_access_token(subject=u.id)
    finally:
        db.close()


def _get_product_stock(product_id):
    from app.db.session import SessionLocal
    from app.models.product import Product
    db = SessionLocal()
    try:
        return db.query(Product).filter(Product.id == product_id).first()
    finally:
        db.close()


def _stock_movements(order_id):
    from app.db.session import SessionLocal
    from app.models.stock import StockMovement
    db = SessionLocal()
    try:
        return db.query(StockMovement).filter(StockMovement.order_id == order_id).all()
    finally:
        db.close()


# ─── 1. Simple order: single product, NEW -> CONFIRMED -> RETURNED ──────────

@pytest.mark.asyncio
async def test_simple_order_restocks_on_return(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix, stock=15)
    order = await _make_order(client, store_id, suffix, [
        {"product_id": product["id"], "product_name": product["name"], "quantity": 2, "unit_price": 1000},
    ])
    token = _get_admin_token()

    stock_after_reserve = _get_product_stock(product["id"])
    assert stock_after_reserve.reserved_stock == 2

    r1 = await _patch_status(client, order["id"], "CONFIRMED", token)
    assert r1.status_code == 200, r1.text
    stock_after_confirm = _get_product_stock(product["id"])
    assert stock_after_confirm.stock == 13  # 15 - 2, physically deducted
    assert stock_after_confirm.reserved_stock == 0

    r2 = await _patch_status(client, order["id"], "RETURNED", token)
    assert r2.status_code == 200, r2.text
    stock_after_return = _get_product_stock(product["id"])
    assert stock_after_return.stock == 15, f"expected stock restored to 15, got {stock_after_return.stock}"

    movements = _stock_movements(order["id"])
    restock_moves = [m for m in movements if m.type == "RETURN_RESTOCK"]
    assert len(restock_moves) == 1
    assert restock_moves[0].quantity == 2

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


# ─── 2. Multiple products in one order ──────────────────────────────────────

@pytest.mark.asyncio
async def test_multiple_products_each_restocked_exact_quantity(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    coussin = await _make_product(client, store_id, suffix + "a", stock=15)
    oreiller = await _make_product(client, store_id, suffix + "b", stock=4)
    order = await _make_order(client, store_id, suffix, [
        {"product_id": coussin["id"], "product_name": "Coussin Voyage", "quantity": 2, "unit_price": 1000},
        {"product_id": oreiller["id"], "product_name": "Oreiller", "quantity": 1, "unit_price": 500},
    ])
    token = _get_admin_token()

    await _patch_status(client, order["id"], "CONFIRMED", token)
    assert _get_product_stock(coussin["id"]).stock == 13
    assert _get_product_stock(oreiller["id"]).stock == 3

    r = await _patch_status(client, order["id"], "RETURNED", token)
    assert r.status_code == 200, r.text
    assert _get_product_stock(coussin["id"]).stock == 15
    assert _get_product_stock(oreiller["id"]).stock == 4

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


# ─── 3. Variants — several colors in one order ──────────────────────────────

@pytest.mark.asyncio
async def test_variants_each_restocked_to_correct_variant(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    variants = [
        {"name": "Couleur", "value": "Rouge", "stock": 10, "reserved": 0},
        {"name": "Couleur", "value": "Bleu", "stock": 10, "reserved": 0},
        {"name": "Couleur", "value": "Noir", "stock": 10, "reserved": 0},
    ]
    product = await _make_product(client, store_id, suffix, stock=30, variants=variants)
    order = await _make_order(client, store_id, suffix, [
        {"product_id": product["id"], "product_name": "T-shirt", "quantity": 2, "unit_price": 1000,
         "variant_details": {"variant": "Rouge"}},
        {"product_id": product["id"], "product_name": "T-shirt", "quantity": 1, "unit_price": 1000,
         "variant_details": {"variant": "Bleu"}},
        {"product_id": product["id"], "product_name": "T-shirt", "quantity": 4, "unit_price": 1000,
         "variant_details": {"variant": "Noir"}},
    ])
    token = _get_admin_token()

    await _patch_status(client, order["id"], "CONFIRMED", token)
    p = _get_product_stock(product["id"])
    by_value = {v["value"]: v for v in p.variants}
    assert by_value["Rouge"]["stock"] == 8
    assert by_value["Bleu"]["stock"] == 9
    assert by_value["Noir"]["stock"] == 6

    r = await _patch_status(client, order["id"], "RETURNED", token)
    assert r.status_code == 200, r.text
    p = _get_product_stock(product["id"])
    by_value = {v["value"]: v for v in p.variants}
    assert by_value["Rouge"]["stock"] == 10, "Rouge must recover exactly its own quantity (2), not another variant's"
    assert by_value["Bleu"]["stock"] == 10
    assert by_value["Noir"]["stock"] == 10

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


# ─── 4. Pack product — behaves as a single stock unit, consistently ────────

@pytest.mark.asyncio
async def test_pack_product_restocked_as_single_unit(client):
    """
    Audit finding: pack_items is NOT expanded into component stock movements
    anywhere in the reserve/confirm/return pipeline — a pack has its own
    Product.stock column, deducted and restocked exactly like any product.
    This is self-consistent end-to-end (the same unit is deducted at
    confirm time and restored at return time), so it's asserted as correct
    behavior here, not "fixed" — expanding ONLY the return path into
    components while purchase-time reservation still holds the pack's own
    stock would create a real inconsistency (components never consumed,
    pack stock drifting) and was deliberately NOT done.
    """
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    component = await _make_product(client, store_id, suffix + "c", stock=50)
    pack = await _make_product(
        client, store_id, suffix + "p", stock=8, is_pack=True,
        pack_items=[{"product_id": component["id"], "quantity": 2, "unit_cost": 500}],
    )
    order = await _make_order(client, store_id, suffix, [
        {"product_id": pack["id"], "product_name": "Pack Voyage", "quantity": 1, "unit_price": 2500},
    ])
    token = _get_admin_token()

    await _patch_status(client, order["id"], "CONFIRMED", token)
    assert _get_product_stock(pack["id"]).stock == 7
    assert _get_product_stock(component["id"]).stock == 50, "component stock must NOT move — packs aren't expanded"

    r = await _patch_status(client, order["id"], "RETURNED", token)
    assert r.status_code == 200, r.text
    assert _get_product_stock(pack["id"]).stock == 8
    assert _get_product_stock(component["id"]).stock == 50

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


# ─── 5. Double-click / repeated identical status change ─────────────────────

@pytest.mark.asyncio
async def test_repeated_returned_status_never_double_restocks(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix, stock=15)
    order = await _make_order(client, store_id, suffix, [
        {"product_id": product["id"], "product_name": product["name"], "quantity": 2, "unit_price": 1000},
    ])
    token = _get_admin_token()
    await _patch_status(client, order["id"], "CONFIRMED", token)

    r1 = await _patch_status(client, order["id"], "RETURNED", token)
    assert r1.status_code == 200
    assert _get_product_stock(product["id"]).stock == 15

    # Double-click: PATCH the exact same status again.
    r2 = await _patch_status(client, order["id"], "RETURNED", token)
    assert r2.status_code == 200, "re-submitting the same status must be a harmless no-op, not an error"
    assert _get_product_stock(product["id"]).stock == 15, "stock must NOT be incremented a second time"

    restock_moves = [m for m in _stock_movements(order["id"]) if m.type == "RETURN_RESTOCK"]
    assert len(restock_moves) == 1, f"expected exactly 1 RETURN_RESTOCK movement, got {len(restock_moves)}"

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


# ─── 6. RETURNED is a true terminal state — cannot re-enter DELIVERED ───────

@pytest.mark.asyncio
async def test_returned_is_terminal_cannot_transition_to_delivered(client):
    """Proves the "RETURNED -> DELIVERED -> RETURNED" double-restock
    scenario is structurally impossible: _VALID_TRANSITIONS["RETURNED"]
    is an empty list, so leaving RETURNED is rejected outright."""
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix, stock=15)
    order = await _make_order(client, store_id, suffix, [
        {"product_id": product["id"], "product_name": product["name"], "quantity": 2, "unit_price": 1000},
    ])
    token = _get_admin_token()
    await _patch_status(client, order["id"], "CONFIRMED", token)
    await _patch_status(client, order["id"], "RETURNED", token)

    r = await _patch_status(client, order["id"], "DELIVERED", token)
    assert r.status_code == 400, f"expected transition RETURNED->DELIVERED to be rejected, got {r.status_code}"
    assert _get_product_stock(product["id"]).stock == 15, "stock must be untouched after a rejected transition"

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


# ─── 7. Concurrency: two simultaneous RETURNED requests for the same order ──

@pytest.mark.asyncio
async def test_concurrent_returned_requests_restock_exactly_once(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix, stock=15)
    order = await _make_order(client, store_id, suffix, [
        {"product_id": product["id"], "product_name": product["name"], "quantity": 2, "unit_price": 1000},
    ])
    token = _get_admin_token()
    await _patch_status(client, order["id"], "CONFIRMED", token)

    import asyncio
    results = await asyncio.gather(
        _patch_status(client, order["id"], "RETURNED", token),
        _patch_status(client, order["id"], "RETURNED", token),
        _patch_status(client, order["id"], "RETURNED", token),
    )
    assert all(r.status_code == 200 for r in results)
    assert _get_product_stock(product["id"]).stock == 15, "concurrent identical requests must restock exactly once"
    restock_moves = [m for m in _stock_movements(order["id"]) if m.type == "RETURN_RESTOCK"]
    assert len(restock_moves) == 1

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


# ─── 8. Historical anomaly detection + idempotent manual reintegration ──────

@pytest.mark.asyncio
async def test_audit_detects_historical_gap_and_backfill_is_idempotent(client):
    """Simulates exactly the bug class fixed in delivery_partners.py/
    yalidine.py: an order that reached RETURNED via a path that bypassed
    order_service.update_order (raw `order.status = "RETURNED"` + only an
    ORDER_CONFIRM movement, no RETURN_RESTOCK) — the audit must flag it,
    and the backfill tool must fix it exactly once."""
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix, stock=15)
    order = await _make_order(client, store_id, suffix, [
        {"product_id": product["id"], "product_name": product["name"], "quantity": 3, "unit_price": 1000},
    ])
    token = _get_admin_token()
    await _patch_status(client, order["id"], "CONFIRMED", token)  # writes ORDER_CONFIRM, deducts stock

    # Simulate the historical bug: force RETURNED directly in the DB,
    # bypassing order_service entirely (no RETURN_RESTOCK ever written).
    from app.db.session import SessionLocal
    from app.models.order import Order as OrderModel
    db = SessionLocal()
    db.query(OrderModel).filter(OrderModel.id == order["id"]).update({"status": "RETURNED"})
    db.commit()
    db.close()

    assert _get_product_stock(product["id"]).stock == 12, "stock should still be deducted (bug not yet detected)"

    audit = await client.get(f"{settings.API_V1_STR}/orders/returns/audit", headers={"Authorization": f"Bearer {token}"})
    assert audit.status_code == 200, audit.text
    data = audit.json()["data"]
    flagged_ids = {a["order_id"] for a in data["anomalies"]}
    assert order["id"] in flagged_ids, "the audit must detect this order as never-restocked"

    fix = await client.post(
        f"{settings.API_V1_STR}/orders/returns/reintegrate-missing",
        json={"order_ids": [order["id"]]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert fix.status_code == 200, fix.text
    assert fix.json()["data"]["processed"] == 1
    assert _get_product_stock(product["id"]).stock == 15, "backfill must restore the exact quantity"

    # Re-run: must be a true no-op now (idempotent tool).
    fix2 = await client.post(
        f"{settings.API_V1_STR}/orders/returns/reintegrate-missing",
        json={"order_ids": [order["id"]]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert fix2.status_code == 200
    assert fix2.json()["data"]["processed"] == 0, "re-running the backfill on an already-fixed order must do nothing"
    assert _get_product_stock(product["id"]).stock == 15, "stock must not be incremented a second time"

    audit2 = await client.get(f"{settings.API_V1_STR}/orders/returns/audit", headers={"Authorization": f"Bearer {token}"})
    assert order["id"] not in {a["order_id"] for a in audit2.json()["data"]["anomalies"]}

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


# ─── 9. Order returned straight from a reserved state (never restocked, correctly) ──

@pytest.mark.asyncio
async def test_returned_from_new_only_releases_reservation_no_restock_expected(client):
    """NEW -> RETURNED never physically deducted stock (only reserved it),
    so release_reservation is the correct op — the audit must NOT flag this
    as an anomaly (no ORDER_CONFIRM movement exists for it)."""
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix, stock=15)
    order = await _make_order(client, store_id, suffix, [
        {"product_id": product["id"], "product_name": product["name"], "quantity": 2, "unit_price": 1000},
    ])
    token = _get_admin_token()

    r = await _patch_status(client, order["id"], "RETURNED", token)
    assert r.status_code == 200, r.text
    assert _get_product_stock(product["id"]).stock == 15, "never physically deducted, must remain unchanged"
    assert _get_product_stock(product["id"]).reserved_stock == 0, "reservation must be released"

    audit = await client.get(f"{settings.API_V1_STR}/orders/returns/audit", headers={"Authorization": f"Bearer {token}"})
    flagged_ids = {a["order_id"] for a in audit.json()["data"]["anomalies"]}
    assert order["id"] not in flagged_ids, "reserved-only orders must never be flagged as return anomalies"

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)


# ─── 10. Returns KPIs reflect real data ──────────────────────────────────────

@pytest.mark.asyncio
async def test_returns_kpis_reflect_real_data(client):
    suffix = str(uuid.uuid4())[:8]
    store_id = await _make_store(client, suffix)
    product = await _make_product(client, store_id, suffix, stock=15)
    order = await _make_order(client, store_id, suffix, [
        {"product_id": product["id"], "product_name": product["name"], "quantity": 3, "unit_price": 1000},
    ])
    token = _get_admin_token()
    await _patch_status(client, order["id"], "CONFIRMED", token)
    await _patch_status(client, order["id"], "RETURNED", token)

    kpis = await client.get(f"{settings.API_V1_STR}/orders/returns/kpis?store_id={store_id}", headers={"Authorization": f"Bearer {token}"})
    assert kpis.status_code == 200, kpis.text
    d = kpis.json()["data"]
    assert d["total_returns"] >= 1
    assert d["total_quantity_reintegrated"] >= 3
    assert d["total_value_reintegrated"] >= 3000
    assert any(p["product_id"] == product["id"] for p in d["top_products"])

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)
