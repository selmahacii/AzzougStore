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


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def compute_salary(
    db: Session,
    employee: User,
    store_id: Optional[str] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    date_by: str = "created_at",
) -> dict:
    """
    Compute the salary for *employee* in *store_id* for the given date window.
    date_by can be 'created_at' or 'delivered_at'/'updated_at'.

    Parameters
    ----------
    db          : active SQLAlchemy session
    employee    : User ORM object (must already be fetched)
    store_id    : restrict to orders belonging to this store (None = all stores)
    since       : lower bound on Order.created_at (inclusive); None = no lower bound
    until       : upper bound on Order.created_at (inclusive); None = no upper bound
    date_by     : field to use for filtering (created_at or delivered_at/updated_at)

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

    # A livreur is paid a fixed salary, never a per-basket/per-delivery
    # commission (2026-07-21, explicit Selma requirement) — the
    # PER_DELIVERED_ORDER fallback a few lines below exists for
    # confirmatrices/agents whose payment_type was never configured, but
    # applying it to an unconfigured livreur would silently pay him a
    # commission he was never meant to get. Only kicks in when the admin
    # hasn't explicitly picked a payment_type for him; an explicit
    # PER_DELIVERED_ORDER choice is still honored if ever configured.
    if payment_type is None and getattr(employee, "role", None) == "LIVREUR":
        payment_type = "MONTHLY_SALARY"

    recovered_rate   = getattr(employee, "payment_recovered_cart", 0) or 0
    lost_rate        = getattr(employee, "payment_lost_cart", 0) or 0
    upsell_rate      = getattr(employee, "payment_upsell", 0) or 0
    marketplace_rate = getattr(employee, "payment_marketplace_upsell_only", 50) or 50
    store_pickup_rate           = getattr(employee, "payment_store_pickup", 100) if getattr(employee, "payment_store_pickup", None) is not None else 100
    recovered_store_pickup_rate = getattr(employee, "payment_recovered_store_pickup", 150) if getattr(employee, "payment_recovered_store_pickup", None) is not None else 150

    # ── Count delivered orders, split by classification ──────────────────────
    normal_delivered          = _count_normal_delivered(db, employee.id, store_id, since, until, date_by=date_by)
    recovered_delivered       = _count_recovered_delivered(db, employee.id, store_id, since, until, date_by=date_by)
    total_delivered           = normal_delivered + recovered_delivered
    returned_count            = _count_returned(db, employee.id, store_id, since, until, date_by=date_by)
    upsell_delivered          = _count_upsell_delivered(db, employee.id, store_id, since, until, date_by=date_by)
    marketplace_delivered     = _count_marketplace_delivered(db, employee.id, store_id, since, until, date_by=date_by)
    store_pickup_delivered    = _count_store_pickup_delivered(db, employee.id, store_id, since, until, date_by=date_by)
    recovered_store_pickup_delivered = _count_recovered_store_pickup_delivered(db, employee.id, store_id, since, until, date_by=date_by)

    # ── Commission historique figée avec support Retrait Point de Vente ─────
    recovered_home_bonus = _sum_frozen_amount(
        db, employee.id, store_id, since, until,
        status="DELIVERED", is_abandoned_cart=True, is_store_pickup=False,
        snapshot_column=Order.commission_recovered_rate, fallback_rate=recovered_rate,
        date_by=date_by,
    )
    recovered_store_pickup_bonus = _sum_frozen_amount(
        db, employee.id, store_id, since, until,
        status="DELIVERED", is_abandoned_cart=True, is_store_pickup=True,
        snapshot_column=Order.commission_recovered_store_pickup_rate, fallback_rate=recovered_store_pickup_rate,
        date_by=date_by,
    )
    abandoned_bonus = recovered_home_bonus + recovered_store_pickup_bonus

    returned_penalty = _sum_frozen_amount(
        db, employee.id, store_id, since, until,
        status="RETURNED", is_abandoned_cart=None,
        snapshot_column=Order.commission_lost_rate, fallback_rate=lost_rate,
        date_by=date_by,
    )
    upsell_bonus = _sum_frozen_amount(
        db, employee.id, store_id, since, until,
        status="DELIVERED", is_abandoned_cart=None, is_upsell=True,
        snapshot_column=Order.commission_upsell_rate, fallback_rate=upsell_rate,
        date_by=date_by,
    )
    marketplace_bonus = _sum_frozen_amount(
        db, employee.id, store_id, since, until,
        status="DELIVERED", is_abandoned_cart=None, is_marketplace_upsell=True,
        snapshot_column=Order.commission_marketplace_rate, fallback_rate=marketplace_rate,
        date_by=date_by,
    )

    # ── Branch by payment type ────────────────────────────────────────────────
    if payment_type == "MONTHLY_SALARY":
        base_salary = payment_amount or 0
        salary      = max(0, base_salary + abandoned_bonus + upsell_bonus + marketplace_bonus - returned_penalty)

        return _build_result(
            payment_type="MONTHLY_SALARY",
            payment_amount=payment_amount,
            recovered_rate=recovered_rate,
            lost_rate=lost_rate,
            upsell_rate=upsell_rate,
            store_pickup_rate=store_pickup_rate,
            recovered_store_pickup_rate=recovered_store_pickup_rate,
            total_delivered=total_delivered,
            normal_delivered=normal_delivered,
            recovered_delivered=recovered_delivered,
            upsell_delivered=upsell_delivered,
            marketplace_delivered_count=marketplace_delivered,
            store_pickup_delivered_count=store_pickup_delivered,
            recovered_store_pickup_delivered_count=recovered_store_pickup_delivered,
            returned_count=returned_count,
            base_salary=base_salary,
            abandoned_bonus=abandoned_bonus,
            upsell_bonus=upsell_bonus,
            marketplace_bonus=marketplace_bonus,
            returned_penalty=returned_penalty,
            salary=salary,
            since=since,
            until=until,
        )

    # PER_DELIVERED_ORDER (explicit or implicit fallback when payment_type is None)
    effective_rate = payment_amount if payment_amount is not None else FALLBACK_RATE_PER_ORDER
    normal_home_salary = _sum_frozen_amount(
        db, employee.id, store_id, since, until,
        status="DELIVERED", is_abandoned_cart=False, is_store_pickup=False,
        snapshot_column=Order.commission_payment_amount, fallback_rate=effective_rate,
        date_by=date_by,
    )
    normal_store_pickup_salary = _sum_frozen_amount(
        db, employee.id, store_id, since, until,
        status="DELIVERED", is_abandoned_cart=False, is_store_pickup=True,
        snapshot_column=Order.commission_store_pickup_rate, fallback_rate=store_pickup_rate,
        date_by=date_by,
    )
    base_salary = normal_home_salary + normal_store_pickup_salary
    salary      = max(0, base_salary + abandoned_bonus + upsell_bonus + marketplace_bonus - returned_penalty)

    return _build_result(
        payment_type=payment_type or "PER_DELIVERED_ORDER",
        payment_amount=effective_rate,
        recovered_rate=recovered_rate,
        lost_rate=lost_rate,
        upsell_rate=upsell_rate,
        store_pickup_rate=store_pickup_rate,
        recovered_store_pickup_rate=recovered_store_pickup_rate,
        total_delivered=total_delivered,
        normal_delivered=normal_delivered,
        recovered_delivered=recovered_delivered,
        upsell_delivered=upsell_delivered,
        marketplace_delivered_count=marketplace_delivered,
        store_pickup_delivered_count=store_pickup_delivered,
        recovered_store_pickup_delivered_count=recovered_store_pickup_delivered,
        returned_count=returned_count,
        base_salary=base_salary,
        abandoned_bonus=abandoned_bonus,
        upsell_bonus=upsell_bonus,
        marketplace_bonus=marketplace_bonus,
        returned_penalty=returned_penalty,
        salary=salary,
        since=since,
        until=until,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Private helpers
# ─────────────────────────────────────────────────────────────────────────────

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


def _build_time_filters(since: Optional[datetime], until: Optional[datetime], date_by: str = "created_at") -> list:
    """Build the date-range filter clauses. Accepts 'created_at' or 'delivered_at'/'updated_at'."""
    from sqlalchemy import func
    filters = []
    date_col = func.coalesce(Order.updated_at, Order.created_at) if date_by in ("delivered_at", "updated_at") else Order.created_at
    if since:
        filters.append(date_col >= since)
    if until:
        filters.append(date_col <= until)
    return filters


def _count_normal_delivered(
    db: Session,
    user_id: str,
    store_id: Optional[str],
    since: Optional[datetime],
    until: Optional[datetime],
    date_by: str = "created_at",
) -> int:
    """
    Count DELIVERED orders that are NOT abandoned carts, assigned to user_id.
    These are the orders that earn the standard per-delivery commission.
    """
    store_filter = _build_store_filter(db, user_id, store_id)

    from sqlalchemy import or_
    filters = [
        store_filter,
        Order.assigned_to       == user_id,
        Order.status            == "DELIVERED",
        or_(Order.is_abandoned_cart == False, Order.is_abandoned_cart.is_(None)),
        Order.recovered_at.is_(None),
        or_(Order.is_marketplace_upsell == False, Order.is_marketplace_upsell.is_(None)),
        Order.is_deleted        == False,
    ] + _build_time_filters(since, until, date_by=date_by)

    return db.query(Order).filter(and_(*filters)).count()


def _count_recovered_delivered(
    db: Session,
    user_id: str,
    store_id: Optional[str] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    date_by: str = "created_at",
) -> int:
    store_filter = _build_store_filter(db, user_id, store_id)

    from sqlalchemy import or_
    filters = [
        store_filter,
        Order.assigned_to       == user_id,
        Order.status            == "DELIVERED",
        or_(Order.is_abandoned_cart == True, Order.recovered_at.isnot(None)),
        or_(Order.is_marketplace_upsell == False, Order.is_marketplace_upsell.is_(None)),
        Order.is_deleted        == False,
    ] + _build_time_filters(since, until, date_by=date_by)

    return db.query(Order).filter(and_(*filters)).count()


def _count_returned(
    db: Session,
    user_id: str,
    store_id: Optional[str],
    since: Optional[datetime],
    until: Optional[datetime],
    date_by: str = "created_at",
) -> int:
    store_filter = _build_store_filter(db, user_id, store_id)

    filters = [
        store_filter,
        Order.assigned_to == user_id,
        Order.status      == "RETURNED",
        Order.is_deleted  == False,
    ] + _build_time_filters(since, until, date_by=date_by)

    return db.query(Order).filter(and_(*filters)).count()


def _count_upsell_delivered(
    db: Session,
    user_id: str,
    store_id: Optional[str],
    since: Optional[datetime],
    until: Optional[datetime],
    date_by: str = "created_at",
) -> int:
    store_filter = _build_store_filter(db, user_id, store_id)

    filters = [
        store_filter,
        Order.assigned_to  == user_id,
        Order.status       == "DELIVERED",
        Order.is_upsell     == True,
        Order.is_deleted   == False,
    ] + _build_time_filters(since, until, date_by=date_by)

    return db.query(Order).filter(and_(*filters)).count()


def _count_marketplace_delivered(
    db: Session,
    user_id: str,
    store_id: Optional[str],
    since: Optional[datetime],
    until: Optional[datetime],
    date_by: str = "created_at",
) -> int:
    store_filter = _build_store_filter(db, user_id, store_id)

    filters = [
        store_filter,
        Order.assigned_to  == user_id,
        Order.status       == "DELIVERED",
        Order.is_marketplace_upsell == True,
        Order.is_deleted   == False,
    ] + _build_time_filters(since, until, date_by=date_by)

    return db.query(Order).filter(and_(*filters)).count()


STORE_PICKUP_TYPES = ["STORE_PICKUP", "POINT_DE_VENTE", "STORE", "RETRAIT_MAGASIN", "MANUAL"]


def _count_store_pickup_delivered(
    db: Session,
    user_id: str,
    store_id: Optional[str],
    since: Optional[datetime],
    until: Optional[datetime],
    date_by: str = "created_at",
) -> int:
    store_filter = _build_store_filter(db, user_id, store_id)
    filters = [
        store_filter,
        Order.assigned_to == user_id,
        Order.status == "DELIVERED",
        Order.delivery_type.in_(STORE_PICKUP_TYPES),
        Order.is_deleted == False,
    ] + _build_time_filters(since, until, date_by=date_by)
    return db.query(Order).filter(and_(*filters)).count()


def _count_recovered_store_pickup_delivered(
    db: Session,
    user_id: str,
    store_id: Optional[str],
    since: Optional[datetime],
    until: Optional[datetime],
    date_by: str = "created_at",
) -> int:
    store_filter = _build_store_filter(db, user_id, store_id)
    from sqlalchemy import or_
    filters = [
        store_filter,
        Order.assigned_to == user_id,
        Order.status == "DELIVERED",
        or_(Order.is_abandoned_cart == True, Order.recovered_at.isnot(None)),
        Order.delivery_type.in_(STORE_PICKUP_TYPES),
        Order.is_deleted == False,
    ] + _build_time_filters(since, until, date_by=date_by)
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
    is_upsell: Optional[bool] = None,
    is_marketplace_upsell: Optional[bool] = None,
    is_store_pickup: Optional[bool] = None,
    date_by: str = "created_at",
) -> int:
    from sqlalchemy import func as _func, case as _case, or_, and_

    store_filter = _build_store_filter(db, user_id, store_id)
    filters = [
        store_filter,
        Order.assigned_to == user_id,
        Order.status == status,
        Order.is_deleted == False,
    ] + _build_time_filters(since, until, date_by=date_by)
    if is_abandoned_cart is False:
        filters.append(and_(
            or_(Order.is_abandoned_cart == False, Order.is_abandoned_cart.is_(None)),
            Order.recovered_at.is_(None)
        ))
    elif is_abandoned_cart is True:
        filters.append(or_(Order.is_abandoned_cart == True, Order.recovered_at.isnot(None)))
    if is_upsell is not None:
        filters.append(Order.is_upsell == is_upsell)
    if is_marketplace_upsell is not None:
        filters.append(or_(Order.is_marketplace_upsell == is_marketplace_upsell, Order.is_marketplace_upsell.is_(None) if is_marketplace_upsell is False else False))
    if is_store_pickup is True:
        filters.append(Order.delivery_type.in_(STORE_PICKUP_TYPES))
    elif is_store_pickup is False:
        filters.append(or_(Order.delivery_type.is_(None), Order.delivery_type.notin_(STORE_PICKUP_TYPES)))

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
    upsell_rate: int = 0,
    store_pickup_rate: int = 100,
    recovered_store_pickup_rate: int = 150,
    total_delivered: int,
    normal_delivered: int,
    recovered_delivered: int,
    upsell_delivered: int = 0,
    marketplace_delivered_count: int = 0,
    store_pickup_delivered_count: int = 0,
    recovered_store_pickup_delivered_count: int = 0,
    returned_count: int = 0,
    base_salary: int,
    abandoned_bonus: int,
    upsell_bonus: int = 0,
    marketplace_bonus: int = 0,
    returned_penalty: int = 0,
    salary: int,
    since: Optional[datetime],
    until: Optional[datetime],
) -> dict:
    """Assemble and return the salary result dictionary."""
    return {
        "payment_type":                           payment_type,
        "payment_amount":                         payment_amount,
        "payment_recovered_cart":                 recovered_rate,
        "payment_store_pickup":                   store_pickup_rate,
        "payment_recovered_store_pickup":         recovered_store_pickup_rate,
        "delivered_count":                        total_delivered,
        "normal_delivered_count":                 normal_delivered,
        "recovered_delivered_count":              recovered_delivered,
        "store_pickup_delivered_count":           store_pickup_delivered_count,
        "recovered_store_pickup_delivered_count": recovered_store_pickup_delivered_count,
        # Legacy alias kept for backward-compatibility with existing API consumers
        "recovered_count":                        recovered_delivered,
        "lost_count":                             returned_count,
        "payment_lost_cart":                      lost_rate,
        "returned_penalty":                       returned_penalty,
        "payment_upsell":                         upsell_rate,
        "upsell_delivered_count":                 upsell_delivered,
        "upsell_bonus":                           upsell_bonus,
        "marketplace_delivered_count":            marketplace_delivered_count,
        "marketplace_bonus":                      marketplace_bonus,
        "base_salary":                            base_salary,
        "abandoned_bonus":                        abandoned_bonus,
        "salary":                                 salary,
        "since":                                  since.isoformat() if since else None,
        "until":                                  until.isoformat() if until else None,
    }
