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
from app.services.order_service import order_service

router = APIRouter()
logger = logging.getLogger("app.orders")


# ─── RBAC helpers ────────────────────────────────────────────────────────────

def _assert_order_access(order: Order, current_user: User) -> None:
    """
    CONFIRMATEUR can access orders assigned to them, or abandoned carts matching their store & product scope.
    MANAGER can only access orders in their store.
    ADMIN/SUPER_ADMIN: full access.
    """
    if current_user.role == "CONFIRMATEUR":
        is_assigned = order.assigned_to == current_user.id
        is_unassigned = order.assigned_to == None
        
        # Check store scope
        store_ok = True
        scope = getattr(current_user, "assigned_store_scope", "ALL")
        if scope == "SPECIFIC":
            raw_stores = getattr(current_user, "assigned_store_ids", None)
            scoped_stores = raw_stores if isinstance(raw_stores, list) else []
            store_ok = order.store_id in scoped_stores
            
        # Check product scope
        product_ok = True
        raw_products = getattr(current_user, "assigned_product_ids", None)
        scoped_products = raw_products if isinstance(raw_products, list) else []
        if scoped_products:
            # Check if any item in the order is in the scoped products
            product_ok = any(item.product_id in scoped_products for item in (order.items or []))
            
        # A confirmatrice can access an order if:
        # 1. It is assigned to them
        # 2. It is unassigned and matches their store/product scope
        is_accessible = is_assigned or (is_unassigned and store_ok and product_ok)
        
        if not is_accessible:
            raise PermissionError(message="Accès refusé à cette commande.")
    elif current_user.role == "MANAGER":
        if current_user.employee_store_id and order.store_id != current_user.employee_store_id:
            raise PermissionError(message="Accès refusé : commande hors de votre boutique.")


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
    from datetime import datetime

    base = db.query(Order).filter(Order.is_deleted == False, Order.status != "MERGED")

    # Same RBAC scoping as list_orders for confirmatrices
    if current_user.role == "CONFIRMATEUR":
        store_filter = True
        scope = getattr(current_user, "assigned_store_scope", "ALL")
        if scope == "SPECIFIC":
            raw_stores = getattr(current_user, "assigned_store_ids", None)
            scoped_stores = raw_stores if isinstance(raw_stores, list) else []
            store_filter = Order.store_id.in_(scoped_stores) if scoped_stores else False
        base = base.filter(or_(
            Order.assigned_to == current_user.id,
            and_(Order.assigned_to == None, store_filter),
        ))
    elif current_user.role == "MANAGER" and current_user.employee_store_id:
        base = base.filter(Order.store_id == current_user.employee_store_id)

    if store_id:
        base = base.filter(Order.store_id == store_id)
    for bound, op_gte in ((start_date, True), (end_date, False)):
        if bound:
            try:
                dt = datetime.fromisoformat(bound.replace("Z", "+00:00")).replace(tzinfo=None)
                base = base.filter(Order.created_at >= dt if op_gte else Order.created_at <= dt)
            except ValueError:
                pass

    def _count(*criteria):
        return base.filter(*criteria).count()

    counts = {
        "all":       base.filter(Order.status.notin_(["CANCELLED", "RETURNED"])).count(),
        "new":       _count(Order.status.in_(["NEW", "ASSIGNED"])),
        "pending":   _count(Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"])),
        "confirmed": _count(Order.status == "CONFIRMED"),
        "shipped":   _count(Order.status == "SHIPPED"),
        "delivered": _count(Order.status == "DELIVERED"),
        "cancelled": _count(Order.status == "CANCELLED"),
        "nrp":       _count(Order.nrp_count > 0, Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"])),
        "abandoned_in_progress": _count(Order.is_abandoned_cart == True, Order.status == "ABANDONED"),
        "recovered": _count(Order.is_abandoned_cart == True, Order.status.in_(["CONFIRMED", "SHIPPED", "DELIVERED"])),
        "archived":  _count(Order.status.in_(["CANCELLED", "RETURNED"])),
    }
    return {"success": True, "counts": counts}


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
    pageSize: int = Query(20, ge=1, le=100),
    store_id: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    assigned_to: Optional[str] = None,
    wilaya: Optional[str] = None,
    source: Optional[str] = None,
    customer_phone: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    logger.debug(f"[Orders] Listing: store_id={store_id!r}, status={status!r}, user={getattr(current_user, 'email', 'anon')!r}")
    
    query = db.query(Order).filter(Order.is_deleted == False)

    # Authentication & RBAC scoping
    if not current_user:
        # GUEST ACCESS: Must provide both phone and store_id
        if not customer_phone or not store_id:
            raise HTTPException(status_code=401, detail="Authentication required for general listing")
        query = query.filter(Order.customer_phone == customer_phone, Order.store_id == store_id)
    else:
        if current_user.role == "CONFIRMATEUR":
            from sqlalchemy import and_, or_
            from app.models.order import OrderItem
            
            # Store scope filter
            store_filter = True
            scope = getattr(current_user, "assigned_store_scope", "ALL")
            if scope == "SPECIFIC":
                raw_stores = getattr(current_user, "assigned_store_ids", None)
                scoped_stores = raw_stores if isinstance(raw_stores, list) else []
                if scoped_stores:
                    store_filter = Order.store_id.in_(scoped_stores)
                else:
                    store_filter = False
            
            # Product scope filter
            raw_products = getattr(current_user, "assigned_product_ids", None)
            scoped_products = raw_products if isinstance(raw_products, list) else []
            if scoped_products:
                product_filter = Order.items.any(OrderItem.product_id.in_(scoped_products))
            else:
                product_filter = True

            assigned_to_me = Order.assigned_to == current_user.id
            unassigned_matching = and_(
                Order.assigned_to == None,
                store_filter,
                product_filter
            )

            # For ABANDONED carts, allow agents to see all of them in their store to recover them
            if status and status.upper() == "ABANDONED":
                query = query.filter(store_filter)
            else:
                query = query.filter(or_(assigned_to_me, unassigned_matching))
        elif current_user.role == "MANAGER" and current_user.employee_store_id:
            query = query.filter(Order.store_id == current_user.employee_store_id)

    # Explicit filters (from query params)
    if store_id:
        query = query.filter(Order.store_id == store_id)
    if customer_phone:
        query = query.filter(Order.customer_phone == customer_phone)
    if status and status.upper() != "ALL":
        if status.upper() == "RECALL":
            from datetime import datetime, timezone
            from sqlalchemy import or_
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            query = query.filter(
                Order.nrp_count > 0,
                Order.status.in_(["IN_PROGRESS", "CALLED", "RESCHEDULED", "ASSIGNED"]),
                or_(
                    Order.next_callback_time == None,
                    Order.next_callback_time <= now
                )
            )
        elif status.upper() == "NEW":
            query = query.filter(Order.status.in_(["NEW", "ASSIGNED"]))
        elif status.upper() == "PENDING_CONFIRMATION":
            query = query.filter(Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"]))
        elif status.upper() == "NRP":
            query = query.filter(
                Order.nrp_count > 0,
                Order.status.in_(["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED"]),
            )
        elif status.upper() == "ABANDONED_IN_PROGRESS":
            query = query.filter(Order.is_abandoned_cart == True, Order.status == "ABANDONED")
        elif status.upper() == "RECOVERED":
            query = query.filter(
                Order.is_abandoned_cart == True,
                Order.status.in_(["CONFIRMED", "SHIPPED", "DELIVERED"]),
            )
        elif status.upper() == "ARCHIVED":
            query = query.filter(Order.status.in_(["CANCELLED", "RETURNED"]))
        else:
            query = query.filter(Order.status == status.upper())
    else:
        # Merged duplicates stay in DB for traceability but are hidden from
        # the default listing — the surviving parent represents them.
        query = query.filter(Order.status != "MERGED")
    if assigned_to:
        query = query.filter(Order.assigned_to == assigned_to)
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
        from datetime import datetime
        try:
            sd = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
            query = query.filter(Order.created_at >= sd)
        except ValueError:
            pass
    if end_date:
        from datetime import datetime
        try:
            ed = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
            query = query.filter(Order.created_at <= ed)
        except ValueError:
            pass

    total = query.count()
    skip = (page - 1) * pageSize
    
    final_query = query.options(
            joinedload(Order.items),
            joinedload(Order.assignee),
            joinedload(Order.customer),
            joinedload(Order.carrier),
            joinedload(Order.store),
        ).order_by(Order.created_at.desc())
    
    logger.debug(f"[Orders] Query result: store_id={store_id!r}, total={total}, page={page}")

    orders = final_query.offset(skip).limit(pageSize).all()

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
    return {"success": True, "id": db_order.id, "message": "Panier abandonné sauvegardé"}


def send_meta_capi_purchase(
    pixel_id: str,
    access_token: str,
    order_number: str,
    total: float,
    phone: Optional[str],
    name: Optional[str],
    wilaya: Optional[str],
    commune: Optional[str],
    client_ip: Optional[str],
    user_agent: Optional[str]
):
    import hashlib
    import time
    import urllib.request
    import json
    import logging

    logger = logging.getLogger(__name__)

    def _hash(val: Optional[str]) -> Optional[str]:
        if not val:
            return None
        cleaned = val.strip().lower()
        return hashlib.sha256(cleaned.encode("utf-8")).hexdigest()

    def _format_phone(ph: Optional[str]) -> Optional[str]:
        if not ph:
            return None
        digits = "".join(c for c in ph if c.isdigit())
        if not digits:
            return None
        if digits.startswith("213") and len(digits) >= 11:
            return digits
        if digits.startswith("0") and len(digits) >= 10:
            return "213" + digits[1:]
        if len(digits) == 9 and digits[0] in ("5", "6", "7"):
            return "213" + digits
        return digits

    def _clean_c(c_val: Optional[str]) -> Optional[str]:
        if not c_val:
            return None
        if "·" in c_val:
            return c_val.split("·")[-1].strip().lower()
        return c_val.strip().lower()

    user_data = {}
    formatted_phone = _format_phone(phone)
    if formatted_phone:
        user_data["ph"] = [hashlib.sha256(formatted_phone.encode("utf-8")).hexdigest()]
        
    if name:
        parts = name.strip().split()
        if len(parts) > 0:
            user_data["fn"] = [_hash(parts[0])]
        if len(parts) > 1:
            user_data["ln"] = [_hash(parts[-1])]
            
    if wilaya:
        user_data["st"] = [_hash(wilaya)]
    if commune:
        user_data["ct"] = [_hash(_clean_c(commune))]
        
    if client_ip:
        ip = client_ip.split(",")[0].strip()
        user_data["client_ip_address"] = ip
    if user_agent:
        user_data["client_user_agent"] = user_agent

    payload = {
        "data": [
          {
            "event_name": "Purchase",
            "event_time": int(time.time()),
            "event_id": f"ORD-{order_number}",
            "action_source": "website",
            "user_data": user_data,
            "custom_data": {
              "value": total,
              "currency": "DZD"
            }
          }
        ]
    }

    url = f"https://graph.facebook.com/v19.0/{pixel_id}/events?access_token={access_token}"
    req_body = json.dumps(payload).encode("utf-8")
    
    req = urllib.request.Request(
        url,
        data=req_body,
        headers={"Content-Type": "application/json"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            res_body = response.read().decode("utf-8")
            logger.info(f"Meta CAPI Purchase sent for ORD-{order_number}. Response: {res_body}")
    except Exception as exc:
        logger.error(f"Failed to send Meta CAPI Purchase for ORD-{order_number}: {exc}")


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
                
                return existing

        from datetime import datetime, timezone, timedelta
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
        
        if order.source == "landing_page":
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
            
        # Trigger Meta Conversions API (CAPI) if configured
        try:
            from app.models.marketing import MetaAdsConfig
            meta_config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == order.store_id).first()
            if meta_config and meta_config.pixel_id and meta_config.access_token:
                client_ip = request.headers.get("x-forwarded-for") or (request.client.host if request.client else None)
                user_agent = request.headers.get("user-agent")
                background_tasks.add_task(
                    send_meta_capi_purchase,
                    pixel_id=meta_config.pixel_id,
                    access_token=meta_config.access_token,
                    order_number=order.order_number,
                    total=float(order.total),
                    phone=order.customer_phone,
                    name=order.customer_name,
                    wilaya=order.customer_wilaya,
                    commune=order.customer_commune,
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
    order = (
        db.query(Order)
        .options(
            joinedload(Order.items).joinedload(OrderItem.product),
            joinedload(Order.events).joinedload(OrderEvent.actor),
            joinedload(Order.assignee),
            joinedload(Order.customer),
            joinedload(Order.carrier),
        )
        .filter(Order.id == id, Order.is_deleted == False)
        .first()
    )
    if not order:
        raise OrderNotFoundError()

    _assert_order_access(order, current_user)

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

    order = db.query(Order).filter(Order.id == id, Order.is_deleted == False).first()
    if not order:
        raise OrderNotFoundError()
    _assert_order_access(order, current_user)
    if order.status != "MERGED":
        raise HTTPException(status_code=400, detail="Cette commande n'est pas une fusion (statut != MERGED).")

    restored_status = order.status_before_merge or "NEW"
    parent_id = order.parent_order_id
    order.status = restored_status
    order.parent_order_id = None
    order.merged_by = None
    order.merged_at = None
    order.status_before_merge = None

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
    order = (
        db.query(Order)
        .options(joinedload(Order.items))
        .filter(Order.id == id, Order.is_deleted == False)
        .first()
    )
    if not order:
        raise OrderNotFoundError()

    _assert_order_access(order, current_user)

    if current_user.role == "CONFIRMATEUR" and order.status == "CANCELLED":
        raise HTTPException(
            status_code=400,
            detail="Une confirmatrice ne peut pas modifier le statut d'une commande annulée."
        )

    try:
        updated = order_service.update_order(
            db,
            order=order,
            update_data=status_update.model_dump(exclude_unset=True),
            actor_id=current_user.id,
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

_LOCKED_STATUSES = {"DELIVERED", "RETURNED", "CANCELLED"}

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
    order = db.query(Order).filter(Order.id == id, Order.is_deleted == False).first()
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
        inv_svc = InventoryService()
        
        # Release stock for old items
        for old_item in order.items:
            try:
                if order.status in {"CONFIRMED", "SHIPPED", "DELIVERED"}:
                    inv_svc.return_restock(
                        db,
                        product_id=old_item.product_id,
                        quantity=old_item.quantity,
                        order_id=order.id,
                        variant_details=old_item.variant_details
                    )
                elif order.status in {"NEW", "ASSIGNED", "CALLED", "ABANDONED", "IN_PROGRESS", "RESCHEDULED"}:
                    inv_svc.release_reservation(
                        db,
                        product_id=old_item.product_id,
                        quantity=old_item.quantity,
                        order_id=order.id,
                        variant_details=old_item.variant_details
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
        
        # Create new items and reserve/deduct stock
        total_amount = 0
        new_items_desc = []
        for item_data in payload.items:
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
    if current_user.role not in ("SUPER_ADMIN", "ADMIN"):
        raise PermissionError(message="Seul un administrateur peut supprimer une commande.")

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

    parent = db.query(Order).filter(Order.id == id, Order.is_deleted == False).first()
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

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    merged_numbers = []
    for dup_id in duplicate_ids:
        if dup_id == parent.id:
            continue
        dup = db.query(Order).filter(Order.id == dup_id, Order.is_deleted == False).first()
        if not dup:
            continue
        if dup.store_id != parent.store_id:
            raise HTTPException(status_code=400, detail=f"La commande {dup.order_number} appartient à une autre boutique.")
        if dup.status in ("SHIPPED", "DELIVERED", "MERGED"):
            raise HTTPException(status_code=400, detail=f"La commande {dup.order_number} ({dup.status}) ne peut pas être fusionnée.")
        if dup.tracking_number:
            raise HTTPException(status_code=400, detail=f"La commande {dup.order_number} a déjà un colis chez le transporteur.")

        dup.status_before_merge = dup.status
        dup.status = "MERGED"
        dup.parent_order_id = parent.id
        dup.merged_by = current_user.id
        dup.merged_at = now
        dup.is_duplicate = True
        merged_numbers.append(dup.order_number)

        db.add(OrderEvent(
            id=str(_uuid.uuid4()),
            order_id=dup.id,
            actor_id=current_user.id,
            from_status=dup.status_before_merge,
            to_status="MERGED",
            note=f"Fusionnée dans la commande {parent.order_number} (doublon même téléphone).",
        ))

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
