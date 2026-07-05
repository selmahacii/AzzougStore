"""
Regression tests:
1. Meta CAPI normalization (Meta customer-information spec).
2. Stock symmetry matrix: confirm from any stage deducts stock exactly once,
   cancel restores it, and CANCELLED → CONFIRMED (confirmatrice winning the
   client back) deducts it again — no drift, no phantom shortage.
"""

import hashlib
import uuid
import os
import sys

import pytest
from httpx import AsyncClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
from app.core.config import settings

INTERNAL_KEY_HEADER = {"x-internal-key": settings.INTERNAL_API_KEY}


@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


# ─── 1. CAPI normalization ────────────────────────────────────────────────────

def _h(v: str) -> str:
    return hashlib.sha256(v.encode()).hexdigest()


def test_capi_normalization_meta_spec():
    from app.services.meta_capi import (
        build_user_data, normalize_phone, normalize_name,
        normalize_city, normalize_email, purchase_event_id,
    )

    # Phone → E.164 with 213, hashed
    assert normalize_phone("0550 12 34 56") == _h("213550123456")
    assert normalize_phone("+213 550 123 456") == _h("213550123456")
    assert normalize_phone("550123456") == _h("213550123456")

    # Names: lowercase, accents stripped, letters only
    assert normalize_name("Mohamed-Amine") == _h("mohamedamine")
    assert normalize_name("Chloé") == _h("chloe")

    # City: annotated communes cleaned
    assert normalize_city("القبة · Kouba") == _h("kouba")
    assert normalize_city("Bir Mourad Rais") == _h("birmouradrais")

    assert normalize_email("  Selma@GMAIL.com ") == _h("selma@gmail.com")

    ud = build_user_data(
        phone="0550123456", full_name="Selma Haci", city="Kouba",
        state="Alger", external_id="0550123456",
        client_ip="1.2.3.4, 10.0.0.1", user_agent="UA",
        fbclid="XYZ",
    )
    assert ud["ph"] == [_h("213550123456")]
    assert ud["fn"] == [_h("selma")]
    assert ud["ln"] == [_h("haci")]
    assert ud["ct"] == [_h("kouba")]
    assert ud["st"] == [_h("alger")]
    assert ud["country"] == [_h("dz")]
    assert ud["client_ip_address"] == "1.2.3.4"
    assert ud["fbc"].startswith("fb.1.") and ud["fbc"].endswith(".XYZ")

    # Deterministic dedup key shared with the browser Pixel
    assert purchase_event_id("abc") == "purchase-abc"


# ─── 2. Stock matrix through the real API ─────────────────────────────────────

async def _setup(client, suffix, stock=50):
    store_response = await client.post(
        f"{settings.API_V1_STR}/stores/",
        json={"name": f"Stock Shop {suffix}", "slug": f"stock-shop-{suffix}",
              "domain": f"stock-shop-{suffix}.com", "template_id": "modern",
              "owner_id": "SYSTEM_ADMIN"},
        headers=INTERNAL_KEY_HEADER,
    )
    assert store_response.status_code == 200
    store_id = store_response.json()["id"]
    product_response = await client.post(
        f"{settings.API_V1_STR}/products/",
        json={"name": f"Stock Product {suffix}", "description": "x", "price": 1000,
              "stock": stock, "category": "General", "sku": f"SKU-STK-{suffix}",
              "store_id": store_id, "is_active": True},
        headers=INTERNAL_KEY_HEADER,
    )
    assert product_response.status_code == 200
    return store_id, product_response.json()


def _stock(db, product_id):
    from app.models.product import Product
    p = db.query(Product).filter(Product.id == product_id).first()
    db.refresh(p)
    return int(p.stock or 0), int(p.reserved_stock or 0)


@pytest.mark.asyncio
async def test_stock_symmetry_confirm_cancel_reconfirm(client):
    suffix = str(uuid.uuid4())[:8]
    store_id, product = await _setup(client, suffix, stock=50)

    r = await client.post(
        f"{settings.API_V1_STR}/orders/",
        json={
            "store_id": store_id, "customer_name": "Client Stock",
            "customer_phone": "0570" + suffix[:6].replace("-", "1"),
            "customer_address": "Alger", "customer_wilaya": "Alger",
            "delivery_type": "HOME", "delivery_fee": 0,
            "subtotal": 1000, "discount": 0, "total": 1000, "source": "MANUAL",
            "items": [{"product_id": product["id"], "product_name": product["name"],
                        "quantity": 2, "unit_price": 1000}],
        },
        headers=INTERNAL_KEY_HEADER,
    )
    assert r.status_code == 201
    order_id = r.json()["id"]

    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        # Creation reserves
        assert _stock(db, product["id"]) == (50, 2)

        async def patch_status(status):
            resp = await client.patch(
                f"{settings.API_V1_STR}/orders/{order_id}",
                json={"status": status}, headers=INTERNAL_KEY_HEADER,
            )
            assert resp.status_code == 200, resp.text
            return resp

        # Confirm from NEW (previously never deducted stock → overselling!)
        await patch_status("CONFIRMED")
        assert _stock(db, product["id"]) == (48, 0)

        # Cancel → stock restored
        await patch_status("CANCELLED")
        assert _stock(db, product["id"]) == (50, 0)

        # Confirmatrice wins the client back: CANCELLED → CONFIRMED directly
        await patch_status("CONFIRMED")
        assert _stock(db, product["id"]) == (48, 0)

        # Rollback of a confirmation: CONFIRMED → IN_PROGRESS (restock + re-reserve)
        await patch_status("IN_PROGRESS")
        assert _stock(db, product["id"]) == (50, 2)

        # And confirm again from IN_PROGRESS
        await patch_status("CONFIRMED")
        assert _stock(db, product["id"]) == (48, 0)
    finally:
        db.close()

    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)
