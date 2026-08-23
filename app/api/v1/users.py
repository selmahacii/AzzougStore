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
from datetime import datetime, timedelta, timezone
from sqlalchemy import func, and_, or_, case

router = APIRouter()

# --- Roles Configuration ---------------------------------------------------
ROLES_CONFIG = [
    {
        "name": "SUPER_ADMIN",
        "label": "Super Administrateur",
        "desc": "Accès total sans restrictions à toutes les boutiques",
        "color": "#4b7bec",
        "perms": ["Tous les modules", "Gestion Boutiques", "Suppression données", "Accès API"]
    },
    {
        "name": "ADMIN",
        "label": "Administrateur",
        "desc": "Gestion globale d'une boutique assignée",
        "color": "#2d3436",
        "perms": ["Gestion Utilisateurs", "Paramètres Boutique", "Audit Logs", "Finance", "Analytics complets"]
    },
    {
        "name": "MANAGER",
        "label": "Responsable Boutique",
        "desc": "Gestion des stocks, achats et équipe locale",
        "color": "#2d98da",
        "perms": ["Gestion Stocks", "Achats Fournisseurs", "Statut Commandes", "Analyse Logistique", "Assignation agents"]
    },
    {
        "name": "CONFIRMATEUR",
        "label": "Agent de Confirmation",
        "desc": "Validation des commandes clients et Upsell",
        "color": "#20bf6b",
        "perms": ["Liste Commandes (assignées)", "Créer Commande", "Appels clients", "Upsell", "Notes commandes"]
    },
    {
        "name": "MARKETER",
        "label": "Affilié & Média",
        "desc": "Acquisition de trafic et tracking performance",
        "color": "#eb4d4b",
        "perms": ["Analytics Marketing", "Accès Pixels", "Rapport ROAS", "Leads générés"]
    },
]


@router.post("/roles", response_model=dict)
def create_role(
    payload: dict,
    _: Any = Depends(deps.get_current_active_user)
):
    """
    Persist a custom role definition. Currently stores the intent and acknowledges -
    role enforcement is handled via the user.role field.
    """
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Le nom du rôle est obligatoire")
    return {"success": True, "message": f"Rôle « {name} » enregistré avec succès"}


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
    Real-time team metrics. qualityIndex/interactionDelay used to be
    hardcoded constants (94.2, 1.4) returned unconditionally regardless of
    actual activity — every store, at every point in time, saw the exact
    same fake numbers. Now genuinely computed from Order/OrderEvent data,
    scoped to the last 30 days to keep this cheap on a free-tier DB (2
    aggregate queries total, no per-row loops).
    """
    total_effectif = db.query(User).count()
    # "En ligne" = a real presence signal (last_seen_at updated by every
    # authenticated request, see deps._get_current_user_impl), not
    # is_active — is_active only means the account isn't disabled, it says
    # nothing about whether the person is actually at their poste right now.
    presence_cutoff = datetime.now() - timedelta(minutes=5)  # noqa: DTZ005
    online_count = db.query(User).filter(User.last_seen_at >= presence_cutoff).count()

    window_start = datetime.now() - timedelta(days=30)  # noqa: DTZ005

    # Average confirmation rate across confirmatrices/agents with at least
    # one order assigned in the window — same CONFIRMED/DELIVERED/SHIPPED
    # definition as get_user_performance, aggregated per agent then averaged.
    per_agent_rates = (
        db.query(
            Order.assigned_to,
            func.count().label("total"),
            func.sum(case((Order.status.in_(["CONFIRMED", "DELIVERED", "SHIPPED"]), 1), else_=0)).label("confirmed"),
        )
        .filter(
            Order.assigned_to.isnot(None),
            Order.is_deleted == False,
            Order.created_at >= window_start,
        )
        .group_by(Order.assigned_to)
        .all()
    )
    rates = [(r.confirmed / r.total) * 100 for r in per_agent_rates if r.total]
    quality_index = round(sum(rates) / len(rates), 1) if rates else None

    # Average minutes between an order's creation and its first recorded
    # event (first confirmatrice touch) — MIN(OrderEvent.created_at) per
    # order, computed in SQL rather than pulled row-by-row into Python.
    first_event_subq = (
        db.query(
            OrderEvent.order_id,
            func.min(OrderEvent.created_at).label("first_event_at"),
        )
        .group_by(OrderEvent.order_id)
        .subquery()
    )
    delay_row = (
        db.query(
            func.avg(
                func.extract("epoch", first_event_subq.c.first_event_at - Order.created_at)
            ).label("avg_seconds")
        )
        .join(first_event_subq, first_event_subq.c.order_id == Order.id)
        .filter(Order.is_deleted == False, Order.created_at >= window_start)
        .one()
    )
    interaction_delay = round(delay_row.avg_seconds / 60, 1) if delay_row.avg_seconds is not None else None

    return InfrastructureStats(
        totalEffectif=total_effectif,
        onlineCount=online_count,
        qualityIndex=quality_index,
        interactionDelay=interaction_delay,
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


@router.post("/me/password", response_model=dict)
def change_own_password(
    payload: dict,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Self-service password change — verifies the current password first.
    Unlike POST /{user_id}/reset-password (ADMIN/MANAGER resetting someone
    else's password without knowing it), this is any authenticated user
    changing their OWN, so it must prove they know the current one.
    Payload: { current_password, new_password }
    """
    from app.core.security import verify_password

    current = payload.get("current_password") or ""
    new_password = payload.get("new_password") or ""

    if not verify_password(current, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect.")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit contenir au moins 6 caractères.")

    current_user.hashed_password = get_password_hash(new_password)  # type: ignore[assignment]
    db.commit()
    return {"success": True, "message": "Mot de passe mis à jour avec succès."}


@router.get("/performance-summary")
def get_users_performance_summary(
    user_ids: str = Query(..., description="Comma-separated user IDs"),
    store_id: Optional[str] = Query(None),
    db: Session = Depends(deps.get_db),
):
    """
    Bulk, list-view-only counterpart to GET /{user_id}/performance.
    MUST be registered before GET /{user_id} — otherwise Starlette matches
    "performance-summary" as a user_id path param and this route is never
    reached at all.

    The "Force de vente" table used to fire ONE full /performance call PER
    ROW (each doing an order aggregation + recent_orders + audit_logs +
    daily-chart query) just to paint a summary badge — free-tier DB budget
    wasted on N+1 round trips for data a single GROUP BY query already
    answers. This collapses it to 2 queries total (order aggregation +
    one user lookup) regardless of how many agents are on the page.

    Trade-off, deliberate: the salary figure here is base pay only
    (delivered_count × payment_amount, or the flat monthly amount) — it
    excludes recovered-cart/upsell bonuses that the full compute_salary()
    adds. That's fine for a quick list-row badge; opening the salary
    dialog for one employee still calls the single-user /performance
    endpoint, which uses compute_salary() and is fully accurate.
    """
    ids = [i.strip() for i in user_ids.split(",") if i.strip()]
    if not ids:
        return {"success": True, "data": {}}

    db.info["skip_tenant_isolation"] = True

    store_filter = (Order.store_id == store_id) if store_id else True
    rows = (
        db.query(
            Order.assigned_to,
            func.count().label("total"),
            func.sum(case((Order.status.in_(["CONFIRMED", "DELIVERED", "SHIPPED"]), 1), else_=0)).label("confirmed"),
            func.sum(case((Order.status == "DELIVERED", 1), else_=0)).label("delivered"),
            func.sum(case((and_(Order.status == "DELIVERED", or_(Order.is_abandoned_cart == True, Order.recovered_at.isnot(None))), 1), else_=0)).label("recovered_delivered"),
            func.sum(case((and_(Order.status == "DELIVERED", or_(Order.is_abandoned_cart == False, Order.is_abandoned_cart.is_(None)), Order.recovered_at.is_(None)), 1), else_=0)).label("normal_delivered"),
            func.sum(case((Order.status == "RETURNED", 1), else_=0)).label("returned"),
        )
        .filter(
            Order.assigned_to.in_(ids),
            store_filter,
            Order.is_deleted == False,
        )
        .group_by(Order.assigned_to)
        .all()
    )
    stats_by_user = {r.assigned_to: r for r in rows}

    users = db.query(User).filter(User.id.in_(ids)).all()

    data = {}
    for u in users:
        r = stats_by_user.get(u.id)
        total = int(r.total or 0) if r else 0
        confirmed = int(r.confirmed or 0) if r else 0
        delivered = int(r.delivered or 0) if r else 0
        recovered_delivered = int(r.recovered_delivered or 0) if r else 0
        normal_delivered = int(r.normal_delivered or 0) if r else 0
        returned = int(r.returned or 0) if r else 0
        rate = round((confirmed / total) * 100) if total else None
        
        # Calculate salary estimate including recovered cart rate
        norm_rate = u.payment_amount or 100
        rec_rate = u.payment_recovered_cart or 150
        pen_rate = u.payment_lost_cart or 0
        if u.payment_type == "MONTHLY_SALARY":
            salary = u.payment_amount or 0
        else:
            salary = (normal_delivered * norm_rate) + (recovered_delivered * rec_rate) - (returned * pen_rate)
            
        data[u.id] = {
            "total_assigned": total,
            "confirmed_count": confirmed,
            "delivered_count": delivered,
            "recovered_delivered_count": recovered_delivered,
            "normal_delivered_count": normal_delivered,
            "returned_count": returned,
            "confirmation_rate": rate,
            "recovered_delivered_rate": round((recovered_delivered / delivered * 100) if delivered else 0, 1),
            "salary": salary,
        }
    return {"success": True, "data": data}


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
            detail="Privilèges insuffisants pour créer un employé."
        )

    # Admins cannot create SUPER_ADMIN accounts
    if False:
        raise HTTPException(
            status_code=403,
            detail="Un administrateur ne peut pas créer un Super Administrateur."
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
            detail="Ce courriel est déjà utilisé par un autre utilisateur."
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
        payment_marketplace_upsell_only=user_in.payment_marketplace_upsell_only if user_in.payment_marketplace_upsell_only is not None else 50,
        assigned_store_scope=user_in.assigned_store_scope or "ALL",
        assigned_store_ids=user_in.assigned_store_ids or [],
        assigned_product_ids=user_in.assigned_product_ids or [],
        permissions=user_in.permissions or [],
        module_visibility=user_in.module_visibility or {},
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
            detail="Privilèges insuffisants pour modifier un employé."
        )

    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    # MANAGER cannot change roles or assign to other stores
    if current_user.role == "MANAGER":
        if hasattr(user_in, 'role') and user_in.role:
            raise HTTPException(status_code=403, detail="Un manager ne peut pas modifier les rôles.")
        if hasattr(user_in, 'employee_store_id') and user_in.employee_store_id and user_in.employee_store_id != current_user.employee_store_id:
            raise HTTPException(status_code=403, detail="Un manager ne peut pas réassigner un employé à une autre boutique.")

    # Check email uniqueness if changing
    if user_in.email and user_in.email != db_user.email:
        email_exists = db.query(User).filter(
            User.email == user_in.email,
            User.id != user_id
        ).first()
        if email_exists:
            raise HTTPException(
                status_code=400,
                detail="Ce courriel est déjà utilisé par un autre utilisateur."
            )

    update_data = user_in.model_dump(exclude_unset=True)

    # Handle password update
    if "password" in update_data and update_data["password"]:
        if len(update_data["password"]) < 6:
            raise HTTPException(status_code=400, detail="Le mot de passe doit contenir au moins 6 caractères.")
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
            detail="Seul un administrateur peut activer/désactiver un compte."
        )

    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    # Cannot deactivate their own account or another SUPER_ADMIN
    if db_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas désactiver votre propre compte.")
    if current_user.role == "MANAGER" and (
        db_user.role in ("SUPER_ADMIN", "ADMIN")
        or (getattr(user_in, "role", None) in ("SUPER_ADMIN", "ADMIN"))
    ):
        raise HTTPException(status_code=403, detail="Un manager ne peut pas modifier ou promouvoir un compte administrateur.")
    if db_user.role == "SUPER_ADMIN" and current_user.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="Accès refusé à ce compte super administrateur.")

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

    action = "activé" if db_user.is_active else "désactivé"
    return {"success": True, "is_active": db_user.is_active, "message": f"Compte {action} avec succès."}


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
        raise HTTPException(status_code=403, detail="Privilèges insuffisants.")

    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    new_password = payload.get("new_password", "")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit contenir au moins 6 caractères.")

    db_user.hashed_password = get_password_hash(new_password)  # type: ignore[assignment]
    db.commit()
    return {"success": True, "message": "Mot de passe réinitialisé avec succès."}


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
            detail="Seul un administrateur peut révoquer l'accès d'un employé."
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
                detail="Impossible de supprimer définitivement cet agent car des commandes lui sont attribuées. Veuillez plutôt le désactiver."
            )
        db.delete(db_user)
        db.commit()
        return {"success": True, "message": "Compte employé supprimé définitivement."}

    # Soft-delete: deactivate
    db_user.is_active = False  # type: ignore[assignment]
    db.commit()
    return {"success": True, "message": "Accès employé révoqué avec succès."}


@router.get("/{user_id}/performance")
def get_user_performance(
    user_id: str,
    store_id: Optional[str] = Query(None),
    period_days: int = 30,
    start_date: Optional[str] = Query(None, description="ISO date, inclusive lower bound on Order.created_at"),
    end_date: Optional[str] = Query(None, description="ISO date, inclusive upper bound on Order.created_at"),
    date_by: str = Query("created_at", description="created_at | delivered_at"),
    db: Session = Depends(deps.get_db),
):
    """Return performance metrics and salary for an employee."""
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
    date_col = func.coalesce(Order.updated_at, Order.created_at) if date_by in ("delivered_at", "updated_at") else Order.created_at
    if since:
        base_q = base_q.filter(date_col >= since)
    if until:
        base_q = base_q.filter(date_col <= until)

    totals_row = base_q.with_entities(
        func.count().label("total"),
        func.sum(case((Order.status.in_(["CONFIRMED", "DELIVERED", "SHIPPED"]), 1), else_=0)).label("confirmed"),
        func.sum(case((Order.status == "DELIVERED", 1), else_=0)).label("delivered"),
        func.sum(case((Order.status == "RETURNED", 1), else_=0)).label("returned"),
        func.sum(case((Order.status == "CANCELLED", 1), else_=0)).label("cancelled"),
        func.sum(case((Order.is_upsell == True, 1), else_=0)).label("upsell"),
        func.sum(case((and_(Order.status.in_(["CONFIRMED", "DELIVERED", "SHIPPED"]), or_(Order.is_abandoned_cart == True, Order.recovered_at.isnot(None))), 1), else_=0)).label("recovered_confirmed"),
        func.sum(case((and_(Order.status == "DELIVERED", or_(Order.is_abandoned_cart == True, Order.recovered_at.isnot(None))), 1), else_=0)).label("recovered_delivered"),
        func.sum(case((and_(Order.status == "DELIVERED", or_(Order.is_abandoned_cart == False, Order.is_abandoned_cart.is_(None)), Order.recovered_at.is_(None)), 1), else_=0)).label("normal_delivered"),
    ).one()
    total_assigned   = totals_row.total or 0
    confirmed_count  = totals_row.confirmed or 0
    delivered_count  = totals_row.delivered or 0
    returned_count   = totals_row.returned or 0
    cancelled_count  = totals_row.cancelled or 0
    upsell_count     = totals_row.upsell or 0
    recovered_confirmed_count = totals_row.recovered_confirmed or 0
    recovered_delivered_count = totals_row.recovered_delivered or 0
    normal_delivered_count    = totals_row.normal_delivered or 0

    salary_data = compute_salary(db, db_user, store_id, since=since, until=until, date_by=date_by)

    # Detailed orders for the period with tracking and carrier status
    period_orders = base_q.order_by(date_col.desc()).limit(250).all()

    audit_logs = (
        db.query(OrderEvent)
        .join(Order, OrderEvent.order_id == Order.id)
        .filter(and_(OrderEvent.actor_id == user_id, store_filter))
        .order_by(OrderEvent.created_at.desc())
        .limit(30)
        .all()
    )

    # ── Daily detailed breakdown (Normal Delivered vs Recovered vs Returns) ──
    daily_breakdown_rows = base_q.with_entities(
        func.date(date_col).label("day"),
        func.sum(case((and_(Order.status == "DELIVERED", or_(Order.is_abandoned_cart == False, Order.is_abandoned_cart.is_(None)), Order.recovered_at.is_(None)), 1), else_=0)).label("normal_delivered"),
        func.sum(case((and_(Order.status == "DELIVERED", or_(Order.is_abandoned_cart == True, Order.recovered_at.isnot(None))), 1), else_=0)).label("recovered_delivered"),
        func.sum(case((Order.status == "RETURNED", 1), else_=0)).label("returned"),
        func.sum(case((Order.status == "DELIVERED", 1), else_=0)).label("total_delivered"),
        func.sum(case((Order.status.in_(["CONFIRMED", "DELIVERED", "SHIPPED"]), 1), else_=0)).label("confirmed"),
    ).group_by(func.date(date_col)).order_by(func.date(date_col).desc()).all()

    norm_rate = int(salary_data.get("payment_amount") or 100)
    rec_rate  = int(salary_data.get("payment_recovered_cart") or 150)
    pen_rate  = int(salary_data.get("payment_lost_cart") or 0)

    daily_breakdown = []
    for row in daily_breakdown_rows:
        if not row.day:
            continue
        n_del = int(row.normal_delivered or 0)
        r_del = int(row.recovered_delivered or 0)
        ret   = int(row.returned or 0)
        tot_del = int(row.total_delivered or 0)
        conf  = int(row.confirmed or 0)
        earnings = (n_del * norm_rate + r_del * rec_rate - ret * pen_rate) if salary_data.get("payment_type") != "MONTHLY_SALARY" else 0
        
        daily_breakdown.append({
            "date": str(row.day),
            "date_formatted": row.day.strftime("%d/%m/%Y") if hasattr(row.day, "strftime") else str(row.day),
            "date_short": row.day.strftime("%d/%m") if hasattr(row.day, "strftime") else str(row.day),
            "normal_delivered": n_del,
            "recovered_delivered": r_del,
            "returned": ret,
            "total_delivered": tot_del,
            "confirmed": conf,
            "daily_earnings": earnings,
        })

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

    # ── 1. Last login / Last activity ─────────────────────────────
    last_event = (
        db.query(OrderEvent.created_at)
        .filter(OrderEvent.actor_id == user_id)
        .order_by(OrderEvent.created_at.desc())
        .first()
    )
    last_seen_dt = db_user.last_seen_at or (last_event[0] if last_event else None)
    last_seen_iso = last_seen_dt.isoformat() if last_seen_dt else None

    # ── 2. Task execution evolution chart & Working Hours ──────────
    task_chart_days = min(period_days, 14)
    task_range_start = (datetime.now() - timedelta(days=task_chart_days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    
    event_daily_rows = db.query(
        func.date(OrderEvent.created_at).label("day"),
        func.count().label("task_count"),
        func.min(OrderEvent.created_at).label("first_action"),
        func.max(OrderEvent.created_at).label("last_action"),
    ).filter(
        and_(
            OrderEvent.actor_id == user_id,
            OrderEvent.created_at >= task_range_start,
        )
    ).group_by(func.date(OrderEvent.created_at)).all()

    tasks_by_day = {}
    day_work_durations = []
    today_str = datetime.now().strftime("%Y-%m-%d")
    today_start_time = None
    today_end_time = None
    today_hours = 0.0

    for row in event_daily_rows:
        day_key = row.day.strftime("%d/%m") if hasattr(row.day, "strftime") else str(row.day)
        day_raw = row.day.strftime("%Y-%m-%d") if hasattr(row.day, "strftime") else str(row.day)
        tasks_by_day[day_key] = row.task_count
        
        if row.first_action and row.last_action:
            duration_hrs = (row.last_action - row.first_action).total_seconds() / 3600.0
            effective_hrs = max(0.5, round(duration_hrs, 1))
            day_work_durations.append(effective_hrs)
            
            if day_raw == today_str:
                today_start_time = row.first_action.strftime("%H:%M")
                today_end_time = row.last_action.strftime("%H:%M")
                today_hours = effective_hrs

    avg_work_hours = round(sum(day_work_durations) / len(day_work_durations), 1) if day_work_durations else 0.0

    task_evolution_chart = []
    for i in range(task_chart_days - 1, -1, -1):
        day = datetime.now() - timedelta(days=i)
        key = day.strftime("%d/%m")
        task_evolution_chart.append({
            "date": key,
            "tasks": tasks_by_day.get(key, 0),
        })

    # Prepare detailed order list
    formatted_orders = []
    for o in period_orders:
        is_rec = bool(o.is_abandoned_cart or o.recovered_at)
        comm_earned = 0
        if o.status == "DELIVERED":
            comm_earned = rec_rate if is_rec else norm_rate
        elif o.status == "RETURNED":
            comm_earned = -pen_rate

        formatted_orders.append({
            "id":                     o.id,
            "order_number":           o.order_number,
            "tracking_number":        o.tracking_number,
            "carrier":                getattr(o, "carrier", None) or "Noest",
            "customer_name":          o.customer_name,
            "customer_phone":         o.customer_phone,
            "wilaya":                 o.customer_wilaya,
            "commune":                o.customer_commune,
            "total":                  o.total,
            "status":                 o.status,
            "is_abandoned_cart":      is_rec,
            "recovered_at":           o.recovered_at.isoformat() if getattr(o, "recovered_at", None) else None,
            "order_type":             "RECOVERED" if is_rec else "NORMAL",
            "created_at":             o.created_at.isoformat() if o.created_at else None,
            "delivered_at":           o.updated_at.isoformat() if o.status == "DELIVERED" and o.updated_at else (o.created_at.isoformat() if o.created_at else None),
            "carrier_tracking_note":  getattr(o, "carrier_tracking_note", None) or getattr(o, "delivery_note", None),
            "commission_amount":      comm_earned,
        })

    return {
        "user": {
            "id":           db_user.id,
            "name":         db_user.name,
            "email":        db_user.email,
            "role":         db_user.role,
            "phone":        db_user.phone,
            "is_active":    db_user.is_active,
            "daily_target": db_user.daily_target or 10,
            "last_seen_at": last_seen_iso,
            "created_at":   db_user.created_at.isoformat() if getattr(db_user, 'created_at', None) else None,
        },
        "working_hours": {
            "today_hours": today_hours,
            "avg_daily_hours": avg_work_hours,
            "start_time": today_start_time or "—",
            "end_time": today_end_time or "—",
            "days_active": len(day_work_durations),
        },
        "task_evolution_chart": task_evolution_chart,
        "daily_breakdown": daily_breakdown,
        "stats": {
            "total_assigned":            total_assigned,
            "confirmed_count":           confirmed_count,
            "delivered_count":           delivered_count,
            "returned_count":            returned_count,
            "cancelled_count":           cancelled_count,
            "upsell_count":              upsell_count,
            "recovered_confirmed_count": recovered_confirmed_count,
            "recovered_delivered_count": recovered_delivered_count,
            "normal_delivered_count":    normal_delivered_count,
            "confirmed_delivered_rate":  round((delivered_count / confirmed_count * 100) if confirmed_count else 0, 1),
            "recovered_delivered_rate":  round((recovered_delivered_count / delivered_count * 100) if delivered_count else 0, 1),
            "salary":                    salary_data["salary"],
            "payment_type":              salary_data["payment_type"],
            "payment_amount":            salary_data["payment_amount"],
            "payment_recovered_cart":                 salary_data.get("payment_recovered_cart", 0),
            "payment_lost_cart":                      salary_data.get("payment_lost_cart", 0),
            "payment_store_pickup":                   salary_data.get("payment_store_pickup", 100),
            "payment_recovered_store_pickup":         salary_data.get("payment_recovered_store_pickup", 150),
            "store_pickup_delivered_count":           salary_data.get("store_pickup_delivered_count", 0),
            "recovered_store_pickup_delivered_count": salary_data.get("recovered_store_pickup_delivered_count", 0),
            "base_salary":               salary_data.get("base_salary", 0),
            "abandoned_bonus":           salary_data.get("abandoned_bonus", 0),
            "recovered_count":           salary_data.get("recovered_count", 0),
            "lost_count":                salary_data.get("lost_count", 0),
            "returned_penalty":          salary_data.get("returned_penalty", 0),
            "payment_upsell":            salary_data.get("payment_upsell", 0),
            "upsell_delivered_count":    salary_data.get("upsell_delivered_count", 0),
            "upsell_bonus":              salary_data.get("upsell_bonus", 0),
            "commission_per_order": (
                salary_data["payment_amount"]
                if salary_data["payment_type"] != "MONTHLY_SALARY"
                else None
            ),
            "confirmation_rate":  round((confirmed_count / total_assigned * 100) if total_assigned else 0, 1),
        },
        "recent_orders": formatted_orders,
        "audit_logs": [
            {
                "id":         a.id,
                "entity":     "Commande",
                "action":     f"{a.from_status or 'NEW'} -> {a.to_status}",
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
        raise HTTPException(status_code=403, detail="Accès non autorisé.")

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


@router.post("/{user_id}/salary/pay", response_model=dict)
def pay_employee_salary(
    user_id: str,
    payload: dict,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Record an actual salary payment as real wallet disbursements.

    An employee who delivered orders across several stores (assigned to
    products/store scopes spanning stores) gets paid from EACH store's own
    till, in proportion to what they actually earned there — never a single
    lump sum yanked from whichever store happened to open the dialog.
    Payload: { store_id, since?, until?, bonus? } — store_id/since/until
    mirror the GET /salary query used to preview the amount; bonus (if any)
    is credited entirely to store_id (the store the admin is acting from).
    """
    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER"):
        raise HTTPException(status_code=403, detail="Privilèges insuffisants pour valider une paie.")

    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    primary_store_id = payload.get("store_id")
    if not primary_store_id:
        raise HTTPException(status_code=400, detail="store_id est requis.")

    if current_user.role == "MANAGER" and current_user.employee_store_id != primary_store_id:
        raise HTTPException(status_code=403, detail="Un manager ne peut valider une paie que pour sa propre boutique.")

    bonus = int(payload.get("bonus") or 0)
    since_raw = payload.get("since")
    until_raw = payload.get("until")
    try:
        since_dt = datetime.fromisoformat(since_raw) if since_raw else None
        until_dt = (
            datetime.fromisoformat(until_raw).replace(hour=23, minute=59, second=59, microsecond=999999)
            if until_raw else None
        )
    except ValueError:
        raise HTTPException(status_code=422, detail="Format de date invalide. Utilisez YYYY-MM-DD.")

    # Every store where this employee actually has DELIVERED orders in the
    # window — this is the real cross-store footprint, not a guess.
    store_filters = [
        Order.assigned_to == user_id,
        Order.status == "DELIVERED",
        Order.is_deleted == False,
    ]
    if since_dt:
        store_filters.append(Order.created_at >= since_dt)
    if until_dt:
        store_filters.append(Order.created_at <= until_dt)
    worked_store_ids = {
        row[0] for row in db.query(Order.store_id).filter(and_(*store_filters)).distinct().all() if row[0]
    }
    worked_store_ids.add(primary_store_id)  # always pay the acting store even with 0 delivered orders (e.g. fixed salary)

    from app.models.finance import Wallet, FinancialTransaction, TransactionType, WalletType

    breakdown = []
    total_paid = 0
    ref = f"PAY-{uuid.uuid4().hex[:8].upper()}"
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    for store_id in sorted(worked_store_ids):
        salary_data = compute_salary(db, db_user, store_id, since=since_dt, until=until_dt)
        portion = int(salary_data.get("salary") or 0)
        if store_id == primary_store_id:
            portion += bonus
        if portion <= 0:
            continue

        wallet = (
            db.query(Wallet)
            .filter(Wallet.store_id == store_id, Wallet.is_active == True)
            .order_by(Wallet.type != WalletType.CASH, Wallet.created_at)
            .first()
        )
        if not wallet:
            raise HTTPException(
                status_code=400,
                detail=f"Aucun portefeuille actif configuré pour la boutique {store_id} — impossible de verser la part due sur cette caisse."
            )

        tx = FinancialTransaction(
            id=str(uuid.uuid4()), reference=ref, wallet_id=wallet.id,
            store_id=store_id, type=TransactionType.DISBURSEMENT, category="SALARY",
            amount=portion, beneficiary=db_user.name,
            description=f"Paie {db_user.name} ({since_raw or '...'} → {until_raw or '...'})",
            transaction_date=now, created_by=current_user.id,
        )
        wallet.balance -= portion
        wallet.total_out += portion
        db.add_all([tx, wallet])

        breakdown.append({"store_id": store_id, "wallet_id": wallet.id, "amount": portion})
        total_paid += portion

    if not breakdown:
        raise HTTPException(status_code=400, detail="Aucun montant à verser (salaire calculé à 0 sur toutes les boutiques concernées).")

    db.commit()

    return {"success": True, "reference": ref, "total_paid": total_paid, "breakdown": breakdown}

