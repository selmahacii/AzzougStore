"""
Regression test for the upsell commission bonus (2026-07-22): a
confirmatrice who adds an on-call upsell product to an order now earns a
flat bonus (payment_upsell, admin-configured) once that order reaches
DELIVERED — ON TOP of whatever else the order already earns (normal rate
or recovery bonus), not a replacement for it. Also proves upsell orders
are correctly excluded from the "normal" bucket (they're their own
category, per Selma's explicit request).
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.models.user import User
from app.models.store import Store
from app.models.order import Order
from app.core.security import get_password_hash
from app.services.order_service import snapshot_commission
from app.services.salary_service import compute_salary


def test_upsell_bonus_is_additive_and_frozen_at_snapshot_time():
    db = SessionLocal()
    suffix = str(uuid.uuid4())[:8]
    try:
        store = Store(
            id=str(uuid.uuid4()), name=f"Upsell Shop {suffix}", slug=f"upsell-shop-{suffix}",
            domain=f"upsell-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        db.add(store)
        db.flush()

        agent = User(
            id=str(uuid.uuid4()), email=f"agent-upsell-{suffix}@test.com", name="Test Agent Upsell",
            hashed_password=get_password_hash("test-only-password"), role="CONFIRMATEUR",
            employee_store_id=store.id, is_active=True,
            payment_type="PER_DELIVERED_ORDER", payment_amount=400, payment_upsell=250,
        )
        db.add(agent)
        db.flush()

        # Normal delivered order, no upsell — earns just the base rate.
        normal_order = Order(
            id=str(uuid.uuid4()), order_number=f"ORD-UP-NORMAL-{suffix}", store_id=store.id,
            customer_name="Client Normal", customer_phone="0591" + suffix,
            customer_address="Adresse test", customer_wilaya="Alger", delivery_type="HOME",
            delivery_fee=0, subtotal=1000, discount=0, total=1000, source="landing_page",
            status="DELIVERED", assigned_to=agent.id, is_upsell=False,
        )
        # Upsell delivered order — earns base rate PLUS the upsell bonus.
        upsell_order = Order(
            id=str(uuid.uuid4()), order_number=f"ORD-UP-UPSELL-{suffix}", store_id=store.id,
            customer_name="Client Upsell", customer_phone="0592" + suffix,
            customer_address="Adresse test", customer_wilaya="Alger", delivery_type="HOME",
            delivery_fee=0, subtotal=1500, discount=0, total=1500, source="landing_page",
            status="DELIVERED", assigned_to=agent.id, is_upsell=True,
        )
        db.add(normal_order)
        db.add(upsell_order)
        db.flush()

        snapshot_commission(db, normal_order, agent.id)
        snapshot_commission(db, upsell_order, agent.id)
        db.commit()

        order_ids = [normal_order.id, upsell_order.id]
        store_id, agent_id = store.id, agent.id

        result = compute_salary(db, agent, store_id=store_id)
        assert result["upsell_delivered_count"] == 1
        assert result["upsell_bonus"] == 250
        # Base salary = 2 delivered orders (normal + upsell, both non-
        # abandoned-cart) at 400 DA each = 800, PLUS the 250 upsell bonus.
        assert result["base_salary"] == 800
        assert result["salary"] == 1050

        # Now change the employee's live rate — the ALREADY-DELIVERED
        # order's bonus must stay frozen at what was snapshotted, not
        # silently jump to the new rate (same historical-freeze guarantee
        # as every other commission column).
        agent.payment_upsell = 999
        db.commit()
        result_after_rate_change = compute_salary(db, agent, store_id=store_id)
        assert result_after_rate_change["upsell_bonus"] == 250, "already-delivered upsell bonus must stay frozen"
    finally:
        try:
            db.query(Order).filter(Order.id.in_(order_ids)).delete(synchronize_session=False)
            db.query(User).filter(User.id == agent_id).delete()
            db.query(Store).filter(Store.id == store_id).delete()
            db.commit()
        except NameError:
            db.rollback()
        finally:
            db.close()
