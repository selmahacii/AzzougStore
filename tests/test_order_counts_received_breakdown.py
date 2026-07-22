"""
Regression test for GET /orders/counts' "_received" breakdown (2026-07-22):
"Commande normale" used to count EVERY non-abandoned-cart order, including
manual entries and upsells — the admin explicitly wants those as distinct,
non-overlapping categories. Also adds "recovered" (panier récupéré,
distinct from a still-abandoned cart) and "cancelled" counts that didn't
exist before.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.core.security import get_password_hash
from app.db.session import SessionLocal
from app.models.store import Store
from app.models.user import User
from app.models.order import Order


def test_received_breakdown_categories_never_overlap():
    client = TestClient(app)
    suffix = str(uuid.uuid4())[:8]
    db = SessionLocal()
    try:
        store = Store(
            id=str(uuid.uuid4()), name=f"Counts Breakdown Shop {suffix}", slug=f"counts-breakdown-shop-{suffix}",
            domain=f"counts-breakdown-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        db.add(store)
        db.flush()

        admin_email = f"admin-breakdown-{suffix}@test.com"
        admin_password = "test-only-password"
        admin = User(
            id=str(uuid.uuid4()), email=admin_email, name="Test Admin Breakdown",
            hashed_password=get_password_hash(admin_password), role="SUPER_ADMIN", is_active=True,
        )
        db.add(admin)
        db.flush()

        def _mk(**kw):
            defaults = dict(
                id=str(uuid.uuid4()), store_id=store.id, customer_name="Client Breakdown",
                customer_address="Adresse test", customer_wilaya="Alger", delivery_type="HOME",
                delivery_fee=0, subtotal=1000, discount=0, total=1000,
            )
            defaults.update(kw)
            return Order(**defaults)

        orders = [
            _mk(order_number=f"ORD-BD-NORMAL-{suffix}", customer_phone="0581" + suffix,
                status="NEW", source="landing_page", is_abandoned_cart=False, is_upsell=False),
            _mk(order_number=f"ORD-BD-MANUAL-{suffix}", customer_phone="0582" + suffix,
                status="NEW", source="MANUAL", is_abandoned_cart=False, is_upsell=False),
            _mk(order_number=f"ORD-BD-UPSELL-{suffix}", customer_phone="0583" + suffix,
                status="NEW", source="landing_page", is_abandoned_cart=False, is_upsell=True),
            _mk(order_number=f"ORD-BD-ABANDONED-{suffix}", customer_phone="0584" + suffix,
                status="ABANDONED", source="abandoned_cart", is_abandoned_cart=True),
            _mk(order_number=f"ORD-BD-RECOVERED-{suffix}", customer_phone="0585" + suffix,
                status="DELIVERED", source="abandoned_cart", is_abandoned_cart=True),
            _mk(order_number=f"ORD-BD-CANCELLED-{suffix}", customer_phone="0586" + suffix,
                status="CANCELLED", source="landing_page", is_abandoned_cart=False, is_upsell=False),
        ]
        db.add_all(orders)
        db.commit()
        order_ids = [o.id for o in orders]
        store_id, admin_id = store.id, admin.id
    finally:
        db.close()

    login = client.post(
        f"{settings.API_V1_STR}/auth/login/access-token",
        data={"username": admin_email, "password": admin_password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]

    try:
        res = client.get(
            f"{settings.API_V1_STR}/orders/counts?store_id={store_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text
        received = res.json()["_received"]
        # "Normal" excludes exactly manual/upsell/abandoned-cart-origin (per
        # Selma's explicit list) — a CANCELLED normal order still counts as
        # normal (cancellation is a status, not a separate origin category).
        assert received["normal"] == 2, "normal must exclude manual/upsell/abandoned-cart-origin orders only"
        assert received["manual"] == 1
        assert received["upsell"] == 1
        assert received["abandoned"] == 1, "still-abandoned cart, not the recovered one"
        assert received["recovered"] == 1, "DELIVERED + is_abandoned_cart must count as recovered, not abandoned"
        assert received["cancelled"] == 1
    finally:
        db = SessionLocal()
        try:
            db.query(Order).filter(Order.id.in_(order_ids)).delete(synchronize_session=False)
            db.query(User).filter(User.id == admin_id).delete()
            db.query(Store).filter(Store.id == store_id).delete()
            db.commit()
        finally:
            db.close()
