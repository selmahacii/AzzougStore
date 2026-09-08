import time as _time
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import func
from uuid import uuid4
from datetime import datetime, timezone

from app.api import deps
from app.models.store import Store
from app.models.order import Order
from app.models.product import Product
from app.models.user import User
from app.schemas.store import Store as StoreSchema, StoreCreate, StoreUpdate
from app.worker import sync_store_inventory

router = APIRouter()

# Micro-cache for the guest storefront store list (default params only).
# Guests all see the same data; 10s TTL keeps admin changes near-real-time.
_guest_stores_cache: dict = {"data": None, "at": 0.0}
_GUEST_STORES_TTL = 10.0

# Domain→store routing cache. This endpoint fires on EVERY storefront page
# load, from every visitor — it was one of the most frequent DB hits in the
# HF access logs. Now lives entirely in app/core/cache.py's unified L1
# (in-process, 45s) + L2 (Upstash, 30min) cache — see lookup_domain() below —
# rather than a second hand-rolled cache dict.


STORE_TEMPLATES = {
    "modern": {
        "layout": "minimalist",
        "primaryColor": "#6C5CE7",
        "fontFamily": "Inter",
        "borderRadius": "12px",
        "navbarStyle": "floating",
        "cardStyle": "glass",
        "buttonStyle": "pill",
        "animations": "smooth"
    },
    "luxury": {
        "layout": "elegant",
        "primaryColor": "#2D3436",
        "fontFamily": "Outfit",
        "borderRadius": "0px",
        "navbarStyle": "fixed",
        "cardStyle": "bordered",
        "buttonStyle": "sharp",
        "animations": "fade"
    },
    "ecom": {
        "layout": "grid-focused",
        "primaryColor": "#00B894",
        "fontFamily": "Inter",
        "borderRadius": "30px",
        "navbarStyle": "sticky",
        "cardStyle": "shadow-bold",
        "buttonStyle": "rounded",
        "animations": "pop"
    }
}


def _enrich_store_with_counts(db: Session, store: Store) -> dict:
    """
    Enrichit un store avec les counts SQL de orders, products, employees.
    Retourne un dict compatible avec StoreSchema.
    """
    store_dict = {c.name: getattr(store, c.name) for c in store.__table__.columns}

    orders_count = db.query(func.count(Order.id)).filter(
        Order.store_id == store.id,
        Order.is_deleted == False
    ).scalar() or 0

    products_count = db.query(func.count(Product.id)).filter(
        Product.store_id == store.id,
        Product.is_active == True
    ).scalar() or 0

    employees_count = db.query(func.count(User.id)).filter(
        User.employee_store_id == store.id,
        User.is_active == True
    ).scalar() or 0

    store_dict["_count"] = {
        "orders": orders_count,
        "products": products_count,
        "employees": employees_count
    }
    return store_dict


@router.get("/", response_model=List[dict])
def read_stores(
    response: Response,
    db: Session = Depends(deps.get_db),
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = Query(None),
    current_user: Any = Depends(deps.get_current_user_optional)
) -> Any:
    """
    Retrieve stores with real-time counts for orders, products, employees.
    Filtered by the current user's access scope. Guests see active stores.
    """
    is_guest_default = current_user is None and skip == 0 and limit == 100 and not search
    if is_guest_default:
        # Let browsers/CDN reuse the guest payload instead of re-hitting us
        response.headers["Cache-Control"] = "public, max-age=30"
        cached = _guest_stores_cache["data"]
        if cached is not None and _time.monotonic() - _guest_stores_cache["at"] < _GUEST_STORES_TTL:
            return cached

    query = db.query(Store).filter(Store.is_deleted == False)

    if current_user:
        # A delivery driver manages inventory/products across the company
        # (like a manager would) — never restricted to a single store here.
        if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER", "LIVREUR"]:
            scope = getattr(current_user, "assigned_store_scope", "ALL")
            if scope == "SPECIFIC":
                raw_stores = getattr(current_user, "assigned_store_ids", None)
                scoped_stores = raw_stores if isinstance(raw_stores, list) else []
                query = query.filter(Store.id.in_(scoped_stores))
    else:
        # Guests can only see active stores
        query = query.filter(Store.is_active == True)

    if search:
        query = query.filter(
            (Store.name.ilike(f"%{search}%")) |
            (Store.slug.ilike(f"%{search}%"))
        )
    stores = query.offset(skip).limit(limit).all()
    if not stores:
        return []

    # Batched counts: 3 grouped queries instead of 3 per store (N+1)
    store_ids = [s.id for s in stores]
    orders_by_store = dict(
        db.query(Order.store_id, func.count(Order.id))
        .filter(Order.store_id.in_(store_ids), Order.is_deleted == False)
        .group_by(Order.store_id).all()
    )
    products_by_store = dict(
        db.query(Product.store_id, func.count(Product.id))
        .filter(Product.store_id.in_(store_ids), Product.is_active == True)
        .group_by(Product.store_id).all()
    )
    employees_by_store = dict(
        db.query(User.employee_store_id, func.count(User.id))
        .filter(User.employee_store_id.in_(store_ids), User.is_active == True)
        .group_by(User.employee_store_id).all()
    )

    result = []
    for s in stores:
        store_dict = {c.name: getattr(s, c.name) for c in s.__table__.columns}
        store_dict["_count"] = {
            "orders": orders_by_store.get(s.id, 0),
            "products": products_by_store.get(s.id, 0),
            "employees": employees_by_store.get(s.id, 0),
        }
        result.append(store_dict)

    if is_guest_default:
        _guest_stores_cache["data"] = result
        _guest_stores_cache["at"] = _time.monotonic()
    return result


@router.post("/", response_model=dict)
def create_store(
    *,
    db: Session = Depends(deps.get_db),
    store_in: StoreCreate,
    current_user: Any = Depends(deps.get_current_active_user)
) -> Any:
    """
    Create new store with template-based initialization.
    Only SUPER_ADMIN and ADMIN can create stores.
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Privilèges insuffisants pour créer une boutique.")

    # Check if slug exists
    existing = db.query(Store).filter(Store.slug == store_in.slug).first()
    if existing:
        raise HTTPException(status_code=400, detail="Une boutique avec ce slug existe déjà.")

    # Check domain uniqueness
    if store_in.domain:
        existing_domain = db.query(Store).filter(Store.domain == store_in.domain).first()
        if existing_domain:
            raise HTTPException(status_code=400, detail="Ce domaine est déjà utilisé par une autre boutique.")

    # Merge template + custom config
    template_config = STORE_TEMPLATES.get(store_in.template_id or "modern", STORE_TEMPLATES["modern"]).copy()
    final_theme_config = {**template_config, **(store_in.theme_config or {})}

    store_dict = store_in.model_dump(exclude={"contact"})
    store_dict["theme_config"] = final_theme_config

    # Handle owner
    owner_id = store_dict.get("owner_id")
    if not owner_id or owner_id == "SYSTEM_ADMIN":
        store_dict["owner_id"] = current_user.id

    store = Store(
        id=str(uuid4()),
        **store_dict
    )
    db.add(store)
    db.commit()
    db.refresh(store)

    # Async inventory sync
    try:
        sync_store_inventory.delay(store.id)
    except Exception:
        pass  # Celery may not be running in dev

    return _enrich_store_with_counts(db, store)


@router.get("/analytics", response_model=dict)
def stores_analytics(
    *,
    db: Session = Depends(deps.get_db),
    period: str = "30d",
    _auth: Any = Depends(deps.get_current_active_user)
) -> Any:
    """
    Aggregate revenue summary per store for SUPER_ADMIN dashboard.
    Returns fields matching the frontend StoreRevenue type:
    { storeId, storeName, totalRevenue, ordersCount, change }
    """
    from datetime import timedelta
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    days = 7 if period == "7d" else 90 if period == "90d" else 30
    start = now - timedelta(days=days)
    prev_start = start - timedelta(days=days)

    stores = db.query(Store).filter(Store.is_deleted == False, Store.is_active == True).all()
    store_ids = [s.id for s in stores]
    if not store_ids:
        return {"success": True, "data": []}

    # 2 grouped queries instead of 3 per store (was N+1 on every dashboard load)
    current_by_store = {
        row[0]: (row[1] or 0, row[2] or 0)
        for row in db.query(Order.store_id, func.sum(Order.total), func.count(Order.id)).filter(
            Order.store_id.in_(store_ids),
            Order.is_deleted == False,
            Order.created_at >= start,
        ).group_by(Order.store_id).all()
    }
    prev_by_store = {
        row[0]: row[1] or 0
        for row in db.query(Order.store_id, func.sum(Order.total)).filter(
            Order.store_id.in_(store_ids),
            Order.is_deleted == False,
            Order.created_at >= prev_start,
            Order.created_at < start,
        ).group_by(Order.store_id).all()
    }

    result = []
    for s in stores:
        current_rev, orders_count = current_by_store.get(s.id, (0, 0))
        prev_rev = prev_by_store.get(s.id, 0)
        change = round(((current_rev - prev_rev) / (prev_rev or 1)) * 100, 2) if prev_rev else 0.0
        result.append({
            "storeId": s.id,
            "storeName": s.name,
            "totalRevenue": current_rev,
            "ordersCount": orders_count,
            "change": change,
        })

    return {"success": True, "data": result}


@router.get("/lookup/domain", response_model=dict)
def lookup_domain(
    *,
    db: Session = Depends(deps.get_db),
    domain: str
) -> Any:
    """
    Lookup store by domain for edge routing.
    """
    import logging
    logger = logging.getLogger("app.stores")

    from app.core.cache import get_or_set

    _MISS = {"__miss__": True}

    def _compute():
        logger.info(f"[LookupDomain] Query: domain={domain!r}")
        store = db.query(Store).filter(
            (Store.domain == domain) | (Store.slug == domain),
            Store.is_deleted == False
        ).first()
        if not store:
            logger.warning(f"[LookupDomain] Store NOT found for domain={domain!r}")
            return _MISS
        logger.info(f"[LookupDomain] Found store: id={store.id!r}, slug={store.slug!r}, domain={store.domain!r}")
        return {"storeId": store.id, "storeSlug": store.slug}

    payload = get_or_set(f"domain_lookup:{domain}", _compute, l1_ttl=45, l2_ttl=1800)
    if payload == _MISS:
        raise HTTPException(status_code=404, detail="Store not found for this domain")
    return payload


@router.get("/{id}", response_model=dict)
def read_store(
    *,
    db: Session = Depends(deps.get_db),
    id: str,
    current_user: Optional[Any] = Depends(deps.get_current_user_optional)
) -> Any:
    """
    Get store by ID with counts. Sensitive credentials (fb_access_token) are hidden from public requests.
    """
    is_admin = current_user is not None and getattr(current_user, "role", None) in ("SUPER_ADMIN", "ADMIN", "MANAGER")

    # Only the public (non-admin) response is cached — it's already stripped
    # of marketing_config.fb_access_token below before it would ever reach
    # the cache, and never merged with an admin read, so a cached entry can
    # never leak the token to a public request.
    if not is_admin:
        from app.core.cache import get_or_set

        def _compute_public():
            store = db.query(Store).filter(Store.id == id, Store.is_deleted == False).first()
            if not store:
                return None
            data = _enrich_store_with_counts(db, store)
            m_config = data.get("marketing_config") or {}
            if isinstance(m_config, dict):
                m_config.pop("fb_access_token", None)
                data["marketing_config"] = m_config
            return data

        store_data = get_or_set(f"store_config:{id}", _compute_public, l1_ttl=45, l2_ttl=60)
        if store_data is None:
            raise HTTPException(status_code=404, detail="Store not found")
        return store_data

    store = db.query(Store).filter(Store.id == id, Store.is_deleted == False).first()
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    return _enrich_store_with_counts(db, store)


@router.put("/{id}", response_model=dict)
def update_store(
    *,
    db: Session = Depends(deps.get_db),
    id: str,
    store_in: StoreUpdate,
    current_user: Any = Depends(deps.get_current_active_user)
) -> Any:
    """
    Update a store's configuration, theme, domain, and social links.
    Only SUPER_ADMIN, ADMIN can update stores.
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Privilèges insuffisants pour modifier une boutique.")

    store = db.query(Store).filter(Store.id == id, Store.is_deleted == False).first()
    if not store:
        raise HTTPException(status_code=404, detail="Boutique introuvable.")

    update_data = store_in.model_dump(exclude_unset=True)

    # Check slug uniqueness if changed
    if "slug" in update_data and update_data["slug"] != store.slug:
        existing = db.query(Store).filter(
            Store.slug == update_data["slug"],
            Store.id != id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Ce slug est déjà utilisé par une autre boutique.")

    # Check domain uniqueness if changed
    if "domain" in update_data and update_data["domain"] and update_data["domain"] != store.domain:
        existing = db.query(Store).filter(
            Store.domain == update_data["domain"],
            Store.id != id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Ce domaine est déjà utilisé par une autre boutique.")

    # Merge theme_config
    if "theme_config" in update_data and isinstance(update_data["theme_config"], dict):
        current_theme = store.theme_config or {}
        if isinstance(current_theme, str):
            import json
            try:
                current_theme = json.loads(current_theme)
            except Exception:
                current_theme = {}
        update_data["theme_config"] = {**current_theme, **update_data["theme_config"]}

    # Ensure social_links is a dict if it exists in update_data
    if "social_links" in update_data and isinstance(update_data["social_links"], str):
        import json
        try:
            update_data["social_links"] = json.loads(update_data["social_links"])
        except Exception:
            update_data["social_links"] = {}

    # Record audit log before
    before_dict = {c.name: getattr(store, c.name) for c in store.__table__.columns}

    for field, value in update_data.items():
        setattr(store, field, value)

    db.flush()
    after_dict = {c.name: getattr(store, c.name) for c in store.__table__.columns}

    from app.services.audit_service import audit_service
    audit_service.record_change(
        db=db,
        actor_id=current_user.id,
        entity_name="Store",
        entity_id=store.id,
        action="UPDATE",
        before=before_dict,
        after=after_dict
    )

    db.commit()
    db.refresh(store)
    # A store edit may have changed domain/slug — drop the routing/config
    # cache so the new mapping is served immediately instead of after the TTL.
    from app.core.cache import invalidate as _cache_invalidate
    _cache_invalidate(f"store_config:{store.id}", f"domain_lookup:{store.domain}", f"domain_lookup:{store.slug}")
    return _enrich_store_with_counts(db, store)


@router.patch("/{id}/toggle", response_model=dict)
def toggle_store(
    *,
    db: Session = Depends(deps.get_db),
    id: str,
    current_user: Any = Depends(deps.get_current_active_user)
) -> Any:
    """
    Toggle store active/inactive status.
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    store = db.query(Store).filter(Store.id == id, Store.is_deleted == False).first()
    if not store:
        raise HTTPException(status_code=404, detail="Boutique introuvable.")

    before_dict = {c.name: getattr(store, c.name) for c in store.__table__.columns}

    store.is_active = not store.is_active  # type: ignore[assignment]
    db.flush()

    after_dict = {c.name: getattr(store, c.name) for c in store.__table__.columns}

    from app.services.audit_service import audit_service
    audit_service.record_change(
        db=db,
        actor_id=current_user.id,
        entity_name="Store",
        entity_id=store.id,
        action="STATUS_CHANGE",
        before=before_dict,
        after=after_dict
    )

    db.commit()
    db.refresh(store)
    return {
        "success": True,
        "is_active": store.is_active,
        "message": f"Boutique {'activée' if store.is_active else 'désactivée'} avec succès."
    }


@router.delete("/{id}", response_model=dict)
def delete_store(
    *,
    db: Session = Depends(deps.get_db),
    id: str,
    current_user: Any = Depends(deps.get_current_active_superuser)
) -> Any:
    """
    Soft-delete a store. Only SUPER_ADMIN can do this.
    """
    store = db.query(Store).filter(Store.id == id, Store.is_deleted == False).first()
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")

    store.is_deleted = True
    store.is_active = False  # type: ignore[assignment]
    store.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)  # type: ignore[assignment]
    db.commit()
    return {"success": True, "id": id, "message": "Boutique supprimée (soft delete)."}
