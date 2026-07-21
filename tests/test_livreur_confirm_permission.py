"""
Regression test for the LIVREUR CONFIRMED permission (2026-07-21): a
courier auto-assignment rule (COMMUNE/WILAYA) hands an order directly to
a livreur, bypassing the confirmatrice workflow entirely — the livreur
must be able to move that order NEW/ABANDONED -> CONFIRMED himself, which
was previously blocked (403) since CONFIRMED wasn't in his allowed status
set.

Setup (store/product/livreur/order) is done directly via the DB session,
same pattern as test_assignment_rule_engine.py / test_courier_auto_
assignment.py — avoids the auth complexity of going through every setup
endpoint over HTTP. Only the ONE thing actually under test (the livreur's
PATCH permission) goes through the real HTTP layer + a real JWT, using
FastAPI's sync TestClient (not the broken AsyncClient(app=...) pattern
several other test files in this repo use with an incompatible httpx
version — confirmed working independently of that unrelated issue).
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


def test_livreur_can_confirm_a_courier_auto_assigned_order():
    client = TestClient(app)
    suffix = str(uuid.uuid4())[:8]
    db = SessionLocal()
    try:
        store = Store(
            id=str(uuid.uuid4()), name=f"Livreur Shop {suffix}", slug=f"livreur-shop-{suffix}",
            domain=f"livreur-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        db.add(store)
        db.flush()

        product = Product(
            id=str(uuid.uuid4()), store_id=store.id, name=f"Livreur Product {suffix}",
            slug=f"livreur-product-{suffix}", description="x", price=1000, stock=10,
            category="General", sku=f"SKU-LIV-{suffix}", is_active=True,
        )
        db.add(product)

        livreur_email = f"livreur-{suffix}@test.com"
        livreur_password = "test-only-password"
        livreur = User(
            id=str(uuid.uuid4()), email=livreur_email, name="Test Livreur",
            hashed_password=get_password_hash(livreur_password), role="LIVREUR",
            employee_store_id=store.id, is_active=True,
        )
        db.add(livreur)
        db.flush()

        order = Order(
            id=str(uuid.uuid4()), order_number=f"ORD-LIV-{suffix}", store_id=store.id,
            customer_name="Client Livreur Direct", customer_phone="0556" + suffix,
            customer_address="Alger", customer_wilaya="Alger", delivery_type="HOME",
            delivery_fee=0, subtotal=1000, discount=0, total=1000, source="landing_page",
            status="NEW",
            # Simulates what resolve_courier_rule + _auto_assign_courier
            # already do at order creation: livreur_id set directly,
            # assigned_to left unset — no confirmatrice was ever involved.
            livreur_id=livreur.id, assigned_to=None,
        )
        db.add(order)
        db.flush()
        db.add(OrderItem(
            id=str(uuid.uuid4()), order_id=order.id, product_id=product.id,
            product_name=product.name, quantity=1, unit_price=1000,
        ))
        db.commit()
        order_id, store_id, livreur_id, product_id = order.id, store.id, livreur.id, product.id
    finally:
        db.close()

    login = client.post(
        f"{settings.API_V1_STR}/auth/login/access-token",
        data={"username": livreur_email, "password": livreur_password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]

    patch = client.patch(
        f"{settings.API_V1_STR}/orders/{order_id}",
        json={"status": "CONFIRMED"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["status"] == "CONFIRMED"

    db = SessionLocal()
    try:
        from app.models.events import OrderEvent
        from app.models.notification import Notification
        from app.models.stock import StockMovement
        from app.models.audit import AuditLog
        db.query(OrderEvent).filter(OrderEvent.order_id == order_id).delete()
        db.query(Notification).filter(Notification.order_id == order_id).delete()
        db.query(StockMovement).filter(StockMovement.order_id == order_id).delete()
        db.query(OrderItem).filter(OrderItem.order_id == order_id).delete()
        db.query(Order).filter(Order.id == order_id).delete()
        db.query(AuditLog).filter(AuditLog.actor_id == livreur_id).delete()
        db.query(User).filter(User.id == livreur_id).delete()
        db.query(Product).filter(Product.id == product_id).delete()
        db.query(Store).filter(Store.id == store_id).delete()
        db.commit()
    finally:
        db.close()


def test_livreur_cannot_dispatch_order_to_carrier():
    """
    Regression test: POST /orders/{id}/dispatch had NO role/ownership check
    at all — any authenticated user, including a LIVREUR, could call it
    directly to create a carrier shipment on any order. A livreur must
    never create the parcel at the carrier himself (dashboard-parity work,
    2026-07-21) — only an explicit admin/confirmatrice action.
    """
    client = TestClient(app)
    suffix = str(uuid.uuid4())[:8]
    db = SessionLocal()
    try:
        store = Store(
            id=str(uuid.uuid4()), name=f"Livreur Dispatch Shop {suffix}", slug=f"livreur-dispatch-shop-{suffix}",
            domain=f"livreur-dispatch-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        db.add(store)
        db.flush()

        product = Product(
            id=str(uuid.uuid4()), store_id=store.id, name=f"Livreur Dispatch Product {suffix}",
            slug=f"livreur-dispatch-product-{suffix}", description="x", price=1000, stock=10,
            category="General", sku=f"SKU-LIVDISP-{suffix}", is_active=True,
        )
        db.add(product)

        livreur_email = f"livreur-dispatch-{suffix}@test.com"
        livreur_password = "test-only-password"
        livreur = User(
            id=str(uuid.uuid4()), email=livreur_email, name="Test Livreur Dispatch",
            hashed_password=get_password_hash(livreur_password), role="LIVREUR",
            employee_store_id=store.id, is_active=True,
        )
        db.add(livreur)
        db.flush()

        order = Order(
            id=str(uuid.uuid4()), order_number=f"ORD-LIVDISP-{suffix}", store_id=store.id,
            customer_name="Client Dispatch", customer_phone="0558" + suffix,
            customer_address="Alger", customer_wilaya="Alger", delivery_type="HOME",
            delivery_fee=0, subtotal=1000, discount=0, total=1000, source="landing_page",
            status="CONFIRMED", livreur_id=livreur.id, assigned_to=None,
        )
        db.add(order)
        db.flush()
        db.add(OrderItem(
            id=str(uuid.uuid4()), order_id=order.id, product_id=product.id,
            product_name=product.name, quantity=1, unit_price=1000,
        ))
        db.commit()
        order_id, store_id, livreur_id, product_id = order.id, store.id, livreur.id, product.id
    finally:
        db.close()

    login = client.post(
        f"{settings.API_V1_STR}/auth/login/access-token",
        data={"username": livreur_email, "password": livreur_password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]

    dispatch = client.post(
        f"{settings.API_V1_STR}/orders/{order_id}/dispatch",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert dispatch.status_code == 403, dispatch.text

    db = SessionLocal()
    try:
        from app.models.events import OrderEvent
        from app.models.notification import Notification
        from app.models.stock import StockMovement
        from app.models.audit import AuditLog
        db.query(OrderEvent).filter(OrderEvent.order_id == order_id).delete()
        db.query(Notification).filter(Notification.order_id == order_id).delete()
        db.query(StockMovement).filter(StockMovement.order_id == order_id).delete()
        db.query(OrderItem).filter(OrderItem.order_id == order_id).delete()
        db.query(Order).filter(Order.id == order_id).delete()
        db.query(AuditLog).filter(AuditLog.actor_id == livreur_id).delete()
        db.query(User).filter(User.id == livreur_id).delete()
        db.query(Product).filter(Product.id == product_id).delete()
        db.query(Store).filter(Store.id == store_id).delete()
        db.commit()
    finally:
        db.close()


def test_livreur_can_edit_customer_info_but_not_carrier_or_fee():
    """
    Regression test for the dashboard-parity work (2026-07-21): a livreur
    now gets the same order-editing drawer as a confirmatrice (PATCH
    /orders/{id}/info), but must never be able to touch the carrier
    relationship (carrier_id, tracking_number) or delivery_fee — those stay
    an explicit admin/confirmatrice decision, matching the dispatch-403
    boundary. Editing his own customer info (name/address/notes) must
    still succeed.
    """
    client = TestClient(app)
    suffix = str(uuid.uuid4())[:8]
    db = SessionLocal()
    try:
        store = Store(
            id=str(uuid.uuid4()), name=f"Livreur Edit Shop {suffix}", slug=f"livreur-edit-shop-{suffix}",
            domain=f"livreur-edit-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        db.add(store)
        db.flush()

        product = Product(
            id=str(uuid.uuid4()), store_id=store.id, name=f"Livreur Edit Product {suffix}",
            slug=f"livreur-edit-product-{suffix}", description="x", price=1000, stock=10,
            category="General", sku=f"SKU-LIVEDIT-{suffix}", is_active=True,
        )
        db.add(product)

        livreur_email = f"livreur-edit-{suffix}@test.com"
        livreur_password = "test-only-password"
        livreur = User(
            id=str(uuid.uuid4()), email=livreur_email, name="Test Livreur Edit",
            hashed_password=get_password_hash(livreur_password), role="LIVREUR",
            employee_store_id=store.id, is_active=True,
        )
        db.add(livreur)
        db.flush()

        order = Order(
            id=str(uuid.uuid4()), order_number=f"ORD-LIVEDIT-{suffix}", store_id=store.id,
            customer_name="Client Avant Edit", customer_phone="0557" + suffix,
            customer_address="Alger", customer_wilaya="Alger", delivery_type="HOME",
            delivery_fee=300, subtotal=1000, discount=0, total=1300, source="landing_page",
            status="NEW", livreur_id=livreur.id, assigned_to=None,
        )
        db.add(order)
        db.flush()
        db.add(OrderItem(
            id=str(uuid.uuid4()), order_id=order.id, product_id=product.id,
            product_name=product.name, quantity=1, unit_price=1000,
        ))
        db.commit()
        order_id, store_id, livreur_id, product_id = order.id, store.id, livreur.id, product.id
    finally:
        db.close()

    login = client.post(
        f"{settings.API_V1_STR}/auth/login/access-token",
        data={"username": livreur_email, "password": livreur_password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Allowed: editing customer info/notes on his own order.
    ok = client.patch(
        f"{settings.API_V1_STR}/orders/{order_id}/info",
        json={"customer_name": "Client Après Edit", "notes": "Client absent, repasser demain"},
        headers=headers,
    )
    assert ok.status_code == 200, ok.text

    # Blocked: changing delivery_fee to a different value.
    blocked_fee = client.patch(
        f"{settings.API_V1_STR}/orders/{order_id}/info",
        json={"delivery_fee": 999},
        headers=headers,
    )
    assert blocked_fee.status_code == 403, blocked_fee.text

    # Allowed: resubmitting the SAME delivery_fee (frontend always sends the
    # full form back, including untouched fields) must NOT 403.
    unchanged_fee = client.patch(
        f"{settings.API_V1_STR}/orders/{order_id}/info",
        json={"delivery_fee": 300},
        headers=headers,
    )
    assert unchanged_fee.status_code == 200, unchanged_fee.text

    db = SessionLocal()
    try:
        from app.models.events import OrderEvent
        from app.models.notification import Notification
        from app.models.stock import StockMovement
        from app.models.audit import AuditLog
        db.query(OrderEvent).filter(OrderEvent.order_id == order_id).delete()
        db.query(Notification).filter(Notification.order_id == order_id).delete()
        db.query(StockMovement).filter(StockMovement.order_id == order_id).delete()
        db.query(OrderItem).filter(OrderItem.order_id == order_id).delete()
        db.query(Order).filter(Order.id == order_id).delete()
        db.query(AuditLog).filter(AuditLog.actor_id == livreur_id).delete()
        db.query(User).filter(User.id == livreur_id).delete()
        db.query(Product).filter(Product.id == product_id).delete()
        db.query(Store).filter(Store.id == store_id).delete()
        db.commit()
    finally:
        db.close()
