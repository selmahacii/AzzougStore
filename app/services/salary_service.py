"""
Salary computation service.

Rules
-----
PER_DELIVERED_ORDER:
    salary = count(orders where status=DELIVERED assigned to employee) * payment_amount

MONTHLY_SALARY:
    salary = payment_amount (fixed, regardless of order count)

An employee with no payment_type configured falls back to PER_DELIVERED_ORDER
with the global FALLBACK_RATE_PER_ORDER commission rate.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models.order import Order
from app.models.user import User

FALLBACK_RATE_PER_ORDER = 400  # DA — used when payment_type/amount are not set


def compute_salary(
    db: Session,
    employee: User,
    store_id: str,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> dict:
    """
    Compute the salary for *employee* in *store_id* for the given date window.

    Parameters
    ----------
    db          : active SQLAlchemy session
    employee    : User ORM object (must already be fetched)
    store_id    : restrict to orders belonging to this store
    since       : lower bound on Order.created_at (inclusive); None = no lower bound
    until       : upper bound on Order.created_at (inclusive); None = no upper bound

    Returns
    -------
    dict with keys:
        payment_type        – "PER_DELIVERED_ORDER" | "MONTHLY_SALARY" | None
        payment_amount      – configured rate/salary in DA
        delivered_count     – number of DELIVERED orders in the window
        salary              – computed salary in DA
        since / until       – echoed back (ISO strings or None)
    """
    payment_type   = employee.payment_type    # may be None
    payment_amount = employee.payment_amount  # may be None
    
    # Abandoned cart recovery commissions
    recovered_rate = getattr(employee, "payment_recovered_cart", 0) or 0
    lost_rate      = 0  # Ignore lost cart commissions entirely
    
    recovered_count = _count_abandoned_recovered(db, employee.id, store_id, since, until)
    lost_count      = 0
    
    abandoned_bonus = (recovered_count * recovered_rate)

    if payment_type == "MONTHLY_SALARY":
        salary          = (payment_amount or 0) + abandoned_bonus
        delivered_count = _count_delivered(db, employee.id, store_id, since, until)
        return {
            "payment_type":    "MONTHLY_SALARY",
            "payment_amount":  payment_amount,
            "delivered_count": delivered_count,
            "recovered_count": recovered_count,
            "lost_count":      0,
            "payment_recovered_cart": recovered_rate,
            "payment_lost_cart":      0,
            "abandoned_bonus":        abandoned_bonus,
            "salary":          salary,
            "since":           since.isoformat() if since else None,
            "until":           until.isoformat() if until else None,
        }

    elif payment_type == "PER_CONFIRMED_ORDER":
        effective_rate  = payment_amount if payment_amount is not None else FALLBACK_RATE_PER_ORDER
        confirmed_count = _count_confirmed(db, employee.id, store_id, since, until)
        delivered_count = _count_delivered(db, employee.id, store_id, since, until)
        salary          = (confirmed_count * effective_rate) + abandoned_bonus

        return {
            "payment_type":    "PER_CONFIRMED_ORDER",
            "payment_amount":  effective_rate,
            "delivered_count": delivered_count,
            "recovered_count": recovered_count,
            "lost_count":      0,
            "payment_recovered_cart": recovered_rate,
            "payment_lost_cart":      0,
            "abandoned_bonus":        abandoned_bonus,
            "salary":          salary,
            "since":           since.isoformat() if since else None,
            "until":           until.isoformat() if until else None,
        }

    # PER_DELIVERED_ORDER  (explicit or implicit fallback)
    effective_rate  = payment_amount if payment_amount is not None else FALLBACK_RATE_PER_ORDER
    delivered_count = _count_delivered(db, employee.id, store_id, since, until)
    salary          = (delivered_count * effective_rate) + abandoned_bonus

    return {
        "payment_type":    payment_type or "PER_DELIVERED_ORDER",
        "payment_amount":  effective_rate,
        "delivered_count": delivered_count,
        "recovered_count": recovered_count,
        "lost_count":      0,
        "payment_recovered_cart": recovered_rate,
        "payment_lost_cart":      0,
        "abandoned_bonus":        abandoned_bonus,
        "salary":          salary,
        "since":           since.isoformat() if since else None,
        "until":           until.isoformat() if until else None,
    }


def _count_delivered(
    db: Session,
    user_id: str,
    store_id: str,
    since: Optional[datetime],
    until: Optional[datetime],
) -> int:
    """Count DELIVERED orders assigned to user_id in store_id within the window."""
    filters = [
        Order.store_id    == store_id,
        Order.assigned_to == user_id,
        Order.status      == "DELIVERED",
        Order.is_deleted  == False,
    ]
    if since:
        filters.append(Order.created_at >= since)
    if until:
        filters.append(Order.created_at <= until)

    return db.query(Order).filter(and_(*filters)).count()


def _count_confirmed(
    db: Session,
    user_id: str,
    store_id: str,
    since: Optional[datetime],
    until: Optional[datetime],
) -> int:
    """Count CONFIRMED (or SHIPPED/DELIVERED) orders assigned to user_id in store_id within the window."""
    filters = [
        Order.store_id    == store_id,
        Order.assigned_to == user_id,
        Order.status.in_(["CONFIRMED", "SHIPPED", "DELIVERED"]),
        Order.is_deleted  == False,
    ]
    if since:
        filters.append(Order.created_at >= since)
    if until:
        filters.append(Order.created_at <= until)

    return db.query(Order).filter(and_(*filters)).count()


def _count_abandoned_recovered(
    db: Session,
    user_id: str,
    store_id: str,
    since: Optional[datetime],
    until: Optional[datetime],
) -> int:
    """Count recovered abandoned carts (is_abandoned_cart=True, status = DELIVERED)."""
    filters = [
        Order.store_id    == store_id,
        Order.assigned_to == user_id,
        Order.is_abandoned_cart == True,
        Order.status      == "DELIVERED",
        Order.is_deleted  == False,
    ]
    if since:
        filters.append(Order.created_at >= since)
    if until:
        filters.append(Order.created_at <= until)

    return db.query(Order).filter(and_(*filters)).count()


def _count_abandoned_lost(
    db: Session,
    user_id: str,
    store_id: str,
    since: Optional[datetime],
    until: Optional[datetime],
) -> int:
    """Count lost abandoned carts (source=abandoned_cart, status = CANCELLED)."""
    filters = [
        Order.store_id    == store_id,
        Order.assigned_to == user_id,
        Order.source      == "abandoned_cart",
        Order.status      == "CANCELLED",
        Order.is_deleted  == False,
    ]
    if since:
        filters.append(Order.created_at >= since)
    if until:
        filters.append(Order.created_at <= until)

    return db.query(Order).filter(and_(*filters)).count()
