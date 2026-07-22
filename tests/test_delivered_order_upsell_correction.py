"""
Regression test for the retroactive upsell correction (2026-07-22): a
confirmatrice sometimes forgets to flag an on-call upsell at the time —
she now needs to be able to toggle Order.is_upsell on an ALREADY
DELIVERED order so it counts toward her commission bonus (see
salary_service.py / test_upsell_commission.py). This must be a LOCAL-ONLY
field change: every other field on a DELIVERED order stays fully locked,
and a payload combining is_upsell with anything else must still be
rejected.
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
from app.models.product import Product
from app.models.user import User
from app.models.order import Order, OrderItem


def test_confirmatrice_can_retroactively_flag_upsell_on_delivered_order_only():
    client = TestClient(app)
    suffix = str(uuid.uuid4())[:8]
    db = SessionLocal()
    try:
        store = Store(
            id=str(uuid.uuid4()), name=f"Delivered Upsell Shop {suffix}", slug=f"delivered-upsell-shop-{suffix}",
            domain=f"delivered-upsell-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        db.add(store)
        db.flush()

        product = Product(
            id=str(uuid.uuid4()), store_id=store.id, name=f"Delivered Upsell Product {suffix}",
            slug=f"delivered-upsell-product-{suffix}", description="x", price=1000, stock=10,
            category="General", sku=f"SKU-DELUP-{suffix}", is_active=True,
        )
        db.add(product)

        agent_email = f"agent-delup-{suffix}@test.com"
        agent_password = "test-only-password"
        agent = User(
            id=str(uuid.uuid4()), email=agent_email, name="Test Agent Delivered Upsell",
            hashed_password=get_password_hash(agent_password), role="CONFIRMATEUR",
            employee_store_id=store.id, is_active=True,
        )
        db.add(agent)
        db.flush()

        order = Order(
            id=str(uuid.uuid4()), order_number=f"ORD-DELUP-{suffix}", store_id=store.id,
            customer_name="Client Delivered Upsell", customer_phone="0593" + suffix,
            customer_address="Adresse test", customer_wilaya="Alger", delivery_type="HOME",
            delivery_fee=0, subtotal=1000, discount=0, total=1000, source="landing_page",
            status="DELIVERED", assigned_to=agent.id, is_upsell=False,
        )
        db.add(order)
        db.flush()
        db.add(OrderItem(
            id=str(uuid.uuid4()), order_id=order.id, product_id=product.id,
            product_name=product.name, quantity=1, unit_price=1000,
        ))
        db.commit()
        order_id, store_id, agent_id, product_id = order.id, store.id, agent.id, product.id
    finally:
        db.close()

    login = client.post(
        f"{settings.API_V1_STR}/auth/login/access-token",
        data={"username": agent_email, "password": agent_password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    try:
        # Blocked: is_upsell combined with any other field on a DELIVERED order.
        blocked = client.patch(
            f"{settings.API_V1_STR}/orders/{order_id}/info",
            json={"is_upsell": True, "notes": "trying to sneak an edit in"},
            headers=headers,
        )
        assert blocked.status_code == 400, blocked.text

        # Allowed: is_upsell alone.
        ok = client.patch(
            f"{settings.API_V1_STR}/orders/{order_id}/info",
            json={"is_upsell": True},
            headers=headers,
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["is_upsell"] is True

        db = SessionLocal()
        try:
            refreshed = db.query(Order).filter(Order.id == order_id).first()
            assert refreshed.is_upsell is True
            assert refreshed.status == "DELIVERED", "status must stay untouched by this local-only correction"
            assert refreshed.customer_name == "Client Delivered Upsell", "no other field may change"
        finally:
            db.close()
    finally:
        db = SessionLocal()
        try:
            db.query(OrderItem).filter(OrderItem.order_id == order_id).delete()
            db.query(Order).filter(Order.id == order_id).delete()
            db.query(User).filter(User.id == agent_id).delete()
            db.query(Product).filter(Product.id == product_id).delete()
            db.query(Store).filter(Store.id == store_id).delete()
            db.commit()
        finally:
            db.close()
