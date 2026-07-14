# ═══════════════════════════════════════════════════════════════
# AzzougShop — Orders Router (Refactored)
# FastAPI is now the SOLE backend. All business logic lives here.
# Next.js Route Handlers at /api/v1/orders/* are deprecated.
# ═══════════════════════════════════════════════════════════════

from __future__ import annotations

import logging
from typing import Any, List, Optional
import uuid

from fastapi import APIRouter, Depends, Query, Request, HTTPException, BackgroundTasks
from sqlalchemy import func as sqlfunc
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


def _confirmateur_scope_criterion(user: User):
    """SQLAlchemy criterion version of the scope, for list/count queries."""
    from sqlalchemy import or_
    from app.models.order import OrderItem

    raw_products = getattr(user, "assigned_product_ids", None)
    products = raw_products if isinstance(raw_products, list) else []
    stores = _confirmateur_resolved_stores(user)

    crits = []
    if stores:
        crits.append(Order.store_id.in_(stores))
    if products:
        crits.append(Order.items.any(OrderItem.product_id.in_(products)))

    if not crits:
        return False  # nothing configured → no unassigned visibility (strict isolation)
    return or_(*crits) if len(crits) > 1 else crits[0]


def _confirmateur_scope_ok(order: Order, user: User) -> bool:
    """Python version of the same scope, for single-order access checks."""
    raw_products = getattr(user, "assigned_product_ids", None)
    products = raw_products if isinstance(raw_products, list) else []
    stores = _confirmateur_resolved_stores(user)

    if not stores and not products:
        return False  # nothing configured → no unassigned visibility (strict isolation)

    store_ok = bool(stores) and order.store_id in stores
    product_ok = bool(products) and any(item.product_id in products for item in (order.items or []))
    return store_ok or product_ok


def _assert_order_access(order: Order, current_user: User) -> None:
    """
    CONFIRMATEUR can access orders assigned to them, or unassigned orders in
    their responsibility scope (see _confirmateur_scope_criterion).
    MANAGER can only access orders in their store.
    ADMIN/SUPER_ADMIN: full access.
    """
    if current_user.role == "CONFIRMATEUR":
        is_assigned = order.assigned_to == current_user.id
        is_unassigned = order.assigned_to == None

        # A confirmatrice can access an order if:
        # 1. It is assigned to them
        # 2. It is unassigned and inside their responsibility scope
        is_accessible = is_assigned or (is_unassigned and _confirmateur_scope_ok(order, current_user))

        if not is_accessible:
            raise PermissionError(message="Accès refusé à cette commande.")
    elif current_user.role == "MANAGER":
        if current_user.employee_store_id and order.store_id != current_user.employee_store_id:
            raise PermissionError(message="Accès refusé : commande hors de votre boutique.")
    elif current_user.role == "LIVREUR":
        # A delivery agent only sees the orders handed to them
        if order.livreur_id != current_user.id:
            raise PermissionError(message="Accès refusé : cette livraison ne vous est pas assignée.")


def _sync_item_images_from_product(orders) -> None:
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
    """
    for order in orders:
        for item in (order.items or []):
            product = getattr(item, "product", None)
            if product is not None and getattr(product, "main_image", None):
                item.image_url = product.main_image


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
    db: Session = Depends(deps.get_db),
    _: User = Depends(deps.get_current_active_user),
):
    """Returns order counts per status for the tab badge display."""
    rows = (
        db.query(Order.status, sqlfunc.count(Order.id).label("cnt"))
        .filter(Order.store_id == store_id, Order.is_deleted == False)
        .group_by(Order.status)
        .all()
    )
    return {r.status: r.cnt for r in rows}


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
        scope_crit = _confirmateur_scope_criterion(current_user)
        base = base_query.filter(or_(
            Order.assigned_to == current_user.id,
            and_(Order.assigned_to == None, scope_crit),
        ))
        base_wide = base_query.filter(scope_crit)
    elif current_user.role == "MANAGER" and current_user.employee_store_id:
        base = base_query.filter(Order.store_id == current_user.employee_store_id)
        base_wide = base
    else:
        base = base_query
        base_wide = base_query

    if store_id:
        base = base.filter(Order.store_id == store_id)
        base_wide = base_wide.filter(Order.store_id == store_id)
    for bound, op_gte in ((start_date, True), (end_date, False)):
        if bound:
            try:
                dt = datetime.fromisoformat(bound.replace("Z", "+00:00")).replace(tzinfo=None)
                base = base.filter(Order.created_at >= dt if op_gte else Order.created_at <= dt)
                base_wide = base_wide.filter(Order.created_at >= dt if op_gte else Order.created_at <= dt)
            except ValueError:
                pass

    def _count(*criteria):
        return base.filter(*criteria).count()

    def _count_wide(*criteria):
        return base_wide.filter(*criteria).count()

    # Mirror of list_orders' exclusion: an order handed to an internal
    # delivery agent counts ONLY in internal_delivery, never in the
    # confirmation-stage badges — else the sidebar numbers disagree with
    # what each module actually lists.
    _not_internal = or_(
        Order.livreur_id.is_(None),
        and_(Order.tracking_number.isnot(None), Order.tracking_number != ""),
    )

    counts = {
        "all":       base.filter(Order.status.notin_(["CANCELLED", "RETURNED"])).count(),
        "new":       _count(_not_internal, Order.status.in_(["NEW", "ASSIGNED"])),
        "pending":   _count(
            _not_internal,
            Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"]),
            or_(Order.nrp_count == None, Order.nrp_count == 0),
        ),
        "confirmed": _count(_not_internal, Order.status == "CONFIRMED"),
        "shipped":   _count_wide(Order.status == "SHIPPED"),
        "delivered": _count_wide(Order.status == "DELIVERED"),
        # The sidebar's "Retournées" badge (agent-dashboard.tsx) looks up
        # counts['returned'] — this key never existed, so that lookup was
        # always undefined ?? 0, and the badge's `count > 0` render guard
        # was permanently false. The badge wasn't wrong, it was invisible.
        "returned":  _count_wide(Order.status == "RETURNED"),
        "cancelled": _count_wide(Order.status == "CANCELLED"),
        "nrp":       _count(_not_internal, Order.nrp_count > 0, Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"])),
        "nrp_abandoned": _count(_not_internal, Order.nrp_count > 0, Order.is_abandoned_cart == True,
                                Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"])),
        "nrp_normal": _count(_not_internal, Order.nrp_count > 0, Order.is_abandoned_cart == False,
                             Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"])),
        "abandoned_in_progress": _count(_not_internal, Order.is_abandoned_cart == True,
                                        Order.status.notin_(["CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"])),
        "recovered": _count(Order.is_abandoned_cart == True, Order.status.in_(["CONFIRMED", "SHIPPED", "DELIVERED"])),
        # Noest's own real-time carrier stage (see CARRIER_STAGE_BUCKETS) —
        # scoped to SHIPPED since that's the only state a carrier_stage is
        # meaningful for (before dispatch there's nothing to poll; after
        # DELIVERED/RETURNED our own status already says so). Store-wide
        # (_count_wide) for the same reason as shipped/delivered/returned.
        **{
            f"carrier_{bucket}": _count_wide(Order.status == "SHIPPED", Order.carrier_stage.in_(keys))
            for bucket, keys in CARRIER_STAGE_BUCKETS.items()
        },
        "internal_delivery": _count_wide(
            Order.livreur_id.isnot(None),
            or_(Order.tracking_number == None, Order.tracking_number == ""),
            Order.status.notin_(["DELIVERED", "RETURNED", "MERGED"]),
        ),
        "archived":  _count_wide(Order.status.in_(["CANCELLED", "RETURNED"])),
        # Rappels dus maintenant : NRP en cours (commande ou panier abandonné)
        # sans heure de rappel programmée, ou dont l'heure est déjà passée.
        "recall": _count(
            _not_internal,
            Order.nrp_count > 0,
            Order.status.in_(["IN_PROGRESS", "CALLED", "RESCHEDULED", "ASSIGNED", "ABANDONED"]),
            or_(Order.next_callback_time == None, Order.next_callback_time <= datetime.now(timezone.utc).replace(tzinfo=None)),
        ),
    }
    return {"success": True, "counts": counts}


# ─── GET /orders/duplicate-stats — duplicate management KPIs ─────────────────

@router.get("/duplicate-stats")
def get_duplicate_stats(
    store_id: Optional[str] = Query(None),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Duplicate-management KPIs:
    total orders, duplicate groups, child orders, duplicate rate,
    recovered duplicates, merged basket value, shipments prevented and the
    commission that would have been paid twice without the merge.
    """
    from sqlalchemy import func, distinct

    base_filters = [Order.is_deleted == False]
    if store_id:
        base_filters.append(Order.store_id == store_id)

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
    search: Optional[str] = None,
    assigned_to: Optional[str] = None,
    wilaya: Optional[str] = None,
    source: Optional[str] = None,
    customer_phone: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    delivery_method: Optional[str] = None,   # internal | carrier
    livreur_id: Optional[str] = None,
    campaign: Optional[str] = None,          # utm_campaign or campaign_id
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
            scope_crit = _confirmateur_scope_criterion(current_user)

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
                "ABANDONED", "INTERNAL_DELIVERY", "SHIPPED", "DELIVERED",
                "RETURNED", "CANCELLED", "ARCHIVED",
            }
            _status_upper = status.upper() if status else ""
            if status and (_status_upper in _STORE_WIDE_STATUSES or _status_upper.startswith("CARRIER_")):
                query = query.filter(or_(assigned_to_me, scope_crit))
            else:
                query = query.filter(or_(assigned_to_me, unassigned_matching))
        elif current_user.role == "MANAGER" and current_user.employee_store_id:
            query = query.filter(Order.store_id == current_user.employee_store_id)
        elif current_user.role == "LIVREUR":
            # A delivery agent only lists the orders handed to them for an
            # INTERNAL delivery — never a carrier-tracked one. Once a NOEST/
            # Yalidine/ZR tracking number exists, that parcel is the
            # transporteur's job, whatever livreur_id still says.
            from sqlalchemy import or_ as _or_liv
            query = query.filter(
                Order.livreur_id == current_user.id,
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
            query = query.filter(Order.status.in_(["NEW", "ASSIGNED"]))
        elif status.upper() == "PENDING_CONFIRMATION":
            # Orders moved directly to a pending status (IN_PROGRESS/RESCHEDULED)
            # without ever going through "Signaler NRP" — nrp_count stays 0.
            # Excludes NRP-driven ones deliberately: those already have their
            # own dedicated modules (NRP Commandes / NRP Paniers Aband.),
            # showing them again here would just duplicate that view.
            from sqlalchemy import or_ as _or_pending
            query = query.filter(
                Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"]),
                _or_pending(Order.nrp_count == None, Order.nrp_count == 0),
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
        elif status.upper() == "ABANDONED_IN_PROGRESS":
            # Un panier abandonné RESTE abandonné tant qu'il n'est pas CONFIRMED
            query = query.filter(
                Order.is_abandoned_cart == True,
                Order.status.notin_(["CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"]),
            )
        elif status.upper() == "RECOVERED":
            query = query.filter(
                Order.is_abandoned_cart == True,
                Order.status.in_(["CONFIRMED", "SHIPPED", "DELIVERED"]),
            )
        elif status.upper() == "ARCHIVED":
            query = query.filter(Order.status.in_(["CANCELLED", "RETURNED"]))
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
    if assigned_to:
        query = query.filter(Order.assigned_to == assigned_to)
    if livreur_id:
        query = query.filter(Order.livreur_id == livreur_id)
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
    if search:
        from sqlalchemy import or_
        query = query.filter(
            or_(
                Order.customer_name.ilike(f"%{search}%"),
                Order.customer_phone.ilike(f"%{search}%"),
                Order.order_number.ilike(f"%{search}%")
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
            joinedload(Order.carrier),
            joinedload(Order.store),
        ).order_by(Order.created_at.desc())
    
    logger.debug(f"[Orders] Query result: store_id={store_id!r}, total={total}, page={page}")

    orders = final_query.offset(skip).limit(pageSize).all()
    _sync_item_images_from_product(orders)

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
    order_data = order_in.model_dump(exclude={"items", "abandoned_cart_id"})
    # Set correct source
    order_data["source"] = order_in.source or "abandoned_cart"
    order_data["is_abandoned_cart"] = True
    
    from app.services.inventory_service import InventoryService
    inv_svc = InventoryService()
    
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
            db_order = (
                db.query(Order)
                .filter(
                    Order.store_id == order_in.store_id,
                    Order.customer_phone == phone,
                    Order.status == "ABANDONED",
                    Order.is_deleted == False,
                )
                .order_by(Order.created_at.desc())
                .first()
            )

    if db_order:
        # Update existing
        for key, value in order_data.items():
            setattr(db_order, key, value)
            
        # Try to auto-assign if currently unassigned
        if not db_order.assigned_to:
            from app.models.store import Store
            from app.services.order_service import _auto_assign
            store = db.query(Store).filter(Store.id == db_order.store_id).first()
            order_product_ids = [item.product_id for item in order_in.items if item.product_id]
            db_order.assigned_to = _auto_assign(db, store, order_product_ids) if store else None
        
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
    from datetime import datetime, timezone
    import uuid
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    order_number = f"ABN-{now.strftime('%Y%m%d')}-{str(uuid.uuid4())[:6].upper()}"
    
    from app.models.store import Store
    from app.services.order_service import _auto_assign
    store = db.query(Store).filter(Store.id == order_in.store_id).first()
    order_product_ids = [item.product_id for item in order_in.items if item.product_id]
    assigned_agent = _auto_assign(db, store, order_product_ids) if store else None
    
    # Avoid duplicate parameter error
    order_data.pop("is_abandoned_cart", None)
    order_data.pop("assigned_to", None)

    # Calculate store_sequence_number
    from sqlalchemy import func
    max_seq = db.query(func.max(Order.store_sequence_number)).filter(Order.store_id == order_in.store_id).scalar()
    store_sequence_number = (max_seq or 0) + 1

    db_order = Order(
        id=str(uuid.uuid4()),
        order_number=order_number,
        store_sequence_number=store_sequence_number,
        status="ABANDONED",
        assigned_to=assigned_agent,
        is_abandoned_cart=True,
        **order_data
    )
    db.add(db_order)
    db.flush()
    
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
        # If this completes an abandoned cart, upgrade it instead of creating duplicate
        if order_in.abandoned_cart_id:
            existing = db.query(Order).filter(Order.id == order_in.abandoned_cart_id).first()
            if existing and existing.status == "ABANDONED":
                for key, value in order_data.items():
                    if key not in ["id", "status", "source", "is_abandoned_cart"]:
                        setattr(existing, key, value)
                
                existing.status = "NEW"
                existing.source = order_in.source or "storefront"  # they checked out themselves
                # The customer completed the checkout THEMSELVES → this is a
                # real NORMAL order, not a recovered cart (no confirmatrice
                # recovery happened). The type badge must say Normal.
                existing.is_abandoned_cart = False

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

                return existing

        from datetime import datetime, timezone, timedelta

        # ── Idempotent submit: rapid multi-clicks on "Commander" ─────────────
        # A customer hammering the order button (storefront or landing page)
        # used to create one order per click; auto-merge then FUSED them by
        # summing quantities — so 3 clicks for 1 item became quantity 3 on the
        # surviving parent, and the confirmatrice saw an inflated basket plus
        # a pile of "doublons". An IDENTICAL basket (same products, same
        # variants, same quantities) resubmitted by the same phone within a
        # short window is the same intent, not a new purchase → return the
        # already-created order untouched. A basket that differs in ANY way
        # (variant changed, quantity changed, product added) falls through to
        # normal creation, where auto-merge handles it as a genuine addition.
        def _items_signature(raw_items: list) -> tuple:
            sig = []
            for it in raw_items:
                vd = it.get("variant_details") if isinstance(it, dict) else None
                variant = (vd.get("variant") if isinstance(vd, dict) else str(vd or "")) or ""
                sig.append((str(it.get("product_id") or ""), str(variant).strip().lower(), int(it.get("quantity") or 0)))
            return tuple(sorted(sig))

        if order_data.get("customer_phone") and order_data.get("store_id"):
            _idem_window = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=15)
            _incoming_sig = _items_signature(items)
            _recent = (
                db.query(Order)
                .options(joinedload(Order.items))
                .filter(
                    Order.store_id == order_data["store_id"],
                    Order.customer_phone == order_data["customer_phone"],
                    Order.created_at >= _idem_window,
                    Order.is_deleted == False,
                    Order.status.notin_(["CANCELLED", "MERGED", "RETURNED"]),
                )
                .order_by(Order.created_at.desc())
                .all()
            )
            for _prev in _recent:
                _prev_sig = _items_signature([
                    {"product_id": pi.product_id, "variant_details": pi.variant_details, "quantity": pi.quantity}
                    for pi in (_prev.items or [])
                ])
                if _prev_sig == _incoming_sig:
                    logger.info(
                        "Idempotent submit: identical basket from %s within 15min → returning existing order %s instead of creating a duplicate",
                        order_data["customer_phone"], _prev.order_number,
                    )
                    return _prev

        is_upsell = order_data.get("is_upsell", False)
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
            from app.models.marketing import MetaAdsConfig
            meta_config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == order.store_id).first()
            if meta_config and meta_config.pixel_id and meta_config.access_token:
                from app.services.meta_capi import send_purchase_for_order
                client_ip = request.headers.get("x-forwarded-for") or (request.client.host if request.client else None)
                user_agent = request.headers.get("user-agent")
                background_tasks.add_task(
                    send_purchase_for_order,
                    order_id=str(order.id),
                    client_ip=client_ip,
                    user_agent=user_agent
                )
        except Exception as capi_err:
            logger.warning(f"Failed to queue Meta CAPI event: {capi_err}")

        return order
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating order: {e}", exc_info=True)
        from app.core.exceptions import InsufficientStockError, ProductNotFoundError
        if isinstance(e, (InsufficientStockError, ProductNotFoundError, ValueError)):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))


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

    _assert_order_access(order, current_user)
    _sync_item_images_from_product([order])

    # Attach merged duplicates for the duplication-history panel
    children = db.query(Order).filter(
        Order.parent_order_id == order.id,
        Order.is_deleted == False,
    ).order_by(Order.created_at.asc()).all()

    from app.schemas.order import OrderReadFull as _OrderReadFull, OrderRead as _OrderRead
    result = _OrderReadFull.model_validate(order)
    result.child_orders = [_OrderRead.model_validate(c) for c in children]
    return result


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
    _assert_order_access(order, current_user)
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

    _assert_order_access(order, current_user)

    # A delivery agent can move his parcels through the delivery pipeline
    # (in delivery / delivered / failed-return / cancelled), optionally with
    # a note — never reassign or change anything else.
    if current_user.role == "LIVREUR":
        requested = (status_update.status or "").upper() if status_update.status else None
        # RESCHEDULED = "Reportée" — the driver couldn't deliver today (client
        # absent, reporté à demain...) and hands the order back to the
        # confirmation pipeline instead of forcing a terminal outcome.
        if requested and requested not in ("SHIPPED", "DELIVERED", "RETURNED", "CANCELLED", "RESCHEDULED"):
            raise HTTPException(status_code=403, detail="Statut non autorisé pour un livreur (En livraison, Livrée, Retour, Reportée ou Annulée uniquement).")
        if status_update.assigned_to or status_update.livreur_id:
            raise HTTPException(status_code=403, detail="Un livreur ne peut pas réassigner une commande.")

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
        return updated
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

    _assert_order_access(order, current_user)

    if order.status in _LOCKED_STATUSES:
        if order.status == "SHIPPED" and not order.tracking_number:
            pass # Allow edit if dispatch failed
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

    _assert_order_access(order, current_user)

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
            "from_status": e.from_status,
            "to_status": e.to_status,
            "note": e.note,
            "call_result": e.call_result,
            "call_attempt": e.call_attempt,
            "created_at": e.created_at.isoformat() if e.created_at else None,
            "actor": {"id": e.actor.id, "name": e.actor.name, "avatar": e.actor.avatar} if e.actor else None,
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
    Note: does NOT trigger stock side effects (use individual PATCH for that).
    """
    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER"):
        raise PermissionError(message="Privilèges insuffisants pour les opérations en masse.")

    order_ids: list = payload.get("order_ids", [])
    new_status: str = payload.get("status", "")

    if not order_ids or not new_status:
        from app.core.exceptions import ValidationError
        raise ValidationError(message="order_ids et status sont requis.")

    updated = 0
    for oid in order_ids:
        order = db.query(Order).filter(Order.id == oid, Order.is_deleted == False).first()
        if order:
            order.status = new_status  # type: ignore[assignment]
            updated += 1

    db.commit()
    logger.info("Bulk status update: %d orders → %s by %s", updated, new_status, current_user.id)
    return {"success": True, "updated": updated, "message": f"{updated} commandes mises à jour."}


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
    _assert_order_access(parent, current_user)
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

    # Rebuild the merged basket before shipping: duplicate merges may have
    # aggregated items, the parcel must carry the exact quantities and COD
    # amount. Exactly ONE shipment is ever created (MERGED + tracking guards).
    computed_subtotal = sum(int(i.quantity or 0) * float(i.unit_price or 0) for i in (order.items or []))
    if computed_subtotal and abs(computed_subtotal - float(order.subtotal or 0)) > 0.01:
        order.subtotal = computed_subtotal
        order.total = max(0, computed_subtotal + float(order.delivery_fee or 0) - float(order.discount or 0))
        logger.info("Dispatch %s: totals realigned to merged basket (subtotal=%s, total=%s)",
                    order.order_number, order.subtotal, order.total)

    # Build detailed product list description for delivery partner
    details_list = []
    for item in order.items:
        var_desc = ""
        if item.variant_details:
            if isinstance(item.variant_details, dict):
                if "variant" in item.variant_details:
                    var_desc = f" ({item.variant_details['variant']})"
                else:
                    parts = [f"{k}: {v}" for k, v in item.variant_details.items() if k != "variant"]
                    if parts:
                        var_desc = f" ({', '.join(parts)})"
            elif isinstance(item.variant_details, str):
                var_desc = f" ({item.variant_details})"
        details_list.append(f"{item.product_name}{var_desc} x{item.quantity}")
    
    product_details_str = " | ".join(details_list)
    if len(product_details_str) > 255:
        product_details_str = product_details_str[:252] + "..."
    if not product_details_str:
        product_details_str = order.order_number

    if not order.carrier_id:
        raise HTTPException(400, "Aucun transporteur n'est assigné à cette commande.")

    partner = db.query(DeliveryPartner).filter(
        DeliveryPartner.id == order.carrier_id,
        DeliveryPartner.is_active == True
    ).first()

    if not partner:
        raise HTTPException(400, "Le transporteur assigné est introuvable ou inactif.")

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
            
            if r.status_code not in (200, 201):
                raise HTTPException(r.status_code, f"Erreur Noest: {r.text[:300]}")
                
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
