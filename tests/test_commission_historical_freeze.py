"""
Regression tests for the commission historical freeze (2026-07-21,
chantier #2): compute_salary() must use the RATE FROZEN ON THE ORDER
(snapshot_commission in order_service.py) at assignment time, not the
employee's CURRENT payment_type/payment_amount — a rate change today must
never retroactively rewrite commissions on already-delivered orders.

Uses a minimal in-memory SQLite database with the real models (same
pattern as test_assignment_rule_engine.py / test_conversion_optimization_engine.py).
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.base_class import Base
from app.models.order import Order
from app.models.user import User
from app.services.salary_service import compute_salary


@pytest.fixture()
def db_session():
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng, tables=[Order.__table__, User.__table__])
    Session = sessionmaker(bind=eng)
    session = Session()
    yield session
    session.close()


def _employee(payment_type="PER_DELIVERED_ORDER", payment_amount=400):
    return User(
        id=str(uuid.uuid4()), email=f"{uuid.uuid4()}@test.com", name="Test Agent",
        hashed_password="x", role="CONFIRMATEUR", is_active=True,
        payment_type=payment_type, payment_amount=payment_amount,
        payment_recovered_cart=0, payment_lost_cart=0,
    )


def _delivered_order(agent_id, store_id, frozen_rate, is_abandoned=False, created_at=None):
    return Order(
        id=str(uuid.uuid4()), order_number=f"ORD-{uuid.uuid4().hex[:8]}", store_id=store_id,
        customer_name="Client", customer_phone="0555000000", customer_address="Alger",
        customer_wilaya="Alger", delivery_type="HOME", delivery_fee=0,
        subtotal=1000, discount=0, total=1000,
        status="DELIVERED", assigned_to=agent_id, is_abandoned_cart=is_abandoned,
        is_deleted=False, created_at=created_at or datetime.now(timezone.utc).replace(tzinfo=None),
        commission_agent_id=agent_id, commission_payment_type="PER_DELIVERED_ORDER",
        commission_payment_amount=frozen_rate, commission_recovered_rate=0, commission_lost_rate=0,
    )


def test_rate_change_today_never_alters_a_past_delivered_orders_commission(db_session):
    """The concrete scenario Selma described: an order was delivered when
    the employee's rate was 400 DA (frozen on the order). The employee's
    rate is later changed to 900 DA. Re-running payroll for that same past
    order must still show 400 DA, not 900 DA."""
    store_id = "store-1"
    emp = _employee(payment_amount=400)
    db_session.add(emp)
    db_session.add(_delivered_order(emp.id, store_id, frozen_rate=400))
    db_session.commit()

    result_before = compute_salary(db_session, emp, store_id=store_id)
    assert result_before["base_salary"] == 400

    # Rate change AFTER the order was delivered and frozen.
    emp.payment_amount = 900
    db_session.commit()

    result_after = compute_salary(db_session, emp, store_id=store_id)
    assert result_after["base_salary"] == 400, "frozen commission must not follow the new live rate"


def test_new_order_after_rate_change_uses_the_new_frozen_rate(db_session):
    """A NEW order assigned after the rate change correctly uses 900 DA —
    only past, already-frozen orders are protected, not future ones."""
    store_id = "store-1"
    emp = _employee(payment_amount=900)
    db_session.add(emp)
    db_session.add(_delivered_order(emp.id, store_id, frozen_rate=900))
    db_session.commit()

    result = compute_salary(db_session, emp, store_id=store_id)
    assert result["base_salary"] == 900


def test_mixed_old_and_new_rate_orders_sum_correctly(db_session):
    """Two orders in the SAME payroll window, one frozen at the old rate
    (400) and one at the new rate (900) — total must be their sum, not
    count * either single rate."""
    store_id = "store-1"
    emp = _employee(payment_amount=900)  # current rate, irrelevant to frozen orders
    db_session.add(emp)
    db_session.add(_delivered_order(emp.id, store_id, frozen_rate=400))
    db_session.add(_delivered_order(emp.id, store_id, frozen_rate=900))
    db_session.commit()

    result = compute_salary(db_session, emp, store_id=store_id)
    assert result["base_salary"] == 1300
    assert result["normal_delivered_count"] == 2


def test_order_without_snapshot_falls_back_to_current_rate(db_session):
    """A historical order created before this feature (commission_payment_amount
    is NULL) must fall back to the employee's current rate — identical to
    pre-existing behavior, so nothing changes for old data."""
    store_id = "store-1"
    emp = _employee(payment_amount=500)
    db_session.add(emp)
    order = Order(
        id=str(uuid.uuid4()), order_number="ORD-LEGACY", store_id=store_id,
        customer_name="Client", customer_phone="0555000000", customer_address="Alger",
        customer_wilaya="Alger", delivery_type="HOME", delivery_fee=0,
        subtotal=1000, discount=0, total=1000,
        status="DELIVERED", assigned_to=emp.id, is_abandoned_cart=False,
        is_deleted=False, created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        # No commission_* fields set — simulates a pre-migration order.
    )
    db_session.add(order)
    db_session.commit()

    result = compute_salary(db_session, emp, store_id=store_id)
    assert result["base_salary"] == 500


def test_recovered_bonus_uses_frozen_rate(db_session):
    """payment_recovered_cart change today must not alter a past recovered
    order's already-frozen bonus."""
    store_id = "store-1"
    emp = _employee(payment_amount=400)
    emp.payment_recovered_cart = 200
    db_session.add(emp)
    order = _delivered_order(emp.id, store_id, frozen_rate=400, is_abandoned=True)
    order.commission_recovered_rate = 150  # frozen at a DIFFERENT rate than the employee's current 200
    db_session.add(order)
    db_session.commit()

    result = compute_salary(db_session, emp, store_id=store_id)
    assert result["abandoned_bonus"] == 150, "must use the frozen 150, not the employee's current 200"
