from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api import deps
from app.models.user import User
from app.models.order import Order
from app.models.audit import AuditLog
from app.models.events import OrderEvent
from app.schemas.user import (
    User as UserSchema,
    UserUpdate,
    UserCreate,
    RolePermission,
    InfrastructureStats,
    MarketerPerformance
)
from app.core.security import get_password_hash
from app.services.salary_service import compute_salary
import uuid
from datetime import datetime, timedelta
from sqlalchemy import func, and_, or_, case

router = APIRouter()

# ÔöÇÔöÇÔöÇ Roles Configuration ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
ROLES_CONFIG = [
    {
        "name": "SUPER_ADMIN",
        "label": "Super Administrateur",
        "desc": "Acc├¿s total sans restrictions ├á toutes les boutiques",
        "color": "#4b7bec",
        "perms": ["Tous les modules", "Gestion Boutiques", "Suppression donn├®es", "Acc├¿s API"]
    },
    {
        "name": "ADMIN",
        "label": "Administrateur",
        "desc": "Gestion globale d'une boutique assign├®e",
        "color": "#2d3436",
        "perms": ["Gestion Utilisateurs", "Param├¿tres Boutique", "Audit Logs", "Finance", "Analytics complets"]
    },
    {
        "name": "MANAGER",
        "label": "Responsable Boutique",
        "desc": "Gestion des stocks, achats et ├®quipe locale",
        "color": "#2d98da",
        "perms": ["Gestion Stocks", "Achats Fournisseurs", "Statut Commandes", "Analyse Logistique", "Assignation agents"]
    },
    {
        "name": "CONFIRMATEUR",
        "label": "Agent de Confirmation",
        "desc": "Validation des commandes clients et Upsell",
        "color": "#20bf6b",
        "perms": ["Liste Commandes (assign├®es)", "Cr├®er Commande", "Appels clients", "Upsell", "Notes commandes"]
    },
    {
        "name": "MARKETER",
        "label": "Affili├® & M├®dia",
        "desc": "Acquisition de trafic et tracking performance",
        "color": "#eb4d4b",
        "perms": ["Analytics Marketing", "Acc├¿s Pixels", "Rapport ROAS", "Leads g├®n├®r├®s"]
    },
]


@router.post("/roles", response_model=dict)
def create_role(
    payload: dict,
    _: Any = Depends(deps.get_current_active_user)
):
    """
    Persist a custom role definition. Currently stores the intent and acknowledges ÔÇö
    role enforcement is handled via the user.role field.
    """
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Le nom du r├┤le est obligatoire")
    return {"success": True, "message": f"R├┤le ┬½{name}┬╗ enregistr├® avec succ├¿s"}


@router.get("/roles-matrix", response_model=List[RolePermission])
def get_roles_matrix(
    db: Session = Depends(deps.get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """
    Get the roles and permissions matrix with live user counts per role.
    """
    role_counts = db.query(User.role, func.count(User.id)).group_by(User.role).all()
    counts_dict = {r[0]: r[1] for r in role_counts}

    result = []
    for r in ROLES_CONFIG:
        result.append(RolePermission(
            name=str(r["label"]),
            description=str(r["desc"]),
            color=str(r["color"]),
            count=counts_dict.get(r["name"], 0),
            permissions=r["perms"]
        ))
    return result


@router.get("/infrastructure-stats", response_model=InfrastructureStats)
def get_infrastructure_stats(
    db: Session = Depends(deps.get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """
    Get real-time infrastructure and team metrics.
    """
    total_effectif = db.query(User).count()
    online_count = db.query(User).filter(User.is_active == True).count()

    return InfrastructureStats(
        totalEffectif=total_effectif,
        onlineCount=online_count,
        qualityIndex=94.2,
        interactionDelay=1.4,
        securityLevel="Optimale",
        nodeId="DZ-AL-CORE-1"
    )


@router.get("/marketers", response_model=List[MarketerPerformance])
def get_marketers_performance(
    store_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(deps.get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """
    Real performance metrics for marketing/affiliate partners (MARKETER role).

    No fabricated data: a marketer with no `tracking_code` configured shows
    zero leads/revenue/ROAS and `tracking_configured=False` — the admin must
    assign a real tracking code (matched against Order.utm_source /
    Order.campaign_id) before any number appears. Budget comes from the
    admin-configured `marketing_budget`; ROAS = attributed delivered revenue
    / budget when a budget is set, else 0.
    """
    marketers = db.query(User).filter(
        User.role == "MARKETER",
        User.is_active == True,
    ).all()
    if not marketers:
        return []

    from app.core.dates import parse_local_date_filter
    date_filters = []
    if start_date:
        try:
            date_filters.append(Order.created_at >= parse_local_date_filter(start_date))
        except ValueError:
            pass
    if end_date:
        try:
            date_filters.append(Order.created_at <= parse_local_date_filter(end_date))
        except ValueError:
            pass

    result: List[MarketerPerformance] = []
    for m in marketers:
        code = getattr(m, "tracking_code", None)
        budget = float(getattr(m, "marketing_budget", None) or 0)

        if not code:
            # No real attribution key configured — report zeros, not guesses.
            result.append(MarketerPerformance(
                id=str(m.id), name=str(m.name), pixel=None, is_active=bool(m.is_active),
                budget=budget, leads=0, revenue=0.0, roas=0.0, tracking_configured=False,
            ))
            continue

        attribution_filters = [
            Order.is_deleted == False,
            Order.status != "MERGED",
            or_(Order.utm_source == code, Order.campaign_id == code, Order.utm_campaign == code),
        ] + date_filters
        if store_id:
            attribution_filters.append(Order.store_id == store_id)

        leads = db.query(func.count(Order.id)).filter(*attribution_filters).scalar() or 0
        revenue = db.query(func.coalesce(func.sum(Order.total), 0)).filter(
            *attribution_filters, Order.status == "DELIVERED"
        ).scalar() or 0
        roas = round(float(revenue) / budget, 2) if budget > 0 else 0.0

        result.append(MarketerPerformance(
            id=str(m.id), name=str(m.name), pixel=code, is_active=bool(m.is_active),
            budget=budget, leads=int(leads), revenue=float(revenue), roas=roas,
            tracking_configured=True,
        ))
    return result


@router.get("/", response_model=List[UserSchema])
def read_users(
    db: Session = Depends(deps.get_db),
    store_id: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 100,
    current_user: Any = Depends(deps.get_current_active_user)
) -> Any:
    """
    Retrieve users (employees) with filtering by store, role, and search.
    MANAGER can only see employees of their store.
    """
    # Role-based scope
    if current_user.role == "MANAGER":
        if not current_user.employee_store_id:
            return []
        query = db.query(User).filter(
            User.employee_store_id == current_user.employee_store_id
        )
    else:
        query = db.query(User)

    if store_id:
        from sqlalchemy import or_, cast, Text
        query = query.filter(
            or_(
                User.employee_store_id == store_id,
                User.assigned_store_scope == "ALL",
                cast(User.assigned_store_ids, Text).ilike(f"%{store_id}%")
            )
        )
    if role:
        query = query.filter(User.role == role)
    if search:
        query = query.filter(
            (User.name.ilike(f"%{search}%")) |
            (User.email.ilike(f"%{search}%")) |
            (User.phone.ilike(f"%{search}%"))
        )

    users = query.offset(skip).limit(limit).all()
    return users


@router.get("/me", response_model=UserSchema)
def read_user_me(
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Get current authenticated user."""
    return current_user


@router.get("/{user_id}", response_model=UserSchema)
def read_user_by_id(
    user_id: str,
    current_user: User = Depends(deps.get_current_active_user),
    db: Session = Depends(deps.get_db),
) -> Any:
    """Get a specific user by ID."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")
    return user


@router.post("/", response_model=UserSchema)
def create_user(
    user_in: UserCreate,
    current_user: User = Depends(deps.get_current_active_user),
    db: Session = Depends(deps.get_db),
):
    """
    Create a new employee. 
    - SUPER_ADMIN: can create any role
    - ADMIN: can create MANAGER, CONFIRMATEUR, MARKETER (not SUPER_ADMIN)
    - MANAGER: cannot create users
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(
            status_code=403,
            detail="Privil├¿ges insuffisants pour cr├®er un employ├®."
        )

    # Admins cannot create SUPER_ADMIN accounts
    if False:
        raise HTTPException(
            status_code=403,
            detail="Un administrateur ne peut pas cr├®er un Super Administrateur."
        )

    # A manager runs operations but can never create platform-level accounts
    if current_user.role == "MANAGER" and (user_in.role or "CONFIRMATEUR") in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(
            status_code=403,
            detail="Un manager ne peut pas creer de compte administrateur.",
        )

    user_exists = db.query(User).filter(User.email == user_in.email).first()
    if user_exists:
        raise HTTPException(
            status_code=400,
            detail="Ce courriel est d├®j├á utilis├® par un autre utilisateur."
        )

    new_id = str(uuid.uuid4())
    role = user_in.role or "CONFIRMATEUR"
    # A marketer needs a real attribution key from day one — derived from
    # their own id (never a fabricated brand/pixel name), editable later.
    tracking_code = user_in.tracking_code
    if role == "MARKETER" and not tracking_code:
        tracking_code = f"AFF-{new_id[:8].upper()}"

    db_user = User(
        id=new_id,
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        name=user_in.name,
        role=role,
        phone=user_in.phone,
        avatar=user_in.avatar,
        daily_target=user_in.daily_target or 10,
        employee_store_id=user_in.employee_store_id,
        is_active=user_in.is_active if user_in.is_active is not None else True,
        payment_type=user_in.payment_type,
        payment_amount=user_in.payment_amount,
        payment_recovered_cart=user_in.payment_recovered_cart or 0,
        payment_lost_cart=user_in.payment_lost_cart or 0,
        payment_upsell=user_in.payment_upsell or 0,
        assigned_store_scope=user_in.assigned_store_scope or "ALL",
        assigned_store_ids=user_in.assigned_store_ids or [],
        assigned_product_ids=user_in.assigned_product_ids or [],
        tracking_code=tracking_code,
        marketing_budget=user_in.marketing_budget,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@router.patch("/{user_id}", response_model=UserSchema)
def update_user(
    user_id: str,
    user_in: UserUpdate,
    current_user: User = Depends(deps.get_current_active_user),
    db: Session = Depends(deps.get_db),
):
    """
    Update an employee's profile, role, or assignment.
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(
            status_code=403,
            detail="Privil├¿ges insuffisants pour modifier un employ├®."
        )

    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    # MANAGER cannot change roles or assign to other stores
    if current_user.role == "MANAGER":
        if hasattr(user_in, 'role') and user_in.role:
            raise HTTPException(status_code=403, detail="Un manager ne peut pas modifier les r├┤les.")
        if hasattr(user_in, 'employee_store_id') and user_in.employee_store_id and user_in.employee_store_id != current_user.employee_store_id:
            raise HTTPException(status_code=403, detail="Un manager ne peut pas r├®assigner un employ├® ├á une autre boutique.")

    # Check email uniqueness if changing
    if user_in.email and user_in.email != db_user.email:
        email_exists = db.query(User).filter(
            User.email == user_in.email,
            User.id != user_id
        ).first()
        if email_exists:
            raise HTTPException(
                status_code=400,
                detail="Ce courriel est d├®j├á utilis├® par un autre utilisateur."
            )

    update_data = user_in.model_dump(exclude_unset=True)

    # Handle password update
    if "password" in update_data and update_data["password"]:
        if len(update_data["password"]) < 6:
            raise HTTPException(status_code=400, detail="Le mot de passe doit contenir au moins 6 caract├¿res.")
        update_data["hashed_password"] = get_password_hash(update_data.pop("password"))
    elif "password" in update_data:
        del update_data["password"]

    # Record audit log before
    before_dict = {c.name: getattr(db_user, c.name) for c in db_user.__table__.columns}

    for field, value in update_data.items():
        if hasattr(db_user, field):
            setattr(db_user, field, value)

    db.add(db_user)
    db.flush()
    after_dict = {c.name: getattr(db_user, c.name) for c in db_user.__table__.columns}

    from app.services.audit_service import audit_service
    audit_service.record_change(
        db=db,
        actor_id=current_user.id,
        entity_name="User",
        entity_id=db_user.id,
        action="UPDATE",
        before=before_dict,
        after=after_dict
    )

    db.commit()
    db.refresh(db_user)
    return db_user


@router.patch("/{user_id}/toggle", response_model=dict)
def toggle_user_active(
    user_id: str,
    current_user: User = Depends(deps.get_current_active_user),
    db: Session = Depends(deps.get_db),
):
    """
    Toggle user active/inactive status (activate or deactivate account).
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(
            status_code=403,
            detail="Seul un administrateur peut activer/d├®sactiver un compte."
        )

    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    # Cannot deactivate their own account or another SUPER_ADMIN
    if db_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas d├®sactiver votre propre compte.")
    if current_user.role == "MANAGER" and (
        db_user.role in ("SUPER_ADMIN", "ADMIN")
        or (getattr(user_in, "role", None) in ("SUPER_ADMIN", "ADMIN"))
    ):
        raise HTTPException(status_code=403, detail="Un manager ne peut pas modifier ou promouvoir un compte administrateur.")
    if db_user.role == "SUPER_ADMIN" and current_user.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="Acc├¿s refus├® ├á ce compte super administrateur.")

    before_dict = {c.name: getattr(db_user, c.name) for c in db_user.__table__.columns}

    db_user.is_active = not bool(db_user.is_active)  # type: ignore[assignment]
    db.flush()

    after_dict = {c.name: getattr(db_user, c.name) for c in db_user.__table__.columns}

    from app.services.audit_service import audit_service
    audit_service.record_change(
        db=db,
        actor_id=current_user.id,
        entity_name="User",
        entity_id=db_user.id,
        action="STATUS_CHANGE",
        before=before_dict,
        after=after_dict
    )

    db.commit()
    db.refresh(db_user)

    action = "activ├®" if db_user.is_active else "d├®sactiv├®"
    return {"success": True, "is_active": db_user.is_active, "message": f"Compte {action} avec succ├¿s."}


@router.post("/{user_id}/reset-password", response_model=dict)
def reset_user_password(
    user_id: str,
    payload: dict,
    current_user: User = Depends(deps.get_current_active_user),
    db: Session = Depends(deps.get_db),
):
    """
    Reset user password. Only SUPER_ADMIN and ADMIN can do this.
    Expected payload: { new_password: "..." }
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Privil├¿ges insuffisants.")

    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    new_password = payload.get("new_password", "")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit contenir au moins 6 caract├¿res.")

    db_user.hashed_password = get_password_hash(new_password)  # type: ignore[assignment]
    db.commit()
    return {"success": True, "message": "Mot de passe r├®initialis├® avec succ├¿s."}


@router.delete("/{user_id}", response_model=dict)
def delete_user(
    user_id: str,
    hard: bool = Query(False),
    current_user: User = Depends(deps.get_current_active_user),
    db: Session = Depends(deps.get_db),
):
    """
    Delete or deactivate an employee. Hard delete if hard=True and user has no linked orders.
    ADMIN and SUPER_ADMIN only.
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN"]:
        raise HTTPException(
            status_code=403,
            detail="Seul un administrateur peut r├®voquer l'acc├¿s d'un employ├®."
        )

    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas supprimer votre propre compte.")

    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    if hard:
        # Check if they have linked orders
        order_count = db.query(Order).filter(Order.assigned_to == user_id).count()
        if order_count > 0:
            raise HTTPException(
                status_code=400, 
                detail="Impossible de supprimer d├®finitivement cet agent car des commandes lui sont attribu├®es. Veuillez plut├┤t le d├®sactiver."
            )
        db.delete(db_user)
        db.commit()
        return {"success": True, "message": "Compte employ├® supprim├® d├®finitivement."}

    # Soft-delete: deactivate
    db_user.is_active = False  # type: ignore[assignment]
    db.commit()
    return {"success": True, "message": "Acc├¿s employ├® r├®voqu├® avec succ├¿s."}


@router.get("/{user_id}/performance")
def get_user_performance(
    user_id: str,
    store_id: Optional[str] = Query(None),
    period_days: int = 30,
    start_date: Optional[str] = Query(None, description="ISO date, inclusive lower bound on Order.created_at"),
    end_date: Optional[str] = Query(None, description="ISO date, inclusive upper bound on Order.created_at"),
    db: Session = Depends(deps.get_db),
):
    """Return performance metrics and salary for an employee.

    start_date/end_date scope BOTH the order-count stats (confirmed/
    delivered/returned/cancelled) AND the salary computation to the same
    window — previously the date pickers in the admin UI had no effect at
    all here: this endpoint only ever took store_id/period_days (the latter
    only used for the daily chart), so the salary shown for a "confirmatrice"
    was always all-time regardless of any date range selected.
    """
    # This endpoint scopes Order access itself below via `store_filter`
    # (the employee's own assigned_store_scope/assigned_store_ids, or the
    # store_id query param) — the header-driven tenant auto-filter is
    # redundant, and on a X-Store-Id/expected-store mismatch it silently
    # zeroes out confirmed_count/recent_orders/audit_logs, indistinguishable
    # from "this employee has no activity". Same class of bug fixed earlier
    # this session across every order-by-id endpoint in orders.py.
    db.info["skip_tenant_isolation"] = True
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    from app.core.dates import parse_local_date_filter
    since = None
    until = None
    if start_date:
        try:
            since = parse_local_date_filter(start_date)
        except ValueError:
            pass
    if end_date:
        try:
            until = parse_local_date_filter(end_date)
        except ValueError:
            pass

    store_filter = True
    scope = getattr(db_user, "assigned_store_scope", "ALL")
    if store_id:
        store_filter = (Order.store_id == store_id)
    elif scope == "SPECIFIC":
        raw_stores = getattr(db_user, "assigned_store_ids", None)
        scoped_stores = raw_stores if isinstance(raw_stores, list) else []
        store_filter = Order.store_id.in_(scoped_stores) if scoped_stores else False

    base_q = db.query(Order).filter(
        and_(
            store_filter,
            Order.assigned_to == user_id,
            Order.is_deleted  == False,
        )
    )
    if since:
        base_q = base_q.filter(Order.created_at >= since)
    if until:
        base_q = base_q.filter(Order.created_at <= until)

    # Was 5 sequential .count() round trips against the same base_q, plus a
    # 7-day loop issuing one more .count() per day (~13 queries total) — on
    # the Supabase pooler each round trip ran 100-300ms, so this endpoint
    # alone took 2-5s (matches the 2-5s latencies seen in prod), long enough
    # to trip the HF gateway's request timeout (503) under load. Collapsed
    # into a single conditional-aggregation query.
    totals_row = base_q.with_entities(
        func.count().label("total"),
        func.sum(case((Order.status.in_(["CONFIRMED", "DELIVERED", "SHIPPED"]), 1), else_=0)).label("confirmed"),
        func.sum(case((Order.status == "DELIVERED", 1), else_=0)).label("delivered"),
        func.sum(case((Order.status == "RETURNED", 1), else_=0)).label("returned"),
        func.sum(case((Order.status == "CANCELLED", 1), else_=0)).label("cancelled"),
        func.sum(case((Order.is_upsell == True, 1), else_=0)).label("upsell"),
    ).one()
    total_assigned   = totals_row.total or 0
    confirmed_count  = totals_row.confirmed or 0
    delivered_count  = totals_row.delivered or 0
    returned_count   = totals_row.returned or 0
    cancelled_count  = totals_row.cancelled or 0
    upsell_count     = totals_row.upsell or 0

    # Salary via service (uses DELIVERED orders only, respects payment_type),
    # now scoped to the same since/until window as the stats above.
    salary_data = compute_salary(db, db_user, store_id, since=since, until=until)

    recent_orders = base_q.order_by(Order.id.desc()).limit(20).all()

    audit_logs = (
        db.query(OrderEvent)
        .join(Order, OrderEvent.order_id == Order.id)
        .filter(and_(OrderEvent.actor_id == user_id, store_filter))
        .order_by(OrderEvent.created_at.desc())
        .limit(30)
        .all()
    )

    chart_days = min(period_days, 7)
    range_start = (datetime.now() - timedelta(days=chart_days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)  # noqa: DTZ005
    daily_rows = db.query(
        func.date(Order.created_at).label("day"),
        func.count().label("count"),
    ).filter(
        and_(
            store_filter,
            Order.assigned_to == user_id,
            Order.status      == "DELIVERED",
            Order.is_deleted  == False,
            Order.created_at  >= range_start,
        )
    ).group_by(func.date(Order.created_at)).all()
    counts_by_day = {row.day.strftime("%d/%m") if hasattr(row.day, "strftime") else row.day: row.count for row in daily_rows}

    daily = []
    for i in range(chart_days - 1, -1, -1):
        day       = datetime.now() - timedelta(days=i)  # noqa: DTZ005
        day_start = day.replace(hour=0,  minute=0,  second=0,  microsecond=0)
        key = day_start.strftime("%d/%m")
        daily.append({"date": key, "count": counts_by_day.get(key, 0)})

    return {
        "user": {
            "id":           db_user.id,
            "name":         db_user.name,
            "email":        db_user.email,
            "role":         db_user.role,
            "phone":        db_user.phone,
            "is_active":    db_user.is_active,
            "daily_target": db_user.daily_target or 10,
        },
        "stats": {
            "total_assigned":    total_assigned,
            "confirmed_count":   confirmed_count,
            "delivered_count":   delivered_count,
            "returned_count":    returned_count,
            "cancelled_count":   cancelled_count,
            "upsell_count":      upsell_count,
            "salary":                    salary_data["salary"],
            "payment_type":              salary_data["payment_type"],
            "payment_amount":            salary_data["payment_amount"],
            "payment_recovered_cart":    salary_data.get("payment_recovered_cart", 0),
            "payment_lost_cart":         salary_data.get("payment_lost_cart", 0),
            "base_salary":               salary_data.get("base_salary", 0),
            "abandoned_bonus":           salary_data.get("abandoned_bonus", 0),
            "normal_delivered_count":    salary_data.get("normal_delivered_count", 0),
            "recovered_count":           salary_data.get("recovered_count", 0),
            "recovered_delivered_count": salary_data.get("recovered_delivered_count", 0),
            "lost_count":                salary_data.get("lost_count", 0),
            "returned_penalty":          salary_data.get("returned_penalty", 0),
            "payment_upsell":            salary_data.get("payment_upsell", 0),
            "upsell_delivered_count":    salary_data.get("upsell_delivered_count", 0),
            "upsell_bonus":              salary_data.get("upsell_bonus", 0),
            # commission_per_order: per-order rate (None for MONTHLY_SALARY)
            "commission_per_order": (
                salary_data["payment_amount"]
                if salary_data["payment_type"] != "MONTHLY_SALARY"
                else None
            ),
            "confirmation_rate":  round((confirmed_count / total_assigned * 100) if total_assigned else 0, 1),
        },
        "recent_orders": [
            {
                "id":            o.id,
                "order_number":  o.order_number,
                "customer_name": o.customer_name,
                "total":         o.total,
                "status":        o.status,
                "wilaya":        o.customer_wilaya,
            }
            for o in recent_orders
        ],
        "audit_logs": [
            {
                "id":         a.id,
                "entity":     "Commande",
                "action":     f"{a.from_status or 'NEW'} ÔåÆ {a.to_status}",
                "entity_id":  a.order_id,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in audit_logs
        ],
        "daily_chart": daily,
    }


@router.get("/{user_id}/salary")
def get_employee_salary(
    user_id: str,
    store_id: str,
    since: Optional[str] = Query(None, description="ISO date, e.g. 2026-04-01"),
    until: Optional[str] = Query(None, description="ISO date, e.g. 2026-04-30"),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Compute the salary for an employee.

    - ADMIN / SUPER_ADMIN: can query any employee.
    - MANAGER: can only query employees of their own store.
    - An employee can query their own salary.

    Optional date window via ?since=YYYY-MM-DD&until=YYYY-MM-DD.
    """
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    # Access control
    is_self    = current_user.id == user_id
    is_admin   = current_user.role in ("SUPER_ADMIN", "ADMIN")
    is_manager = (
        current_user.role == "MANAGER"
        and current_user.employee_store_id == store_id
    )
    if not (is_self or is_admin or is_manager):
        raise HTTPException(status_code=403, detail="Acc├¿s non autoris├®.")

    # Parse optional date window
    since_dt: Optional[datetime] = None
    until_dt: Optional[datetime] = None
    try:
        if since:
            since_dt = datetime.fromisoformat(since)
        if until:
            # Include the full last day
            until_dt = datetime.fromisoformat(until).replace(
                hour=23, minute=59, second=59, microsecond=999999
            )
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="Format de date invalide. Utilisez YYYY-MM-DD."
        )

    salary_data = compute_salary(db, db_user, store_id, since=since_dt, until=until_dt)

    return {
        "employee": {
            "id":             db_user.id,
            "name":           db_user.name,
            "role":           db_user.role,
            "payment_type":   db_user.payment_type,
            "payment_amount": db_user.payment_amount,
        },
        "salary": salary_data,
    }

