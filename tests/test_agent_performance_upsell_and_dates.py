"""
Regression tests for the "Mon Salaire" dashboard fix (2026-07-22):
1. GET /users/{id}/performance now also returns upsell_count (was missing
   entirely — no badge for it existed on the frontend or backend).
2. start_date/end_date actually scope the stats — a delivered order
   outside the window must not be counted.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.core.security import get_password_hash
from app.db.session import SessionLocal
from app.models.store import Store
from app.models.product import Product
from app.models.order import Order
from app.models.user import User


def test_performance_reports_upsell_count_and_honors_date_window():
    client = TestClient(app)
    suffix = str(uuid.uuid4())[:8]
    db = SessionLocal()
    try:
        store = Store(
            id=str(uuid.uuid4()), name=f"Perf Shop {suffix}", slug=f"perf-shop-{suffix}",
            domain=f"perf-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        db.add(store)
        db.flush()

        product = Product(
            id=str(uuid.uuid4()), store_id=store.id, name=f"Perf Product {suffix}",
            slug=f"perf-product-{suffix}", description="x", price=1000, stock=10,
            category="General", sku=f"SKU-PERF-{suffix}", is_active=True,
        )
        db.add(product)

        admin_email = f"admin-perf-{suffix}@test.com"
        admin_password = "test-only-password"
        admin = User(
            id=str(uuid.uuid4()), email=admin_email, name="Test Admin Perf",
            hashed_password=get_password_hash(admin_password), role="SUPER_ADMIN", is_active=True,
        )
        agent = User(
            id=str(uuid.uuid4()), email=f"agent-perf-{suffix}@test.com", name="Test Agent Perf",
            hashed_password=get_password_hash("test-only-password"), role="CONFIRMATEUR",
            employee_store_id=store.id, is_active=True,
        )
        db.add(admin)
        db.add(agent)
        db.flush()

        now = datetime.utcnow()
        recent_order = Order(
            id=str(uuid.uuid4()), order_number=f"ORD-PERF-RECENT-{suffix}", store_id=store.id,
            customer_name="Client Perf Recent", customer_phone="0563" + suffix,
            customer_address="Adresse test", customer_wilaya="Alger", delivery_type="HOME",
            delivery_fee=0, subtotal=1000, discount=0, total=1000, source="landing_page",
            status="DELIVERED", assigned_to=agent.id, is_upsell=True, created_at=now,
        )
        old_order = Order(
            id=str(uuid.uuid4()), order_number=f"ORD-PERF-OLD-{suffix}", store_id=store.id,
            customer_name="Client Perf Old", customer_phone="0564" + suffix,
            customer_address="Adresse test", customer_wilaya="Alger", delivery_type="HOME",
            delivery_fee=0, subtotal=1000, discount=0, total=1000, source="landing_page",
            status="DELIVERED", assigned_to=agent.id, is_upsell=True, created_at=now - timedelta(days=60),
        )
        db.add(recent_order)
        db.add(old_order)
        db.commit()

        order_ids = [recent_order.id, old_order.id]
        store_id, agent_id, admin_id, product_id = store.id, agent.id, admin.id, product.id
    finally:
        db.close()

    login = client.post(
        f"{settings.API_V1_STR}/auth/login/access-token",
        data={"username": admin_email, "password": admin_password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    try:
        no_filter = client.get(f"{settings.API_V1_STR}/users/{agent_id}/performance", headers=headers)
        assert no_filter.status_code == 200, no_filter.text
        assert no_filter.json()["stats"]["upsell_count"] == 2

        start = (datetime.utcnow() - timedelta(days=7)).date().isoformat()
        windowed = client.get(
            f"{settings.API_V1_STR}/users/{agent_id}/performance?start_date={start}", headers=headers,
        )
        assert windowed.status_code == 200, windowed.text
        stats = windowed.json()["stats"]
        assert stats["upsell_count"] == 1, "the order from 60 days ago must be excluded by start_date"
        assert stats["delivered_count"] == 1
    finally:
        db = SessionLocal()
        try:
            db.query(Order).filter(Order.id.in_(order_ids)).delete(synchronize_session=False)
            db.query(User).filter(User.id.in_([agent_id, admin_id])).delete(synchronize_session=False)
            db.query(Product).filter(Product.id == product_id).delete()
            db.query(Store).filter(Store.id == store_id).delete()
            db.commit()
        finally:
            db.close()
