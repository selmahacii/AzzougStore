"""
Regression test for the Assignment Rule Engine's biggest-impact bug
(2026-07-22): Store.assignment_active defaults to False and
assignment_logic defaults to "MANUAL" — _auto_assign() used to check that
gate BEFORE ever consulting the Assignment Rule Engine, so an explicit
PRODUCT/STORE rule an admin configured was silently ignored for EVERY
store that hadn't separately turned on auto-assignment (the vast
majority, since MANUAL/False are the defaults). The order stayed
unassigned, then became visible to whichever OTHER confirmatrice had a
broad legacy assigned_store_ids/assigned_product_ids scope overlapping it
— not the agent the rule explicitly named. Reported live: a PRODUCT rule
naming "Ryma" kept routing to "Lyna" instead.

This test reproduces the exact scenario: a PRODUCT-level rule assigns a
specific product to agent A; a DIFFERENT confirmatrice B (with a broader
legacy scope covering the same store) must NOT get the order, and B must
NOT even be able to see it via GET /orders/{id} (the visibility exclusion
fix) — the rule's owner must be the one auto-assigned.
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
from app.models.order import Order
from app.models.assignment_rule import AssignmentRule
from app.services.order_service import order_service


def test_product_rule_wins_even_on_a_manual_store_and_excludes_other_confirmatrice():
    db = SessionLocal()
    suffix = str(uuid.uuid4())[:8]
    try:
        # Defaults matter here: assignment_active=False, assignment_logic
        # defaults to "MANUAL" (Store model defaults) — exactly the
        # real-world configuration that triggered the bug.
        store = Store(
            id=str(uuid.uuid4()), name=f"Rule Bug Shop {suffix}", slug=f"rule-bug-shop-{suffix}",
            domain=f"rule-bug-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        db.add(store)
        db.flush()

        product = Product(
            id=str(uuid.uuid4()), store_id=store.id, name=f"Ryma Product {suffix}",
            slug=f"ryma-product-{suffix}", description="x", price=1000, stock=10,
            category="General", sku=f"SKU-RULEBUG-{suffix}", is_active=True,
        )
        db.add(product)

        ryma = User(
            id=str(uuid.uuid4()), email=f"ryma-{suffix}@test.com", name="Ryma",
            hashed_password=get_password_hash("test-only-password"), role="CONFIRMATEUR",
            employee_store_id=store.id, is_active=True,
        )
        # Lyna has a BROAD legacy scope covering the same store — the
        # exact overlap that let her steal Ryma's rule-claimed order.
        lyna = User(
            id=str(uuid.uuid4()), email=f"lyna-{suffix}@test.com", name="Lyna",
            hashed_password=get_password_hash("test-only-password"), role="CONFIRMATEUR",
            assigned_store_ids=[store.id], is_active=True,
        )
        db.add(ryma)
        db.add(lyna)
        db.flush()

        rule = AssignmentRule(
            id=str(uuid.uuid4()), rule_type="PRODUCT", target_id=product.id,
            agent_id=ryma.id, is_exclusion=False, is_active=True,
        )
        db.add(rule)
        db.commit()
        product_id, store_id, ryma_id, lyna_id, rule_id = product.id, store.id, ryma.id, lyna.id, rule.id

        order = order_service.create_order(
            db,
            order_data=dict(
                store_id=store_id, customer_name="Client Rule Bug", customer_phone="0570" + suffix,
                customer_address="Adresse test", customer_wilaya="Alger", delivery_type="HOME",
                delivery_fee=0, subtotal=1000, discount=0, total=1000, source="landing_page",
            ),
            items_data=[{"product_id": product_id, "product_name": product.name, "quantity": 1, "unit_price": 1000}],
            actor_id=None,
        )
        db.commit()
        db.refresh(order)
        order_id, order_assigned_to = order.id, order.assigned_to
    finally:
        db.close()

    client = TestClient(app)
    try:
        assert order_assigned_to == ryma_id, (
            f"the PRODUCT rule must win even on a MANUAL/inactive-assignment store — "
            f"got assigned_to={order_assigned_to!r}, expected Ryma ({ryma_id!r})"
        )
        lyna_login = client.post(
            f"{settings.API_V1_STR}/auth/login/access-token",
            data={"username": f"lyna-{suffix}@test.com", "password": "test-only-password"},
        )
        assert lyna_login.status_code == 200, lyna_login.text
        lyna_token = lyna_login.json()["access_token"]

        lyna_detail = client.get(
            f"{settings.API_V1_STR}/orders/{order_id}",
            headers={"Authorization": f"Bearer {lyna_token}"},
        )
        assert lyna_detail.status_code == 403, "Lyna must not be able to see an order the PRODUCT rule claimed for Ryma"

        lyna_list = client.get(
            f"{settings.API_V1_STR}/orders?pageSize=200",
            headers={"Authorization": f"Bearer {lyna_token}"},
        )
        assert lyna_list.status_code == 200, lyna_list.text
        assert order_id not in {o["id"] for o in lyna_list.json()["data"]}
    finally:
        db = SessionLocal()
        try:
            from app.models.events import OrderEvent
            from app.models.notification import Notification
            from app.models.stock import StockMovement
            from app.models.audit import AuditLog
            from app.models.order import OrderItem
            from app.models.customer import Customer
            db.query(OrderEvent).filter(OrderEvent.order_id == order_id).delete()
            db.query(Notification).filter(Notification.order_id == order_id).delete()
            db.query(StockMovement).filter(StockMovement.order_id == order_id).delete()
            db.query(OrderItem).filter(OrderItem.order_id == order_id).delete()
            db.query(Order).filter(Order.id == order_id).delete()
            db.query(AssignmentRule).filter(AssignmentRule.id == rule_id).delete()
            db.query(AuditLog).filter(AuditLog.actor_id.in_([ryma_id, lyna_id])).delete(synchronize_session=False)
            db.query(AuditLog).filter(AuditLog.store_id == store_id).delete(synchronize_session=False)
            db.query(User).filter(User.id.in_([ryma_id, lyna_id])).delete(synchronize_session=False)
            db.query(Product).filter(Product.id == product_id).delete()
            db.query(Customer).filter(Customer.store_id == store_id).delete()
            db.query(Store).filter(Store.id == store_id).delete()
            db.commit()
        finally:
            db.close()
