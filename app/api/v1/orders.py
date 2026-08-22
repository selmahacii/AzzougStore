# ═══════════════════════════════════════════════════════════════
# AzzougShop — Orders Router (Refactored)
# FastAPI is now the SOLE backend. All business logic lives here.
# Next.js Route Handlers at /api/v1/orders/* are deprecated.
# ═══════════════════════════════════════════════════════════════

from __future__ import annotations

import json
import logging
import re
from collections import Counter
from typing import Any, List, Optional
import uuid

from fastapi import APIRouter, Depends, Query, Request, HTTPException, BackgroundTasks, Body, UploadFile, File
from sqlalchemy import func, func as sqlfunc, and_
from sqlalchemy.orm import Session, joinedload

from app.api import deps
from app.core.exceptions import (
    InvalidStateTransitionError,
    OrderNotFoundError,
    PermissionError,
    StoreNotFoundError,
)
from app.core.rate_limit import check_rate_limit
from app.models.events import OrderEvent
from app.models.order import Order, OrderItem
from app.models.user import User
from app.schemas.order import (
    OrderCreate,
    OrderList,
    OrderRead,
    OrderReadFull,
    OrderUpdateStatus,
    OrderInfoUpdate,
)
from app.services.order_service import order_service, auto_merge_duplicates

router = APIRouter()
logger = logging.getLogger("app.orders")

# Décision produit explicite (2026-07-21, confirmée par Selma) : ne JAMAIS
# envoyer de Purchase à Meta pour une commande issue d'un panier abandonné
# récupéré par téléphone — même confirmée/livrée, même si c'est une vraie
# vente. Conséquence assumée et expliquée : le ROAS que Meta calcule
# sous-comptera ces ventes réelles, puisqu'il n'en aura jamais connaissance.
# Un seul interrupteur central, pas un `if False` éparpillé — pour repasser
# à True facilement si la décision change, sans devoir retrouver chaque site.
SEND_PURCHASE_FOR_RECOVERED_ABANDONED_CARTS = False


# ─── Carrier stage buckets (Noest's own granular tracking) ───────────────────
# Groups Noest's raw event_key (Order.carrier_stage, written by
# app.services.noest_sync on every poll) into the 6 stages the confirmatrice
# sees natively on Noest's own dashboard, so "Logistique" sub-modules can
# filter by real carrier progress instead of only our coarse SHIPPED status.
# Ordered roughly by pipeline progression; "delivered"/"suspended" mirror our
# own DELIVERED status / colis_suspendu flag respectively, kept here too so
# a single bucket lookup covers every stage consistently.
CARRIER_STAGE_BUCKETS: dict = {
    "ready_to_ship": {"upload", "customer_validation"},
    "processing": {"validation_reception_admin", "validation_collect_colis"},
    "in_transit": {"validation_reception", "sent_to_redispatch"},
    "out_for_delivery": {"fdr_activated", "mise_a_jour"},
    "suspended": {"colis_suspendu"},
    "delivered": {"livre", "livred"},
}


def _carrier_stage_bucket(stage: Optional[str]) -> Optional[str]:
    if not stage:
        return None
    s = stage.strip().lower()
    for bucket, keys in CARRIER_STAGE_BUCKETS.items():
        if s in keys:
            return bucket
    return None


# ─── RBAC helpers ────────────────────────────────────────────────────────────

# Confirmatrice responsibility scope — UNION semantics, STRICT ISOLATION by
# default, independent of the legacy assigned_store_scope ("ALL"/"SPECIFIC")
# flag:
#   • Resolved stores = assigned_store_ids ∪ {employee_store_id} (whichever
#     are set) — she is responsible for every one of these stores COMPLETELY
#     (all its products). assigned_store_ids is always honored regardless of
#     assigned_store_scope: that flag previously made the list dead weight
#     whenever it said "ALL", which is exactly the state an admin ends up in
#     after adding products to a confirmatrice already responsible for full
#     stores — a completely ordinary setup.
#   • assigned_product_ids (if non-empty): PLUS every order containing one of
#     these products, wherever that product's store is.
#   • NOTHING configured at all (no store, no product, no employee_store_id):
#     she sees ZERO unassigned orders — never a silent fallback to "every
#     store". Two confirmatrices each fully unconfigured must NEVER end up
#     seeing each other's orders; only an order actually ASSIGNED TO her
#     (handled separately in _assert_order_access / list_orders) is ever
#     visible in that case. Isolation is strict unless stores/products
#     genuinely overlap between agents.
# This covers all three real-world setups: full store(s) only, products only,
# and the hybrid "full store(s) + specific products of other stores".

def _confirmateur_resolved_stores(user: User) -> list:
    raw_stores = getattr(user, "assigned_store_ids", None)
    stores = list(raw_stores) if isinstance(raw_stores, list) else []
    employee_store_id = getattr(user, "employee_store_id", None)
    if employee_store_id and employee_store_id not in stores:
        stores.append(employee_store_id)
    return stores


def _legacy_products_claimed_by_others(user: User, db: Optional[Session]) -> set:
    """
    Every product_id in ANOTHER active CONFIRMATEUR/AGENT/AGENT_MANAGER's own
    User.assigned_product_ids — the per-employee "produits assignés" list
    editable straight from the employees admin panel (employees-page.tsx),
    which is a SEPARATE mechanism from the assignment_rules table (no DB-
    level conflict-prevention constraint backs it — two employees' lists can
    freely overlap). This is the actual root cause of the reported bug in
    its most common form: an admin assigns product X to confirmatrice A
    through this simple per-employee list (not through the separate "Règles
    d'Assignation" tab), while confirmatrice B has broader whole-store
    responsibility (assigned_store_ids/employee_store_id) covering the same
    store — nothing previously excluded X from B's store-wide match, so B
    kept seeing/managing orders containing A's product.
    Excludes `user`'s own products (if she also happens to have X in her own
    list, that's an intentional overlap, not "claimed by someone else").
    db=None (best-effort call sites) => empty set => no exclusion applied.
    """
    if db is None:
        return set()
    own_products = set(getattr(user, "assigned_product_ids", None) or [])
    rows = (
        db.query(User.assigned_product_ids)
        .filter(
            User.id != user.id,
            User.is_active == True,
            User.role.in_(["CONFIRMATEUR", "AGENT", "AGENT_MANAGER"]),
        )
        .all()
    )
    claimed: set = set()
    for (pids,) in rows:
        if isinstance(pids, list):
            claimed.update(pids)
    return claimed - own_products


def _legacy_products_claimed_by_others_criterion(user: User, db: Optional[Session]):
    """SQLAlchemy criterion twin of _legacy_products_claimed_by_others — True when this order contains one of those products."""
    from sqlalchemy import false as _false
    from app.models.order import OrderItem

    claimed = _legacy_products_claimed_by_others(user, db)
    if not claimed:
        return _false()
    return Order.items.any(OrderItem.product_id.in_(list(claimed)))


def _order_claimed_by_other_confirmatrice_criterion(user: User, db: Optional[Session]):
    """
    Union of BOTH product-ownership signals in this codebase: the formal
    assignment_rules PRODUCT/STORE row (_assignment_rule_claimed_by_other_criterion)
    and the informal per-employee assigned_product_ids list
    (_legacy_products_claimed_by_others_criterion). True when EITHER
    resolves this order to a confirmatrice other than `user`.
    """
    from sqlalchemy import or_
    return or_(
        _assignment_rule_claimed_by_other_criterion(user.id),
        _legacy_products_claimed_by_others_criterion(user, db),
    )


def _product_rule_owner_subquery():
    """
    Correlated scalar subquery: the deterministic PRODUCT-level Assignment
    Rule owner for Order.id, or NULL if no item has an active PRODUCT rule.
    Mirrors resolve_assignment_rule's tie-break EXACTLY (app/services/
    order_service.py — same ORDER BY target_id ASC LIMIT 1): when two items
    in the same order are claimed by different agents, the product with the
    lexicographically smallest product_id wins, deterministically. Keeping
    the single-order Python resolver and this bulk-query SQL version in
    lockstep is what guarantees list_orders/get_agent_counts and
    _assert_order_access never disagree about who owns a given order.
    """
    from sqlalchemy import select
    from app.models.assignment_rule import AssignmentRule
    from app.models.order import OrderItem

    return (
        select(AssignmentRule.agent_id)
        .where(
            AssignmentRule.rule_type == "PRODUCT",
            AssignmentRule.is_exclusion == False,
            AssignmentRule.is_active == True,
            AssignmentRule.target_id.in_(
                select(OrderItem.product_id)
                .where(OrderItem.order_id == Order.id, OrderItem.product_id.isnot(None))
            ),
        )
        .order_by(AssignmentRule.target_id.asc())
        .limit(1)
        .correlate(Order)
        .scalar_subquery()
    )


def _store_rule_owner_subquery():
    """
    Correlated scalar subquery: the active STORE-level Assignment Rule agent
    for Order.store_id, or NULL. At most one active non-exclusion STORE rule
    can exist per store (DB partial-unique-index constraint — see
    AssignmentRule docstring), so no tie-break is needed at this level.
    """
    from sqlalchemy import select
    from app.models.assignment_rule import AssignmentRule

    return (
        select(AssignmentRule.agent_id)
        .where(
            AssignmentRule.rule_type == "STORE",
            AssignmentRule.target_id == Order.store_id,
            AssignmentRule.is_exclusion == False,
            AssignmentRule.is_active == True,
        )
        .limit(1)
        .correlate(Order)
        .scalar_subquery()
    )


def _product_exclusion_for_agent_criterion(agent_id: str):
    """
    True when `agent_id` has an active PRODUCT-level exclusion rule on one
    of this order's items — blocks her STORE-level ownership for THIS
    order specifically (e.g. she owns the whole store except this one
    product), same semantics as resolve_assignment_rule's exclusion check.
    """
    from sqlalchemy import exists, select
    from app.models.assignment_rule import AssignmentRule
    from app.models.order import OrderItem

    return exists(select(1).where(
        OrderItem.order_id == Order.id,
        AssignmentRule.rule_type == "PRODUCT",
        AssignmentRule.target_id == OrderItem.product_id,
        AssignmentRule.agent_id == agent_id,
        AssignmentRule.is_exclusion == True,
        AssignmentRule.is_active == True,
    ))


def _assignment_rule_owner_exists_criterion():
    """True when ANY active PRODUCT or STORE Assignment Rule resolves an owner for this order at all (regardless of who)."""
    from sqlalchemy import or_
    return or_(_product_rule_owner_subquery().isnot(None), _store_rule_owner_subquery().isnot(None))


def _assignment_rule_resolved_owner_criterion(agent_id: str):
    """
    SQLAlchemy criterion: True when the Assignment Rule Engine's
    deterministic resolution (PRODUCT > STORE priority, same tie-break and
    exclusion semantics as resolve_assignment_rule in order_service.py)
    currently names `agent_id` as this order's owner — regardless of what
    Order.assigned_to happens to be stamped with (rules can be created or
    changed AFTER the order already exists, or after auto-assign already
    ran under an older rule set, so assigned_to is only ever a snapshot).
    CATEGORY/BRAND levels aren't replicated here (lower priority, and
    already applied correctly at auto-assign time — same acknowledged,
    pre-existing gap as this function's predecessor
    _assignment_rule_claimed_by_other_criterion: defense-in-depth for the
    two levels that actually matter for query-time visibility).
    """
    from sqlalchemy import and_, or_

    product_owner = _product_rule_owner_subquery()
    store_owner = _store_rule_owner_subquery()
    return or_(
        product_owner == agent_id,
        and_(
            product_owner.is_(None),
            store_owner == agent_id,
            ~_product_exclusion_for_agent_criterion(agent_id),
        ),
    )


def _assignment_rule_claimed_by_other_criterion(user_id: str):
    """
    SQLAlchemy criterion: True when the Assignment Rule Engine resolves an
    owner for this order (see _assignment_rule_resolved_owner_criterion)
    and it is NOT `user_id`. Used to EXCLUDE such orders from a
    confirmatrice's broad legacy scope (assigned_store_ids/
    assigned_product_ids) AND from her "assigned to me" queue — without
    this, an order whose Order.assigned_to still names her from before a
    PRODUCT/STORE rule was configured (or from the old pool logic) stayed
    visible to her forever, even after an admin explicitly handed that
    product/store to someone else. Mirrors the livreur territory-
    exclusivity fix (_region_owned_by_any_livreur_criterion) — same class
    of bug: an explicit rule must always beat a broad fallback or a stale
    snapshot.
    """
    from sqlalchemy import and_, not_
    return and_(
        _assignment_rule_owner_exists_criterion(),
        not_(_assignment_rule_resolved_owner_criterion(user_id)),
    )


def _confirmateur_scope_criterion(user: User, db: Optional[Session] = None):
    """
    SQLAlchemy criterion version of the store/product scope, for list/count queries.
    If assigned_store_scope is 'ALL' or empty, allows visibility across stores.
    """
    from sqlalchemy import or_, and_, true
    from app.models.order import OrderItem

    scope = getattr(user, "assigned_store_scope", "ALL")
    raw_products = getattr(user, "assigned_product_ids", None)
    products = raw_products if isinstance(raw_products, list) else []
    stores = _confirmateur_resolved_stores(user)

    crits = []
    if stores:
        crits.append(Order.store_id.in_(stores))
    if products:
        crits.append(Order.items.any(OrderItem.product_id.in_(products)))

    if not crits:
        if scope == "ALL" or not scope:
            broad_match = true()
        else:
            return False  # nothing configured and scope is SPECIFIC → no unassigned visibility
    else:
        broad_match = or_(*crits) if len(crits) > 1 else crits[0]
        if scope == "ALL" or not scope:
            broad_match = true()

    return and_(broad_match, ~_order_claimed_by_other_confirmatrice_criterion(user, db))


def _confirmateur_ownership_criterion(user: User, legacy_criterion, db: Optional[Session] = None):
    """
    Single source of truth combining rule-based ownership with a caller-
    supplied legacy/fallback criterion (her "queue" vs. the store-wide
    view — see list_orders/get_agent_counts, which differ only in what
    counts as fallback).

    Priority (highest wins):
      0. Order.assignment_locked is True (an admin/manager explicitly
         pinned this specific order to an agent) → visible ONLY to that
         agent, full stop — beats even a PRODUCT-level rule. See the
         column's docstring in app/models/order.py for the production bug
         this fixes: a deliberate one-off reassignment was silently undone
         by the rule engine on the very next access check.
      1. A PRODUCT-level Assignment Rule resolves HER as this order's
         owner → visible, regardless of Order.assigned_to or legacy scope.
         This is the hard, product-exact override — the original fix for
         "product assigned to A but B still sees the order".
      2. A PRODUCT-level rule resolves a DIFFERENT agent → always excluded,
         even if Order.assigned_to currently names her (mirrors #1 — a
         product-exact rule always wins over a stale/direct assignment).
      3. Otherwise (no PRODUCT-level rule matches this order either way):
         Order.assigned_to == her → always visible. A broader STORE/
         CATEGORY/BRAND-level rule for a DIFFERENT agent must NOT strip
         access to an order that is concretely, explicitly assigned to
         her — those levels are fallback defaults for UNASSIGNED orders,
         not an override of a direct assignment.
         BUG FIXED (2026-07-23, reported live): a confirmatrice with a
         PRODUCT rule got "Accès refusé" on her OWN assigned order
         because the store also had an unrelated STORE-level rule for a
         different agent — the old `no_rule_resolves` gate treated ANY
         rule existing anywhere in the store as disqualifying her direct
         assignment, not just a rule that actually concerns her order.
      4. Otherwise, fall back to the full 4-level rule resolution / the
         caller-supplied legacy_criterion, still excluding orders another
         confirmatrice individually claims (formal rule or legacy list).
    """
    from sqlalchemy import or_, and_, not_

    locked = Order.assignment_locked == True
    locked_to_her = and_(locked, Order.assigned_to == user.id)

    assigned_to_her = (Order.assigned_to == user.id)
    assigned_to_other = and_(Order.assigned_to.isnot(None), Order.assigned_to != user.id)
    is_unassigned = Order.assigned_to.is_(None)

    product_owner = _product_rule_owner_subquery()
    product_resolved_to_her = (product_owner == user.id)
    product_resolved_to_other = and_(product_owner.isnot(None), product_owner != user.id)

    resolved_to_her_full = _assignment_rule_resolved_owner_criterion(user.id)
    safe_legacy = and_(legacy_criterion, ~_order_claimed_by_other_confirmatrice_criterion(user, db))

    # Abandoned carts are store-wide recovery opportunities for all confirmatrices
    # assigned to that store (safe_legacy), unless locked or explicitly claimed
    # by a product rule for another agent.
    is_abandoned_cart_crit = or_(Order.is_abandoned_cart == True, Order.status == "ABANDONED")
    abandoned_visible = and_(is_abandoned_cart_crit, not_(product_resolved_to_other), safe_legacy)

    unlocked_visible = or_(
        assigned_to_her,
        abandoned_visible,
        and_(
            is_unassigned,
            or_(
                product_resolved_to_her,
                and_(not_(product_resolved_to_other), resolved_to_her_full),
                and_(not_(product_resolved_to_other), safe_legacy),
            )
        )
    )

    return or_(locked_to_her, and_(not_(locked), unlocked_visible))


def _confirmateur_scope_ok(order: Order, user: User, db: Optional[Session] = None) -> bool:
    """Python version of the same scope, for single-order access checks."""
    scope = getattr(user, "assigned_store_scope", "ALL")
    raw_products = getattr(user, "assigned_product_ids", None)
    products = raw_products if isinstance(raw_products, list) else []
    stores = _confirmateur_resolved_stores(user)

    if not stores and not products:
        if scope != "ALL" and scope:
            return False  # nothing configured and scope is SPECIFIC → no unassigned visibility

    store_ok = (scope == "ALL" or not scope) or (bool(stores) and order.store_id in stores)
    product_ok = bool(products) and any(item.product_id in products for item in (order.items or []))
    if not (store_ok or product_ok):
        return False

    # Same exclusion as the SQL criterion above — an explicit PRODUCT/STORE
    # rule (formal or legacy per-employee list) naming a DIFFERENT agent
    # always wins over her broad legacy scope.
    claimed_by = _order_rule_resolved_owner(order, user, db)
    if claimed_by and claimed_by != user.id:
        return False
    if db is not None:
        item_pids = {item.product_id for item in (order.items or []) if item.product_id}
        if item_pids & _legacy_products_claimed_by_others(user, db):
            return False
    return True


def _order_rule_resolved_owner(order: Order, user: User, db: Optional[Session] = None) -> Optional[str]:
    """
    Python/single-order equivalent of _assignment_rule_resolved_owner_criterion
    — delegates to resolve_assignment_rule (order_service.py), the ONE
    implementation of the PRODUCT > STORE > CATEGORY > BRAND priority +
    deterministic tie-break, so a single-order check never drifts from what
    a bulk list/count query decides. Returns None (never raises) if db is
    unavailable or resolution fails — callers treat that as "no rule
    applies", never as "wrongly excluded/included".
    """
    if db is None:
        return None
    from app.services.order_service import resolve_assignment_rule
    try:
        item_pids = [item.product_id for item in (order.items or []) if item.product_id]
        return resolve_assignment_rule(db, order.store_id, item_pids)
    except Exception:
        return None


def _order_product_level_owner(order: Order, db: Optional[Session] = None) -> Optional[str]:
    """
    PRODUCT-level-ONLY resolution (ignores STORE/CATEGORY/BRAND) — the
    hard-override signal that must beat even a direct Order.assigned_to.
    Python/single-order twin of _product_rule_owner_subquery, same
    deterministic tie-break (smallest target_id). Returns None if no
    PRODUCT rule matches any of this order's items — that is NOT the same
    as "unowned": the caller must then fall back to Order.assigned_to /
    the full 4-level resolution, never treat a lower-priority rule
    (STORE/CATEGORY/BRAND) for a different agent as grounds to override a
    direct assignment (see _confirmateur_ownership_criterion for the full
    rationale and the production bug this fixes).
    """
    if db is None:
        return None
    from app.models.assignment_rule import AssignmentRule
    item_pids = [item.product_id for item in (order.items or []) if item.product_id]
    if not item_pids:
        return None
    rule = (
        db.query(AssignmentRule)
        .filter(
            AssignmentRule.rule_type == "PRODUCT",
            AssignmentRule.target_id.in_(item_pids),
            AssignmentRule.is_exclusion == False,
            AssignmentRule.is_active == True,
        )
        .order_by(AssignmentRule.target_id.asc())
        .first()
    )
    return rule.agent_id if rule else None


def _region_owned_by_agent_criterion(agent_id: str):
    """
    SQLAlchemy criterion, query-side twin of _region_courier_owner: True
    when Order.customer_commune/wilaya resolves (COMMUNE > WILAYA priority)
    to this specific livreur. Used to INCLUDE those orders in his list —
    covers orders that predate the rule or a rule added after order
    creation, not just ones with Order.livreur_id already stamped.
    """
    from sqlalchemy import exists, select, and_, or_
    from app.models.assignment_rule import AssignmentRule

    def _rule_exists(rule_type, target_col, agent=None):
        conds = [
            AssignmentRule.rule_type == rule_type,
            AssignmentRule.target_id == target_col,
            AssignmentRule.is_exclusion == False,
            AssignmentRule.is_active == True,
        ]
        if agent is not None:
            conds.append(AssignmentRule.agent_id == agent)
        return exists(select(1).where(*conds))

    commune_owned_by_agent = _rule_exists("COMMUNE", Order.customer_commune, agent_id)
    commune_owned_by_anyone = _rule_exists("COMMUNE", Order.customer_commune)
    wilaya_owned_by_agent = _rule_exists("WILAYA", Order.customer_wilaya, agent_id)
    return or_(commune_owned_by_agent, and_(~commune_owned_by_anyone, wilaya_owned_by_agent))


def _region_owned_by_any_livreur_criterion():
    """
    SQLAlchemy criterion: True when Order.customer_commune/wilaya is ANY
    livreur's exclusive territory (regardless of which one). Used to
    EXCLUDE these orders from the confirmatrice's scope entirely — that
    territory belongs to whichever livreur the rule names, not her, even
    for orders that still have no Order.livreur_id stamped or that are in
    a status she'd normally see (abandoned cart, shipped, etc).
    """
    from sqlalchemy import exists, select, or_
    from app.models.assignment_rule import AssignmentRule

    def _rule_exists(rule_type, target_col):
        return exists(select(1).where(
            AssignmentRule.rule_type == rule_type,
            AssignmentRule.target_id == target_col,
            AssignmentRule.is_exclusion == False,
            AssignmentRule.is_active == True,
        ))
    return or_(_rule_exists("COMMUNE", Order.customer_commune), _rule_exists("WILAYA", Order.customer_wilaya))


def _region_courier_owner(db: Optional[Session], order: Order) -> Optional[str]:
    """
    Who "owns" this order's delivery region right now, per the Assignment
    Rule Engine (COMMUNE > WILAYA priority) — live-resolved, NOT just
    whatever Order.livreur_id was stamped with at creation time. A rule
    created AFTER the order already existed (or an order created before
    any rule existed) must still resolve correctly: territory ownership is
    a property of the region + the CURRENT rules, not a one-time snapshot.
    Returns the livreur's user id, or None if no rule covers this region.
    db may be None (best-effort call sites) — treated as "no rule applies".
    """
    if db is None:
        return None
    from app.services.order_service import resolve_courier_rule
    try:
        return resolve_courier_rule(db, order.customer_wilaya, order.customer_commune)
    except Exception:
        return None


def _assert_order_access(order: Order, current_user: User, db: Optional[Session] = None) -> None:
    """
    CONFIRMATEUR — priority (highest wins), mirrors
    _confirmateur_ownership_criterion (SQL) exactly so a single-order check
    and a list/count query never disagree:
      1. A PRODUCT-level Assignment Rule resolves HER as owner → always
         accessible, regardless of Order.assigned_to.
      2. A PRODUCT-level rule resolves a DIFFERENT agent → always denied,
         even if Order.assigned_to currently names her.
      3. Otherwise (no PRODUCT-level rule matches this order either way):
         Order.assigned_to == her → always accessible. A broader STORE/
         CATEGORY/BRAND-level rule for someone else must NOT override a
         direct, concrete assignment on a specific order.
         BUG FIXED (2026-07-23, reported live): a confirmatrice with a
         PRODUCT rule got "Accès refusé" on her OWN assigned order because
         the store also had an unrelated STORE-level rule for a different
         agent — the previous version treated ANY rule resolving anyone
         in the store as disqualifying her direct assignment.
      4. Order.assigned_to names a DIFFERENT confirmatrice (and no
         PRODUCT rule overrides it) → always denied, no matter what a
         broader STORE/CATEGORY/BRAND rule says. This is the mirror of
         #3 and what prevents the STORE-rule owner from ALSO seeing an
         order that's concretely assigned to someone else — a STORE rule
         is a fallback default for UNASSIGNED orders, not a second,
         overlapping claim on top of an existing direct assignment
         (avoids reintroducing duplicate visibility).
      5. Order is unassigned → fall back to the full 4-level rule
         resolution, or (if no rule resolves at all) her legacy
         responsibility scope (_confirmateur_scope_ok).
    EXCEPT an order whose delivery region is a livreur's exclusive territory
    (see _region_courier_owner): that territory is his alone, whether or not
    Order.livreur_id was ever stamped on this particular order.
    MANAGER can only access orders in their store.
    ADMIN/SUPER_ADMIN: full access.
    LIVREUR: orders explicitly handed to them (Order.livreur_id), OR any
    order whose delivery region currently resolves to them via a COMMUNE/
    WILAYA rule — covers orders that predate the rule, or a rule added
    after the order existed, not just ones stamped at creation time.
    """
    if current_user.role == "CONFIRMATEUR":
        if getattr(order, "assignment_locked", False):
            # An admin/manager explicitly pinned this specific order to an
            # agent (Order.assignment_locked) — that decision is final and
            # beats even a PRODUCT-level rule naming someone else. See the
            # column's docstring in app/models/order.py for the production
            # bug this fixes: a deliberate one-off reassignment was
            # silently undone by the rule engine on the very next access
            # check.
            is_accessible = order.assigned_to == current_user.id
        else:
            if order.assigned_to is not None:
                is_accessible = (order.assigned_to == current_user.id)
            else:
                product_owner = _order_product_level_owner(order, db)
                if product_owner is not None:
                    is_accessible = (product_owner == current_user.id)
                else:
                    rule_owner = _order_rule_resolved_owner(order, current_user, db)
                    if rule_owner is not None:
                        is_accessible = (rule_owner == current_user.id)
                    else:
                        is_accessible = _confirmateur_scope_ok(order, current_user, db)

        if not is_accessible:
            raise PermissionError(message="Accès refusé à cette commande.")
        if _region_courier_owner(db, order):
            raise PermissionError(message="Accès refusé : cette commande appartient à la zone exclusive d'un livreur.")
    elif current_user.role == "MANAGER":
        if current_user.employee_store_id and order.store_id != current_user.employee_store_id:
            raise PermissionError(message="Accès refusé : commande hors de votre boutique.")
    elif current_user.role == "LIVREUR":
        # A delivery agent sees orders explicitly handed to them, OR any
        # order whose region currently resolves to them via a rule.
        if order.livreur_id != current_user.id and _region_courier_owner(db, order) != current_user.id:
            raise PermissionError(message="Accès refusé : cette livraison ne vous est pas assignée.")


def _capi_reference_time(db: Session, order: Order):
    """
    Moment où l'envoi Purchase AURAIT DÛ se déclencher pour cette commande —
    la base de comparaison pour classifier temps réel vs backfill (voir
    classify_capi_log_timing dans meta_capi.py). Pour une commande jamais
    passée par ABANDONED, c'est sa création. Pour un panier abandonné
    récupéré par téléphone, c'est la transition ABANDONED -> vente réelle
    (le déclencheur réel dans update_order), pas la création — sinon un
    panier resté 3 semaines en ABANDONED avant confirmation serait
    faussement classé "backfill".
    """
    abandoned_transition = (
        db.query(OrderEvent.created_at)
        .filter(OrderEvent.order_id == order.id, OrderEvent.from_status == "ABANDONED")
        .order_by(OrderEvent.created_at.asc())
        .first()
    )
    if abandoned_transition and abandoned_transition[0]:
        return abandoned_transition[0]
    return order.created_at


def _sync_item_images_from_product(db: Session, orders) -> None:
    """
    Order items store image_url as a one-time snapshot taken when the item
    was added (see OrderItem model comment). Left as-is, replacing a
    product's photo in the admin never reflects on ANY existing order —
    every dashboard (admin, confirmatrice, livreur) keeps showing the old or
    dead photo forever, which looks like a broken-sync bug even after the
    photo is fixed. Overriding with the live product.main_image at read time
    (in-memory only, never committed) makes every photo update visible
    everywhere immediately, while still falling back to the snapshot for
    items whose product was deleted.

    Was: accessing item.product per item — that relationship is never
    eager-loaded on this query (see the joinedload comment on final_query
    above: the full Product row was deliberately dropped from the eager
    load as wasted transfer), so every access lazy-loaded ONE extra SQL
    query per item. Confirmed in prod: GET /orders (pageSize=50) issued 58
    queries totalling 4456ms — 55 more than the 3 the endpoint actually
    needs — and this loop was the source. Batched into a single query for
    just the (id, main_image) columns actually used here.
    """
    product_ids = {
        item.product_id
        for order in orders
        for item in (order.items or [])
        if item.product_id
    }
    if not product_ids:
        return
    from app.models.product import Product
    images_by_product = dict(
        db.query(Product.id, Product.main_image).filter(Product.id.in_(product_ids)).all()
    )
    for order in orders:
        for item in (order.items or []):
            main_image = images_by_product.get(item.product_id)
            if main_image:
                item.image_url = main_image


@router.get("/check-duplicate")
def check_duplicate(
    request: Request,
    phone: Optional[str] = Query(None),
    customer_phone: Optional[str] = Query(None),
    store_id: Optional[str] = Query(None),
    limit: int = Query(1, ge=1, le=10),
    db: Session = Depends(deps.get_db),
    current_user: Optional[User] = Depends(deps.get_current_user_optional),
):
    """
    Vérifie si un numéro de téléphone a déjà passé une commande dans les 14 derniers jours.
    Supporte à la fois l'administration (phone) et le storefront public (customer_phone).
    Les clients non-authentifiés reçoivent uniquement un booléen indicatif pour préserver la vie privée (RGPD).
    """
    # ── Rate limiting strict ──────────────────────────────────
    client_ip = (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-Ip", "")
        or "127.0.0.1"
    )
    rate = check_rate_limit(key=f"rl:check-dup:{client_ip}", limit=10, window_seconds=60)
    if not rate.allowed:
        raise HTTPException(
            status_code=429,
            detail="Trop de demandes de vérification. Réessayez dans une minute.",
        )

    phone_number = phone or customer_phone
    if not phone_number:
        raise HTTPException(status_code=400, detail="Téléphone requis pour la vérification.")
        
    from datetime import datetime, timezone, timedelta
    fourteen_days_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=14)
    
    query = db.query(Order).filter(
        Order.customer_phone == phone_number,
        Order.created_at >= fourteen_days_ago,
        Order.is_deleted == False
    )
    if store_id:
        query = query.filter(Order.store_id == store_id)
        
    orders = query.order_by(Order.created_at.desc()).limit(limit).all()
    duplicate = orders[0] if orders else None
    
    # Restrict response data for unauthenticated users (guests)
    if not current_user:
        return {
            "success": True,
            "is_duplicate": duplicate is not None,
            "order_number": None,
            "data": [],
            "total": 1 if duplicate else 0
        }

    return {
        "success": True,
        "is_duplicate": duplicate is not None,
        "order_number": duplicate.order_number if duplicate else None,
        "data": orders,
        "total": len(orders)
    }


@router.get("/vigilance")
def check_vigilance(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
    store_id: Optional[str] = None,
):
    """
    Get orders that haven't been updated for 2 hours.
    Used for the "SLA Vigilance" monitoring.
    """
    from datetime import datetime, timedelta, timezone
    two_hours_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)
    
    query = db.query(Order).filter(
        Order.is_deleted == False,
        Order.status.in_(["NEW", "PENDING", "CALLED"]), # These statuses need confirmation
        Order.updated_at <= two_hours_ago
    )
    
    # Role-based scoping
    if current_user.role == "CONFIRMATEUR":
        query = query.filter(Order.assigned_to == current_user.id)
    elif current_user.role == "MANAGER" and current_user.employee_store_id:
        query = query.filter(Order.store_id == current_user.employee_store_id)
        
    if store_id:
        query = query.filter(Order.store_id == store_id)
        
    vulnerable_orders = query.all()
    
    return {
        "success": True,
        "count": len(vulnerable_orders),
        "data": [
            {
                "id": o.id,
                "order_number": o.order_number,
                "customer_name": o.customer_name,
                "created_at": o.created_at.isoformat(),
                "status": o.status
            }
            for o in vulnerable_orders
        ]
    }


# ─── Public guest duplicate-order check (merged into main check_duplicate above) ───


# ─── GET /orders/counts — Per-status counts for tab badges ───────────────────

@router.get("/counts")
def get_order_counts(
    store_id: str = Query(...),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(deps.get_db),
    _: User = Depends(deps.get_current_active_user),
):
    """
    Returns order counts per status for the tab badge display.

    Honors the same start_date/end_date the list itself is filtered by —
    without this, picking "aujourd'hui" filtered the LIST to today but the
    tab badges kept showing all-time totals, so the admin saw e.g. a badge
    "NEW 14" above a list of 3 orders: yesterday's orders appeared "mixed
    into" today's view. MERGED excluded for the same reason it's excluded
    everywhere else (a duplicate absorbed into its parent isn't an order).
    """
    q = (
        db.query(Order.status, sqlfunc.count(Order.id).label("cnt"))
        .filter(Order.store_id == store_id, Order.is_deleted == False, Order.status != "MERGED")
    )
    if start_date:
        from app.core.dates import parse_local_date_filter
        try:
            q = q.filter(Order.created_at >= parse_local_date_filter(start_date))
        except ValueError:
            pass
    if end_date:
        from app.core.dates import parse_local_date_filter
        try:
            q = q.filter(Order.created_at <= parse_local_date_filter(end_date))
        except ValueError:
            pass
    rows = q.group_by(Order.status).all()
    counts = {r.status: r.cnt for r in rows}

    # "Reçues" — how many orders came into the ERP in this period, period.
    # Counts EVERY order regardless of whether an agent has since acted on
    # it (assigned, called, confirmed...) — the receipt date never changes,
    # only the status does. One shared date-filtered base query, one
    # conditional-aggregation SELECT (was up to 6 separate round trips).
    def _dated(q):
        if start_date:
            from app.core.dates import parse_local_date_filter
            try:
                q = q.filter(Order.created_at >= parse_local_date_filter(start_date))
            except ValueError:
                pass
        if end_date:
            from app.core.dates import parse_local_date_filter
            try:
                q = q.filter(Order.created_at <= parse_local_date_filter(end_date))
            except ValueError:
                pass
        return q

    from sqlalchemy import and_ as _and_r, or_ as _or_r, case as _case_r

    def _sum_r(*criteria):
        return sqlfunc.sum(_case_r((_and_r(*criteria), 1), else_=0))

    recovered_crit = _and_r(
        Order.is_abandoned_cart == True,
        Order.is_upsell == False,
        _or_r(Order.recovered_at.isnot(None), Order.status.in_(["CONFIRMED", "SHIPPED", "DELIVERED"])),
    )
    abandoned_active_crit = _and_r(
        Order.is_abandoned_cart == True,
        Order.recovered_at.is_(None),
        Order.status.notin_(["CONFIRMED", "SHIPPED", "DELIVERED"]),
    )
    # "Commande normale" excludes manual entry, upsell and abandoned-cart
    # origin — a distinct category of its own each, not a subset of
    # "normal" (the admin's own explicit request: these must never overlap).
    normal_crit = _and_r(
        Order.is_abandoned_cart == False,
        sqlfunc.coalesce(Order.source, "") != "MANUAL",
        Order.is_upsell == False,
    )

    received_row = _dated(
        db.query(Order).filter(Order.store_id == store_id, Order.is_deleted == False, Order.status != "MERGED")
    ).with_entities(
        _sum_r(normal_crit).label("normal"),
        _sum_r(abandoned_active_crit).label("abandoned"),
        _sum_r(recovered_crit).label("recovered"),
        _sum_r(sqlfunc.coalesce(Order.source, "") == "MANUAL", Order.is_upsell == False).label("manual"),
        _sum_r(Order.is_upsell == True).label("upsell"),
        _sum_r(Order.status == "CANCELLED").label("cancelled"),
    ).one()

    # "Doublons reçus" — how many ORDERS (not raw resubmit rows) had at
    # least one duplicate merged into them in this period. Counts DISTINCT
    # parent_order_id, not count(*) on MERGED rows: one order that absorbed
    # 3 resubmits is "1 order with a duplicate problem", not 3.
    from sqlalchemy import distinct as _distinct
    received_duplicate = _dated(
        db.query(sqlfunc.count(_distinct(Order.parent_order_id))).filter(
            Order.store_id == store_id,
            Order.is_deleted == False,
            Order.status == "MERGED",
            Order.parent_order_id.isnot(None),
        )
    ).scalar() or 0

    counts["_received"] = {
        "normal": received_row.normal or 0,
        "abandoned": received_row.abandoned or 0,
        "recovered": received_row.recovered or 0,
        "duplicate": received_duplicate,
        "manual": received_row.manual or 0,
        "upsell": received_row.upsell or 0,
        "cancelled": received_row.cancelled or 0,
    }
    return counts


# ─── GET /orders/agent-counts — Sidebar module counts for confirmatrices ─────

@router.get("/agent-counts")
def get_agent_counts(
    store_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Counts per agent-dashboard sub-module (new, pending, confirmed, delivered,
    cancelled, nrp, abandoned_in_progress, recovered, archived, shipped),
    scoped exactly like the agent's order list.
    """
    from sqlalchemy import and_, or_
    from datetime import datetime, timezone

    # Same reasoning as list_orders: this endpoint scopes itself explicitly
    # below (CONFIRMATEUR union scope, MANAGER's employee_store_id) including
    # the store_id query param — the global header-driven tenant auto-filter
    # is redundant and, on a mismatch, silently ANDs two different store_ids
    # together and returns zero results. get_db() hands out a fresh Session
    # per request, so this never leaks across requests.
    db.info["skip_tenant_isolation"] = True

    base_query = db.query(Order).filter(Order.is_deleted == False, Order.status != "MERGED")

    # Same RBAC scoping as list_orders for confirmatrices (union store/product
    # scope). Two variants: `base` (her personal queue — assigned to her, or
    # unassigned within her scope) for conversion-stage counts, and
    # `base_wide` (her full store/product scope, regardless of who confirmed
    # it) for logistics-stage counts. Once an order ships, tracking it is a
    # store-wide concern — see the matching comment in list_orders. Using the
    # narrow `base` for shipped/delivered/returned/cancelled/carrier_*/archived
    # meant a colleague-confirmed order was invisible in those badges on any
    # store with more than one confirmatrice; a single-confirmatrice store
    # never showed the gap since everything happened to be assigned_to her.
    if current_user.role == "CONFIRMATEUR":
        scope_crit = _confirmateur_scope_criterion(current_user, db)
        legacy_queue = or_(
            Order.assigned_to == current_user.id,
            and_(Order.assigned_to == None, scope_crit),
        )
        # Rule-based ownership (formal PRODUCT/STORE Assignment Rules, or the
        # informal per-employee assigned_product_ids list) always wins over
        # the legacy assigned_to/scope fallback — see
        # _confirmateur_ownership_criterion. Without this, a product handed
        # to a different confirmatrice still counted in this confirmatrice's
        # badges as long as Order.assigned_to (a one-time snapshot) still
        # happened to name her.
        base = base_query.filter(_confirmateur_ownership_criterion(current_user, legacy_queue, db))
        base_wide = base_query.filter(_confirmateur_ownership_criterion(current_user, scope_crit, db))
    elif current_user.role == "MANAGER" and current_user.employee_store_id:
        base = base_query.filter(Order.store_id == current_user.employee_store_id)
        base_wide = base
    elif current_user.role == "LIVREUR":
        # Was completely unscoped before this fix (fell through to the
        # `else` branch below) — a livreur's sidebar badges showed the
        # ENTIRE store's Logistique numbers (every confirmatrice's shipped/
        # delivered/returned totals), not just the orders in his own
        # assigned territory. Same region+livreur_id match as list_orders,
        # and the same carrier-tracked exclusion (once a parcel has a real
        # tracking number it's the transporteur's job, not his).
        from sqlalchemy import select as _select_evt
        _acted_ids = _select_evt(OrderEvent.order_id).where(OrderEvent.actor_id == current_user.id)
        _livreur_scope = or_(
            Order.livreur_id == current_user.id,
            Order.assigned_to == current_user.id,
            _region_owned_by_agent_criterion(current_user.id),
            Order.id.in_(_acted_ids)
        )
        _livreur_no_carrier = or_(Order.tracking_number.is_(None), Order.tracking_number == "")
        base = base_query.filter(_livreur_scope, _livreur_no_carrier)
        base_wide = base
    else:
        base = base_query
        base_wide = base_query

    if store_id and isinstance(store_id, str):
        base = base.filter(Order.store_id == store_id)
        base_wide = base_wide.filter(Order.store_id == store_id)
    for bound, op_gte in ((start_date, True), (end_date, False)):
        if bound and isinstance(bound, str):
            try:
                dt = datetime.fromisoformat(bound.replace("Z", "+00:00")).replace(tzinfo=None)
                base = base.filter(Order.created_at >= dt if op_gte else Order.created_at <= dt)
                base_wide = base_wide.filter(Order.created_at >= dt if op_gte else Order.created_at <= dt)
            except ValueError:
                pass

    # Was 23-24 separate .count() round trips (one per badge — base and
    # base_wide filtered ~10 and ~13 times respectively). Confirmed in prod:
    # GET /orders/agent-counts took ~2000ms, 1759ms (24 queries) of it SQL —
    # at the Supabase pooler's ~70-100ms/round-trip, this endpoint's cost
    # WAS the round-trip count, not any single query's complexity. Collapsed
    # into 2 conditional-aggregation queries (one per base query, since
    # `base` and `base_wide` differ in their own WHERE scoping for
    # CONFIRMATEUR — they can't share a single SELECT).
    #
    # Beyond the query count itself: this endpoint is polled repeatedly by
    # every open dashboard tab (sidebar badges refresh on an interval), so
    # the SAME aggregate gets recomputed dozens of times a minute across
    # concurrent users on the same store. On the free tier we can't add
    # capacity, so instead: cache the result. 8s is short enough that a
    # confirmatrice never perceives stale badge counts, long enough to
    # collapse a burst of near-simultaneous polls (multiple tabs, multiple
    # dashboard widgets on one page load) into a single DB round trip.
    from sqlalchemy import case as _case
    from app.core.cache import get_or_set as _cache_get_or_set

    _cache_key = (
        f"agent_counts:{current_user.id}:{current_user.role}:"
        f"{store_id or '-'}:{start_date or '-'}:{end_date or '-'}"
    )

    def _compute_counts() -> dict:
        # Mirror of list_orders' exclusion: an order handed to an internal
        # delivery agent counts ONLY in internal_delivery, never in the
        # confirmation-stage badges — else the sidebar numbers disagree with
        # what each module actually lists.
        _not_internal = or_(
            Order.livreur_id.is_(None),
            and_(Order.tracking_number.isnot(None), Order.tracking_number != ""),
        )
        _now = datetime.now(timezone.utc).replace(tzinfo=None)

        def _sum(*criteria):
            return sqlfunc.sum(_case((and_(*criteria), 1), else_=0))

        # "Nouvelles Commandes" et "En attente" représentent le flux NORMAL
        # (landing page, Meta Ads, storefront...) que la confirmatrice traite —
        # une commande saisie manuellement (source == 'MANUAL') a déjà sa
        # propre case "Commandes Manuelles" (wide_row, ci-dessous) ; sans cette
        # exclusion elle comptait dans les DEUX badges à la fois.
        _not_manual = sqlfunc.coalesce(Order.source, "") != "MANUAL"
        # Upsell is its own distinct badge (see "upsell" in wide_row below) —
        # an order flagged is_upsell must never ALSO inflate "Nouvelles"/"En
        # attente"/"Paniers Récupérés", the same way _not_manual already
        # keeps a manually-entered order out of those two.
        _not_upsell = Order.is_upsell == False

        base_row = base.with_entities(
            _sum(Order.status.notin_(["CANCELLED", "RETURNED"])).label("all"),
            _sum(_not_internal, _not_manual, _not_upsell, Order.status.in_(["NEW", "ASSIGNED"])).label("new"),
            _sum(
                _not_internal, _not_manual, _not_upsell,
                Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"]),
                or_(Order.nrp_count == None, Order.nrp_count == 0),
            ).label("pending"),
            _sum(_not_internal, Order.status == "CONFIRMED").label("confirmed"),
            _sum(_not_internal, Order.nrp_count > 0, Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"])).label("nrp"),
            _sum(_not_internal, Order.nrp_count > 0, Order.is_abandoned_cart == True,
                 Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"])).label("nrp_abandoned"),
            _sum(_not_internal, Order.nrp_count > 0, Order.is_abandoned_cart == False,
                 Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"])).label("nrp_normal"),
            _sum(_not_internal, or_(Order.is_abandoned_cart == True, Order.status == "ABANDONED"),
                 Order.status.notin_(["CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"])).label("abandoned_in_progress"),
            _sum(_not_upsell, Order.is_abandoned_cart == True, Order.status.in_(["CONFIRMED", "SHIPPED", "DELIVERED"])).label("recovered"),
            # Rappels dus maintenant : NRP en cours (commande ou panier abandonné)
            # sans heure de rappel programmée, ou dont l'heure est déjà passée.
            _sum(
                _not_internal,
                Order.nrp_count > 0,
                Order.status.in_(["IN_PROGRESS", "CALLED", "RESCHEDULED", "ASSIGNED", "ABANDONED"]),
                or_(Order.next_callback_time == None, Order.next_callback_time <= _now),
            ).label("recall"),
        ).one()

        wide_row = base_wide.with_entities(
            _sum(Order.status == "SHIPPED").label("shipped"),
            _sum(Order.status == "DELIVERED").label("delivered"),
            # The sidebar's "Retournées" badge (agent-dashboard.tsx) looks up
            # counts['returned'] — this key never existed, so that lookup was
            # always undefined ?? 0, and the badge's `count > 0` render guard
            # was permanently false. The badge wasn't wrong, it was invisible.
            _sum(Order.status == "RETURNED").label("returned"),
            _sum(Order.status == "CANCELLED").label("cancelled"),
            _sum(
                Order.livreur_id.isnot(None),
                or_(Order.tracking_number == None, Order.tracking_number == ""),
                Order.status.notin_(["DELIVERED", "RETURNED", "MERGED"]),
            ).label("internal_delivery"),
            _sum(Order.status.in_(["CANCELLED", "RETURNED"])).label("archived"),
            # "Commandes Manuelles" sidebar badge — store-wide like shipped/
            # delivered/returned above, not scoped to the confirmatrice's own
            # `base`: a manually-entered order can be created by any agent/admin,
            # and whoever's checking this count should see the store's total,
            # not just their own.
            _sum(sqlfunc.coalesce(Order.source, "") == "MANUAL", Order.is_upsell == False).label("manual"),
            _sum(Order.is_upsell == True).label("upsell"),
            # Noest's own real-time carrier stage (see CARRIER_STAGE_BUCKETS) —
            # scoped to SHIPPED since that's the only state a carrier_stage is
            # meaningful for (before dispatch there's nothing to poll; after
            # DELIVERED/RETURNED our own status already says so).
            *[
                _sum(Order.status == "SHIPPED", Order.carrier_stage.in_(keys)).label(f"carrier_{bucket}")
                for bucket, keys in CARRIER_STAGE_BUCKETS.items()
            ],
        ).one()

        counts = {k: (v or 0) for k, v in base_row._mapping.items()}
        counts.update({k: (v or 0) for k, v in wide_row._mapping.items()})
        return counts

    counts = _cache_get_or_set(_cache_key, _compute_counts, l1_ttl=8, l2_ttl=20)
    return {"success": True, "counts": counts}


# ─── GET /orders/duplicate-stats — duplicate management KPIs ─────────────────

@router.get("/duplicate-stats")
def get_duplicate_stats(
    store_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Duplicate-management KPIs:
    total orders, duplicate groups, child orders, duplicate rate,
    recovered duplicates, merged basket value, shipments prevented and the
    commission that would have been paid twice without the merge.

    start_date/end_date scope every count to the SAME period as the rest of
    the dashboard — without this, "Doublons" showed a lifetime, store-wide
    total (e.g. 22) next to type-filter pills scoped to "today" (e.g. a
    total of 20 orders), an impossible-looking mismatch that was really just
    two different time windows silently compared side by side.
    """
    from sqlalchemy import func, distinct
    from datetime import datetime as _dt

    base_filters = [Order.is_deleted == False]
    if store_id:
        base_filters.append(Order.store_id == store_id)
    if start_date:
        base_filters.append(Order.created_at >= _dt.fromisoformat(start_date.replace("Z", "+00:00")).replace(tzinfo=None))
    if end_date:
        base_filters.append(Order.created_at <= _dt.fromisoformat(end_date.replace("Z", "+00:00")).replace(tzinfo=None))

    total_orders = db.query(func.count(Order.id)).filter(*base_filters).scalar() or 0
    child_orders = db.query(func.count(Order.id)).filter(
        *base_filters, Order.status == "MERGED").scalar() or 0
    duplicate_groups = db.query(func.count(distinct(Order.parent_order_id))).filter(
        *base_filters, Order.status == "MERGED", Order.parent_order_id.isnot(None)).scalar() or 0
    recovered_duplicates = db.query(func.count(Order.id)).filter(
        *base_filters, Order.status == "MERGED", Order.is_abandoned_cart == True).scalar() or 0

    # Value of the merged baskets (parents that absorbed at least one child)
    parent_ids = [r[0] for r in db.query(distinct(Order.parent_order_id)).filter(
        *base_filters, Order.status == "MERGED", Order.parent_order_id.isnot(None)).all() if r[0]]
    merged_basket_value = 0
    avg_dups_per_customer = 0.0
    if parent_ids:
        merged_basket_value = db.query(func.coalesce(func.sum(Order.total), 0)).filter(
            Order.id.in_(parent_ids)).scalar() or 0
        avg_dups_per_customer = round(child_orders / len(parent_ids), 2)

    # Each merged child is one shipment (and one commission) that was NOT
    # produced twice. Commission estimated at the platform fallback rate.
    from app.services.salary_service import FALLBACK_RATE_PER_ORDER
    return {
        "success": True,
        "data": {
            "total_orders": total_orders,
            "duplicate_groups": duplicate_groups,
            "child_orders": child_orders,
            "duplicate_rate": round(child_orders / total_orders * 100, 1) if total_orders else 0,
            "avg_duplicates_per_customer": avg_dups_per_customer,
            "recovered_duplicate_orders": recovered_duplicates,
            "merged_basket_value": merged_basket_value,
            "shipments_prevented": child_orders,
            "commission_saved_estimate": child_orders * FALLBACK_RATE_PER_ORDER,
        },
    }


# ─── GET /orders/track — public storefront order tracking ────────────────────

@router.get("/track")
def track_order(
    request: Request,
    order_number: str = Query(..., min_length=5),
    store_id: str = Query(...),
    db: Session = Depends(deps.get_db),
):
    """
    Public endpoint — no auth required.
    Returns safe order info (status + timeline) for the storefront tracking page.
    Rate-limited to prevent order number enumeration.
    """
    client_ip = request.client.host if request.client else "unknown"
    result = check_rate_limit(key=f"track:{client_ip}", limit=20, window_seconds=60)
    if not result.allowed:
        raise HTTPException(status_code=429, detail="Trop de requêtes. Réessayez dans une minute.")

    order = (
        db.query(Order)
        .options(joinedload(Order.items))
        .filter(
            Order.order_number == order_number.strip().upper(),
            Order.store_id == store_id,
            Order.is_deleted == False,
        )
        .first()
    )
    if not order:
        return {"success": False, "message": "Commande introuvable. Vérifiez le numéro et réessayez."}

    return {
        "success": True,
        "data": {
            "id": order.id,
            "order_number": order.order_number,
            "status": order.status,
            "delivery_type": order.delivery_type,
            # Customer info — what they entered at checkout
            "customer_name": order.customer_name,
            "customer_phone": order.customer_phone,
            "customer_wilaya": order.customer_wilaya,
            "customer_address": order.customer_address,
            "customer_commune": getattr(order, "customer_commune", None),
            # Financials
            "total": order.total,
            "delivery_fee": order.delivery_fee,
            # Carrier tracking
            "tracking_number": order.tracking_number,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "updated_at": order.updated_at.isoformat() if order.updated_at else None,
            "items": [
                {
                    "product_name": item.product_name,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "image": getattr(item, "image", None),
                }
                for item in (order.items or [])
            ],
        },
    }


# ─── GET /orders/ ─────────────────────────────────────────────────────────────

@router.get("/", response_model=OrderList)
def list_orders(
    db: Session = Depends(deps.get_db),
    current_user: Optional[User] = Depends(deps.get_current_user_optional),
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=2000),
    store_id: Optional[str] = None,
    status: Optional[str] = None,
    type_filter: Optional[str] = Query(None, alias="type"),
    is_abandoned_cart: Optional[bool] = None,
    search: Optional[str] = None,
    assigned_to: Optional[str] = None,
    wilaya: Optional[str] = None,
    source: Optional[str] = None,
    customer_phone: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    delivery_method: Optional[str] = None,   # internal | carrier
    livreur_id: Optional[str] = None,
    carrier_id: Optional[str] = None,        # DeliveryPartner.id (Order.carrier_id)
    campaign: Optional[str] = None,          # utm_campaign or campaign_id
    product_id: Optional[str] = None,
):
    logger.debug(f"[Orders] Listing: store_id={store_id!r}, status={status!r}, user={getattr(current_user, 'email', 'anon')!r}")

    # This endpoint does its OWN complete, explicit scoping below (guest
    # phone+store_id, SUPER_ADMIN/ADMIN unrestricted, CONFIRMATEUR union
    # scope, MANAGER's employee_store_id, LIVREUR, deny-by-default) — including
    # explicitly honoring the store_id QUERY PARAM at "if store_id:" further
    # down. The global do_orm_execute tenant auto-filter (TenantMiddleware,
    # driven by the X-Store-Id HEADER) is a blunt safety net for endpoints
    # that DON'T scope themselves; here it's redundant, and when the header
    # doesn't match the query param — the frontend's active-store header can
    # legitimately differ from the store the confirmatrice is browsing on a
    # multi-store account — it silently ANDs both filters together
    # (store_id == 'A' AND store_id == 'B'), which can never match anything.
    # A confirmatrice with 176 real orders in a store then sees total=0,
    # indistinguishable from "this store genuinely has no orders". get_db()
    # hands out a fresh Session per request (closed at teardown), so this
    # flag never leaks across requests.
    db.info["skip_tenant_isolation"] = True

    query = db.query(Order).filter(Order.is_deleted == False)

    # Authentication & RBAC scoping
    if not current_user:
        # GUEST ACCESS: Must provide both phone and store_id
        if not customer_phone or not store_id:
            raise HTTPException(status_code=401, detail="Authentication required for general listing")
        query = query.filter(Order.customer_phone == customer_phone, Order.store_id == store_id)
    else:
        if current_user.role in ("SUPER_ADMIN", "ADMIN"):
            pass  # unrestricted — admins manage every order
        elif current_user.role == "CONFIRMATEUR":
            from sqlalchemy import and_, or_

            # Union responsibility scope: full stores + specific products of
            # other stores — see _confirmateur_scope_criterion.
            scope_crit = _confirmateur_scope_criterion(current_user, db)

            assigned_to_me = Order.assigned_to == current_user.id
            unassigned_matching = and_(
                Order.assigned_to == None,
                scope_crit,
            )

            # For ABANDONED carts, allow agents to see all of them in their scope to recover them.
            # Same for the Logistique tab's statuses (INTERNAL_DELIVERY, SHIPPED, DELIVERED,
            # RETURNED): once an order is confirmed, tracking its delivery is a store-wide
            # concern, not tied to whichever confirmatrice originally confirmed it — restricting
            # to assigned_to_me/unassigned here silently hid orders confirmed by a colleague
            # from "Assignées Livreur" and the other delivery-tracking views. Still bounded by
            # her responsibility scope so one confirmatrice never sees another's stores.
            # CARRIER_* (Noest's own granular stages — ready_to_ship,
            # processing, in_transit, out_for_delivery, suspended) are exactly
            # as store-wide as SHIPPED itself: they're just SHIPPED filtered
            # by carrier_stage. Leaving them out of this set meant a colleague-
            # confirmed order stuck at "colis_suspendu" or mid-transit was
            # invisible in the logistics sub-modules — on a store with a single
            # confirmatrice everything happens to be assigned_to her so the gap
            # never showed, which is why "one store looked fine, the other
            # didn't" for stores with more than one confirmatrice sharing it.
            # CANCELLED/ARCHIVED are the same lifecycle outcome as RETURNED —
            # once terminal, it's no longer "her queue" either.
            _STORE_WIDE_STATUSES = {
                "ABANDONED", "NRP_ABANDONED", "ABANDONED_IN_PROGRESS", "RECOVERED",
                "INTERNAL_DELIVERY", "SHIPPED", "DELIVERED",
                "RETURNED", "CANCELLED", "ARCHIVED",
            }
            _status_upper = status.upper() if (status and isinstance(status, str)) else ""
            _type_upper = type_filter.upper() if (type_filter and isinstance(type_filter, str)) else ""
            is_abandoned_query = (
                (_status_upper in {"ABANDONED", "NRP_ABANDONED", "ABANDONED_IN_PROGRESS", "RECOVERED"}) or
                (_type_upper == "ABANDONED") or
                is_abandoned_cart is True
            )
            # Rule-based ownership (PRODUCT/STORE Assignment Rules) always
            # wins over the legacy assigned_to/scope fallback below — see
            # _confirmateur_ownership_criterion. Without this, a product
            # handed to a different confirmatrice via an Assignment Rule
            # stayed visible to whoever Order.assigned_to (a one-time
            # snapshot, stamped before the rule existed or by the legacy
            # pool logic) still happened to name.
            if (status and isinstance(status, str) and (_status_upper in _STORE_WIDE_STATUSES or _status_upper.startswith("CARRIER_"))) or is_abandoned_query:
                query = query.filter(_confirmateur_ownership_criterion(current_user, or_(assigned_to_me, scope_crit), db))
            else:
                query = query.filter(_confirmateur_ownership_criterion(current_user, or_(assigned_to_me, unassigned_matching), db))

            # Les confirmatrices voient toutes les commandes de leur périmètre pour l'ensemble des 58 Wilayas.
            pass
        elif current_user.role == "MANAGER" and current_user.employee_store_id:
            query = query.filter(Order.store_id == current_user.employee_store_id)
        elif current_user.role == "LIVREUR":
            # A delivery agent lists orders explicitly handed to them, OR
            # any order whose delivery region currently resolves to them
            # via a COMMUNE/WILAYA rule — covers orders that predate the
            # rule (or a rule added after the order existed), not just ones
            # with Order.livreur_id already stamped at creation time. Never
            # a carrier-tracked parcel — once a NOEST/Yalidine/ZR tracking
            # number exists, that's the transporteur's job.
            from sqlalchemy import or_ as _or_liv, select as _select_evt_l
            _acted_ids_l = _select_evt_l(OrderEvent.order_id).where(OrderEvent.actor_id == current_user.id)
            query = query.filter(
                _or_liv(
                    Order.livreur_id == current_user.id,
                    Order.assigned_to == current_user.id,
                    _region_owned_by_agent_criterion(current_user.id),
                    Order.id.in_(_acted_ids_l)
                ),
                _or_liv(Order.tracking_number.is_(None), Order.tracking_number == ""),
            )
        else:
            # MANAGER without employee_store_id, MARKETER, CUSTOMER, or any
            # unrecognized/mistyped role value — deny by default instead of
            # silently falling through with no filter at all (which used to
            # grant an unrestricted, admin-like view of every order in the
            # database to any role this chain didn't explicitly handle).
            query = query.filter(Order.id.is_(None))

    # Explicit filters (from query params)
    if store_id:
        query = query.filter(Order.store_id == store_id)
    if customer_phone:
        query = query.filter(Order.customer_phone == customer_phone)
    # An order handed to an internal delivery agent lives EXCLUSIVELY in the
    # "Assignées Livreur" (INTERNAL_DELIVERY) view from that moment on — it
    # used to keep showing in Nouvelles/En cours/NRP/Confirmées too, so the
    # confirmatrice saw the same order in two places and could keep working
    # a parcel that was already out with a driver. Excluded from every
    # confirmation-stage filter below; DELIVERED/RETURNED/ARCHIVED views are
    # untouched (terminal outcomes belong there whoever delivered them), and
    # a carrier tracking number overrides livreur_id per existing rule.
    from sqlalchemy import or_ as _or_nid, and_ as _and_nid
    _not_internal_delivery = _or_nid(
        Order.livreur_id.is_(None),
        _and_nid(Order.tracking_number.isnot(None), Order.tracking_number != ""),
    )
    _CONFIRMATION_STAGE_FILTERS = {
        "NEW", "PENDING_CONFIRMATION", "RECALL", "NRP", "NRP_ABANDONED",
        "NRP_NORMAL", "ABANDONED_IN_PROGRESS", "ASSIGNED", "CALLED",
        "IN_PROGRESS", "RESCHEDULED", "CONFIRMED",
    }

    _is_livreur = bool(current_user) and getattr(current_user, "role", None) == "LIVREUR"

    if status and status.upper() != "ALL":
        # Never applied to the LIVREUR himself: his whole view IS the
        # internal-delivery set, this exclusion would blank it out.
        if status.upper() in _CONFIRMATION_STAGE_FILTERS and not _is_livreur:
            query = query.filter(_not_internal_delivery)
        if status.upper() == "RECALL":
            from datetime import datetime, timezone
            from sqlalchemy import or_
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            query = query.filter(
                Order.nrp_count > 0,
                # ABANDONED included: abandoned-cart NRPs must appear in recalls too
                Order.status.in_(["IN_PROGRESS", "CALLED", "RESCHEDULED", "ASSIGNED", "ABANDONED"]),
                or_(
                    Order.next_callback_time == None,
                    Order.next_callback_time <= now
                )
            )
        elif status.upper() == "NEW":
            # "Nouvelles Commandes" = flux normal (landing page/Meta Ads/
            # storefront) — une commande saisie manuellement a déjà son propre
            # module "Commandes Manuelles" (voir status.upper() == "MANUAL"
            # plus bas / GET /orders/agent-counts) ; sans cette exclusion elle
            # apparaissait dans les deux listes à la fois.
            query = query.filter(
                Order.status.in_(["NEW", "ASSIGNED"]),
                sqlfunc.coalesce(Order.source, "") != "MANUAL",
            )
        elif status.upper() == "PENDING_CONFIRMATION":
            # Orders moved directly to a pending status (IN_PROGRESS/RESCHEDULED)
            # without ever going through "Signaler NRP" — nrp_count stays 0.
            # Excludes NRP-driven ones deliberately: those already have their
            # own dedicated modules (NRP Commandes / NRP Paniers Aband.),
            # showing them again here would just duplicate that view. Also
            # excludes MANUAL orders — same reasoning as "NEW" above.
            from sqlalchemy import or_ as _or_pending
            query = query.filter(
                Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"]),
                _or_pending(Order.nrp_count == None, Order.nrp_count == 0),
                sqlfunc.coalesce(Order.source, "") != "MANUAL",
            )
        elif status.upper() == "NRP":
            query = query.filter(
                Order.nrp_count > 0,
                Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"]),
            )
        elif status.upper() == "NRP_ABANDONED":
            # NRP sur panier abandonné (reste "abandonné" tant que non confirmé)
            query = query.filter(
                Order.nrp_count > 0,
                Order.is_abandoned_cart == True,
                Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"]),
            )
        elif status.upper() == "NRP_NORMAL":
            # NRP sur commande normale
            query = query.filter(
                Order.nrp_count > 0,
                Order.is_abandoned_cart == False,
                Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"]),
            )
        elif status.upper() in ("ABANDONED", "ABANDONED_IN_PROGRESS"):
            # Un panier abandonné regroupe toutes les commandes avec is_abandoned_cart=True
            # ou status="ABANDONED", tant qu'elles ne sont pas finalisées (CONFIRMED/SHIPPED/DELIVERED/CANCELLED/RETURNED)
            from sqlalchemy import or_
            query = query.filter(
                or_(Order.is_abandoned_cart == True, Order.status == "ABANDONED"),
                Order.status.notin_(["CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"]),
            )
        elif status.upper() == "RECOVERED":
            query = query.filter(
                Order.is_abandoned_cart == True,
                Order.status.in_(["CONFIRMED", "SHIPPED", "DELIVERED"]),
            )
        elif status.upper() == "ARCHIVED":
            query = query.filter(Order.status.in_(["CANCELLED", "RETURNED"]))
        elif status.upper() == "WORKING":
            # "En Cours" dans le tableau de bord confirmatrice — regroupe
            # tous les statuts "en cours de traitement téléphonique" avant
            # confirmation (ASSIGNED/CALLED/IN_PROGRESS/RESCHEDULED), même
            # logique que ARCHIVED ci-dessus. Le badge de cet onglet
            # sommait déjà ces 4 statuts côté frontend ; ce filtre les
            # regroupe aussi côté liste, pour que le nombre affiché sur
            # l'onglet corresponde à ce qu'il affiche une fois cliqué.
            query = query.filter(Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"]))
        elif status.upper() == "MANUAL":
            # "Commandes Manuelles" — every order an agent/admin typed in
            # directly (phone order, in-store, etc.) rather than the
            # customer submitting it themselves through a storefront/LP.
            # Whatever its current status, not scoped to the confirmation
            # stage like the filters above: a manually-entered order is
            # still "manual" whether it's still NEW or already DELIVERED.
            query = query.filter(sqlfunc.coalesce(Order.source, "") == "MANUAL")
        elif status.upper() == "UPSELL":
            # An extra product added on-call (agent-dashboard.tsx's "Ajouter
            # un produit existant (Upsell)" during order editing) — flagged
            # via Order.is_upsell, whatever its current status.
            query = query.filter(Order.is_upsell == True)
        elif status.upper().startswith("CARRIER_") and status.upper()[len("CARRIER_"):].lower() in CARRIER_STAGE_BUCKETS:
            # Noest's own granular carrier stage (see CARRIER_STAGE_BUCKETS) —
            # e.g. status=CARRIER_OUT_FOR_DELIVERY for the "En livraison"
            # sub-module. Scoped to SHIPPED, the only state this is meaningful
            # for (see get_agent_counts' identical scoping).
            _bucket = status.upper()[len("CARRIER_"):].lower()
            query = query.filter(
                Order.status == "SHIPPED",
                Order.carrier_stage.in_(CARRIER_STAGE_BUCKETS[_bucket]),
            )
        elif status.upper() == "INTERNAL_DELIVERY":
            # Any order handed to an internal delivery agent, whatever its
            # current status (assignment is available from every stage now —
            # NEW, NRP, CANCELLED included). Delivered/Returned/Merged already
            # have their own dedicated views, so they're excluded here.
            # A carrier tracking number means the order actually left through
            # NOEST/Yalidine/ZR — that's a "Livraison Transporteur" case, not
            # an internal one, even if livreur_id was never cleared for some
            # reason; the two are mutually exclusive by business rule.
            from sqlalchemy import or_ as _or
            query = query.filter(
                Order.livreur_id.isnot(None),
                _or(Order.tracking_number.is_(None), Order.tracking_number == ""),
                Order.status.notin_(["DELIVERED", "RETURNED", "MERGED"]),
            )
        else:
            query = query.filter(Order.status == status.upper())
    else:
        # Merged duplicates stay in DB for traceability but are hidden from
        # the default listing — the surviving parent represents them.
        # EXCEPTION: an explicit search must find child orders too (searching
        # a child order number opens its parent from the UI).
        if not search:
            query = query.filter(Order.status != "MERGED")

    if is_abandoned_cart is not None:
        from sqlalchemy import or_
        if is_abandoned_cart is True:
            query = query.filter(or_(Order.is_abandoned_cart == True, Order.status == "ABANDONED"))
        else:
            query = query.filter(Order.is_abandoned_cart == False, Order.status != "ABANDONED")

    if type_filter and isinstance(type_filter, str) and type_filter.upper() != "ALL":
        _tf = type_filter.upper()
        from sqlalchemy import or_
        if _tf == "ABANDONED":
            query = query.filter(
                or_(Order.is_abandoned_cart == True, Order.status == "ABANDONED"),
                Order.status.notin_(["CONFIRMED", "SHIPPED", "DELIVERED"]),
            )
        elif _tf == "RECOVERED":
            query = query.filter(
                Order.is_abandoned_cart == True,
                Order.status.in_(["CONFIRMED", "SHIPPED", "DELIVERED"]),
            )
        elif _tf == "NORMAL":
            query = query.filter(
                Order.is_abandoned_cart == False,
                sqlfunc.coalesce(Order.source, "") != "MANUAL",
                Order.is_upsell == False,
            )
        elif _tf == "MANUAL":
            query = query.filter(sqlfunc.coalesce(Order.source, "") == "MANUAL")

    if assigned_to:
        query = query.filter(Order.assigned_to == assigned_to)
    if livreur_id:
        query = query.filter(Order.livreur_id == livreur_id)
    if carrier_id:
        query = query.filter(Order.carrier_id == carrier_id)
    if delivery_method:
        if delivery_method.lower() == "internal":
            query = query.filter(Order.livreur_id.isnot(None))
        elif delivery_method.lower() in ("carrier", "noest"):
            query = query.filter(Order.tracking_number.isnot(None), Order.tracking_number != "")
    if campaign:
        from sqlalchemy import or_
        query = query.filter(or_(Order.utm_campaign == campaign, Order.campaign_id == campaign))
    if wilaya:
        query = query.filter(Order.customer_wilaya == wilaya)
    if source:
        query = query.filter(Order.source == source)
    if product_id:
        # EXISTS, pas un JOIN — une commande avec plusieurs lignes du même
        # produit ne doit pas apparaître en double dans la liste.
        query = query.filter(
            db.query(OrderItem.id)
            .filter(OrderItem.order_id == Order.id, OrderItem.product_id == product_id)
            .exists()
        )
    if search:
        from sqlalchemy import or_
        query = query.filter(
            or_(
                Order.customer_name.ilike(f"%{search}%"),
                Order.customer_phone.ilike(f"%{search}%"),
                Order.order_number.ilike(f"%{search}%"),
                Order.tracking_number.ilike(f"%{search}%"),
                db.query(OrderItem.id)
                .filter(OrderItem.order_id == Order.id, OrderItem.product_name.ilike(f"%{search}%"))
                .exists(),
            )
        )
    if start_date:
        from app.core.dates import parse_local_date_filter
        try:
            query = query.filter(Order.created_at >= parse_local_date_filter(start_date))
        except ValueError:
            pass
    if end_date:
        from app.core.dates import parse_local_date_filter
        try:
            query = query.filter(Order.created_at <= parse_local_date_filter(end_date))
        except ValueError:
            pass

    total = query.count()
    skip = (page - 1) * pageSize
    
    final_query = query.options(
            # OrderItemRead (schemas/order.py) never serializes item.product —
            # it only exposes the denormalized product_id/product_name/
            # unit_price/image_url already stored on OrderItem itself. Eagerly
            # joining the full Product row (description, SEO fields, variants
            # JSON...) for every item of every order was pure wasted transfer
            # between the backend and Neon, never used downstream.
            joinedload(Order.items),
            joinedload(Order.assignee),
            joinedload(Order.livreur),
            joinedload(Order.store),
        ).order_by(Order.created_at.desc())
    
    logger.debug(f"[Orders] Query result: store_id={store_id!r}, total={total}, page={page}")

    orders = final_query.offset(skip).limit(pageSize).all()
    _sync_item_images_from_product(db, orders)

    # Attach a per-order event count so the UI can show "🕘 N événements" right
    # in the list without opening the detail drawer for every order — one
    # grouped query for the whole page, not one query per row. Works for
    # orders created before this feature too: OrderEvent has always been
    # populated on every status change (_log_event), only the visibility was
    # missing. Plain attribute set on the ORM instance; OrderRead.events_count
    # reads it via from_attributes just like any real column.
    if orders:
        _counts = dict(
            db.query(OrderEvent.order_id, sqlfunc.count(OrderEvent.id))
            .filter(OrderEvent.order_id.in_([o.id for o in orders]))
            .group_by(OrderEvent.order_id)
            .all()
        )
        for o in orders:
            o.events_count = _counts.get(o.id, 0)  # type: ignore[attr-defined]

        # Same pattern for duplicate_count — how many resubmits were merged
        # into each parent order on this page. list_orders never eager-loads
        # the full child_orders relationship (only the single-order detail
        # endpoint does), so a parent's duplicate history was invisible from
        # the list itself — the admin had to open every order one by one to
        # discover it had absorbed duplicates at all.
        # Also the most recent duplicate's timestamp per parent, so the list
        # badge can show WHEN the last resubmit came in without fetching
        # full child_orders details for every row on the page (that stays a
        # lazy, on-demand fetch — see GET /orders/{id}).
        _dup_rows = (
            db.query(Order.parent_order_id, sqlfunc.count(Order.id), sqlfunc.max(Order.created_at))
            .filter(
                Order.parent_order_id.in_([o.id for o in orders]),
                Order.status == "MERGED",
            )
            .group_by(Order.parent_order_id)
            .all()
        )
        _dup_counts = {r[0]: r[1] for r in _dup_rows}
        _dup_last_at = {r[0]: r[2] for r in _dup_rows}
        for o in orders:
            o.duplicate_count = _dup_counts.get(o.id, 0)  # type: ignore[attr-defined]
            o.last_duplicate_at = _dup_last_at.get(o.id)  # type: ignore[attr-defined]

    return {
        "success": True,
        "data": orders,
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "totalPages": (total + pageSize - 1) // pageSize if pageSize > 0 else 0,
    }


# ─── POST /orders/ — Public guest + authenticated order creation ───────────────

@router.post("/abandoned", status_code=201)
def update_abandoned_cart(
    order_in: OrderCreate,
    request: Request,
    db: Session = Depends(deps.get_db),
):
    """
    Save or update an abandoned cart draft from the storefront.
    """
    from datetime import datetime, timezone, timedelta
    order_data = order_in.model_dump(exclude={"items", "abandoned_cart_id"})
    # Set correct source, status and flag for abandoned cart drafts
    order_data["source"] = order_in.source or "abandoned_cart"
    order_data["is_abandoned_cart"] = True
    order_data["status"] = "ABANDONED"

    from app.services.inventory_service import InventoryService
    inv_svc = InventoryService()

    # Serialize concurrent saves for the SAME customer — a customer clicking
    # the checkout button several times in quick succession (or a flaky
    # connection retrying) fires several of these 2s-debounced requests
    # close enough together that the phone-fallback SELECT below (find-
    # existing-or-create) is a classic check-then-act race: each request
    # sees "no existing cart yet" before any of the others has committed
    # its INSERT, so every one of them creates its own ABN-* row instead of
    # updating a shared one. Confirmed in production: a single customer
    # produced 16 near-identical ABN-20260714-* orders within one minute.
    # pg_advisory_xact_lock is transaction-scoped — it releases automatically
    # at commit/rollback, no manual unlock needed, and blocks concurrent
    # requests for the same (store, phone) until the first one finishes.
    _lock_phone = (order_data.get("customer_phone") or "").strip()
    if _lock_phone and _lock_phone.lower() != "inconnu":
        from sqlalchemy import text as _sql_text
        db.execute(
            _sql_text("SELECT pg_advisory_xact_lock(hashtext(:key)::bigint)"),
            {"key": f"{order_in.store_id}:{_lock_phone}"},
        )

    # If we have an existing abandoned cart ID, try to update it
    db_order = None
    if order_in.abandoned_cart_id:
        db_order = db.query(Order).filter(
            Order.id == order_in.abandoned_cart_id,
            Order.status == "ABANDONED"
        ).first()

    # Fallback dedup by phone+store: the tracked id often stops matching because
    # auto-merge flips the previous cart to MERGED. Without this, EVERY keystroke
    # 2s-debounced save then created a brand-new cart (which was merged in turn),
    # flooding the store with dozens of MERGED duplicate carts seconds apart.
    # Reuse the customer's existing live abandoned cart instead of creating one.
    if not db_order:
        phone = (order_data.get("customer_phone") or "").strip()
        if phone and phone.lower() != "inconnu":
            _window_7d = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
            db_order = (
                db.query(Order)
                .filter(
                    Order.store_id == order_in.store_id,
                    Order.customer_phone == phone,
                    Order.created_at >= _window_7d,
                    Order.is_deleted == False,
                    Order.status.notin_(["CANCELLED", "RETURNED"]),
                )
                .order_by(Order.created_at.desc())
                .first()
            )
            if db_order and db_order.parent_order_id:
                parent_order = db.query(Order).filter(Order.id == db_order.parent_order_id).first()
                if parent_order:
                    db_order = parent_order

    if db_order:
        # Update existing
        for key, value in order_data.items():
            setattr(db_order, key, value)

        # Merge any other duplicate drafts for the same phone & store
        phone = (order_data.get("customer_phone") or "").strip()
        if phone and phone.lower() != "inconnu":
            other_duplicates = db.query(Order).filter(
                Order.store_id == order_in.store_id,
                Order.customer_phone == phone,
                Order.id != db_order.id,
                Order.is_deleted == False,
                Order.status != "MERGED"
            ).all()
            for dup in other_duplicates:
                dup.status = "MERGED"
                dup.parent_order_id = db_order.id
                dup.is_deleted = True
            
        # Try to auto-assign if currently unassigned
        if not db_order.assigned_to and not db_order.livreur_id:
            from app.models.store import Store
            from app.services.order_service import _auto_assign, _auto_assign_courier, snapshot_commission
            # Courier auto-assignment by destination (chantier #3) checked
            # first — a matching commune/wilaya goes straight to the
            # livreur, bypassing the confirmatrice pool entirely. Defensive:
            # this debounced draft-save fires on nearly every keystroke —
            # a query failure here (e.g. migration lag) must never break
            # saving the customer's cart draft.
            try:
                resolved_courier_id = _auto_assign_courier(db, db_order.customer_wilaya, db_order.customer_commune)
            except Exception as courier_err:
                db.rollback()
                logger.warning("Courier auto-assignment failed, continuing without it: %s", courier_err)
                resolved_courier_id = None
            if resolved_courier_id:
                db_order.livreur_id = resolved_courier_id
            else:
                store = db.query(Store).filter(Store.id == db_order.store_id).first()
                order_product_ids = [item.product_id for item in order_in.items if item.product_id]
                from app.services.order_service import resolve_assignment_rule
                rule_agent = None
                for pid in order_product_ids:
                    rule_agent = resolve_assignment_rule(db, db_order.store_id, pid)
                    if rule_agent:
                        break
                db_order.assigned_to = rule_agent
                if db_order.assigned_to:
                    snapshot_commission(db, db_order, db_order.assigned_to)
        
        # This endpoint is hit on every ~2s-debounced keystroke while the
        # customer types their contact info on the storefront — the CART
        # ITEMS themselves are unchanged on the vast majority of those
        # calls. Unconditionally release+delete+recreate+reserve every item
        # on every single call (previous behavior) cost ~20-30 extra SQL
        # round trips per save even when nothing about the items changed —
        # confirmed in prod: POST /orders/abandoned averaged ~3000ms across
        # 33-34 queries, concurrent instances of which were starving the
        # single-worker container enough to make unrelated requests (login,
        # a confirmatrice's status updates) time out at the Vercel proxy.
        # Skip the whole release/reserve cycle when the item set is
        # byte-for-byte identical to what's already stored.
        _new_signature = sorted(
            (i.product_id, i.quantity, i.unit_price, json.dumps(i.variant_details, sort_keys=True) if i.variant_details else None)
            for i in order_in.items
        )
        _old_signature = sorted(
            (i.product_id, i.quantity, i.unit_price, json.dumps(i.variant_details, sort_keys=True) if i.variant_details else None)
            for i in db_order.items
        )
        if _new_signature != _old_signature:
            # Release reservations for old items
            for old_item in db_order.items:
                try:
                    inv_svc.release_reservation(
                        db,
                        product_id=old_item.product_id,
                        quantity=old_item.quantity,
                        order_id=db_order.id,
                        variant_details=old_item.variant_details
                    )
                except Exception as exc:
                    logger.warning(f"Could not release reservation for old abandoned cart item {old_item.id}: {exc}")

            # Replace items
            db.query(OrderItem).filter(OrderItem.order_id == db_order.id).delete()
            import uuid
            for item_in in order_in.items:
                item_data = item_in.model_dump()
                db_item = OrderItem(
                    id=str(uuid.uuid4()),
                    order_id=db_order.id,
                    **{k: v for k, v in item_data.items() if k in {"product_id", "product_name", "quantity", "unit_price", "variant_details", "image_url"}}
                )
                db.add(db_item)

                # Reserve stock for new items
                try:
                    inv_svc.reserve_stock(
                        db,
                        product_id=db_item.product_id,
                        quantity=db_item.quantity,
                        order_id=db_order.id,
                        variant_details=db_item.variant_details
                    )
                except Exception as exc:
                    logger.warning(f"Could not reserve stock for abandoned cart item {db_item.product_id}: {exc}")

        db.commit()
        db.refresh(db_order)
        return {"success": True, "id": db_order.id, "message": "Panier abandonné mis à jour"}
    
    # Create new abandoned cart with auto-assignment
    import uuid
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    order_number = f"ABN-{now.strftime('%Y%m%d')}-{str(uuid.uuid4())[:6].upper()}"
    
    from app.models.store import Store
    from app.services.order_service import resolve_assignment_rule, snapshot_commission
    store = db.query(Store).filter(Store.id == order_in.store_id).first()
    order_product_ids = [item.product_id for item in order_in.items if item.product_id]
    assigned_agent = None
    for pid in order_product_ids:
        assigned_agent = resolve_assignment_rule(db, order_in.store_id, pid)
        if assigned_agent:
            break

    # Avoid duplicate parameter error
    order_data.pop("is_abandoned_cart", None)
    order_data.pop("assigned_to", None)

    # Calculate store_sequence_number from non-deleted, non-merged active orders
    from sqlalchemy import func
    max_seq = db.query(func.max(Order.store_sequence_number)).filter(
        Order.store_id == order_in.store_id,
        Order.is_deleted == False,
        Order.status != "MERGED",
    ).scalar()
    store_sequence_number = (max_seq or 0) + 1

    # Delivery fee rule: ALWAYS apply the admin's configured Noest fee grid price for the wilaya
    # UNLESS the Admin explicitly enabled Free Shipping on the Product!
    from app.services.order_service import is_admin_free_shipping_product, resolve_wilaya_delivery_fee
    admin_free_shipping = is_admin_free_shipping_product(db, order_in.items)
    if admin_free_shipping:
        order_data["delivery_fee"] = 0
    else:
        calc_fee = resolve_wilaya_delivery_fee(db, order_in.store_id, order_data.get("customer_wilaya"), order_data.get("delivery_type", "HOME"))
        order_data["delivery_fee"] = calc_fee

    if order_data.get("subtotal") and float(order_data.get("subtotal") or 0) > 0:
        order_data["total"] = max(0, float(order_data["subtotal"]) - float(order_data.get("discount") or 0) + float(order_data["delivery_fee"]))

    valid_order_cols = {c.name for c in Order.__table__.columns}
    db_order = Order(
        id=str(uuid.uuid4()),
        order_number=order_number,
        store_sequence_number=store_sequence_number,
        status="ABANDONED",
        assigned_to=assigned_agent,
        is_abandoned_cart=True,
        **{k: v for k, v in order_data.items() if k in valid_order_cols and k not in ("id", "order_number", "store_sequence_number", "status", "assigned_to", "is_abandoned_cart")}
    )
    db.add(db_order)
    db.flush()
    snapshot_commission(db, db_order, assigned_agent)
    
    for item_in in order_in.items:
        item_data = item_in.model_dump()
        db_item = OrderItem(
            id=str(uuid.uuid4()),
            order_id=db_order.id,
            **{k: v for k, v in item_data.items() if k in {"product_id", "product_name", "quantity", "unit_price", "variant_details", "image_url"}}
        )
        db.add(db_item)
        
        # Reserve stock for new items
        try:
            inv_svc.reserve_stock(
                db,
                product_id=db_item.product_id,
                quantity=db_item.quantity,
                order_id=db_order.id,
                variant_details=db_item.variant_details
            )
        except Exception as exc:
            logger.warning(f"Could not reserve stock for new abandoned cart item {db_item.product_id}: {exc}")
        
    db.commit()
    db.refresh(db_order)

    # A fresh abandoned cart may duplicate an existing active order (or another
    # abandoned cart) of the same customer — fuse into one operational order.
    try:
        if auto_merge_duplicates(db, db_order, actor_id=None):
            db.commit()
            db.refresh(db_order)
    except Exception as merge_err:
        db.rollback()
        logger.warning("Auto-merge failed for abandoned cart %s: %s", db_order.id, merge_err)

    from app.core.logging import log_order_event
    log_order_event("DRAFT_PANIER_ABANDONNE", db_order, "Pré-saisie de téléphone ou panier abandonné capturé sur la landing page")

    return {"success": True, "id": db_order.id, "message": "Panier abandonné sauvegardé"}


@router.post("/", status_code=201)
def create_order(
    order_in: OrderCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(deps.get_db),
):
    """
    Create a new order. No authentication required — guests can place orders.
    If a valid session cookie is present it is used for audit, but not required.
    """
    items = [item.model_dump() for item in order_in.items]
    order_data = order_in.model_dump(exclude={"items", "abandoned_cart_id"})
    
    # Try to resolve actor from cookie — but never block on missing auth
    actor_id: Optional[str] = None
    try:
        user = deps.get_current_user(
            request=request,
            db=db,
            token=None,
            x_internal_key=request.headers.get("x-internal-key"),
            x_user_id=request.headers.get("x-user-id"),
            authorization=request.headers.get("authorization"),
        )
        actor_id = user.id
    except Exception:
        pass

    try:
        from sqlalchemy import or_
        # If this completes an abandoned cart, upgrade it instead of creating duplicate
        existing = None
        if order_in.abandoned_cart_id:
            existing = db.query(Order).filter(Order.id == order_in.abandoned_cart_id).first()
        if not existing and order_in.customer_phone:
            existing = db.query(Order).filter(
                Order.customer_phone == order_in.customer_phone,
                or_(Order.is_abandoned_cart == True, Order.status == "ABANDONED"),
                Order.is_deleted == False
            ).order_by(Order.created_at.desc()).first()

        if existing and (existing.status == "ABANDONED" or existing.is_abandoned_cart):
            for key, value in order_data.items():
                if key not in ["id", "status", "source", "is_abandoned_cart"]:
                    setattr(existing, key, value)
            
            existing.status = "NEW"
            existing.source = order_in.source or "storefront"  # they checked out themselves
            # The customer completed the checkout THEMSELVES → this is a
            # real NORMAL order, not a recovered cart (no confirmatrice
            # recovery happened). The type badge must say Normal.
            if existing.order_number and existing.order_number.startswith("ABN-"):
                existing.order_number = existing.order_number.replace("ABN-", "ORD-")

            logger.info(
                "🟢 [ORDER DETECTION] Upgrade Draft -> Normal Order: order_id=%s, num=%s, client='%s' (%s), is_abandoned_cart=False, status=NEW",
                existing.id, existing.order_number, existing.customer_name, existing.customer_phone
            )

            # Release old reservations
            from app.services.inventory_service import InventoryService
            inv_svc = InventoryService()
            for old_item in existing.items:
                try:
                    inv_svc.release_reservation(
                        db,
                        product_id=old_item.product_id,
                        quantity=old_item.quantity,
                        order_id=existing.id,
                        variant_details=old_item.variant_details
                    )
                except Exception as exc:
                    logger.warning(f"Could not release reservation for upgrading abandoned cart {existing.id}: {exc}")
            
            db.query(OrderItem).filter(OrderItem.order_id == existing.id).delete()
            for i_data in items:
                db_item = OrderItem(
                    id=str(uuid.uuid4()) if not i_data.get("id") else i_data["id"],
                    order_id=existing.id,
                    **{k: v for k, v in i_data.items() if k in {"product_id", "product_name", "quantity", "unit_price", "variant_details", "image_url"}}
                )
                db.add(db_item)
                
                # Reserve new stock
                try:
                    inv_svc.reserve_stock(
                        db,
                        product_id=db_item.product_id,
                        quantity=db_item.quantity,
                        order_id=existing.id,
                        variant_details=db_item.variant_details
                    )
                except Exception as exc:
                    logger.warning(f"Could not reserve stock for upgrading abandoned cart {existing.id}: {exc}")
                
            db.commit()
            db.refresh(existing)

            try:
                if auto_merge_duplicates(db, existing, actor_id=actor_id):
                    db.commit()
                    db.refresh(existing)
            except Exception as merge_err:
                db.rollback()
                logger.warning("Auto-merge failed for upgraded cart %s: %s", existing.id, merge_err)

                # The customer just completed checkout THEMSELVES from an
                # abandoned-cart link — this is a genuine sale, exactly like a
                # brand-new order, so it must fire Purchase CAPI exactly once
                # (send_purchase_for_order's own idempotency guard protects
                # against ever double-firing if a confirmatrice later also
                # touches this order's status).
                if str(existing.status) != "MERGED":
                    try:
                        from app.services.meta_capi import _get_meta_config_cached, send_purchase_for_order, enqueue_purchase_for_order
                        meta_cfg = _get_meta_config_cached(db, existing.store_id)
                        if meta_cfg and meta_cfg.get("pixel_id") and meta_cfg.get("access_token"):
                            # Durable queue: write status='queued' and COMMIT it
                            # before scheduling the background task. If the
                            # process dies right after this commit (HF
                            # redeploy), the row survives and is replayed by
                            # app.main.resume_pending_queues on the next boot —
                            # this is what closes the exact gap that silently
                            # lost 22 real ORD-* Purchases in production.
                            client_ip = request.headers.get("x-forwarded-for") or (request.client.host if request.client else None)
                            user_agent = request.headers.get("user-agent")
                            # Persisted on the order (not just passed to this one
                            # synchronous call) so a LATER retry/backfill of this
                            # same Purchase can still recover them — see
                            # _handle_claimed_row's fallback in meta_capi.py.
                            existing.client_ip = client_ip
                            enqueue_purchase_for_order(db, existing)
                            from app.core.logging import log_order_event
                            log_order_event("ENVOI_META_CAPI_QUEUED", existing, "Événement Purchase CAPI ajouté à la file d'attente durable")
                            background_tasks.add_task(
                                send_purchase_for_order,
                                order_id=str(existing.id),
                                client_ip=client_ip,
                                user_agent=user_agent
                            )
                    except Exception as capi_err:
                        db.rollback()
                        logger.warning(f"Failed to queue Meta CAPI event for recovered cart {existing.id}: {capi_err}")

                return existing

        from datetime import datetime, timezone, timedelta

        # ── 3-minute silent absorption window: multi-clicks / immediate re-submits (e.g. 9:05 -> 9:06) ─────
        # Multiple clicks or submissions within 3 minutes for the same phone number
        # are treated as the SAME single order attempt: updates the existing order in-place,
        # ensuring is_duplicate = False (NO "Doublon" badge displayed).
        # Submissions after 3 minutes (e.g. 9:05 -> 9:10) create a separate entry that IS
        # flagged/merged as a duplicate for confirmatrice review.
        if order_data.get("customer_phone"):
            raw_phone = str(order_data["customer_phone"]).strip()
            import re
            phone_digits = re.sub(r"\D", "", raw_phone)
            if phone_digits.startswith("213") and len(phone_digits) >= 11:
                phone_digits = phone_digits[3:]
            elif phone_digits.startswith("0") and len(phone_digits) >= 10:
                phone_digits = phone_digits[1:]

            if phone_digits and len(phone_digits) >= 8:
                try:
                    # Integer lock key based on last 8 digits of phone to serialize parallel requests
                    lock_key = int(phone_digits[-8:]) if phone_digits[-8:].isdigit() else (abs(hash(phone_digits)) % (2**31 - 1))
                    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
                except Exception as lock_err:
                    logger.debug("Advisory lock skipped/unavailable: %s", lock_err)

                _idem_window = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=3)
                _recent_query = db.query(Order).filter(
                    func.right(func.regexp_replace(Order.customer_phone, r'\D', '', 'g'), 8) == phone_digits[-8:],
                    Order.created_at >= _idem_window,
                    Order.is_deleted == False,
                    Order.status.notin_(["CANCELLED", "RETURNED"]),
                )
                if order_data.get("store_id"):
                    _recent_query = _recent_query.filter(Order.store_id == order_data["store_id"])
                _prev = _recent_query.order_by(Order.created_at.asc()).first()
                if _prev:
                    # Update existing draft/abandoned cart into real order silently (is_duplicate = False)
                    if _prev.is_abandoned_cart or _prev.status in ("ABANDONED", "NEW"):
                        _prev.status = order_data.get("status", "NEW")
                        _prev.is_abandoned_cart = False
                        _prev.is_duplicate = False  # DO NOT flag as duplicate for fast 0-3min re-submits!
                        valid_order_cols = {c.name for c in Order.__table__.columns}
                        for k, v in order_data.items():
                            if k in valid_order_cols and k not in ("id", "order_number", "store_sequence_number") and hasattr(_prev, k):
                                setattr(_prev, k, v)
                    
                    # Merge any other duplicate drafts for this customer
                    other_dups = db.query(Order).filter(
                        func.right(func.regexp_replace(Order.customer_phone, r'\D', '', 'g'), 8) == phone_digits[-8:],
                        Order.id != _prev.id,
                        Order.is_deleted == False,
                        Order.status != "MERGED"
                    )
                    if order_data.get("store_id"):
                        other_dups = other_dups.filter(Order.store_id == order_data["store_id"])
                    for dup in other_dups.all():
                        dup.status = "MERGED"
                        dup.parent_order_id = _prev.id
                        dup.is_deleted = True
                    
                    db.commit()
                    logger.info(
                        "Deduplicated submit: phone %s submitted within 3-min window → updated existing order %s (is_duplicate=False)",
                        phone_digits, _prev.order_number,
                    )
                    return _prev

        is_upsell = order_data.get("is_upsell", False)
        
        # Auto-flag as upsell if it contains ONLY upsell products
        if not is_upsell and items:
            from app.models.product import Product
            _prod_ids = [item.get("product_id") for item in items if item.get("product_id")]
            if _prod_ids:
                _upsell_count = db.query(Product).filter(
                    Product.id.in_(_prod_ids), 
                    Product.is_upsell_only == True
                ).count()
                if _upsell_count == len(set(_prod_ids)):
                    is_upsell = True
                    order_data["is_upsell"] = True

        if not is_upsell and order_data.get("customer_phone"):
            fourteen_days_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=14)
            duplicate_exists = db.query(Order).filter(
                Order.customer_phone == order_data["customer_phone"],
                Order.created_at >= fourteen_days_ago,
                Order.is_deleted == False
            ).first()
            if duplicate_exists:
                order_data["is_duplicate"] = True

        logger.info(f"Received order payload: {order_data}")
        logger.info(f"Items: {items}")
        order = order_service.create_order(
            db,
            order_data=order_data,
            items_data=items,
            actor_id=actor_id,
        )
        db.commit()
        db.refresh(order)

        # Automatic duplicate grouping: same phone + same store, still in
        # confirmation stage → one operational parent, children become MERGED.
        try:
            if auto_merge_duplicates(db, order, actor_id=actor_id):
                db.commit()
                db.refresh(order)
        except Exception as merge_err:
            db.rollback()
            logger.warning("Auto-merge failed for order %s: %s", order.id, merge_err)


        # Only bump the LP counter for a real, standalone order. If auto-merge
        # just folded this submission into an existing parent (same phone), the
        # order is now MERGED and counting it would double-count one customer —
        # the same inflation the LP list recount deliberately excludes.
        if order.source == "landing_page" and str(order.status) != "MERGED":
            try:
                from app.models.landing_page import LandingPage
                if items and items[0].get("product_id"):
                    lp = db.query(LandingPage).filter(
                        LandingPage.store_id == order.store_id,
                        LandingPage.product_id == items[0]["product_id"]
                    ).first()
                    if lp:
                        lp.orders = (lp.orders or 0) + 1
                        db.add(lp)
                        db.commit()
            except Exception as lp_err:
                logger.warning(f"Failed to increment landing page orders count: {lp_err}")
        
        if actor_id:
            logger.info("Order %s created by user %s", order.order_number, actor_id)
        else:
            logger.info("Order %s created by guest", order.order_number)
            
        # Trigger Meta Conversions API (CAPI) if configured — fully normalized
        # user_data, retries, logging, and an event_id shared with the browser
        # Pixel (purchase-{order.id}) so Meta deduplicates the two signals.
        try:
            from app.services.meta_capi import _get_meta_config_cached, send_purchase_for_order, enqueue_purchase_for_order
            meta_cfg = _get_meta_config_cached(db, order.store_id)
            if meta_cfg and meta_cfg.get("pixel_id") and meta_cfg.get("access_token"):
                # Durable queue: the 'queued' row is written and COMMITTED
                # here, before add_task is even scheduled — not inside the
                # background task itself. If the HF container is killed
                # anywhere after this commit (mid-request, between response
                # and task execution, whenever), the row already exists on
                # disk and app.main.resume_pending_queues replays it on the
                # next boot. This is the fix for the proven gap: 22 real
                # ORD-* orders got ZERO CAPI attempt (not even a failed one)
                # because nothing was ever written before the old
                # BackgroundTasks callback started running.
                client_ip = request.headers.get("x-forwarded-for") or (request.client.host if request.client else None)
                user_agent = request.headers.get("user-agent")
                order.client_ip = client_ip
                order.client_user_agent = user_agent
                enqueue_purchase_for_order(db, order)
                db.commit()
                background_tasks.add_task(
                    send_purchase_for_order,
                    order_id=str(order.id),
                    client_ip=client_ip,
                    user_agent=user_agent
                )
        except Exception as capi_err:
            db.rollback()
            logger.warning(f"Failed to queue Meta CAPI event: {capi_err}")

        return order
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating order: {e}", exc_info=True)
        from app.core.exceptions import InsufficientStockError, ProductNotFoundError
        if isinstance(e, (InsufficientStockError, ProductNotFoundError, ValueError)):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── Commissions confirmatrice / livreur ────────────────────────────────────
# Doit rester AVANT /{id} (routage par ordre d'enregistrement). Aucune
# nouvelle table : les taux vivent dans Store.operations_config (JSON déjà
# existant, jamais utilisé avant) — évite toute migration de schéma sur une
# base dont l'historique Alembic a plusieurs "heads" divergentes que je ne
# peux pas résoudre en toute sécurité sans interpréteur Python local pour
# vérifier. Défauts appliqués si rien n'est configuré, jamais un crash.

_DEFAULT_COMMISSION_CONFIRMATRICE_PCT = 2.0   # % de la valeur de la commande
_DEFAULT_COMMISSION_LIVREUR_FIXED = 100        # DA fixe par commande livrée
_UPSELL_COMMISSION_FLAT_DA = 250               # DA fixe par produit upsell ajouté par la confirmatrice

@router.get("/commissions", response_model=dict)
def get_commissions(
    store_id: str = Query(...),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    from app.core.dates import parse_local_date_filter
    from app.models.store import Store

    db.info["skip_tenant_isolation"] = True
    store = db.query(Store).filter(Store.id == store_id).first()
    cfg = (store.operations_config or {}) if store else {}
    pct = cfg.get("commission_confirmatrice_pct", _DEFAULT_COMMISSION_CONFIRMATRICE_PCT)
    fixed = cfg.get("commission_livreur_fixed", _DEFAULT_COMMISSION_LIVREUR_FIXED)

    q = db.query(Order).filter(Order.store_id == store_id, Order.status == "DELIVERED", Order.is_deleted == False)
    if start_date:
        try:
            q = q.filter(Order.created_at >= parse_local_date_filter(start_date))
        except ValueError:
            pass
    if end_date:
        try:
            q = q.filter(Order.created_at <= parse_local_date_filter(end_date))
        except ValueError:
            pass
    orders = q.options(joinedload(Order.assignee), joinedload(Order.livreur)).all()

    _CONFIRMATRICE_LIVREUR_BONUS_DA = 50.0  # 50 DA par commande assignée à un livreur et livrée

    order_ids = [o.id for o in orders]
    noest_delivered_order_ids = set()
    if order_ids:
        from app.models.order import OrderEvent
        noest_events = db.query(OrderEvent.order_id).filter(
            OrderEvent.order_id.in_(order_ids),
            OrderEvent.to_status == "DELIVERED",
            OrderEvent.note.ilike("%noest%")
        ).all()
        noest_delivered_order_ids = {r[0] for r in noest_events}

    total_noest = 0
    total_manual = 0

    confirmatrices: dict = {}
    livreurs: dict = {}
    for o in orders:
        is_noest = (o.id in noest_delivered_order_ids) or (bool(o.tracking_number) and (o.shipping_provider == "noest" or "noest" in str(o.tracking_number).lower()))
        if is_noest:
            total_noest += 1
        else:
            total_manual += 1

        if o.assignee:
            row = confirmatrices.setdefault(o.assignee.id, {
                "name": o.assignee.name,
                "orders": 0,
                "orders_noest": 0,
                "orders_manual": 0,
                "commission": 0.0,
                "livreur_bonus": 0.0
            })
            row["orders"] += 1
            if is_noest:
                row["orders_noest"] += 1
            else:
                row["orders_manual"] += 1

            comm = (o.total or 0) * pct / 100
            if o.livreur_id or o.livreur:
                comm += _CONFIRMATRICE_LIVREUR_BONUS_DA
                row["livreur_bonus"] += _CONFIRMATRICE_LIVREUR_BONUS_DA
            row["commission"] += comm
        if o.livreur:
            row = livreurs.setdefault(o.livreur.id, {"name": o.livreur.name, "orders": 0, "commission": 0.0})
            row["orders"] += 1
            row["commission"] += fixed

    return {
        "success": True,
        "data": {
            "rates": {"commission_confirmatrice_pct": pct, "commission_livreur_fixed": fixed, "commission_confirmatrice_livreur_bonus": _CONFIRMATRICE_LIVREUR_BONUS_DA},
            "confirmatrices": sorted(confirmatrices.values(), key=lambda r: -r["commission"]),
            "livreurs": sorted(livreurs.values(), key=lambda r: -r["commission"]),
            "total_commandes_livrees": len(orders),
            "commandes_livrees_noest": total_noest,
            "commandes_livrees_manuel": total_manual,
        },
    }


@router.patch("/commissions/config", response_model=dict)
def update_commission_config(
    store_id: str = Body(...),
    commission_confirmatrice_pct: Optional[float] = Body(None),
    commission_livreur_fixed: Optional[float] = Body(None),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    from app.models.store import Store

    if getattr(current_user, "role", None) not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="Store introuvable")

    cfg = dict(store.operations_config or {})
    if commission_confirmatrice_pct is not None:
        cfg["commission_confirmatrice_pct"] = commission_confirmatrice_pct
    if commission_livreur_fixed is not None:
        cfg["commission_livreur_fixed"] = commission_livreur_fixed
    store.operations_config = cfg
    db.commit()
    return {"success": True, "data": cfg}


# ─── GET /orders/{id} ─────────────────────────────────────────────────────────

@router.get("/{id}", response_model=OrderReadFull)
def get_order(
    id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """Get a single order with full details: items, events, assignee, customer."""
    # This endpoint scopes access explicitly via _assert_order_access right
    # below — the header-driven tenant auto-filter is redundant and, on a
    # header/order store_id mismatch (e.g. browsing a user's profile whose
    # active-store context differs from this specific order's store), it
    # silently hides an order that genuinely exists, indistinguishable from
    # "deleted". Same class of bug fixed earlier in list_orders/get_agent_counts.
    db.info["skip_tenant_isolation"] = True
    order = (
        db.query(Order)
        .options(
            # OrderItemRead (schemas/order.py) never serializes item.product —
            # it only exposes the denormalized product_id/product_name/
            # unit_price/image_url already stored on OrderItem itself. Eagerly
            # joining the full Product row (description, SEO fields, variants
            # JSON...) for every item of every order was pure wasted transfer
            # between the backend and Neon, never used downstream.
            joinedload(Order.items),
            joinedload(Order.events).joinedload(OrderEvent.actor),
            joinedload(Order.assignee),
            joinedload(Order.livreur),
            joinedload(Order.carrier),
        )
        .filter(Order.id == id, Order.is_deleted == False)
        .first()
    )
    if not order:
        raise OrderNotFoundError()

    _assert_order_access(order, current_user, db)
    _sync_item_images_from_product(db, [order])

    # Attach merged duplicates for the duplication-history panel
    children = db.query(Order).filter(
        Order.parent_order_id == order.id,
    ).order_by(Order.created_at.asc()).all()

    from app.schemas.order import OrderReadFull as _OrderReadFull, OrderRead as _OrderRead
    result = _OrderReadFull.model_validate(order)
    result.child_orders = [_OrderRead.model_validate(c) for c in children]
    # This order is itself a MERGED child — attach the parent it was
    # absorbed into so the confirmatrice can navigate straight to the
    # order she should actually be confirming/dispatching (see
    # parent_order's docstring in schemas/order.py for why this matters).
    if order.parent_order_id:
        parent = db.query(Order).filter(
            Order.id == order.parent_order_id,
        ).first()
        if parent:
            result.parent_order = _OrderRead.model_validate(parent)
    return result


# ─── GET /orders/{id}/tracking — marketing attribution report ───────────────
# Everything here comes from data already stored on the order + 3 cheap
# lookups by primary/unique key (MetaAdsConfig by store_id, MetaAdsCampaign
# by campaign_id, MetaAdsAdInsight by ad_id) + meta_capi_logs by order_id.
# No Meta API call is ever made here — opening this tab costs 0 network
# requests to Meta, only already-synced local data.

@router.get("/{id}/tracking", response_model=dict)
def get_order_tracking(
    id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    from app.models.marketing import MetaAdsConfig, MetaAdsCampaign, MetaAdsAdInsight, MetaCapiLog

    db.info["skip_tenant_isolation"] = True
    order = db.query(Order).filter(Order.id == id, Order.is_deleted == False).first()
    if not order:
        raise OrderNotFoundError()
    _assert_order_access(order, current_user, db)

    def _or_na(v):
        return v if v not in (None, "") else None

    # ── 1. Origine du trafic — 100% depuis les colonnes déjà stockées sur order ──
    traffic_origin = {
        "source": _or_na(order.source),
        "utm_source": _or_na(order.utm_source),
        "utm_medium": _or_na(order.utm_medium),
        "utm_campaign": _or_na(order.utm_campaign),
        "utm_content": _or_na(order.utm_content),
        "utm_term": _or_na(order.utm_term),
        "referrer": _or_na(order.referrer),
        "landing_page_url": _or_na(order.event_source_url),
        "full_url": _or_na(order.event_source_url),
        "order_time": order.created_at.isoformat() if order.created_at else None,
        # first_page_visited was hardcoded None with a comment claiming
        # "genuinely not captured anywhere" — that was WRONG: the storefront
        # (src/lib/attribution.ts) already captures the true first-touch
        # landing page and sends it on every order submission via
        # attributionPayload(); the field was just silently dropped because
        # no column ever existed to receive it (fixed by the landing_url
        # migration — root cause, not a new capture mechanism).
        "first_page_visited": _or_na(order.landing_url),
        # last_page_before_purchase: no true multi-page browsing history
        # exists (only first-touch + submission-time URL are captured), so
        # this is honestly the same event_source_url already shown above as
        # landing_page_url/full_url — for a single-page landing-page funnel
        # (this business model) that page IS the last one before purchase.
        # Not a distinct capture, not fabricated as one.
        "last_page_before_purchase": _or_na(order.event_source_url),
        "arrival_time": None,
    }

    # ── 2. Informations Meta — order columns + store-level MetaAdsConfig (1 query) ──
    config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == order.store_id).first()
    capi_log = (
        db.query(MetaCapiLog)
        .filter(MetaCapiLog.order_id == order.id, MetaCapiLog.event_name == "Purchase")
        .first()
    )
    meta_info = {
        "pixel_id": _or_na(config.pixel_id) if config else None,
        "event_id": _or_na(capi_log.event_id) if capi_log else None,
        "event_name": _or_na(capi_log.event_name) if capi_log else None,
        "event_time": capi_log.completed_at.isoformat() if capi_log and capi_log.completed_at else None,
        "fbp": _or_na(order.fbp),
        "fbc": _or_na(order.fbc),
        "fbclid": _or_na(order.fbclid),
        "click_id": _or_na(order.fbclid),
        "event_source_url": _or_na(order.event_source_url),
    }

    # ── 3. Campagne Meta — noms résolus par 2 lookups par clé unique, pas de scan ──
    campaign_name = adset_name = ad_name = None
    if order.campaign_id:
        camp = db.query(MetaAdsCampaign.campaign_name).filter(MetaAdsCampaign.campaign_id == order.campaign_id).first()
        campaign_name = camp[0] if camp else None
    if order.ad_id:
        ad_row = db.query(MetaAdsAdInsight.adset_name, MetaAdsAdInsight.ad_name).filter(MetaAdsAdInsight.ad_id == order.ad_id).first()
        if ad_row:
            adset_name, ad_name = ad_row[0], ad_row[1]
    campaign_info = {
        "campaign_name": _or_na(campaign_name),
        "adset_name": _or_na(adset_name),
        "ad_name": _or_na(ad_name),
        "campaign_id": _or_na(order.campaign_id),
        "adset_id": _or_na(order.adset_id),
        "ad_id": _or_na(order.ad_id),
    }

    # ── 4. Qualité du tracking — étapes VÉRIFIABLES seulement. Pixel/Relay/Ads
    # Manager ne sont jamais observables depuis ce backend (voir explication
    # dans chaque champ) — jamais affichés comme ✅/❌ pour ne pas fabriquer
    # une preuve qu'on n'a pas. ──
    erp_ok = True  # la commande existe, trivialement vrai
    queue_ok = capi_log is not None
    capi_ok = capi_log.status == "success" if capi_log else False
    # "Meta accepté" : un statut success signifie que Meta a répondu 200 à
    # notre envoi — c'est une preuve réelle (le code HTTP), pas une supposition.
    meta_accepted = capi_log.status == "success" if capi_log else False

    verifiable_steps = {
        "erp": {"status": "ok" if erp_ok else "fail", "verifiable": True},
        "pixel": {"status": "non_verifiable", "verifiable": False, "reason": "Le Pixel s'exécute uniquement dans le navigateur du client, jamais observable depuis ce backend."},
        "relay": {"status": "non_verifiable", "verifiable": False, "reason": "Le relais frontend n'écrit aucune ligne persistante (fire-and-forget vers Meta) — aucune preuve de passage n'est enregistrée."},
        "queue": {"status": "ok" if queue_ok else "fail", "verifiable": True},
        "capi": {"status": "ok" if capi_ok else ("fail" if capi_log else "not_attempted"), "verifiable": True},
        "meta": {"status": "ok" if meta_accepted else ("fail" if capi_log else "not_attempted"), "verifiable": True},
        "ads_manager": {"status": "non_verifiable", "verifiable": False, "reason": "Aucun accès API Meta Ads Manager configuré dans cet environnement — non vérifiable automatiquement."},
    }
    _checkable = [s for s in verifiable_steps.values() if s["verifiable"]]
    _passed = sum(1 for s in _checkable if s["status"] == "ok")
    tracking_score = round(_passed / len(_checkable) * 100, 1) if _checkable else None

    failure_detail = None
    if capi_log and capi_log.status in ("failed", "retry"):
        failure_detail = {
            "step": "capi",
            "error_message": capi_log.error_message,
            "error_category": capi_log.error_category,
            "http_status": capi_log.last_http_status,
            "retry_count": capi_log.retry_count,
        }

    # ── 5. Timeline — uniquement des timestamps RÉELLEMENT enregistrés.
    # AddToCart/InitiateCheckout ne sont jamais persistés nulle part
    # aujourd'hui (relais fire-and-forget, voir ci-dessus) — absents plutôt
    # qu'inventés. ──
    timeline = [{"time": order.created_at.isoformat(), "label": "Commande créée"}] if order.created_at else []
    if capi_log:
        if capi_log.created_at:
            timeline.append({"time": capi_log.created_at.isoformat(), "label": "Queue créée (CAPI)"})
        if capi_log.processing_started_at:
            timeline.append({"time": capi_log.processing_started_at.isoformat(), "label": "Envoi CAPI en cours"})
        if capi_log.completed_at:
            label = "Meta accepté (Purchase visible)" if capi_log.status == "success" else "CAPI terminé (échec)"
            timeline.append({"time": capi_log.completed_at.isoformat(), "label": label})
    timeline.sort(key=lambda t: t["time"])

    # ── 6. Attribution marketing automatique — règles simples et vérifiables,
    # jamais un pourcentage de confiance inventé sans preuve. ──
    def _classify_source():
        src = (order.utm_source or "").lower()
        medium = (order.utm_medium or "").lower()
        ref = (order.referrer or "").lower()
        if order.fbclid:
            return "Facebook", "Élevée (fbclid présent — preuve de clic publicitaire)"
        if "instagram" in src or "ig" in src.split():
            return "Instagram", "Moyenne (utm_source déclaré)"
        if "facebook" in src or "fb" in src.split() or "meta" in src:
            return "Facebook", "Moyenne (utm_source déclaré, sans fbclid)"
        if "tiktok" in src:
            return "TikTok", "Moyenne (utm_source déclaré)"
        if "google" in src or "google" in ref:
            return "Google", "Moyenne (utm_source/referrer déclaré)"
        if medium == "email":
            return "Email", "Moyenne (utm_medium déclaré)"
        if "whatsapp" in src or "whatsapp" in ref:
            return "WhatsApp", "Moyenne (utm_source/referrer déclaré)"
        if ref and not order.utm_source:
            return "Referral", "Faible (referrer sans UTM)"
        if not ref and not order.utm_source and not order.fbclid:
            return "Direct ou Organique", "Faible (aucun signal d'origine détecté)"
        return "Inconnu", "Aucune (aucune règle ne correspond)"

    attribution_source, attribution_confidence = _classify_source()

    # ── 7. Classification temps réel / backfill (section 1 de la demande) ──
    from app.services.meta_capi import classify_capi_log
    from app.models.audit import AuditLog as _AuditLog
    reference_time = _capi_reference_time(db, order)
    _explicit_backfill = db.query(_AuditLog.id).filter(
        _AuditLog.entity == "order", _AuditLog.entity_id == order.id, _AuditLog.action == "capi_marked_backfill",
    ).first() is not None
    capi_classification = classify_capi_log(capi_log, reference_time, explicit_backfill=_explicit_backfill)
    capi_classification["created_at"] = order.created_at.isoformat() if order.created_at else None
    capi_classification["sent_at"] = capi_log.completed_at.isoformat() if capi_log and capi_log.completed_at else None
    capi_classification["reference_time"] = reference_time.isoformat() if reference_time else None

    # ── 8. Event Match Quality (section 2 de la demande) ──
    from app.services.meta_capi import compute_match_quality
    match_quality = compute_match_quality((capi_log.payload or {}).get("user_data") if capi_log and capi_log.payload else None)

    return {
        "success": True,
        "data": {
            "traffic_origin": traffic_origin,
            "meta_info": meta_info,
            "campaign_info": campaign_info,
            "tracking_quality": {
                "steps": verifiable_steps,
                "score": tracking_score,
                "score_basis": "Calculé uniquement sur les étapes vérifiables (ERP, Queue, CAPI, Meta) — Pixel/Relay/Ads Manager exclus du calcul, non observables depuis ce backend.",
                "failure_detail": failure_detail,
            },
            "capi_classification": capi_classification,
            "match_quality": match_quality,
            "timeline": timeline,
            "attribution": {
                "source": attribution_source,
                "confidence": attribution_confidence,
            },
        },
    }


# ─── Preuve de livraison (photo) ─────────────────────────────────────────────
# Stockée via AuditLog.diff (JSON déjà existant) plutôt qu'une nouvelle
# colonne — même raisonnement d'évitement de migration que ci-dessus.

@router.post("/{id}/delivery-proof", response_model=dict)
async def upload_delivery_proof(
    id: str,
    file: UploadFile = File(...),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    import os as _os
    from app.models.audit import AuditLog

    order = db.query(Order).filter(Order.id == id, Order.is_deleted == False).first()
    if not order:
        raise OrderNotFoundError()

    _os.makedirs("uploads/delivery_proofs", exist_ok=True)
    ext = _os.path.splitext(file.filename or "")[1] or ".jpg"
    filename = f"{id}_{uuid.uuid4().hex}{ext}"
    filepath = _os.path.join("uploads/delivery_proofs", filename)
    with open(filepath, "wb") as f:
        f.write(await file.read())
    url = f"/uploads/delivery_proofs/{filename}"

    db.add(AuditLog(
        id=str(uuid.uuid4()), actor_id=current_user.id, store_id=order.store_id,
        entity="order", entity_id=order.id, action="delivery_proof_uploaded",
        diff={"url": url},
    ))
    db.commit()
    return {"success": True, "url": url}


@router.post("/{id}/override-created-at", response_model=dict)
def override_order_created_at(
    id: str,
    created_at_iso: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    from datetime import datetime as _dt_override
    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER"):
        raise HTTPException(status_code=403, detail="Non autorisé")
    order = db.query(Order).filter(Order.id == id, Order.is_deleted == False).first()
    if not order:
        raise OrderNotFoundError()
    order.created_at = _dt_override.fromisoformat(created_at_iso)
    db.commit()
    return {"success": True, "order_id": order.id, "created_at": order.created_at.isoformat()}


@router.get("/{id}/delivery-proof", response_model=dict)
def get_delivery_proofs(
    id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    from app.models.audit import AuditLog

    logs = (
        db.query(AuditLog)
        .filter(AuditLog.entity == "order", AuditLog.entity_id == id, AuditLog.action == "delivery_proof_uploaded")
        .order_by(AuditLog.created_at.desc())
        .all()
    )
    return {
        "success": True,
        "data": [{"url": (l.diff or {}).get("url"), "date": l.created_at.isoformat() if l.created_at else None} for l in logs],
    }


# ─── GET /orders/{id}/erp-detail — cycle de vie complet + KPI + traçabilité ──
# Assemble ce qui existe déjà ailleurs (OrderEvent, StockMovement, AuditLog)
# en une seule vue par commande. Ne fabrique rien : les sections sans donnée
# réelle (commissions, preuve de livraison photo, documents) sont absentes
# du payload plutôt que renvoyées à zéro/vide comme si elles existaient.

@router.get("/{id}/erp-detail", response_model=dict)
def get_order_erp_detail(
    id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    from app.models.stock import StockMovement
    from app.models.marketing import MetaCapiLog
    from app.models.product import Product

    db.info["skip_tenant_isolation"] = True
    order = (
        db.query(Order)
        .options(joinedload(Order.events).joinedload(OrderEvent.actor), joinedload(Order.livreur), joinedload(Order.assignee), joinedload(Order.items))
        .filter(Order.id == id, Order.is_deleted == False)
        .first()
    )
    if not order:
        raise OrderNotFoundError()
    _assert_order_access(order, current_user, db)

    events = sorted(order.events, key=lambda e: e.created_at or order.created_at)

    # ── Historique des statuts (qui, quand, ancien → nouveau) ──
    status_history = [
        {
            "from_status": e.from_status, "to_status": e.to_status,
            "actor": e.actor.name if e.actor else "Système", "actor_role": e.actor_role,
            "date": e.created_at.isoformat() if e.created_at else None,
            "note": e.note,
        }
        for e in events
    ]

    # ── Historique des appels / confirmations (call_result déjà sur OrderEvent) ──
    call_history = [
        {
            "date": e.created_at.isoformat() if e.created_at else None,
            "actor": e.actor.name if e.actor else "Système",
            "result": e.call_result, "attempt": e.call_attempt, "note": e.note,
            "scheduled_callback_at": e.scheduled_callback_at.isoformat() if e.scheduled_callback_at else None,
        }
        for e in events if e.call_result
    ]

    # ── Mouvements de stock générés par cette commande ──
    movements = (
        db.query(StockMovement).options(joinedload(StockMovement.actor))
        .filter(StockMovement.order_id == id).order_by(StockMovement.created_at.asc()).all()
    )
    product_ids = {m.product_id for m in movements}
    product_names = {}
    warehouse_names = {}
    if product_ids:
        product_names = dict(db.query(Product.id, Product.name).filter(Product.id.in_(product_ids)).all())
    wh_ids = {m.warehouse_id for m in movements if m.warehouse_id}
    if wh_ids:
        from app.models.warehouse import Warehouse
        warehouse_names = dict(db.query(Warehouse.id, Warehouse.name).filter(Warehouse.id.in_(wh_ids)).all())
    stock_movements = [
        {
            "type": m.type, "quantity": m.quantity, "product_name": product_names.get(m.product_id),
            "warehouse_name": warehouse_names.get(m.warehouse_id), "batch_id": m.batch_id,
            "actor": m.actor.name if m.actor else "Système", "reason": m.reason,
            "date": m.created_at.isoformat() if m.created_at else None,
        }
        for m in movements
    ]

    # ── Tracking Meta (résumé, le détail complet vit déjà dans /tracking) ──
    capi_log = db.query(MetaCapiLog).filter(MetaCapiLog.order_id == id, MetaCapiLog.event_name == "Purchase").first()

    # ── KPI temporels — calculés depuis les vrais timestamps des transitions,
    # jamais estimés. Absents (None) si la commande n'a pas encore atteint
    # cette étape plutôt qu'un zéro trompeur. ──
    def _time_to(target_statuses):
        for e in events:
            if e.to_status in target_statuses:
                return e.created_at
        return None

    t_created = order.created_at
    t_confirmed = _time_to(("CONFIRMED",))
    t_shipped = _time_to(("SHIPPED",))
    t_delivered = _time_to(("DELIVERED",))

    def _hours_between(a, b):
        if not a or not b:
            return None
        return round((b - a).total_seconds() / 3600, 1)

    kpis = {
        "temps_creation_confirmation_h": _hours_between(t_created, t_confirmed),
        "temps_confirmation_expedition_h": _hours_between(t_confirmed, t_shipped),
        "temps_expedition_livraison_h": _hours_between(t_shipped, t_delivered),
        "temps_total_cycle_h": _hours_between(t_created, t_delivered),
        "nombre_tentatives_livraison": len([e for e in events if e.to_status == "RESCHEDULED"]) + (1 if t_delivered else 0),
        "nombre_modifications": len(events),
        "valeur_commande": order.total,
        "cout_livraison": order.delivery_fee,
        # Marge/profit nécessitent le cost_price de chaque produit au moment
        # de la vente (non snapshotté sur OrderItem) — calculé au prix
        # ACTUEL du produit, donc une estimation explicitement marquée comme
        # telle, pas un chiffre comptable exact.
    }
    cost_products = 0
    margin_known = True
    _item_product_ids = [it.product_id for it in order.items if it.product_id]
    _cost_by_product_id = dict(
        db.query(Product.id, Product.cost_price).filter(Product.id.in_(_item_product_ids)).all()
    ) if _item_product_ids else {}
    for it in order.items:
        cost_price = _cost_by_product_id.get(it.product_id) if it.product_id else None
        if cost_price is not None:
            cost_products += cost_price * it.quantity
        else:
            margin_known = False
    kpis["cout_produits_estime"] = cost_products if margin_known else None
    kpis["marge_estimee"] = (order.total - cost_products - (order.delivery_fee or 0)) if margin_known else None

    return {
        "success": True,
        "data": {
            "status_history": status_history,
            "call_history": call_history,
            "stock_movements": stock_movements,
            "meta_tracking": {
                "sent": capi_log is not None,
                "status": capi_log.status if capi_log else None,
                "event_id": capi_log.event_id if capi_log else None,
                "error_message": capi_log.error_message if capi_log else None,
            },
            "kpis": kpis,
            "livreur": order.livreur.name if order.livreur else None,
            "assigned_to": order.assignee.name if order.assignee else None,
            # Non trackés — nécessitent une nouvelle fonctionnalité, pas
            # seulement un endpoint (commissions, preuve de livraison photo,
            # documents/factures générés, pièces jointes) :
            "not_tracked": ["commissions", "delivery_proof", "documents", "attachments"],
        },
    }


# ─── POST /orders/{id}/unmerge — Restore a merged duplicate ─────────────────

@router.post("/{id}/unmerge", response_model=dict)
def unmerge_order(
    id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Detach a merged duplicate from its parent: restores the original status
    and clears merge tracking fields. Writes a traceability event.
    """
    import uuid as _uuid
    from app.models.events import OrderEvent as _OrderEvent

    # See get_order for why this is redundant/harmful here — access is
    # already explicitly checked below via _assert_order_access.
    db.info["skip_tenant_isolation"] = True
    order = db.query(Order).filter(Order.id == id, Order.is_deleted == False).with_for_update().first()
    if not order:
        raise OrderNotFoundError()
    _assert_order_access(order, current_user, db)
    if order.status != "MERGED":
        raise HTTPException(status_code=400, detail="Cette commande n'est pas une fusion (statut != MERGED).")

    restored_status = order.status_before_merge or "NEW"
    parent_id = order.parent_order_id

    # Reverse the basket aggregation: remove this child's quantities from the
    # parent's merged basket (stock + totals recomputed), fully reversible.
    if parent_id:
        parent = (
            db.query(Order)
            .filter(Order.id == parent_id, Order.is_deleted == False)
            .with_for_update()
            .first()
        )
        if parent:
            from app.services.order_service import _remove_child_items
            _remove_child_items(db, parent, order, current_user.id)

    order.status = restored_status
    order.parent_order_id = None
    order.merged_by = None
    order.merged_at = None
    order.status_before_merge = None

    # The order becomes operational again — re-reserve its stock
    # (mirrors the release done at merge time)
    if restored_status in ("NEW", "PENDING", "ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"):
        from app.services.inventory_service import inventory_service as _inv
        for item in order.items:
            try:
                _inv.reserve_stock(
                    db,
                    product_id=item.product_id,
                    quantity=item.quantity,
                    order_id=order.id,
                    actor_id=current_user.id,
                    variant_details=item.variant_details,
                )
            except Exception as exc:
                logger.warning("Unmerge: stock re-reservation failed for %s: %s", order.id, exc)

    db.add(_OrderEvent(
        id=str(_uuid.uuid4()),
        order_id=order.id,
        actor_id=current_user.id,
        from_status="MERGED",
        to_status=restored_status,
        note=f"Séparée de la commande parente ({parent_id}) — statut restauré.",
    ))
    db.commit()
    logger.info("Order %s unmerged by %s (restored to %s)", order.order_number, current_user.id, restored_status)
    return {"success": True, "message": f"Commande {order.order_number} séparée, statut restauré à {restored_status}."}


# ─── PATCH /orders/{id} ───────────────────────────────────────────────────────

@router.patch("/{id}", response_model=OrderRead)
def update_order(
    id: str,
    status_update: OrderUpdateStatus,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Update order status/assignment with full state machine validation.
    Stock side effects are applied atomically.
    """
    # See get_order for why this is redundant/harmful here — access is
    # already explicitly checked below via _assert_order_access.
    db.info["skip_tenant_isolation"] = True
    # Row-level lock on the order (separate query: FOR UPDATE is not allowed
    # with the OUTER JOIN produced by joinedload). Serializes concurrent
    # updates on the same order for the whole transaction.
    db.query(Order.id).filter(Order.id == id).with_for_update().first()
    order = (
        db.query(Order)
        .options(joinedload(Order.items))
        .filter(Order.id == id, Order.is_deleted == False)
        .first()
    )
    if not order:
        raise OrderNotFoundError()

    # Captured BEFORE order_service.update_order() mutates `order` in place —
    # needed below to detect a genuine "recovered abandoned cart" transition
    # (ABANDONED is a dead-end status per _VALID_TRANSITIONS once left, so
    # this condition can only be true once per order's lifetime).
    _was_abandoned = str(order.status) == "ABANDONED"

    _assert_order_access(order, current_user, db)

    # A delivery agent can move his parcels through the delivery pipeline
    # (in delivery / delivered / failed-return / cancelled), optionally with
    # a note — never reassign or change anything else.
    # CONFIRMED added (2026-07-21): a courier auto-assignment rule (COMMUNE/
    # WILAYA — see resolve_courier_rule) hands an order directly to a
    # livreur, bypassing the confirmatrice workflow ENTIRELY — no
    # confirmatrice ever touches that order, so no one else can ever move
    # it NEW/ABANDONED -> CONFIRMED. The livreur must be able to do exactly
    # what a confirmatrice would (confirm, cancel, mark returned) for these
    # orders — the one thing he still never does is create the shipment at
    # the carrier (Noest/Yalidine), which stays an explicit admin/
    # confirmatrice action. _VALID_TRANSITIONS still governs which FROM
    # status can legally reach CONFIRMED — this only widens WHO may attempt it.
    if current_user.role == "LIVREUR":
        requested = (status_update.status or "").upper() if status_update.status else None
        # RESCHEDULED = "Reportée" — the driver couldn't deliver today (client
        # absent, reporté à demain...) and hands the order back to the
        # confirmation pipeline instead of forcing a terminal outcome.
        if requested and requested not in ("SHIPPED", "DELIVERED", "RETURNED", "CANCELLED", "RESCHEDULED", "CONFIRMED"):
            raise HTTPException(status_code=403, detail="Statut non autorisé pour un livreur (Confirmée, En livraison, Livrée, Retour, Reportée ou Annulée uniquement).")
        if status_update.assigned_to or status_update.livreur_id:
            raise HTTPException(status_code=403, detail="Un livreur ne peut pas réassigner une commande.")

    # A confirmatrice can manually reassign a cart/order to ANOTHER agent IF AND ONLY IF no actions
    # (calls, NRP attempts, or status progression) have been applied to it yet.
    if current_user.role == "CONFIRMATEUR" and status_update.assigned_to:
        new_target_agent = status_update.assigned_to
        if new_target_agent != order.assigned_to and new_target_agent != current_user.id:
            has_nrp = (order.nrp_count or 0) > 0
            has_call = order.called_at is not None or order.confirmation_start_time is not None
            has_progressed_status = order.status not in ("ABANDONED", "NEW", "ASSIGNED")
            is_unprocessed = not (has_nrp or has_call or has_progressed_status)
            if not is_unprocessed:
                raise HTTPException(
                    status_code=403,
                    detail="Réassignation impossible : ce panier a déjà fait l'objet de tentatives de traitement."
                )

    try:
        updated = order_service.update_order(
            db,
            order=order,
            update_data=status_update.model_dump(exclude_unset=True),
            actor_id=current_user.id,
            actor_name=current_user.name,
            actor_role=current_user.role,
        )
        db.commit()
        db.refresh(updated)

        # A confirmatrice just phoned the customer back and confirmed a cart
        # that was previously abandoned — this WAS fired to Meta as a genuine
        # sale (a real Purchase CAPI, exactly once, idempotency-guarded).
        # Deliberately disabled per SEND_PURCHASE_FOR_RECOVERED_ABANDONED_CARTS
        # (see top of file) — explicit product decision, not a bug: Meta will
        # never learn about these conversions even though they are real sales.
        _REAL_SALE_STATUSES = {"CONFIRMED", "SHIPPED", "DELIVERED"}
        if SEND_PURCHASE_FOR_RECOVERED_ABANDONED_CARTS and _was_abandoned and str(updated.status) in _REAL_SALE_STATUSES:
            try:
                from app.models.marketing import MetaAdsConfig
                meta_config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == updated.store_id).first()
                if meta_config and meta_config.pixel_id and meta_config.access_token:
                    from app.services.meta_capi import send_purchase_for_order, enqueue_purchase_for_order
                    client_ip = request.headers.get("x-forwarded-for") or (request.client.host if request.client else None)
                    user_agent = request.headers.get("user-agent")
                    # Same values as today's synchronous send (the customer's own
                    # session is gone, so this is the confirmatrice's browser —
                    # an existing, unchanged trade-off); persisted so a later
                    # retry of this same Purchase resends the same value instead
                    # of nothing.
                    updated.client_ip = client_ip
                    updated.client_user_agent = user_agent
                    enqueue_purchase_for_order(db, updated)
                    db.commit()
                    background_tasks.add_task(
                        send_purchase_for_order,
                        order_id=str(updated.id),
                        client_ip=client_ip,
                        user_agent=user_agent
                    )
            except Exception as capi_err:
                db.rollback()
                logger.warning(f"Failed to queue Meta CAPI event for phone-confirmed cart {updated.id}: {capi_err}")

        try:
            from app.api.v1.analytics import clear_analytics_cache
            clear_analytics_cache()
        except Exception:
            pass

        full_updated = db.query(Order).options(
            joinedload(Order.assignee),
            joinedload(Order.items),
            joinedload(Order.livreur),
            joinedload(Order.carrier),
            joinedload(Order.store),
        ).filter(Order.id == updated.id).first()
        return full_updated or updated
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating order status: {e}", exc_info=True)
        # Propagate custom exceptions or wrap
        from app.core.exceptions import InsufficientStockError, ProductNotFoundError, InvalidStateTransitionError
        if isinstance(e, (InsufficientStockError, ProductNotFoundError, InvalidStateTransitionError, ValueError)):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ─── PATCH /orders/{id}/info ─────────────────────────────────────────────────

# CANCELLED is editable again: a confirmatrice can fix the details of a
# cancelled order and re-confirm it after winning the client back.
_LOCKED_STATUSES = {"DELIVERED", "RETURNED"}

@router.patch("/{id}/info", response_model=dict)
def update_order_info(
    id: str,
    payload: OrderInfoUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Update editable order fields (customer info, address, fees, tracking).
    Blocked once the order is SHIPPED, DELIVERED, RETURNED or CANCELLED.
    """
    # See get_order for why this is redundant/harmful here — access is
    # already explicitly checked below via _assert_order_access.
    db.info["skip_tenant_isolation"] = True
    order = db.query(Order).filter(Order.id == id, Order.is_deleted == False).with_for_update().first()
    if not order:
        raise OrderNotFoundError()

    _assert_order_access(order, current_user, db)

    # A livreur may correct the customer's own info (name/phone/address/
    # notes/items) on his own orders, matching the confirmatrice — but the
    # carrier relationship (tracking_number, carrier_id) and delivery_fee
    # stay an explicit admin/confirmatrice decision, same boundary as
    # dispatch_order above.
    if current_user.role == "LIVREUR":
        # Compare against the CURRENT stored value, not merely "was the key
        # present" — the frontend always resubmits the full form (including
        # untouched fields), so exclude_unset would 403 every single save.
        _livreur_locked = {
            "tracking_number": order.tracking_number,
            "carrier_id": order.carrier_id,
            "delivery_fee": order.delivery_fee,
        }
        _payload_dict = payload.model_dump(exclude_unset=True)
        for _field, _current_value in _livreur_locked.items():
            if _field in _payload_dict and _payload_dict[_field] != _current_value:
                raise HTTPException(status_code=403, detail="Un livreur ne peut pas modifier le transporteur, le numéro de suivi ou les frais de livraison.")

    # A MERGED order is a dead, absorbed duplicate — its own basket/address/
    # delivery fee are frozen for audit, and _VALID_TRANSITIONS deliberately
    # allows NO outgoing status change from MERGED. Editing it here used to
    # silently succeed (wilaya, commune, carrier, delivery fee all changed
    # article-by-article) while doing NOTHING for the actual order being
    # fulfilled — that lives entirely on parent_order_id instead. Confirmed
  # in production (order #595): a confirmatrice spent 20+ minutes editing a
    # merged child, unaware her changes had no effect on the real shipment.
    if order.status == "MERGED":
        parent = db.query(Order).filter(Order.id == order.parent_order_id).first() if order.parent_order_id else None
        parent_hint = f" Gérez plutôt la commande {parent.order_number}." if parent else ""
        raise HTTPException(
            status_code=400,
            detail=f"Cette commande a été fusionnée dans une autre — elle n'est plus modifiable.{parent_hint}"
        )

    if order.status in _LOCKED_STATUSES:
        if current_user.role in ("SUPER_ADMIN", "ADMIN"):
            pass # SuperAdmin & Admin can edit order info & prices even if status is locked
        elif order.status == "SHIPPED" and not order.tracking_number:
            pass # Allow edit if dispatch failed
        elif order.status == "DELIVERED" and set(payload.model_dump(exclude_unset=True).keys()) <= {"is_upsell"}:
            if payload.is_upsell is not None:
                order.is_upsell = payload.is_upsell
            db.commit()
            db.refresh(order)
            return {"success": True, "id": order.id, "is_upsell": order.is_upsell, "message": "Upsell mis à jour."}
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Impossible de modifier une commande dont le statut est {order.status}."
            )

    # Track changed fields for traceability
    from app.models.events import OrderEvent
    import uuid

    changed_fields = []
    logger.info(f"[DEBUG BACKEND] PATCH /info started for order {id}")
    logger.info(f"[DEBUG BACKEND] Payload received: {payload.model_dump(exclude_unset=True)}")
    logger.info(f"[DEBUG BACKEND] Order state BEFORE update - Total: {order.total}, Subtotal: {order.subtotal}, Delivery Fee: {order.delivery_fee}, Items: {[(i.product_name, i.quantity, i.unit_price) for i in order.items]}")
    
    # 1. Handle items updates and stock side-effects
    if payload.items is not None:
        from app.services.inventory_service import InventoryService
        from app.models.order import OrderItem
        from app.services.order_service import expand_combined_variant_items, _expand_order_item
        inv_svc = InventoryService()

        # Commission upsell (250 DA/produit) : capturé AVANT toute suppression
        # depuis l'état RÉEL de la commande en base — jamais depuis un flag
        # envoyé par le frontend (is_upsell), qui reste vrai tant que le
        # composant n'a pas rechargé originalProductIds et re-déclencherait
        # une commission à chaque nouvelle sauvegarde de la même commande.
        _previous_product_ids = {item.product_id for item in order.items}

        # Release stock for old items. Expanded first: a legacy item can still
        # carry a combined "P1: ... | P2: ..." variant string (e.g. absorbed
        # from a merged duplicate before this was fixed there too) — releasing
        # it as one unit would dump the whole quantity onto whichever variant
        # _find_matching_variant happens to match first, leaving the other
        # variant's reserved count stuck and permanently short.
        for old_item in order.items:
            for sub in _expand_order_item(old_item):
                qty = int(sub.get("quantity") or 0)
                if qty <= 0:
                    continue
                try:
                    if order.status in {"CONFIRMED", "SHIPPED", "DELIVERED"}:
                        inv_svc.return_restock(
                            db,
                            product_id=sub["product_id"],
                            quantity=qty,
                            order_id=order.id,
                            variant_details=sub.get("variant_details")
                        )
                    elif order.status in {"NEW", "ASSIGNED", "CALLED", "ABANDONED", "IN_PROGRESS", "RESCHEDULED"}:
                        inv_svc.release_reservation(
                            db,
                            product_id=sub["product_id"],
                            quantity=qty,
                            order_id=order.id,
                            variant_details=sub.get("variant_details")
                        )
                except Exception as exc:
                    logger.warning(f"Could not release old stock/reservation for item {old_item.id}: {exc}")
                
        # Describe old items for traceability note
        old_items_desc = ", ".join([
            f"{oi.product_name} (x{oi.quantity}) {oi.unit_price} DA" + (f" [{oi.variant_details.get('variant')}]" if oi.variant_details and isinstance(oi.variant_details, dict) and oi.variant_details.get('variant') else "")
            for oi in order.items
        ])
        
        # Delete old items
        for old_item in order.items:
            db.delete(old_item)
        db.flush()
        
        # Clear relationship list
        order.items = []
        
        # Create new items and reserve/deduct stock. Expanded first: the edit
        # drawer sends one line per selected variant already, but this also
        # guards a stray combined "P1: ... | P2: ..." payload (e.g. replayed
        # from a merged duplicate's item) from ever being persisted as one
        # OrderItem again.
        total_amount = 0
        new_items_desc = []
        for item_data in expand_combined_variant_items(payload.items):
            new_item = OrderItem(
                id=str(uuid.uuid4()),
                order_id=order.id,
                **{k: v for k, v in item_data.items() if k in {"product_id", "product_name", "quantity", "unit_price", "variant_details", "image_url"}}
            )
            db.add(new_item)
            order.items.append(new_item)
            total_amount += new_item.quantity * new_item.unit_price
            new_items_desc.append(
                f"{new_item.product_name} (x{new_item.quantity}) {new_item.unit_price} DA" + (f" [{new_item.variant_details.get('variant')}]" if new_item.variant_details and isinstance(new_item.variant_details, dict) and new_item.variant_details.get('variant') else "")
            )
            
            try:
                if order.status in {"CONFIRMED", "SHIPPED", "DELIVERED"}:
                    # reserve first (availability check + reserved +q) then
                    # confirm (stock -q, reserved -q): net effect deducts the
                    # physical stock WITHOUT eating someone else's reservation.
                    inv_svc.reserve_stock(
                        db,
                        product_id=new_item.product_id,
                        quantity=new_item.quantity,
                        order_id=order.id,
                        variant_details=new_item.variant_details
                    )
                    inv_svc.confirm_stock(
                        db,
                        product_id=new_item.product_id,
                        quantity=new_item.quantity,
                        order_id=order.id,
                        variant_details=new_item.variant_details
                    )
                elif order.status in {"NEW", "ASSIGNED", "CALLED", "ABANDONED", "IN_PROGRESS", "RESCHEDULED"}:
                    inv_svc.reserve_stock(
                        db,
                        product_id=new_item.product_id,
                        quantity=new_item.quantity,
                        order_id=order.id,
                        variant_details=new_item.variant_details
                    )
            except Exception as exc:
                logger.warning(f"Could not reserve/deduct stock for new item {new_item.product_id}: {exc}")
                raise HTTPException(status_code=400, detail=f"Stock insuffisant pour {new_item.product_name}: {str(exc)}")
                
        if old_items_desc != ", ".join(new_items_desc) or order.subtotal != total_amount:
            changed_fields.append(f"articles ({old_items_desc} -> {', '.join(new_items_desc)})")
            order.subtotal = total_amount

        # Auto-flag as upsell if the order now contains ONLY upsell products
        _all_product_ids = {item.product_id for item in order.items if item.product_id}
        if _all_product_ids and not order.is_upsell:
            from app.models.product import Product
            _upsell_count = db.query(Product).filter(
                Product.id.in_(_all_product_ids), 
                Product.is_upsell_only == True
            ).count()
            if _upsell_count == len(_all_product_ids):
                order.is_upsell = True
                changed_fields.append("statut upsell automatique activé")


        # Commission upsell — 250 DA par produit upsell RÉELLEMENT ajouté à
        # l'instant (product_id absent de _previous_product_ids), et
        # UNIQUEMENT si ce produit est marqué is_upsell_only=True (un
        # confirmatrice qui ajoute un produit catalogue normal ne déclenche
        # aucune commission upsell — seuls les produits upsell dédiés comptent).
        _newly_added_ids = {
            item.product_id for item in order.items if item.product_id not in _previous_product_ids
        }
        if _newly_added_ids:
            from app.models.upsell import UpsellCommission
            from app.models.product import Product
            _upsell_products = (
                db.query(Product.id, Product.name)
                .filter(Product.id.in_(_newly_added_ids), Product.is_upsell_only == True)
                .all()
            )
            for _prod_id, _prod_name in _upsell_products:
                db.add(UpsellCommission(
                    id=str(uuid.uuid4()), store_id=order.store_id, user_id=current_user.id,
                    order_id=order.id, amount=_UPSELL_COMMISSION_FLAT_DA, is_paid=False,
                ))
                changed_fields.append(f"commission upsell +{_UPSELL_COMMISSION_FLAT_DA} DA ({_prod_name})")

    # Translation dictionary for cleaner logs
    field_labels = {
        "customer_name": "nom",
        "customer_phone": "téléphone",
        "customer_phone2": "téléphone 2",
        "customer_wilaya": "wilaya",
        "customer_commune": "commune",
        "customer_address": "adresse",
        "delivery_fee": "frais de livraison",
        "delivery_type": "type de livraison",
        "carrier_id": "transporteur",
        "notes": "remarques",
        "internal_notes": "notes internes",
        "items": "articles",
        "total": "total",
        "discount": "remise"
    }

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field == "items":
            continue
        if field == "created_at" and value is not None:
            if isinstance(value, str):
                from datetime import datetime as _dt_p
                value = _dt_p.fromisoformat(value.replace("Z", ""))
            setattr(order, "created_at", value)
            changed_fields.append(f"date de création (modifiée vers {value})")
            continue
        if hasattr(order, field):
            old_val = getattr(order, field)
            if old_val != value:
                label = field_labels.get(field, field)
                changed_fields.append(f"{label} ({old_val} -> {value})")
                setattr(order, field, value)

    # A tracking number pasted in without also picking a carrier left
    # carrier_id NULL forever — that order becomes correctly DELIVERED (Noest
    # auto-sync polls by tracking_number, not carrier_id) but invisible in
    # "Performance par Transporteur" (which requires carrier_id == partner.id)
    # even though the storewide delivery chart on the same screen counted it
    # fine. When exactly one active carrier is configured for the store
    # there's no ambiguity to resolve — backfill it automatically.
    if "tracking_number" in data and data.get("tracking_number") and not order.carrier_id:
        from app.models.delivery_partner import DeliveryPartner
        _active_partners = db.query(DeliveryPartner).filter(
            DeliveryPartner.store_id == order.store_id,
            DeliveryPartner.is_active == True,
        ).all()
        if len(_active_partners) == 1:
            order.carrier_id = _active_partners[0].id
            changed_fields.append(f"transporteur (auto-déduit depuis le n° de suivi -> {_active_partners[0].name})")

    # Recalculate grand total: total = subtotal - discount + delivery_fee
    expected_total = (order.subtotal or 0) - (order.discount or 0) + (order.delivery_fee or 0)
    if order.total != expected_total:
        changed_fields.append(f"total ({order.total} -> {expected_total})")
        order.total = expected_total

    logger.info(f"[DEBUG BACKEND] changed_fields detected: {changed_fields}")
    logger.info(f"[DEBUG BACKEND] Order state AFTER update - Total: {order.total}, Subtotal: {order.subtotal}, Delivery Fee: {order.delivery_fee}")
    if changed_fields:
        note = "Modification des détails de la commande : " + ", ".join(changed_fields)
        if len(note) > 500:
            note = note[:497] + "..."
        
        event = OrderEvent(
            id=str(uuid.uuid4()),
            order_id=order.id,
            actor_id=current_user.id,
            from_status=order.status,
            to_status=order.status,
            note=note
        )
        db.add(event)

    db.commit()
    db.refresh(order)
    try:
        from app.api.v1.analytics import clear_analytics_cache
        clear_analytics_cache()
    except Exception as _e:
        pass

    # Return the full updated order so the frontend can sync immediately
    updated_items = []
    for item in (order.items or []):
        updated_items.append({
            "id": item.id,
            "product_id": item.product_id,
            "product_name": item.product_name,
            "sku": None,
            "quantity": item.quantity,
            "unit_price": float(item.unit_price) if item.unit_price else 0,
            "variant_details": item.variant_details,
            "image_url": item.image_url,
        })

    return {
        "success": True,
        "data": {
            "id": order.id,
            "order_number": order.order_number,
            "status": order.status,
            "assigned_to": order.assigned_to,
            "assignee": {
                "id": order.assignee.id,
                "full_name": getattr(order.assignee, "full_name", None) or getattr(order.assignee, "name", None),
                "email": order.assignee.email,
                "role": getattr(order.assignee, "role", None),
            } if order.assignee else None,
            "customer_name": order.customer_name,
            "customer_phone": order.customer_phone,
            "customer_wilaya": order.customer_wilaya,
            "customer_commune": order.customer_commune,
            "customer_address": order.customer_address,
            "delivery_type": order.delivery_type,
            "carrier_id": order.carrier_id,
            "delivery_fee": float(order.delivery_fee) if order.delivery_fee else 0,
            "total": float(order.total) if order.total else 0,
            "notes": order.notes,
            "internal_notes": order.internal_notes,
            "items": updated_items,
        }
    }


# ─── DELETE /orders/{id} ──────────────────────────────────────────────────────

@router.delete("/{id}", response_model=dict)
def delete_order(
    id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Soft-delete an order. Automatically releases stock reservations.
    ADMIN+ only.
    """
    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER"):
        raise PermissionError(message="Seul un administrateur peut supprimer une commande.")

    # See get_order for why this is redundant/harmful here — role check above
    # already gates access.
    db.info["skip_tenant_isolation"] = True
    order = (
        db.query(Order)
        .options(joinedload(Order.items))
        .filter(Order.id == id, Order.is_deleted == False)
        .first()
    )
    if not order:
        raise OrderNotFoundError()

    try:
        order_service.soft_delete(db, order=order, actor_id=current_user.id)
        db.commit()
        return {"success": True, "message": "Commande supprimée avec succès."}
    except Exception as e:
        db.rollback()
        logger.error(f"Error soft-deleting order: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur lors de la suppression de la commande : {str(e)}")


# ─── GET /orders/{id}/events ──────────────────────────────────────────────────

@router.get("/{id}/events", response_model=List[dict])
def get_order_events(
    id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """Full event/audit log for a specific order."""
    # See get_order for why this is redundant/harmful here — access is
    # already explicitly checked below via _assert_order_access. This was
    # the one actually hit in production: an order confirmed to exist in
    # Chic Outfit 404'd as "Commande introuvable" whenever the request's
    # X-Store-Id header didn't match the order's own store_id.
    db.info["skip_tenant_isolation"] = True
    order = db.query(Order).filter(Order.id == id, Order.is_deleted == False).first()
    if not order:
        raise OrderNotFoundError()

    _assert_order_access(order, current_user, db)

    events = (
        db.query(OrderEvent)
        .options(joinedload(OrderEvent.actor))
        .filter(OrderEvent.order_id == id)
        .order_by(OrderEvent.created_at.asc())
        .all()
    )

    return [
        {
            "id": e.id,
            "order_id": e.order_id,
            "actor_id": e.actor_id,
            # actor_role is the role AT THE TIME of the action (persisted on
            # the event); e.actor.role is the actor's CURRENT role, used only
            # as a fallback for events logged before this column existed.
            "actor_role": e.actor_role or (e.actor.role if e.actor else None),
            "from_status": e.from_status,
            "to_status": e.to_status,
            "note": e.note,
            "call_result": e.call_result,
            "call_attempt": e.call_attempt,
            "created_at": e.created_at.isoformat() if e.created_at else None,
            "actor": {"id": e.actor.id, "name": e.actor.name, "avatar": e.actor.avatar, "role": e.actor.role} if e.actor else None,
        }
        for e in events
    ]


# ─── POST /orders/bulk-status ─────────────────────────────────────────────────

@router.post("/bulk-status", response_model=dict)
def bulk_update_status(
    payload: dict,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Batch status update. ADMIN+ only.

    Routed one-by-one through order_service.update_order — the SAME state
    machine validation, stock side effects (RETURN_RESTOCK on a return,
    confirm/release on other transitions), audit event, and idempotency
    guard as the single-order PATCH. This used to run a raw bulk SQL
    UPDATE straight on Order.status, completely bypassing stock: bulk-
    marking orders RETURNED never restocked a single unit, silently
    diverging Product.stock from reality for every order moved this way —
    the exact "duplicated/bypassed stock logic" this endpoint must never
    have. A failure on one order (invalid transition, missing product…)
    is reported per-order and does not abort the rest of the batch.
    """
    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER"):
        raise PermissionError(message="Privilèges insuffisants pour les opérations en masse.")

    order_ids: list = payload.get("order_ids", [])
    new_status: str = payload.get("status", "")

    if not order_ids or not new_status:
        from app.core.exceptions import ValidationError
        raise ValidationError(message="order_ids et status sont requis.")

    updated = 0
    failed: dict = {}
    for order_id in order_ids:
        try:
            # Row-level lock, same as the single-order PATCH — serializes
            # against a concurrent update on the same order.
            db.query(Order.id).filter(Order.id == order_id).with_for_update().first()
            order = (
                db.query(Order)
                .options(joinedload(Order.items))
                .filter(Order.id == order_id, Order.is_deleted == False)
                .first()
            )
            if not order:
                failed[order_id] = "Commande introuvable."
                continue
            _assert_order_access(order, current_user, db)
            order_service.update_order(
                db,
                order=order,
                update_data={"status": new_status},
                actor_id=current_user.id,
                actor_name=getattr(current_user, "name", None),
                actor_role=current_user.role,
            )
            db.commit()
            updated += 1
        except Exception as exc:
            db.rollback()
            failed[order_id] = str(exc)

    logger.info("Bulk status update: %d/%d orders → %s by %s", updated, len(order_ids), new_status, current_user.id)
    return {
        "success": not failed,
        "updated": updated,
        "failed": failed,
        "message": f"{updated} commandes mises à jour." + (f" {len(failed)} échec(s)." if failed else ""),
    }


# ─── POST /orders/{id}/merge-duplicates — Merge duplicate orders ─────────────

@router.post("/{id}/merge-duplicates", response_model=dict)
def merge_duplicate_orders(
    id: str,
    payload: dict,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Merge duplicate orders into a surviving parent order.

    - The parent (id) stays untouched and remains the only shippable order.
    - Each duplicate gets status=MERGED, parent_order_id, merged_by/merged_at,
      and its original status preserved in status_before_merge.
    - An OrderEvent is written on both sides for full traceability.
    - Nothing is deleted — merged orders stay queryable (status=MERGED).
    """
    import uuid as _uuid
    from datetime import datetime, timezone
    from app.models.events import OrderEvent

    # See get_order for why this is redundant/harmful here — access is
    # already explicitly checked below via _assert_order_access.
    db.info["skip_tenant_isolation"] = True
    parent = db.query(Order).filter(Order.id == id, Order.is_deleted == False).with_for_update().first()
    if not parent:
        raise HTTPException(status_code=404, detail="Commande parente introuvable.")
    _assert_order_access(parent, current_user, db)
    if parent.status == "MERGED":
        raise HTTPException(status_code=400, detail="La commande parente est elle-même déjà fusionnée.")

    duplicate_ids: list = payload.get("duplicate_ids") or []
    if not duplicate_ids:
        # Auto-detect: same store + same phone, still in confirmation stage
        candidates = db.query(Order).filter(
            Order.store_id == parent.store_id,
            Order.customer_phone == parent.customer_phone,
            Order.id != parent.id,
            Order.is_deleted == False,
            Order.status.in_(["NEW", "PENDING", "ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"]),
        ).all()
        duplicate_ids = [o.id for o in candidates]

    if not duplicate_ids:
        return {"success": True, "merged": 0, "message": "Aucun doublon à fusionner."}

    from app.services.order_service import merge_child_into_parent

    merged_numbers = []
    for dup_id in duplicate_ids:
        if dup_id == parent.id:
            continue
        dup = db.query(Order).filter(Order.id == dup_id, Order.is_deleted == False).with_for_update().first()
        if not dup:
            continue
        if dup.store_id != parent.store_id:
            raise HTTPException(status_code=400, detail=f"La commande {dup.order_number} appartient à une autre boutique.")
        if dup.status in ("SHIPPED", "DELIVERED", "MERGED"):
            raise HTTPException(status_code=400, detail=f"La commande {dup.order_number} ({dup.status}) ne peut pas être fusionnée.")
        if dup.tracking_number:
            raise HTTPException(status_code=400, detail=f"La commande {dup.order_number} a déjà un colis chez le transporteur.")

        # Shared merge primitive: MERGED child + stock hold moved + basket
        # aggregated into the parent (same product+variant → summed) + events.
        merge_child_into_parent(db, parent, dup, current_user.id, reason="fusion manuelle — doublon même téléphone")
        merged_numbers.append(dup.order_number)

    if merged_numbers:
        parent.is_duplicate = False
        db.add(OrderEvent(
            id=str(_uuid.uuid4()),
            order_id=parent.id,
            actor_id=current_user.id,
            from_status=parent.status,
            to_status=parent.status,
            note=f"Doublons fusionnés dans cette commande : {', '.join(merged_numbers)}.",
        ))

    db.commit()
    logger.info("Merged %d duplicates into order %s by %s", len(merged_numbers), parent.order_number, current_user.id)
    return {
        "success": True,
        "merged": len(merged_numbers),
        "merged_order_numbers": merged_numbers,
        "message": f"{len(merged_numbers)} doublon(s) fusionné(s) dans {parent.order_number}.",
    }


def _get_wilaya_id(wilaya_val: str | int | None) -> Optional[int]:
    if not wilaya_val: return None
    if isinstance(wilaya_val, int): return wilaya_val
    w_str = str(wilaya_val).strip()
    if w_str.isdigit(): return int(w_str)
    
    from app.api.v1.delivery import WILAYAS
    w_lower = w_str.lower()
    for i, w in enumerate(WILAYAS):
        if w.lower() == w_lower:
            return i + 1
    return None

def _clean_commune(commune_val: str | None, wilaya_name: str | None) -> str:
    if not commune_val: 
        return str(wilaya_name) if wilaya_name else "Chef-lieu"
    
    # Split on bullet separator if present
    if "·" in commune_val:
        commune_val = commune_val.split("·")[-1].strip()
        
    # Collapse multiple spaces to single space
    import re
    commune_val = re.sub(r"\s+", " ", commune_val).strip()
    
    # Strip wilaya name prefix (e.g. "Alger Bab Ezzouar" -> "Bab Ezzouar" if wilaya is "Alger")
    if wilaya_name:
        w_clean = wilaya_name.strip()
        if commune_val.lower().startswith(w_clean.lower() + " ") and len(commune_val) > len(w_clean) + 1:
            commune_val = commune_val[len(w_clean) + 1:].strip()
            
    return commune_val

_NOEST_STOPWORDS_FR = {"de", "du", "des", "la", "le", "les", "et", "en", "d", "l", "un", "une"}


def _noest_product_shortcode(product_name: str) -> str:
    """
    'Coussin de Voyage' -> 'cv' — première lettre de chaque mot significatif
    (particules françaises ignorées), en minuscule. But : un libellé court
    et lisible pour le transporteur au lieu du nom complet du produit répété
    pour chaque variante — Noest affiche ce champ tel quel sur le bordereau,
    où l'espace est limité.
    """
    words = re.findall(r"[A-Za-zÀ-ÿ]+", product_name or "")
    letters = [w[0].lower() for w in words if w.lower() not in _NOEST_STOPWORDS_FR]
    code = "".join(letters)
    return code if code else (product_name or "?").strip().lower()[:3]


def _noest_variant_values(variant_details) -> List[str]:
    """
    Réduit variant_details à la liste des VALEURS uniquement, une entrée par
    unité — ex. "P1: Couleur: Noir | P2: Couleur: Noir" -> ["noir", "noir"],
    "Couleur: Bleu, Taille: XL" -> ["bleu / xl"]. Aucun nom de groupe
    ("Couleur:"), aucun préfixe d'unité ("P1:") : Noest n'a besoin que de la
    valeur pour distinguer les stocks, pas de la structure interne de l'ERP.
    """
    if not variant_details:
        return []
    if isinstance(variant_details, dict):
        text = str(variant_details.get("variant")) if "variant" in variant_details else \
            ", ".join(str(v) for v in variant_details.values() if v)
    else:
        text = str(variant_details)
    values: List[str] = []
    for segment in text.split("|"):
        segment = re.sub(r"^\s*P\d+:\s*", "", segment.strip())
        pieces = []
        for pair in segment.split(","):
            pair = pair.strip()
            if not pair:
                continue
            pieces.append(pair.split(":", 1)[1].strip() if ":" in pair else pair)
        if pieces:
            values.append(" / ".join(pieces).lower())
    return values


def _build_noest_product_line(item) -> str:
    """
    Format concis pour le bordereau Noest : "{code}:{variante} x{qté}",
    unités regroupées par variante identique — ex. 2 unités "Coussin de
    Voyage" toutes deux Noir -> "cv:noir x2" au lieu de répéter
    "Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Noir) x2" (verbeux,
    conçu pour la confirmatrice, pas pour un bordereau transporteur — ce
    format détaillé reste inchangé partout ailleurs, notamment dans les
    vues confirmatrice/admin, qui lisent item.variant_details directement).
    """
    code = _noest_product_shortcode(item.product_name)
    values = _noest_variant_values(item.variant_details)
    if not values:
        return f"{code} x{item.quantity}"
    
    counts = Counter(values)
    
    if len(values) == 1 and item.quantity > 1:
        return f"{code}:{values[0]} x{item.quantity}"
        
    return ", ".join(f"{code}:{value} x{count}" for value, count in counts.items())


# ─── POST /orders/{id}/dispatch ────────────────────────────────────────────────

@router.post("/{id}/dispatch", response_model=dict)
async def dispatch_order(
    id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Auto-dispatches a CONFIRMED order to its assigned DeliveryPartner.
    """
    from app.core.exceptions import OrderNotFoundError
    from app.models.delivery_partner import DeliveryPartner

    # A courier-auto-assigned livreur updates status only (see PATCH /{id}) —
    # he never creates the parcel at the carrier himself, that stays an
    # explicit admin/confirmatrice action even on his own orders.
    if current_user.role == "LIVREUR":
        raise HTTPException(status_code=403, detail="Un livreur ne peut pas créer l'expédition chez le transporteur.")

    from sqlalchemy.orm import joinedload
    # See get_order for why this is redundant/harmful here.
    db.info["skip_tenant_isolation"] = True
    # Serialize dispatches on the same order: two concurrent clicks must not
    # create two parcels at the carrier. The second transaction waits here,
    # then sees the tracking number already set.
    db.query(Order.id).filter(Order.id == id).with_for_update().first()
    order = (
        db.query(Order)
        .options(joinedload(Order.items))
        .filter(Order.id == id, Order.is_deleted == False)
        .first()
    )
    if not order:
        raise OrderNotFoundError()

    if order.status == "MERGED":
        raise HTTPException(400, f"Cette commande a été fusionnée (doublon). Expédiez la commande parente à la place.")

    if order.tracking_number:
        raise HTTPException(400, f"Cette commande a déjà un colis chez le transporteur (suivi : {order.tracking_number}).")

    # This endpoint sets order.status = "SHIPPED" via a RAW assignment below
    # (not order_service.update_order) — it never runs the stock matrix, it
    # assumes stock was already physically deducted by an earlier ->CONFIRMED
    # transition. Dispatching a NEW/ASSIGNED order straight from here would
    # ship stock that was never actually confirmed/deducted. A MANUAL order
    # goes through the exact same confirmation workflow as any other order
    # (explicitly confirmed by an agent) — no auto-confirm shortcut, no
    # special-casing by source. Enforced server-side (previously only the
    # frontend gate stopped this; a direct API call could bypass it).
    if order.status != "CONFIRMED":
        if current_user.role in ("SUPER_ADMIN", "ADMIN") and order.status in {"NEW", "ASSIGNED", "CALLED", "RESCHEDULED", "IN_PROGRESS"}:
            from app.services.order_service import update_order_status
            update_order_status(db, order_id=order.id, new_status="CONFIRMED", actor_id=current_user.id)
            db.refresh(order)
        else:
            raise HTTPException(400, "La commande doit être Confirmée avant de créer le colis chez le transporteur.")

    if not order.carrier_id:
        active_partner = db.query(DeliveryPartner).filter(
            DeliveryPartner.store_id == order.store_id,
            DeliveryPartner.is_active == True
        ).first()
        if active_partner:
            order.carrier_id = active_partner.id
        else:
            raise HTTPException(400, "Aucun transporteur n'est assigné à cette commande.")

    partner = db.query(DeliveryPartner).filter(
        DeliveryPartner.id == order.carrier_id,
        DeliveryPartner.is_active == True
    ).first()

    if not partner:
        raise HTTPException(400, "Le transporteur assigné est introuvable ou inactif.")

    computed_subtotal = sum(int(i.quantity or 0) * float(i.unit_price or 0) for i in (order.items or []))
    if computed_subtotal and abs(computed_subtotal - float(order.subtotal or 0)) > 0.01:
        order.subtotal = computed_subtotal
        order.total = max(0, computed_subtotal + float(order.delivery_fee or 0) - float(order.discount or 0))

    details_list = [_build_noest_product_line(item) for item in order.items]
    product_details_str = " | ".join(details_list)
    if len(product_details_str) > 255:
        product_details_str = product_details_str[:252] + "..."
    if not product_details_str:
        product_details_str = order.order_number

    c_id = partner.carrier_id.lower()

    try:
        if c_id == "yalidine":
            from app.api.carriers.yalidine import _creds, _headers, TIMEOUT
            import httpx
            api_id, api_token, base = _creds(partner)
            
            import re
            names = order.customer_name.split() if order.customer_name else ["Client"]
            fname = names[0]
            lname = names[-1] if len(names) > 1 else names[0]

            is_stopdesk_yal = order.delivery_type in ("stop_desk", "OFFICE")
            stopdesk_id = None
            if is_stopdesk_yal:
                m = re.search(r"Bureau Yalidine \(ID:\s*(\d+)\)", order.customer_address or "")
                if m:
                    stopdesk_id = int(m.group(1))

            body = {
                "firstname": fname,
                "familyname": lname,
                "contact_phone": order.customer_phone or "",
                "address": order.customer_address or "",
                "from_wilaya_name": "Alger", 
                "to_wilaya_name": order.customer_wilaya or "",
                "to_commune_name": _clean_commune(order.customer_commune, order.customer_wilaya),
                "product_list": product_details_str,
                "price": float(order.total) if order.total else 0,
                "freeshipping": 0,
                "is_stopdesk": is_stopdesk_yal,
                "stopdesk_id": stopdesk_id,
                "has_exchange": False,
            }
            
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                r = await client.post(
                    f"{base}/parcels/",
                    headers=_headers(api_id, api_token),
                    json=[body],
                )
            
            if r.status_code not in (200, 201):
                raise HTTPException(r.status_code, f"Erreur Yalidine: {r.text[:300]}")
                
            res = r.json()
            parcels = res if isinstance(res, list) else res.get("parcels", [res])
            tracking = (parcels[0] if parcels else {}).get("tracking") or ""
            
            if tracking:
                # Switching internal driver -> carrier: the driver is no
                # longer the source of truth for this delivery. No orphan
                # states: exactly one active delivery method at a time.
                if order.livreur_id:
                    from app.models.events import OrderEvent as _OE
                    import uuid as _uuid2
                    db.add(_OE(id=str(_uuid2.uuid4()), order_id=order.id, actor_id=current_user.id,
                               from_status=order.status, to_status=order.status,
                               note=f"Switch livreur interne -> transporteur (Yalidine) : nouveau tracking {tracking}."))
                    order.livreur_id = None
                order.tracking_number = tracking
                order.status = "SHIPPED"
                db.commit()
                return {"success": True, "tracking_number": tracking, "partner": "yalidine"}
            else:
                raise HTTPException(502, "Yalidine n'a retourné aucun numéro de suivi.")
        elif c_id == "noest":
            from app.api.carriers.noest import _creds, _headers, PROD_BASE, TIMEOUT
            import httpx
            import uuid
            token, guid, base = _creds(partner)
            
            import re
            
            ref = order.order_number
            is_stopdesk_noest = 1 if order.delivery_type in ("stop_desk", "OFFICE") else 0
            station_code = None
            if is_stopdesk_noest:
                match = re.search(r"Bureau Noest\s+([A-Za-z0-9_\-]+)", order.customer_address or "", re.IGNORECASE)
                if match:
                    station_code = match.group(1)
                else:
                    raise HTTPException(
                        status_code=400,
                        detail="Le bureau Noest sélectionné est invalide ou n'a pas été trouvé dans l'adresse. Veuillez modifier la commande pour choisir un bureau relais Noest valide."
                    )

            from app.services.noest_mapping import find_best_commune_match, map_wilaya_name_to_id
            
            customer_wilaya_raw = order.customer_wilaya
            if isinstance(customer_wilaya_raw, str) and not customer_wilaya_raw.isdigit():
                wilaya_id_val = map_wilaya_name_to_id(customer_wilaya_raw)
            elif customer_wilaya_raw:
                wilaya_id_val = int(customer_wilaya_raw)
            else:
                wilaya_id_val = 16
                
            customer_commune_raw = order.customer_commune or ""
            best_commune = await find_best_commune_match(db, partner.store_id, wilaya_id_val, customer_commune_raw)
            if not best_commune:
                best_commune = customer_commune_raw or "Chef-lieu"

            body = {
                "user_guid":  guid,
                "reference":  ref,
                "client":     order.customer_name or "",
                "phone":      order.customer_phone or "",
                "adresse":    order.customer_address or "",
                "wilaya_id":  wilaya_id_val,
                "commune":    best_commune,
                "montant":    order.total or 0,
                "produit":    product_details_str,
                "remarque":   order.notes or "",
                "type_id":    1,
                "stop_desk":  is_stopdesk_noest,
                "station_code": station_code,
                "poids":      0,
                "can_open":   0,
            }
            body = {k: v for k, v in body.items() if v is not None}
            
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                r = await client.post(
                    f"{base}/api/public/create/order",
                    headers=_headers(token),
                    json=body,
                )
                
                # Check if we got validation errors (commune or station_code)
                res_temp = {}
                try:
                    res_temp = r.json()
                except Exception:
                    pass

                err_str = ""
                if r.status_code == 422:
                    err_str = r.text.lower()
                elif r.status_code == 200 and not res_temp.get("success"):
                    err_str = str(res_temp.get("message") or res_temp.get("errors") or "").lower()

                is_commune_err = "commune" in err_str
                is_station_err = "station" in err_str or "valide" in err_str

                # Retry with leading zero stripped if invalid
                if is_station_err and body.get("stop_desk") and isinstance(body.get("station_code"), str):
                    orig_code = body["station_code"]
                    body["station_code"] = orig_code.lstrip("0")
                    r = await client.post(
                        f"{base}/api/public/create/order",
                        headers=_headers(token),
                        json=body,
                    )
                    # update res_temp
                    try:
                        res_temp = r.json()
                    except Exception:
                        pass
                    
                    if r.status_code == 200 and not res_temp.get("success"):
                        err_str = str(res_temp.get("message") or res_temp.get("errors") or "").lower()
                        is_commune_err = "commune" in err_str

                # Retry with fallback if commune is invalid
                if is_commune_err:
                    body["commune"] = order.customer_wilaya or "Chef-lieu"
                    r = await client.post(
                        f"{base}/api/public/create/order",
                        headers=_headers(token),
                        json=body,
                    )

                # 403-with-HTML = Noest's WAF rejected the request BODY, not
                # our access: the tracking poll POSTs to the same host with
                # the same token and passes (see noest_sync logs), so the
                # block is payload-content-triggered (URLs/emojis/special
                # chars in product names, notes or address commonly trip
                # mod_security-style rules). Retry ONCE with the free-text
                # fields sanitized to plain letters/digits before giving up.
                if r.status_code == 403 and "<html" in (r.text or "").lower():
                    _waf_re = re.compile(r"[^0-9A-Za-zÀ-ÿ؀-ۿ\s,.\-()/]")
                    def _waf_safe(s: str, max_len: int = 250) -> str:
                        return _waf_re.sub(" ", s or "").strip()[:max_len]
                    body["produit"] = _waf_safe(body.get("produit", "")) or "Colis"
                    body["remarque"] = _waf_safe(body.get("remarque", ""))
                    body["adresse"] = _waf_safe(body.get("adresse", "")) or "Adresse communiquée par téléphone"
                    body["client"] = _waf_safe(body.get("client", ""), 100) or "Client"
                    r = await client.post(
                        f"{base}/api/public/create/order",
                        headers=_headers(token),
                        json=body,
                    )

            if r.status_code not in (200, 201):
                # Noest fronts its API with a WAF that answers blocked/refused
                # requests with a raw HTML error page — dumping that HTML at
                # the confirmatrice ("Erreur Noest: <html>...") tells her
                # nothing. Map the common cases to actionable French instead.
                _body_txt = r.text or ""
                _is_html = "<html" in _body_txt.lower()
                if r.status_code == 403:
                    _msg = (
                        "Noest a refusé la requête (403 Forbidden) — c'est un blocage côté Noest "
                        "(pare-feu ou token API invalide/expiré), pas un problème de la commande. "
                        "Réessayez dans quelques minutes ; si ça persiste, vérifiez le token Noest "
                        "dans Transporteurs ou contactez le support Noest."
                    )
                elif r.status_code in (500, 502, 503, 504):
                    _msg = (
                        f"Le serveur Noest est momentanément indisponible ({r.status_code}). "
                        "Réessayez dans quelques minutes."
                    )
                elif _is_html:
                    _msg = f"Noest a renvoyé une page d'erreur ({r.status_code}). Réessayez plus tard."
                else:
                    _msg = f"Erreur Noest: {_body_txt[:300]}"
                raise HTTPException(r.status_code, _msg)
                
            res = r.json()
            if not res.get("success"):
                err_msg = res.get("message") or str(res.get("errors") or "Erreur de validation transporteur")
                raise HTTPException(400, f"Erreur Noest: {err_msg}")
                
            tracking = res.get("tracking") or ""
            
            if tracking:
                if order.livreur_id:
                    from app.models.events import OrderEvent as _OE
                    import uuid as _uuid2
                    db.add(_OE(id=str(_uuid2.uuid4()), order_id=order.id, actor_id=current_user.id,
                               from_status=order.status, to_status=order.status,
                               note=f"Switch livreur interne -> transporteur (Noest) : nouveau tracking {tracking}."))
                    order.livreur_id = None
                order.tracking_number = tracking
                order.status = "SHIPPED"
                db.commit()
                return {"success": True, "tracking_number": tracking, "partner": "noest"}
            else:
                raise HTTPException(502, "Noest n'a retourné aucun numéro de suivi.")

        elif c_id == "zr_express":
            from app.api.v1.delivery_partners import zr_push_order
            res = zr_push_order(partner.id, order.id, db, current_user)
            order.status = "SHIPPED"
            db.commit()
            return {"success": True, "tracking_number": order.tracking_number, "partner": "zr_express"}

        else:
            raise HTTPException(400, f"Transporteur {c_id} non supporté pour le dispatch automatique.")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Erreur de communication transporteur : {str(e)}")


# ─── Returns / stock reintegration — audit + KPIs + manual backfill ─────────
# Idempotency note: no new "already processed" flag was added anywhere.
# order_service.update_order() already restocks exactly once per RETURNED
# order via the existing CONFIRMED/SHIPPED/DELIVERED → RETURNED stock
# matrix (was_c and not now_c/now_r → return_restock), and RETURNED is a
# terminal state with zero outgoing transitions in _VALID_TRANSITIONS —
# there is structurally no path to re-enter it and no path to double-fire
# the restock. stock_movements (type=RETURN_RESTOCK) is the durable proof
# it happened, and is exactly what the audit below checks for — reusing it
# instead of adding a redundant boolean column.

@router.get("/returns/audit", response_model=dict)
def audit_returned_orders_stock(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Detects RETURNED orders that were physically deducted (a StockMovement
    row of type ORDER_CONFIRM exists for them — i.e. they were once
    CONFIRMED/SHIPPED/DELIVERED) but never got a RETURN_RESTOCK movement —
    the exact, provable signature of a restock that was silently skipped
    (e.g. by the delivery_partners.py / yalidine.py bypasses fixed
    alongside this feature). An order returned straight from a RESERVED
    state (NEW/ASSIGNED/CALLED → RETURNED) never had physical stock
    deducted in the first place (release_reservation, not return_restock,
    is the correct op for it) — such orders correctly have NO
    RETURN_RESTOCK movement and are NOT flagged here.
    """
    from app.models.stock import StockMovement
    from sqlalchemy import exists as sa_exists

    db.info["skip_tenant_isolation"] = True

    confirm_exists = sa_exists().where(
        StockMovement.order_id == Order.id, StockMovement.type == "ORDER_CONFIRM"
    )
    restock_exists = sa_exists().where(
        StockMovement.order_id == Order.id, StockMovement.type == "RETURN_RESTOCK"
    )

    total_returned = db.query(sqlfunc.count(Order.id)).filter(
        Order.status == "RETURNED", Order.is_deleted == False,
    ).scalar() or 0

    restocked_count = db.query(sqlfunc.count(Order.id)).filter(
        Order.status == "RETURNED", Order.is_deleted == False, restock_exists,
    ).scalar() or 0

    anomalies = (
        db.query(Order.id, Order.order_number, Order.store_id, Order.updated_at, Order.total)
        .filter(Order.status == "RETURNED", Order.is_deleted == False, confirm_exists, ~restock_exists)
        .order_by(Order.updated_at.desc())
        .limit(200)
        .all()
    )

    return {
        "success": True,
        "data": {
            "total_returned": total_returned,
            "restocked": restocked_count,
            "never_restocked_but_expected": len(anomalies),
            "not_applicable_reserved_only": max(0, total_returned - restocked_count - len(anomalies)),
            "anomalies": [
                {
                    "order_id": a.id, "order_number": a.order_number,
                    "store_id": a.store_id, "updated_at": a.updated_at.isoformat() if a.updated_at else None,
                    "total": a.total, "stock_remis": False,
                }
                for a in anomalies
            ],
        },
    }


@router.post("/returns/reintegrate-missing", response_model=dict)
def reintegrate_missing_stock(
    order_ids: Optional[List[str]] = Body(None, embed=True),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Admin tool: reintegrates stock for RETURNED orders flagged by the audit
    above. Idempotent by construction — re-running it after a first
    successful pass finds zero anomalies (each processed order now has a
    RETURN_RESTOCK movement, so the same EXISTS/NOT-EXISTS query that found
    it no longer does), never a double-restock. Reuses
    inventory_service.return_restock — the exact same function the normal
    live transition uses, not a parallel implementation.
    """
    if getattr(current_user, "role", None) not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    from app.models.stock import StockMovement
    from app.services.inventory_service import inventory_service
    from sqlalchemy import exists as sa_exists

    db.info["skip_tenant_isolation"] = True

    confirm_exists = sa_exists().where(
        StockMovement.order_id == Order.id, StockMovement.type == "ORDER_CONFIRM"
    )
    restock_exists = sa_exists().where(
        StockMovement.order_id == Order.id, StockMovement.type == "RETURN_RESTOCK"
    )
    query = db.query(Order).options(joinedload(Order.items)).filter(
        Order.status == "RETURNED", Order.is_deleted == False, confirm_exists, ~restock_exists,
    )
    if order_ids:
        query = query.filter(Order.id.in_(order_ids))
    targets = query.limit(500).all()

    processed, skipped_items, results = 0, 0, []
    for order in targets:
        # Row lock + re-check under lock: two admins clicking "reintegrate"
        # at the same moment must not both restock the same order.
        db.query(Order.id).filter(Order.id == order.id).with_for_update().first()
        still_missing = db.query(
            sa_exists().where(StockMovement.order_id == order.id, StockMovement.type == "RETURN_RESTOCK")
        ).scalar()
        if still_missing:
            continue
        items_done = 0
        for item in order.items:
            if not item.product_id:
                skipped_items += 1
                continue
            try:
                inventory_service.return_restock(
                    db, product_id=item.product_id, quantity=item.quantity,
                    order_id=order.id, actor_id=current_user.id,
                    variant_details=item.variant_details,
                )
                items_done += 1
            except Exception as exc:
                logger.warning("Reintegration failed for order %s item product %s: %s", order.id, item.product_id, exc)
        db.commit()
        processed += 1
        results.append({"order_id": order.id, "order_number": order.order_number, "items_reintegrated": items_done})

    return {
        "success": True,
        "message": f"{processed} commande(s) réintégrée(s), {skipped_items} ligne(s) sans produit lié ignorée(s)",
        "data": {"processed": processed, "skipped_items": skipped_items, "orders": results},
    }


@router.get("/returns/kpis", response_model=dict)
def get_returns_kpis(
    store_id: Optional[str] = Query(None),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    All figures come from stock_movements (type=RETURN_RESTOCK), joined
    once to order_items for financial value (unit_price) and to products
    for names — every aggregate is a single GROUP BY, no per-row Python
    loop, no N+1.
    """
    from datetime import datetime, timedelta
    from sqlalchemy import and_
    from app.models.stock import StockMovement
    from app.models.product import Product

    db.info["skip_tenant_isolation"] = True
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)

    base = db.query(StockMovement).filter(StockMovement.type == "RETURN_RESTOCK")
    if store_id:
        base = base.join(Order, Order.id == StockMovement.order_id).filter(Order.store_id == store_id)

    def _count_and_qty(since):
        q = base.filter(StockMovement.created_at >= since)
        row = q.with_entities(sqlfunc.count(StockMovement.id), sqlfunc.coalesce(sqlfunc.sum(StockMovement.quantity), 0)).first()
        return {"returns": row[0] or 0, "quantity": int(row[1] or 0)}

    totals = base.with_entities(
        sqlfunc.count(sqlfunc.distinct(StockMovement.order_id)),
        sqlfunc.count(StockMovement.id),
        sqlfunc.coalesce(sqlfunc.sum(StockMovement.quantity), 0),
    ).first()

    # Financial value: movement.quantity × the order's own unit_price for
    # that product (join on order_id + product_id — a single grouped query,
    # not a loop per movement).
    value_row = (
        base.join(OrderItem, and_(OrderItem.order_id == StockMovement.order_id, OrderItem.product_id == StockMovement.product_id))
        .with_entities(sqlfunc.coalesce(sqlfunc.sum(StockMovement.quantity * OrderItem.unit_price), 0))
        .first()
    )

    top_products = (
        base.join(Product, Product.id == StockMovement.product_id)
        .with_entities(Product.id, Product.name, sqlfunc.sum(StockMovement.quantity).label("qty"))
        .group_by(Product.id, Product.name)
        .order_by(sqlfunc.sum(StockMovement.quantity).desc())
        .limit(10)
        .all()
    )

    return {
        "success": True,
        "data": {
            "total_returns": totals[0] or 0,
            "total_movements": totals[1] or 0,
            "total_quantity_reintegrated": int(totals[2] or 0),
            "total_value_reintegrated": float(value_row[0] or 0),
            "today": _count_and_qty(today_start),
            "this_week": _count_and_qty(week_start),
            "this_month": _count_and_qty(month_start),
            "top_products": [
                {"product_id": p[0], "product_name": p[1], "quantity_returned": int(p[2] or 0)}
                for p in top_products
            ],
        },
    }


@router.get("/returns/analysis", response_model=dict)
def get_returns_analysis(
    store_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Section "Analyse des retours" — top livreurs / causes / clients, taux de
    retour, valeur perdue (jamais réintégrée). Complète get_returns_kpis
    (qui couvre déjà top_products) sans dupliquer son calcul. Chaque
    agrégat est un GROUP BY unique, aucune boucle Python par ligne.
    """
    from app.core.dates import parse_local_date_filter
    from app.models.stock import StockMovement

    db.info["skip_tenant_isolation"] = True

    base = db.query(Order).filter(Order.status == "RETURNED", Order.is_deleted == False)
    if store_id:
        base = base.filter(Order.store_id == store_id)
    if date_from:
        try:
            base = base.filter(Order.updated_at >= parse_local_date_filter(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            base = base.filter(Order.updated_at <= parse_local_date_filter(date_to))
        except ValueError:
            pass

    total_returned = base.with_entities(sqlfunc.count(Order.id)).scalar() or 0

    delivered_base = db.query(Order).filter(Order.status == "DELIVERED", Order.is_deleted == False)
    if store_id:
        delivered_base = delivered_base.filter(Order.store_id == store_id)
    total_delivered = delivered_base.with_entities(sqlfunc.count(Order.id)).scalar() or 0
    return_rate = round((total_returned / (total_returned + total_delivered)) * 100, 1) if (total_returned + total_delivered) > 0 else 0.0

    top_livreurs = (
        base.filter(Order.livreur_id.isnot(None))
        .join(User, User.id == Order.livreur_id)
        .with_entities(User.id, User.name, sqlfunc.count(Order.id).label("cnt"))
        .group_by(User.id, User.name)
        .order_by(sqlfunc.count(Order.id).desc())
        .limit(10)
        .all()
    )

    top_clients = (
        base.with_entities(Order.customer_phone, Order.customer_name, sqlfunc.count(Order.id).label("cnt"))
        .group_by(Order.customer_phone, Order.customer_name)
        .order_by(sqlfunc.count(Order.id).desc())
        .limit(10)
        .all()
    )

    # Cause = le texte libre saisi sur l'événement de transition vers
    # RETURNED (terminal, donc au plus un par commande) — pas de nouvelle
    # colonne, on réutilise ce qui est déjà tapé par l'agent/livreur, OU
    # (depuis peu, voir noest_sync.py) le libellé d'étape réel transmis par
    # Noest lui-même (ex: "Livraison échouée"). Exclut les deux anciennes
    # notes système génériques ("Synchronisation automatique Noest : X." /
    # "Statut changé : X → Y") qui ne portent aucune information sur le
    # POURQUOI du retour — les laisser ici ne ferait que remplir "Top
    # causes" avec du bruit d'audit au lieu de vraies raisons.
    top_causes = (
        db.query(OrderEvent.note, sqlfunc.count(OrderEvent.id).label("cnt"))
        .filter(
            OrderEvent.to_status == "RETURNED",
            OrderEvent.order_id.in_(base.with_entities(Order.id)),
            OrderEvent.note.isnot(None),
            OrderEvent.note != "",
            ~OrderEvent.note.like("Synchronisation automatique%"),
            ~OrderEvent.note.like("Statut changé :%"),
        )
        .group_by(OrderEvent.note)
        .order_by(sqlfunc.count(OrderEvent.id).desc())
        .limit(10)
        .all()
    )

    # Valeur perdue = commandes retournées jamais réintégrées en stock
    # (même signature que /returns/audit : ORDER_CONFIRM existe, aucun
    # RETURN_RESTOCK n'a suivi) — le montant total de ces commandes.
    from sqlalchemy import exists as sa_exists
    confirm_exists = sa_exists().where(StockMovement.order_id == Order.id, StockMovement.type == "ORDER_CONFIRM")
    restock_exists = sa_exists().where(StockMovement.order_id == Order.id, StockMovement.type == "RETURN_RESTOCK")
    lost_value = (
        base.filter(confirm_exists, ~restock_exists)
        .with_entities(sqlfunc.coalesce(sqlfunc.sum(Order.total), 0))
        .scalar() or 0
    )

    return {
        "success": True,
        "data": {
            "total_returned": total_returned,
            "total_delivered": total_delivered,
            "return_rate_pct": return_rate,
            "top_livreurs": [{"livreur_id": r[0], "name": r[1], "returns": int(r[2])} for r in top_livreurs],
            "top_clients": [{"phone": r[0], "name": r[1], "returns": int(r[2])} for r in top_clients],
            "top_causes": [{"cause": r[0], "count": int(r[1])} for r in top_causes],
            "valeur_perdue": float(lost_value),
        },
    }


@router.get("/returns/list", response_model=dict)
def list_returned_orders(
    store_id: Optional[str] = Query(None),
    livreur_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Section "Analyse des commandes retournées" — une ligne par commande
    RETURNED avec client, livreur, date de livraison, date du retour,
    produits, montant, cause, statut de réintégration, validé par, date
    de réintégration. Toutes les jointures/aggrégats sont faits en 3
    requêtes pour la page entière (commandes+items, événements DELIVERED/
    RETURNED, mouvements RETURN_RESTOCK) — jamais une requête par ligne.
    """
    from app.core.dates import parse_local_date_filter
    from app.models.stock import StockMovement

    db.info["skip_tenant_isolation"] = True

    q = db.query(Order).filter(Order.status == "RETURNED", Order.is_deleted == False)
    if store_id:
        q = q.filter(Order.store_id == store_id)
    if livreur_id:
        q = q.filter(Order.livreur_id == livreur_id)
    if date_from:
        try:
            q = q.filter(Order.updated_at >= parse_local_date_filter(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.filter(Order.updated_at <= parse_local_date_filter(date_to))
        except ValueError:
            pass

    total = q.with_entities(sqlfunc.count(Order.id)).scalar() or 0
    orders = (
        q.options(joinedload(Order.items), joinedload(Order.livreur))
        .order_by(Order.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    order_ids = [o.id for o in orders]

    delivered_events = {}
    return_events = {}
    if order_ids:
        for oid, ts in (
            db.query(OrderEvent.order_id, sqlfunc.max(OrderEvent.created_at))
            .filter(OrderEvent.order_id.in_(order_ids), OrderEvent.to_status == "DELIVERED")
            .group_by(OrderEvent.order_id)
            .all()
        ):
            delivered_events[oid] = ts
        for ev in (
            db.query(OrderEvent.order_id, OrderEvent.note, OrderEvent.created_at)
            .filter(OrderEvent.order_id.in_(order_ids), OrderEvent.to_status == "RETURNED")
            .all()
        ):
            return_events[ev.order_id] = {"cause": ev.note, "returned_at": ev.created_at}

    reintegration = {}
    if order_ids:
        rows = (
            db.query(
                StockMovement.order_id,
                sqlfunc.min(StockMovement.created_at).label("reintegrated_at"),
                sqlfunc.max(StockMovement.actor_id).label("actor_id"),
            )
            .filter(StockMovement.order_id.in_(order_ids), StockMovement.type == "RETURN_RESTOCK")
            .group_by(StockMovement.order_id)
            .all()
        )
        actor_ids = [r.actor_id for r in rows if r.actor_id]
        actors = {}
        if actor_ids:
            actors = {u.id: u.name for u in db.query(User.id, User.name).filter(User.id.in_(actor_ids)).all()}
        for r in rows:
            reintegration[r.order_id] = {
                "reintegrated_at": r.reintegrated_at.isoformat() if r.reintegrated_at else None,
                "validated_by": actors.get(r.actor_id),
            }

    data = []
    for o in orders:
        reint = reintegration.get(o.id)
        ret_ev = return_events.get(o.id)
        data.append({
            "order_id": o.id,
            "order_number": o.order_number,
            "customer_name": o.customer_name,
            "customer_phone": o.customer_phone,
            "livreur": o.livreur.name if o.livreur else None,
            "delivered_at": delivered_events[o.id].isoformat() if o.id in delivered_events else None,
            "returned_at": ret_ev["returned_at"].isoformat() if ret_ev and ret_ev["returned_at"] else (o.updated_at.isoformat() if o.updated_at else None),
            "cause": ret_ev["cause"] if ret_ev else None,
            "products": [
                {"product_id": it.product_id, "product_name": it.product_name, "quantity": it.quantity}
                for it in o.items
            ],
            "total": o.total,
            "reintegration_status": "reintegrated" if reint else "pending",
            "validated_by": reint["validated_by"] if reint else None,
            "reintegrated_at": reint["reintegrated_at"] if reint else None,
        })

    return {
        "success": True,
        "data": data,
        "pagination": {"page": page, "page_size": page_size, "total": total, "pages": (total + page_size - 1) // page_size},
    }


# ─── GET /orders/capi/tracking-quality-v2 — dashboard temps réel/backfill ───
# Section 2/3/4 de la demande : ERP vs Meta avec répartition temps réel /
# backfill / en attente / échec, + mode "Performance réelle" (temps réel
# seul) vs "Performance Meta" (tout, pour matcher exactement ce que Meta
# affiche). Une seule requête groupée sur meta_capi_logs + orders, pas de
# boucle Python par commande pour le compte global (la boucle ne sert qu'à
# classifier les <=200 lignes de la page "problematic_orders" ci-dessous).

@router.get("/capi/tracking-quality-v2", response_model=dict)
def get_capi_tracking_quality_v2(
    store_id: str = Query(...),
    mode: str = Query("meta", pattern="^(meta|realtime)$"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    include_legacy_data: bool = Query(
        False,
        description="Si True, inclut les données antérieures au cutover du 16/07/2026 (nouveau moteur CAPI durable) au lieu de les exclure par défaut.",
    ),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    from datetime import datetime as _dt, timedelta as _td
    from app.models.marketing import MetaCapiLog
    from app.core.dates import parse_local_date_filter
    from app.core.analytics_cache import get_cached, set_cached, DEFAULT_TTL_SECONDS

    _cache_key = f"tracking_quality_v2:{store_id}:{mode}:{date_from}:{date_to}:{include_legacy_data}"
    _cached = get_cached(_cache_key)
    if _cached is not None:
        return _cached

    db.info["skip_tenant_isolation"] = True

    q = (
        db.query(Order, MetaCapiLog)
        .outerjoin(MetaCapiLog, and_(MetaCapiLog.order_id == Order.id, MetaCapiLog.event_name == "Purchase"))
        .filter(
            Order.store_id == store_id, Order.is_deleted == False,
            Order.status.in_(("CONFIRMED", "SHIPPED", "DELIVERED")),
            sqlfunc.coalesce(Order.source, "") != "MANUAL",
        )
    )
    if date_from:
        try:
            q = q.filter(Order.created_at >= parse_local_date_filter(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.filter(Order.created_at <= parse_local_date_filter(date_to))
        except ValueError:
            pass
    # Garde-fou perf : sans borne explicite, une boutique avec des dizaines
    # de milliers de commandes chargerait tout en mémoire. 90 jours par
    # défaut, jamais un scan illimité (voir rapport d'audit, point 6).
    if not date_from and not date_to:
        q = q.filter(Order.created_at >= _dt.now() - _td(days=90))
    rows = q.all()

    # Un seul aller-retour pour tous les OrderEvent ABANDONED->réel de la
    # période (au lieu d'une requête par commande dans la boucle ci-dessous).
    order_ids = [o.id for o, _ in rows]
    abandoned_transitions = {}
    if order_ids:
        for oid, ts in (
            db.query(OrderEvent.order_id, sqlfunc.min(OrderEvent.created_at))
            .filter(OrderEvent.order_id.in_(order_ids), OrderEvent.from_status == "ABANDONED")
            .group_by(OrderEvent.order_id)
            .all()
        ):
            abandoned_transitions[oid] = ts

    from app.services.meta_capi import classify_capi_log_timing
    from app.models.audit import AuditLog as _AuditLog

    explicit_backfill_ids = set()
    if order_ids:
        explicit_backfill_ids = {
            r[0] for r in db.query(_AuditLog.entity_id).filter(
                _AuditLog.entity == "order", _AuditLog.entity_id.in_(order_ids), _AuditLog.action == "capi_marked_backfill",
            ).all()
        }

    realtime_ok, backfill_ok, pending, failed = 0, 0, 0, 0
    for order, log in rows:
        reference = abandoned_transitions.get(order.id, order.created_at)
        if log is None:
            pending += 1
        elif log.status in ("queued", "processing", "retry"):
            pending += 1
        elif log.status == "failed":
            failed += 1
        elif log.status == "success":
            if order.id not in explicit_backfill_ids and classify_capi_log_timing(log.created_at, reference) == "realtime":
                realtime_ok += 1
            else:
                backfill_ok += 1

    total_erp = len(rows)
    meta_purchases = realtime_ok + backfill_ok  # ce que Meta a effectivement reçu et accepté
    performance_count = realtime_ok if mode == "realtime" else meta_purchases
    coverage_pct = round(meta_purchases / total_erp * 100, 1) if total_erp else 0.0
    ecart = total_erp - meta_purchases

    # ── Event Match Quality moyenne + couverture PAR CHAMP (section "Signal
    # Quality Dashboard") — déléguée à MetaAnalyticsEngine, scopée aux MÊMES
    # commandes déjà chargées ci-dessus (order_ids), pour utiliser l'unique
    # implémentation de compute_match_quality plutôt qu'une boucle locale
    # redondante. Le reference-time pour realtime/backfill RESTE local
    # ci-dessus (abandoned_transitions) : c'est une nuance déjà documentée
    # (méthodologie en bas de cette fonction) que le moteur store-wide ne
    # gère pas encore, donc pas migrée pour ne pas régresser silencieusement
    # ce comportement précis.
    from app.services.meta_analytics_engine import compute_meta_metrics
    _emq_since = min((o.created_at for o, _ in rows), default=_dt.now() - _td(days=90))
    _emq_until = _dt.now()
    _m = (
        compute_meta_metrics(db, store_id, _emq_since, _emq_until, order_ids=order_ids, include_legacy_data=include_legacy_data)
        if order_ids else None
    )
    avg_match_quality = _m["event_match_quality"] if _m else None
    signal_field_coverage = _m["field_coverage"] if _m else []
    emq_time_window = _m["time_window"] if _m else None

    # ── Délais moyens du pipeline (commande → confirmation → expédition →
    # livraison, + création → envoi CAPI) — calculés depuis les VRAIS
    # timestamps OrderEvent des commandes déjà chargées : une seule requête
    # groupée supplémentaire, pas de boucle SQL. Clic/visite de landing ne
    # sont capturés nulle part dans la base — délibérément absents plutôt
    # qu'inventés.
    _stage_events: dict = {}
    if order_ids:
        for oid, to_status, ts in (
            db.query(OrderEvent.order_id, OrderEvent.to_status, sqlfunc.min(OrderEvent.created_at))
            .filter(OrderEvent.order_id.in_(order_ids),
                    OrderEvent.to_status.in_(("CONFIRMED", "SHIPPED", "DELIVERED")))
            .group_by(OrderEvent.order_id, OrderEvent.to_status)
            .all()
        ):
            _stage_events.setdefault(oid, {})[to_status] = ts

    def _avg_delay_hours(pairs):
        vals = [(b - a).total_seconds() / 3600 for a, b in pairs if a and b and b >= a]
        return round(sum(vals) / len(vals), 1) if vals else None

    _conf_pairs, _ship_pairs, _deliv_pairs, _capi_pairs = [], [], [], []
    for order, log in rows:
        ev = _stage_events.get(order.id, {})
        _conf_pairs.append((order.created_at, ev.get("CONFIRMED")))
        _ship_pairs.append((ev.get("CONFIRMED"), ev.get("SHIPPED")))
        _deliv_pairs.append((ev.get("SHIPPED"), ev.get("DELIVERED")))
        if log is not None and log.status == "success":
            _capi_pairs.append((order.created_at, log.created_at))
    pipeline_delays = {
        "commande_vers_confirmation_h": _avg_delay_hours(_conf_pairs),
        "confirmation_vers_expedition_h": _avg_delay_hours(_ship_pairs),
        "expedition_vers_livraison_h": _avg_delay_hours(_deliv_pairs),
        "commande_vers_purchase_meta_h": _avg_delay_hours(_capi_pairs),
        "note": "Clic et visite de landing page ne sont pas capturés en base — délais indisponibles pour ces étapes, jamais estimés.",
    }

    # ── Analyse des pertes — pourquoi certaines commandes de la période ne
    # sont PAS dans le décompte Meta. Une seule requête groupée sur les
    # commandes EXCLUES du filtre principal (annulées/fusionnées/manuelles),
    # + les raisons techniques déjà comptées ci-dessus.
    _excluded_q = (
        db.query(Order.status, sqlfunc.coalesce(Order.source, ""), sqlfunc.count(Order.id))
        .filter(
            Order.store_id == store_id, Order.is_deleted == False,
            ~and_(Order.status.in_(("CONFIRMED", "SHIPPED", "DELIVERED")),
                  sqlfunc.coalesce(Order.source, "") != "MANUAL"),
        )
    )
    # Même borne temporelle que la requête principale : quand aucune date
    # n'est fournie, on limite à 90j (garde-fou perf). Filtre construit
    # conditionnellement — passer un bool Python brut à .filter() lève une
    # ArgumentError en SQLAlchemy, d'où ce if explicite plutôt qu'un ternaire.
    if not date_from and not date_to:
        _excluded_q = _excluded_q.filter(Order.created_at >= _dt.now() - _td(days=90))
    _excluded_rows = (
        _excluded_q.group_by(Order.status, sqlfunc.coalesce(Order.source, "")).all()
    )
    loss_analysis = {"annulee": 0, "fusionnee_doublon": 0, "manuelle": 0, "abandonnee": 0, "autre_statut": 0,
                     "en_attente_envoi": pending, "echec_technique": failed}
    for st, src, cnt in _excluded_rows:
        if src == "MANUAL":
            loss_analysis["manuelle"] += cnt
        elif st == "CANCELLED":
            loss_analysis["annulee"] += cnt
        elif st == "MERGED":
            loss_analysis["fusionnee_doublon"] += cnt
        elif st == "ABANDONED":
            loss_analysis["abandonnee"] += cnt
        else:
            loss_analysis["autre_statut"] += cnt

    # ── Learning Score — volume de Purchase reçus par Meta sur 7 jours
    # glissants (indépendant de la période sélectionnée : la phase
    # d'apprentissage de Meta se réévalue en continu sur une fenêtre
    # glissante, pas sur la période du dashboard). Seuils indicatifs basés
    # sur la recommandation générale publique de Meta (~50 conversions/
    # semaine pour sortir de la phase d'apprentissage) — jamais le calcul
    # interne exact de Meta, qu'aucune API n'expose.
    _seven_days_ago = _dt.now() - _td(days=7)
    purchases_7d = (
        db.query(sqlfunc.count(MetaCapiLog.id))
        .join(Order, Order.id == MetaCapiLog.order_id)
        .filter(
            Order.store_id == store_id, MetaCapiLog.event_name == "Purchase",
            MetaCapiLog.status == "success", MetaCapiLog.completed_at >= _seven_days_ago,
        )
        .scalar() or 0
    )
    if purchases_7d < 10:
        learning_status, learning_label = "learning", "Apprentissage"
        learning_explanation = f"Seulement {purchases_7d} Purchase reçu(s) par Meta cette semaine. Meta possède peu de données ; le modèle d'optimisation est encore en apprentissage."
    elif purchases_7d < 50:
        learning_status, learning_label = "limited_learning", "Apprentissage Limité"
        learning_explanation = f"{purchases_7d} Purchase cette semaine — sous le seuil de ~50/semaine généralement recommandé par Meta pour sortir de l'apprentissage."
    elif purchases_7d < 100:
        learning_status, learning_label = "stable", "Stable"
        learning_explanation = f"{purchases_7d} Purchase cette semaine — volume suffisant pour une diffusion stable selon les repères généraux de Meta."
    else:
        learning_status, learning_label = "optimized", "Optimisé"
        learning_explanation = f"{purchases_7d} Purchase cette semaine — volume élevé, Meta dispose de largement assez de données pour optimiser finement la diffusion."

    # ── Note globale /100 + recommandations (section 8) — combinaison
    # transparente de 3 signaux déjà calculés ci-dessus, pondération
    # documentée plutôt qu'une formule opaque.
    recommendations = []
    score_components = []
    score_components.append(coverage_pct)
    if avg_match_quality is not None:
        score_components.append(avg_match_quality)
    failure_rate = round(failed / total_erp * 100, 1) if total_erp else 0.0
    score_components.append(max(0.0, 100 - failure_rate * 5))  # chaque % d'échec pèse lourd
    tracking_score_global = round(sum(score_components) / len(score_components), 1) if score_components else None
    # Label/couleur via les MÊMES bandes que le Signal Quality Center
    # (meta_health_label, via classify()) — la formule reste locale (elle
    # combine coverage_pct/avg_match_quality/failure_rate, propres à cette
    # vue centrée-commandes), mais le vocabulaire Excellent/Bon/.../Critique
    # et sa couleur ne sont plus réinventés en TSX.
    from app.services.meta_analytics_engine import classify
    from app.services.meta_capi import meta_health_label
    tracking_score_classified = classify(tracking_score_global, meta_health_label)
    coverage_pct_classified = classify(coverage_pct, meta_health_label)

    if coverage_pct < 95:
        recommendations.append(f"Couverture à {coverage_pct}% — vérifier les commandes 'manquantes' via /orders/capi/backfill-audit.")
    if avg_match_quality is not None and avg_match_quality < 70:
        recommendations.append(f"Match Quality moyenne à {avg_match_quality}% — email/ville souvent absents, vérifier la collecte au checkout.")
    if failure_rate > 2:
        recommendations.append(f"Taux d'échec CAPI à {failure_rate}% — vérifier la validité du token Meta (voir Santé du Pixel).")
    if backfill_ok > realtime_ok * 0.2 and backfill_ok > 5:
        recommendations.append(f"{backfill_ok} achat(s) en rattrapage — surveiller que le déclencheur temps réel fonctionne pour les nouvelles commandes.")
    # Recommandations dérivées de la couverture par champ — jamais génériques,
    # toujours le champ précis et son pourcentage réel mesuré.
    for fc in signal_field_coverage:
        if fc["coverage_pct"] is not None and fc["coverage_pct"] < 30 and fc["key"] in ("em", "fbc", "fbp"):
            recommendations.append(f"{fc['label']} présent sur seulement {fc['coverage_pct']}% des Purchase — signal de correspondance faible pour Meta.")
    if not recommendations:
        recommendations.append("Aucune anomalie détectée sur la période.")

    _timing_total = realtime_ok + backfill_ok
    result = {
        "success": True,
        "data": {
            "mode": mode,
            "erp_purchases": total_erp,
            "meta_purchases": meta_purchases,
            "realtime": realtime_ok,
            "realtime_pct": round(realtime_ok / _timing_total * 100, 1) if _timing_total else 0.0,
            "backfill": backfill_ok,
            "backfill_pct": round(backfill_ok / _timing_total * 100, 1) if _timing_total else 0.0,
            "pending": pending,
            "failed": failed,
            "avg_match_quality": avg_match_quality,
            "signal_field_coverage": signal_field_coverage,
            "emq_time_window": emq_time_window,
            "pipeline_delays": pipeline_delays,
            "loss_analysis": loss_analysis,
            "learning": {
                "status": learning_status, "label": learning_label,
                "explanation": learning_explanation, "purchases_7d": purchases_7d,
                "note": "Fenêtre glissante de 7 jours, INDÉPENDANTE de la période sélectionnée ci-dessus (la phase d'apprentissage Meta se réévalue en continu, pas sur une période de dashboard). Le diagnostic \"Volume de conversions insuffisant\" affiché dans Diagnostics/Learning est une MOYENNE sur toute la période choisie (7/30/90 jours) — les deux peuvent légitimement afficher un statut différent au même moment sans que ce soit une erreur.",
            },
            "tracking_score": tracking_score_global,
            "tracking_score_classified": tracking_score_classified,
            "recommendations": recommendations,
            "coverage_pct": coverage_pct,
            "coverage_pct_classified": coverage_pct_classified,
            "ecart_reel": ecart,
            "performance_count": performance_count,
            "methodology": "Calculé depuis les commandes ERP (CONFIRMED/SHIPPED/DELIVERED, hors MANUAL) jointes à meta_capi_logs sur la période sélectionnée — realtime/backfill classés par écart entre l'envoi CAPI et la création de la commande OU la reprise d'un panier abandonné (référence différente de Signal Quality Center, qui utilise toujours la création de commande).",
            # Population de CETTE vue (centrée-commandes ERP), pour comparer
            # avec les autres écrans qui partent de meta_capi_logs directement
            # (population différente = nombre différent, normal) :
            "population": f"{total_erp} commande(s) ERP confirmée(s)/expédiée(s)/livrée(s) sur la période — dont {_m['sample_size'] if _m else 0} avec payload CAPI exploitable pour le Match Quality.",
        },
    }
    set_cached(_cache_key, result, DEFAULT_TTL_SECONDS)
    return result


# ─── GET /orders/capi/list — commandes filtrées par statut d'envoi CAPI ────
# Section 6 : filtres temps réel / backfill / en attente / succès / échec /
# retrying / skipped, pour les commandes ET le dashboard.

@router.get("/capi/list", response_model=dict)
def list_orders_by_capi_status(
    store_id: str = Query(...),
    capi_filter: str = Query(..., pattern="^(realtime|backfill|pending|success|failed|retrying|skipped)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    from app.models.marketing import MetaCapiLog
    from app.services.meta_capi import classify_capi_log_timing

    db.info["skip_tenant_isolation"] = True

    base = (
        db.query(Order, MetaCapiLog)
        .outerjoin(MetaCapiLog, and_(MetaCapiLog.order_id == Order.id, MetaCapiLog.event_name == "Purchase"))
        .filter(Order.store_id == store_id, Order.is_deleted == False)
    )

    # Filtres directement en base pour tout sauf realtime/backfill (qui
    # dépendent d'un calcul par ligne — voir classify_capi_log_timing).
    _STATUS_FILTERS = {"pending": ("queued", "processing"), "failed": ("failed",), "retrying": ("retry",), "skipped": ("skipped",), "success": ("success",)}
    if capi_filter in _STATUS_FILTERS:
        base = base.filter(MetaCapiLog.status.in_(_STATUS_FILTERS[capi_filter]))
        total = base.count()
        rows = base.order_by(Order.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    else:
        # realtime / backfill : filtre sur des succès uniquement, classifiés
        # par écart de temps — nécessite de parcourir les lignes matching
        # (limité aux commandes déjà 'success', pas toute la table).
        from app.models.audit import AuditLog as _AuditLog
        base = base.filter(MetaCapiLog.status == "success")
        candidates = base.order_by(Order.created_at.desc()).limit(2000).all()
        oids = [o.id for o, _ in candidates]
        abandoned_transitions = {}
        explicit_backfill_ids = set()
        if oids:
            for oid, ts in (
                db.query(OrderEvent.order_id, sqlfunc.min(OrderEvent.created_at))
                .filter(OrderEvent.order_id.in_(oids), OrderEvent.from_status == "ABANDONED")
                .group_by(OrderEvent.order_id).all()
            ):
                abandoned_transitions[oid] = ts
            explicit_backfill_ids = {
                r[0] for r in db.query(_AuditLog.entity_id).filter(
                    _AuditLog.entity == "order", _AuditLog.entity_id.in_(oids), _AuditLog.action == "capi_marked_backfill",
                ).all()
            }
        filtered = []
        for order, log in candidates:
            reference = abandoned_transitions.get(order.id, order.created_at)
            timing = "backfill" if order.id in explicit_backfill_ids else classify_capi_log_timing(log.created_at, reference)
            if timing == capi_filter:
                filtered.append((order, log))
        total = len(filtered)
        rows = filtered[(page - 1) * page_size: page * page_size]

    data = [
        {
            "order_id": o.id, "order_number": o.order_number, "customer_name": o.customer_name,
            "status": o.status, "total": o.total, "created_at": o.created_at.isoformat() if o.created_at else None,
            "capi_status": log.status if log else None,
            "capi_sent_at": log.completed_at.isoformat() if log and log.completed_at else None,
        }
        for o, log in rows
    ]
    return {"success": True, "data": data, "pagination": {"page": page, "page_size": page_size, "total": total}}


# ─── CAPI backfill — historical "jamais tenté" gap ──────────────────────────
# The "Purchase never fired" gap on the tracking-quality dashboard was mostly
# ABANDONED carts recovered by a confirmatrice through a plain status PATCH,
# a path that had no CAPI trigger until it was added to update_order()
# (_was_abandoned / _REAL_SALE_STATUSES, above). That fix only fires for
# transitions happening FROM NOW ON — every order that already left ABANDONED
# before this code existed is permanent unexplained debt unless backfilled
# once, here, exactly like /returns/reintegrate-missing backfills historical
# stock. Also covers any other pre-fix gap uniformly (missed config, past
# outage) since the condition is simply "real sale, zero Purchase log row".

# Fenêtre officielle Meta Conversions API : un event_time de plus de 7
# jours dans le passé est rejeté par Meta (doc :
# developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event).
# Comme le correctif event_time (voir meta_capi.py) envoie désormais la
# VRAIE date de la commande — jamais l'heure actuelle — une commande plus
# vieille que 7 jours n'est structurellement plus rattrapable par CAPI.
# Ce n'est pas contourné en trichant sur la date ; l'ordre est simplement
# retiré du backfill actionnable, honnêtement étiqueté "hors fenêtre Meta".
META_CAPI_EVENT_TIME_WINDOW_DAYS = 7


@router.get("/capi/backfill-audit", response_model=dict)
def audit_missing_capi(
    store_id: Optional[str] = Query(None),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    from datetime import datetime as _dt, timedelta as _td
    from sqlalchemy import exists as sa_exists
    from app.models.marketing import MetaCapiLog, MetaAdsConfig

    db.info["skip_tenant_isolation"] = True

    capi_success_exists = sa_exists().where(
        MetaCapiLog.order_id == Order.id, MetaCapiLog.event_name == "Purchase", MetaCapiLog.status == "success",
    )
    q = db.query(Order.id, Order.order_number, Order.store_id, Order.status, Order.updated_at, Order.created_at).filter(
        Order.status.in_(("CONFIRMED", "SHIPPED", "DELIVERED")),
        Order.is_deleted == False,
        sqlfunc.coalesce(Order.source, "") != "MANUAL",
        sqlfunc.coalesce(Order.source, "") != "POS",
        ~capi_success_exists,
    )
    if store_id:
        q = q.filter(Order.store_id == store_id)

    missing = q.order_by(Order.updated_at.desc()).limit(500).all()

    # Only orders whose store actually has a Meta config are truly
    # actionable — the rest would just fail again for the same reason
    # send_purchase_for_order already silently no-ops on them.
    configured_store_ids = {
        s for (s,) in db.query(MetaAdsConfig.store_id).filter(
            MetaAdsConfig.pixel_id.isnot(None), MetaAdsConfig.access_token.isnot(None),
        ).all()
    }
    cutoff = _dt.utcnow() - _td(days=META_CAPI_EVENT_TIME_WINDOW_DAYS)
    with_config = [m for m in missing if m.store_id in configured_store_ids]
    actionable = [m for m in with_config if m.created_at and m.created_at >= cutoff]
    out_of_window = [m for m in with_config if not (m.created_at and m.created_at >= cutoff)]

    return {
        "success": True,
        "data": {
            "total_missing": len(missing),
            "actionable": len(actionable),
            "out_of_window": len(out_of_window),
            "out_of_window_reason": f"Commande créée il y a plus de {META_CAPI_EVENT_TIME_WINDOW_DAYS} jours — Meta rejette tout event_time hors de cette fenêtre, non contournable sans mentir sur la date réelle.",
            "orders": [
                {"order_id": m.id, "order_number": m.order_number, "store_id": m.store_id, "status": m.status, "updated_at": m.updated_at.isoformat() if m.updated_at else None}
                for m in actionable
            ],
        },
    }


@router.post("/capi/backfill-missing", response_model=dict)
def backfill_missing_capi(
    background_tasks: BackgroundTasks,
    request: Request,
    order_ids: Optional[List[str]] = Body(None, embed=True),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    import time as _time
    from datetime import datetime as _dt, timezone as _tz, timedelta
    from sqlalchemy import exists as sa_exists
    from app.models.marketing import MetaCapiLog, MetaAdsConfig
    from app.models.audit import AuditLog
    from app.services.meta_capi import send_purchase_for_order, enqueue_purchase_for_order

    if getattr(current_user, "role", None) not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    db.info["skip_tenant_isolation"] = True
    run_started_at = _dt.now(_tz.utc)
    _t0 = _time.monotonic()

    capi_success_exists = sa_exists().where(
        MetaCapiLog.order_id == Order.id, MetaCapiLog.event_name == "Purchase", MetaCapiLog.status == "success",
    )
    cutoff = _dt.now(_tz.utc).replace(tzinfo=None) - timedelta(days=META_CAPI_EVENT_TIME_WINDOW_DAYS)
    q = db.query(Order).filter(
        Order.status.in_(("CONFIRMED", "SHIPPED", "DELIVERED")),
        Order.is_deleted == False,
        sqlfunc.coalesce(Order.source, "") != "MANUAL",
        sqlfunc.coalesce(Order.source, "") != "POS",
        Order.created_at >= cutoff,  # hors de cette fenêtre = Meta rejette l'event_time réel, non contournable
        ~capi_success_exists,
    )
    if order_ids:
        q = q.filter(Order.id.in_(order_ids))
    targets = q.limit(500).all()
    analyzed = len(targets)

    client_ip = request.headers.get("x-forwarded-for") or (request.client.host if request.client else None)
    user_agent = request.headers.get("user-agent")

    # Envoi SYNCHRONE (pas background_tasks) — volontaire : un backfill est
    # une opération de maintenance rare déclenchée par un admin, jamais sur
    # le chemin critique d'une requête utilisateur. La contrepartie, en
    # échange d'une réponse plus lente, c'est de connaître le VRAI résultat
    # (succès/échec) de chaque envoi avant de répondre — indispensable pour
    # que l'historique des opérations (section 5) rapporte des chiffres
    # réels, pas juste "mis en file" sans savoir ce qui s'est passé ensuite.
    queued, skipped_no_config, success_count, error_count = 0, 0, 0, 0
    for order in targets:
        # Row lock + re-check under lock — same double-fire guard pattern
        # used by /returns/reintegrate-missing.
        db.query(Order.id).filter(Order.id == order.id).with_for_update().first()
        already_sent = db.query(
            sa_exists().where(
                MetaCapiLog.order_id == order.id, MetaCapiLog.event_name == "Purchase", MetaCapiLog.status == "success",
            )
        ).scalar()
        if already_sent:
            continue
        config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == order.store_id).first()
        if not config or not config.pixel_id or not config.access_token:
            skipped_no_config += 1
            continue
        try:
            enqueue_purchase_for_order(db, order)
            db.commit()
            queued += 1
            # Marquage EXPLICITE "rattrapage" (section 2 : tracking_source =
            # backfill) — enregistré ICI, avant l'envoi, pas déduit après
            # coup par un écart de temps. Destiné à notre ERP uniquement,
            # n'affecte jamais ce qui est transmis à Meta.
            db.add(AuditLog(
                id=str(uuid.uuid4()), actor_id=current_user.id, store_id=order.store_id,
                entity="order", entity_id=order.id, action="capi_marked_backfill",
                diff={"order_created_at": order.created_at.isoformat() if order.created_at else None},
            ))
            db.commit()
            send_purchase_for_order(order_id=str(order.id), client_ip=client_ip, user_agent=user_agent)
            final_status = db.query(MetaCapiLog.status).filter(
                MetaCapiLog.order_id == order.id, MetaCapiLog.event_name == "Purchase",
            ).scalar()
            if final_status == "success":
                success_count += 1
            elif final_status in ("failed", "retry"):
                error_count += 1
        except Exception as exc:
            db.rollback()
            error_count += 1
            logger.warning("CAPI backfill failed to queue order %s: %s", order.id, exc)

    duration_s = round(_time.monotonic() - _t0, 1)

    # Traçabilité complète de l'opération (section 5) — via AuditLog.diff,
    # aucune nouvelle table, même raisonnement que les commissions/preuve de
    # livraison plus haut dans cette session.
    db.add(AuditLog(
        id=str(uuid.uuid4()), actor_id=current_user.id, store_id=None,
        entity="capi_backfill", entity_id=str(uuid.uuid4()), action="capi_backfill_run",
        diff={
            "date": run_started_at.isoformat(), "analyzed": analyzed, "queued": queued,
            "success": success_count, "errors": error_count, "skipped_no_config": skipped_no_config,
            "duration_seconds": duration_s, "order_ids_filter": order_ids,
        },
    ))
    db.commit()

    return {
        "success": True,
        "message": f"{queued} commande(s) traitée(s) : {success_count} succès, {error_count} erreur(s), {skipped_no_config} sans config Meta",
        "data": {
            "analyzed": analyzed, "queued": queued, "success": success_count,
            "errors": error_count, "skipped_no_config": skipped_no_config, "duration_seconds": duration_s,
        },
    }


@router.get("/capi/backfill-history", response_model=dict)
def get_backfill_history(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """Section 5 — historique complet des opérations de backfill CAPI, lu
    depuis AuditLog (écrit par backfill_missing_capi ci-dessus)."""
    from app.models.audit import AuditLog

    db.info["skip_tenant_isolation"] = True
    logs = (
        db.query(AuditLog).options(joinedload(AuditLog.actor))
        .filter(AuditLog.action == "capi_backfill_run")
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "success": True,
        "data": [
            {
                "id": l.id, "date": (l.diff or {}).get("date") or (l.created_at.isoformat() if l.created_at else None),
                "actor": l.actor.name if l.actor else "Système",
                "analyzed": (l.diff or {}).get("analyzed", 0), "queued": (l.diff or {}).get("queued", 0),
                "success": (l.diff or {}).get("success", 0), "errors": (l.diff or {}).get("errors", 0),
                "skipped_no_config": (l.diff or {}).get("skipped_no_config", 0),
                "duration_seconds": (l.diff or {}).get("duration_seconds"),
            }
            for l in logs
        ],
    }
