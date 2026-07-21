"""
Regression tests for the livreur/confirmatrice territory-exclusivity fix
(2026-07-21): a COMMUNE/WILAYA assignment rule makes that delivery region a
livreur's EXCLUSIVE territory — he must see every order there (even ones
that predate the rule, or a rule added after order creation, so
Order.livreur_id was never stamped), and a confirmatrice must never see
those orders at all, regardless of status.

Setup is done directly via the DB session (same pattern as
test_livreur_confirm_permission.py) — only the actual GET /orders list
calls go through the real HTTP layer with a real JWT.
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
from app.models.order import Order, OrderItem
from app.models.user import User
from app.models.assignment_rule import AssignmentRule


def _cleanup(order_ids, user_ids, product_id, store_id, rule_ids):
    db = SessionLocal()
    try:
        from app.models.events import OrderEvent
        from app.models.notification import Notification
        from app.models.stock import StockMovement
        from app.models.audit import AuditLog
        db.query(OrderEvent).filter(OrderEvent.order_id.in_(order_ids)).delete(synchronize_session=False)
        db.query(Notification).filter(Notification.order_id.in_(order_ids)).delete(synchronize_session=False)
        db.query(StockMovement).filter(StockMovement.order_id.in_(order_ids)).delete(synchronize_session=False)
        db.query(OrderItem).filter(OrderItem.order_id.in_(order_ids)).delete(synchronize_session=False)
        db.query(Order).filter(Order.id.in_(order_ids)).delete(synchronize_session=False)
        db.query(AssignmentRule).filter(AssignmentRule.id.in_(rule_ids)).delete(synchronize_session=False)
        db.query(AuditLog).filter(AuditLog.actor_id.in_(user_ids)).delete(synchronize_session=False)
        db.query(User).filter(User.id.in_(user_ids)).delete(synchronize_session=False)
        db.query(Product).filter(Product.id == product_id).delete()
        db.query(Store).filter(Store.id == store_id).delete()
        db.commit()
    finally:
        db.close()


def test_livreur_sees_region_orders_that_predate_the_rule_and_confirmatrice_no_longer_does():
    client = TestClient(app)
    suffix = str(uuid.uuid4())[:8]
    db = SessionLocal()
    try:
        store = Store(
            id=str(uuid.uuid4()), name=f"Region Shop {suffix}", slug=f"region-shop-{suffix}",
            domain=f"region-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        db.add(store)
        db.flush()

        product = Product(
            id=str(uuid.uuid4()), store_id=store.id, name=f"Region Product {suffix}",
            slug=f"region-product-{suffix}", description="x", price=1000, stock=10,
            category="General", sku=f"SKU-REGION-{suffix}", is_active=True,
        )
        db.add(product)

        livreur_email = f"livreur-region-{suffix}@test.com"
        livreur_password = "test-only-password"
        livreur = User(
            id=str(uuid.uuid4()), email=livreur_email, name="Test Livreur Region",
            hashed_password=get_password_hash(livreur_password), role="LIVREUR",
            employee_store_id=store.id, is_active=True,
        )
        db.add(livreur)

        confirmatrice_email = f"confirmatrice-region-{suffix}@test.com"
        confirmatrice_password = "test-only-password"
        confirmatrice = User(
            id=str(uuid.uuid4()), email=confirmatrice_email, name="Test Confirmatrice Region",
            hashed_password=get_password_hash(confirmatrice_password), role="CONFIRMATEUR",
            employee_store_id=store.id, assigned_store_ids=[store.id], is_active=True,
        )
        db.add(confirmatrice)
        db.flush()

        # This order is created BEFORE any assignment rule exists — it has
        # NO livreur_id stamped, and would previously have been visible to
        # the confirmatrice (unassigned, inside her store scope) and
        # invisible to the livreur.
        commune = f"CommuneTest{suffix}"
        order = Order(
            id=str(uuid.uuid4()), order_number=f"ORD-REGION-{suffix}", store_id=store.id,
            customer_name="Client Region", customer_phone="0559" + suffix,
            customer_address="Adresse test", customer_wilaya="Alger", customer_commune=commune,
            delivery_type="HOME", delivery_fee=0, subtotal=1000, discount=0, total=1000,
            source="landing_page", status="NEW", livreur_id=None, assigned_to=None,
        )
        db.add(order)
        db.flush()
        db.add(OrderItem(
            id=str(uuid.uuid4()), order_id=order.id, product_id=product.id,
            product_name=product.name, quantity=1, unit_price=1000,
        ))
        db.commit()

        # NOW the rule is created — after the order already existed.
        rule = AssignmentRule(
            id=str(uuid.uuid4()), rule_type="COMMUNE", target_id=commune,
            agent_id=livreur.id, is_exclusion=False, is_active=True,
        )
        db.add(rule)
        db.commit()

        order_id, store_id, livreur_id, confirmatrice_id, product_id, rule_id = (
            order.id, store.id, livreur.id, confirmatrice.id, product.id, rule.id,
        )
    finally:
        db.close()

    livreur_login = client.post(
        f"{settings.API_V1_STR}/auth/login/access-token",
        data={"username": livreur_email, "password": livreur_password},
    )
    assert livreur_login.status_code == 200, livreur_login.text
    livreur_token = livreur_login.json()["access_token"]

    confirmatrice_login = client.post(
        f"{settings.API_V1_STR}/auth/login/access-token",
        data={"username": confirmatrice_email, "password": confirmatrice_password},
    )
    assert confirmatrice_login.status_code == 200, confirmatrice_login.text
    confirmatrice_token = confirmatrice_login.json()["access_token"]

    try:
        livreur_list = client.get(
            f"{settings.API_V1_STR}/orders?pageSize=200",
            headers={"Authorization": f"Bearer {livreur_token}"},
        )
        assert livreur_list.status_code == 200, livreur_list.text
        livreur_order_ids = {o["id"] for o in livreur_list.json()["data"]}
        assert order_id in livreur_order_ids, "the livreur must see a region order created BEFORE the rule existed"

        livreur_detail = client.get(
            f"{settings.API_V1_STR}/orders/{order_id}",
            headers={"Authorization": f"Bearer {livreur_token}"},
        )
        assert livreur_detail.status_code == 200, livreur_detail.text

        confirmatrice_list = client.get(
            f"{settings.API_V1_STR}/orders?pageSize=200",
            headers={"Authorization": f"Bearer {confirmatrice_token}"},
        )
        assert confirmatrice_list.status_code == 200, confirmatrice_list.text
        confirmatrice_order_ids = {o["id"] for o in confirmatrice_list.json()["data"]}
        assert order_id not in confirmatrice_order_ids, "the confirmatrice must NOT see an order in a livreur's exclusive region"

        confirmatrice_detail = client.get(
            f"{settings.API_V1_STR}/orders/{order_id}",
            headers={"Authorization": f"Bearer {confirmatrice_token}"},
        )
        assert confirmatrice_detail.status_code == 403, confirmatrice_detail.text
    finally:
        _cleanup([order_id], [livreur_id, confirmatrice_id], product_id, store_id, [rule_id])


def test_livreur_agent_counts_scoped_to_his_own_territory_not_store_wide():
    """
    Regression test: GET /orders/agent-counts had NO branch for LIVREUR at
    all — it fell through to the unscoped `else`, so a livreur's sidebar
    badges (Livrées, Retournées, En livraison...) showed the ENTIRE store's
    numbers instead of just his own territory. Also proves the new UPSELL
    pseudo-status filter/count works.
    """
    client = TestClient(app)
    suffix = str(uuid.uuid4())[:8]
    db = SessionLocal()
    try:
        store = Store(
            id=str(uuid.uuid4()), name=f"Counts Shop {suffix}", slug=f"counts-shop-{suffix}",
            domain=f"counts-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        db.add(store)
        db.flush()

        product = Product(
            id=str(uuid.uuid4()), store_id=store.id, name=f"Counts Product {suffix}",
            slug=f"counts-product-{suffix}", description="x", price=1000, stock=10,
            category="General", sku=f"SKU-COUNTS-{suffix}", is_active=True,
        )
        db.add(product)

        livreur_email = f"livreur-counts-{suffix}@test.com"
        livreur_password = "test-only-password"
        livreur = User(
            id=str(uuid.uuid4()), email=livreur_email, name="Test Livreur Counts",
            hashed_password=get_password_hash(livreur_password), role="LIVREUR",
            employee_store_id=store.id, is_active=True,
        )
        db.add(livreur)
        db.flush()

        commune = f"CommuneCounts{suffix}"
        rule = AssignmentRule(
            id=str(uuid.uuid4()), rule_type="COMMUNE", target_id=commune,
            agent_id=livreur.id, is_exclusion=False, is_active=True,
        )
        db.add(rule)
        db.flush()

        # DELIVERED order in his territory — must be counted.
        his_order = Order(
            id=str(uuid.uuid4()), order_number=f"ORD-COUNTS-HIS-{suffix}", store_id=store.id,
            customer_name="Client Counts His", customer_phone="0561" + suffix,
            customer_address="Adresse test", customer_wilaya="Alger", customer_commune=commune,
            delivery_type="HOME", delivery_fee=0, subtotal=1000, discount=0, total=1000,
            source="landing_page", status="DELIVERED", is_upsell=True,
        )
        # DELIVERED order OUTSIDE his territory — must NOT be counted for him.
        other_order = Order(
            id=str(uuid.uuid4()), order_number=f"ORD-COUNTS-OTHER-{suffix}", store_id=store.id,
            customer_name="Client Counts Other", customer_phone="0562" + suffix,
            customer_address="Adresse test", customer_wilaya="Oran", customer_commune="AutreCommune",
            delivery_type="HOME", delivery_fee=0, subtotal=1000, discount=0, total=1000,
            source="landing_page", status="DELIVERED",
        )
        db.add(his_order)
        db.add(other_order)
        db.commit()

        order_ids = [his_order.id, other_order.id]
        store_id, livreur_id, product_id, rule_id = store.id, livreur.id, product.id, rule.id
    finally:
        db.close()

    login = client.post(
        f"{settings.API_V1_STR}/auth/login/access-token",
        data={"username": livreur_email, "password": livreur_password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]

    try:
        res = client.get(
            f"{settings.API_V1_STR}/orders/agent-counts?store_id={store_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text
        counts = res.json()["counts"]
        assert counts["delivered"] == 1, "must count only his own territory's delivered order, not the whole store's"
        assert counts["upsell"] == 1
    finally:
        _cleanup(order_ids, [livreur_id], product_id, store_id, [rule_id])
