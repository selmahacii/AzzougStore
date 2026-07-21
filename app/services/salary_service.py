"""
Salary computation service ÔÇö DELIVERED-only commission engine.

Rules
-----
PER_DELIVERED_ORDER:
    salary = (normal_delivered_count ├ù payment_amount)
           + (recovered_delivered_count ├ù payment_recovered_cart)
           - (returned_count ├ù payment_lost_cart)

MONTHLY_SALARY:
    salary = payment_amount (fixed)
           + (recovered_delivered_count ├ù payment_recovered_cart)
           - (returned_count ├ù payment_lost_cart)

RETURNED penalty
----------------
A RETURNED order was confirmed (and often already commissioned as CONFIRMED
in real business practice) but the carrier brought it back undelivered ÔÇö the
company still eats the delivery-fee cost. payment_lost_cart (DA, configured
per-employee, default 0) is deducted per RETURNED order assigned to the
employee in the same date window as everything else. Salary is floored at 0
(never goes negative). Set payment_lost_cart to 0 to disable this entirely.

Classification at query time
-----------------------------
Every DELIVERED order assigned to the employee is classified as:
  - "Normal"    when Order.is_abandoned_cart == False
  - "Recovered" when Order.is_abandoned_cart == True

Duplicate / child orders are never counted because they carry
  assigned_to = None  and/or  status = "DUPLICATE".

No other status (CONFIRMED, SHIPPED, CALLED, ÔÇª) ever generates a commission.
This is by design: delivery confirmation comes from the shipping carrier (NOEST).

Removed
-------
PER_CONFIRMED_ORDER has been removed entirely.
Any user whose payment_type was previously "PER_CONFIRMED_ORDER" in the database
must be migrated to "PER_DELIVERED_ORDER" via the migration script:
    backend/scripts/recalculate_commissions.py
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models.order import Order
from app.models.user import User

# Fallback rate used when payment_type / payment_amount are not configured
FALLBACK_RATE_PER_ORDER = 400  # DA


# ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
# Public API
# ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

def compute_salary(
    db: Session,
    employee: User,
    store_id: Optional[str] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> dict:
    """
    Compute the salary for *employee* in *store_id* for the given date window.

    Parameters
    ----------
    db          : active SQLAlchemy session
    employee    : User ORM object (must already be fetched)
    store_id    : restrict to orders belonging to this store (None = all stores)
    since       : lower bound on Order.created_at (inclusive); None = no lower bound
    until       : upper bound on Order.created_at (inclusive); None = no upper bound

    Returns
    -------
    dict with keys:
        payment_type              ÔÇô "PER_DELIVERED_ORDER" | "MONTHLY_SALARY" | None
        payment_amount            ÔÇô configured rate / monthly salary in DA
        payment_recovered_cart    ÔÇô per-order recovery bonus rate in DA
        delivered_count           ÔÇô total DELIVERED orders (normal + recovered)
        normal_delivered_count    ÔÇô DELIVERED orders that are NOT abandoned carts
        recovered_delivered_count ÔÇô DELIVERED orders that ARE abandoned carts (recovered)
        base_salary               ÔÇô normal_delivered_count ├ù payment_amount  (or fixed)
        abandoned_bonus           ÔÇô recovered_delivered_count ├ù payment_recovered_cart
        salary                    ÔÇô base_salary + abandoned_bonus
        since / until             ÔÇô echoed back (ISO strings or None)
    """
    payment_type   = employee.payment_type    # "PER_DELIVERED_ORDER" | "MONTHLY_SALARY" | None
    payment_amount = employee.payment_amount  # DA

    recovered_rate = getattr(employee, "payment_recovered_cart", 0) or 0
    lost_rate      = getattr(employee, "payment_lost_cart", 0) or 0

    # ÔöÇÔöÇ Count delivered orders, split by classification ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    normal_delivered    = _count_normal_delivered(db, employee.id, store_id, since, until)
    recovered_delivered = _count_recovered_delivered(db, employee.id, store_id, since, until)
    total_delivered     = normal_delivered + recovered_delivered
    returned_count      = _count_returned(db, employee.id, store_id, since, until)

    # Commission historique figée (2026-07-21) : ces bonus/pénalités
    # utilisent le taux FIGÉ sur chaque commande (snapshot_commission dans
    # order_service.py), pas le taux ACTUEL de l'employé — un changement
    # de payment_recovered_cart/payment_lost_cart aujourd'hui ne modifie
    # plus les commissions déjà figées sur des commandes passées.
    # fallback_rate couvre les commandes antérieures à cette
    # fonctionnalité (snapshot NULL), à l'identique du comportement
    # précédent.
    abandoned_bonus = _sum_frozen_amount(
        db, employee.id, store_id, since, until,
        status="DELIVERED", is_abandoned_cart=True,
        snapshot_column=Order.commission_recovered_rate, fallback_rate=recovered_rate,
    )
    returned_penalty = _sum_frozen_amount(
        db, employee.id, store_id, since, until,
        status="RETURNED", is_abandoned_cart=None,
        snapshot_column=Order.commission_lost_rate, fallback_rate=lost_rate,
    )

    # ÔöÇÔöÇ Branch by payment type ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    if payment_type == "MONTHLY_SALARY":
        base_salary = payment_amount or 0
        salary      = max(0, base_salary + abandoned_bonus - returned_penalty)

        return _build_result(
            payment_type="MONTHLY_SALARY",
            payment_amount=payment_amount,
            recovered_rate=recovered_rate,
            lost_rate=lost_rate,
            total_delivered=total_delivered,
            normal_delivered=normal_delivered,
            recovered_delivered=recovered_delivered,
            returned_count=returned_count,
            base_salary=base_salary,
            abandoned_bonus=abandoned_bonus,
            returned_penalty=returned_penalty,
            salary=salary,
            since=since,
            until=until,
        )

    # PER_DELIVERED_ORDER (explicit or implicit fallback when payment_type is None)
    # Commission historique figée : somme le taux FIGÉ par commande
    # (commission_payment_amount), pas normal_delivered * taux ACTUEL —
    # sinon un changement de payment_amount aujourd'hui réécrirait
    # silencieusement toutes les commissions déjà versées de cet employé.
    effective_rate = payment_amount if payment_amount is not None else FALLBACK_RATE_PER_ORDER
    base_salary    = _sum_frozen_amount(
        db, employee.id, store_id, since, until,
        status="DELIVERED", is_abandoned_cart=False,
        snapshot_column=Order.commission_payment_amount, fallback_rate=effective_rate,
    )
    salary         = max(0, base_salary + abandoned_bonus - returned_penalty)

    return _build_result(
        payment_type=payment_type or "PER_DELIVERED_ORDER",
        payment_amount=effective_rate,
        recovered_rate=recovered_rate,
        lost_rate=lost_rate,
        total_delivered=total_delivered,
        normal_delivered=normal_delivered,
        recovered_delivered=recovered_delivered,
        returned_count=returned_count,
        base_salary=base_salary,
        abandoned_bonus=abandoned_bonus,
        returned_penalty=returned_penalty,
        salary=salary,
        since=since,
        until=until,
    )


# ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
# Private helpers
# ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

def _build_store_filter(db: Session, user_id: str, store_id: Optional[str]):
    """
    Return a SQLAlchemy filter clause for the store scope.
    - If store_id is provided, restrict to that store.
    - Else if the user is SPECIFIC-scoped, restrict to their assigned_store_ids.
    - Otherwise allow all stores (True).
    """
    if store_id:
        return Order.store_id == store_id

    user = db.query(User).filter(User.id == user_id).first()
    if user and getattr(user, "assigned_store_scope", "ALL") == "SPECIFIC":
        raw_stores   = getattr(user, "assigned_store_ids", None)
        scoped_stores = raw_stores if isinstance(raw_stores, list) else []
        return Order.store_id.in_(scoped_stores) if scoped_stores else False

    return True  # No store restriction


def _build_time_filters(since: Optional[datetime], until: Optional[datetime]) -> list:
    """Build the date-range filter clauses."""
    filters = []
    if since:
        filters.append(Order.created_at >= since)
    if until:
        filters.append(Order.created_at <= until)
    return filters


def _count_normal_delivered(
    db: Session,
    user_id: str,
    store_id: Optional[str],
    since: Optional[datetime],
    until: Optional[datetime],
) -> int:
    """
    Count DELIVERED orders that are NOT abandoned carts, assigned to user_id.
    These are the orders that earn the standard per-delivery commission.
    """
    store_filter = _build_store_filter(db, user_id, store_id)

    filters = [
        store_filter,
        Order.assigned_to       == user_id,
        Order.status            == "DELIVERED",
        Order.is_abandoned_cart == False,
        Order.is_deleted        == False,
    ] + _build_time_filters(since, until)

    return db.query(Order).filter(and_(*filters)).count()


def _count_recovered_delivered(
    db: Session,
    user_id: str,
    store_id: Optional[str] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> int:
    """
    Count DELIVERED orders that are abandoned carts (successfully recovered and delivered).
    These earn the recovery-specific commission rate (payment_recovered_cart).

    Only DELIVERED is counted ÔÇö CONFIRMED, SHIPPED are not sufficient.
    The delivery confirmation must come from the shipping carrier.
    """
    store_filter = _build_store_filter(db, user_id, store_id)

    filters = [
        store_filter,
        Order.assigned_to       == user_id,
        Order.status            == "DELIVERED",
        Order.is_abandoned_cart == True,
        Order.is_deleted        == False,
    ] + _build_time_filters(since, until)

    return db.query(Order).filter(and_(*filters)).count()


def _count_returned(
    db: Session,
    user_id: str,
    store_id: Optional[str],
    since: Optional[datetime],
    until: Optional[datetime],
) -> int:
    """
    Count RETURNED orders assigned to user_id ÔÇö the carrier brought the order
    back undelivered after the employee had already confirmed it. Informational
    on its own; drives returned_penalty when the employee has a non-zero
    payment_lost_cart rate configured.
    """
    store_filter = _build_store_filter(db, user_id, store_id)

    filters = [
        store_filter,
        Order.assigned_to == user_id,
        Order.status      == "RETURNED",
        Order.is_deleted  == False,
    ] + _build_time_filters(since, until)

    return db.query(Order).filter(and_(*filters)).count()


def _sum_frozen_amount(
    db: Session,
    user_id: str,
    store_id: Optional[str],
    since: Optional[datetime],
    until: Optional[datetime],
    *,
    status: str,
    is_abandoned_cart: Optional[bool],
    snapshot_column,
    fallback_rate: int,
) -> int:
    """
    Commission historique figée (2026-07-21) — somme le taux FIGÉ sur
    chaque commande (commission_payment_amount / commission_recovered_rate
    / commission_lost_rate, selon snapshot_column) au lieu de multiplier un
    compte de commandes par le taux ACTUEL de l'employé. Une commande dont
    le snapshot est NULL (créée avant cette fonctionnalité, ou assignée
    avant que l'employé n'ait de taux configuré) retombe sur fallback_rate
    — le même taux "actuel" utilisé partout ailleurs, donc aucun
    changement de comportement pour l'historique pré-existant.
    """
    from sqlalchemy import func as _func, case as _case

    store_filter = _build_store_filter(db, user_id, store_id)
    filters = [
        store_filter,
        Order.assigned_to == user_id,
        Order.status == status,
        Order.is_deleted == False,
    ] + _build_time_filters(since, until)
    if is_abandoned_cart is not None:
        filters.append(Order.is_abandoned_cart == is_abandoned_cart)

    total = (
        db.query(_func.sum(_case((snapshot_column.isnot(None), snapshot_column), else_=fallback_rate)))
        .filter(and_(*filters))
        .scalar()
    )
    return int(total or 0)


def _build_result(
    *,
    payment_type: str,
    payment_amount,
    recovered_rate: int,
    lost_rate: int = 0,
    total_delivered: int,
    normal_delivered: int,
    recovered_delivered: int,
    returned_count: int = 0,
    base_salary: int,
    abandoned_bonus: int,
    returned_penalty: int = 0,
    salary: int,
    since: Optional[datetime],
    until: Optional[datetime],
) -> dict:
    """Assemble and return the salary result dictionary."""
    return {
        "payment_type":              payment_type,
        "payment_amount":            payment_amount,
        "payment_recovered_cart":    recovered_rate,
        "delivered_count":           total_delivered,
        "normal_delivered_count":    normal_delivered,
        "recovered_delivered_count": recovered_delivered,
        # Legacy alias kept for backward-compatibility with existing API consumers
        "recovered_count":           recovered_delivered,
        "lost_count":                returned_count,
        "payment_lost_cart":         lost_rate,
        "returned_penalty":          returned_penalty,
        "base_salary":               base_salary,
        "abandoned_bonus":           abandoned_bonus,
        "salary":                    salary,
        "since":                     since.isoformat() if since else None,
        "until":                     until.isoformat() if until else None,
    }
