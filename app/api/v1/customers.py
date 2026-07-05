from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, desc, asc
from typing import Optional, List, Any

from app.db.session import get_db
from app.api import deps
from app.models.customer import Customer
from app.models.order import Order
from app.models.user import User
from app.schemas.customer import CustomerPagination, Customer as CustomerSchema, CustomerCreate, CustomerUpdate
import uuid

router = APIRouter()


@router.get("/", response_model=CustomerPagination)
def get_customers(
    db: Session = Depends(get_db),
    store_id: Optional[str] = None,
    phone: Optional[str] = None,
    tier: Optional[str] = None,
    search: Optional[str] = None,
    wilaya: Optional[str] = None,
    blacklisted: Optional[bool] = None,
    source: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=2000),
    sortBy: str = "total_spent",
    sortDir: str = "desc",
    current_user: Any = Depends(deps.get_current_active_user)
):
    query = db.query(Customer)

    # Role-based scope
    if current_user.role == "MANAGER" and current_user.employee_store_id:
        query = query.filter(Customer.store_id == current_user.employee_store_id)
    elif store_id:
        query = query.filter(Customer.store_id == store_id)

    if phone:
        query = query.filter(Customer.phone.contains(phone))
    if tier:
        query = query.filter(Customer.tier == tier)
    if wilaya:
        query = query.filter(Customer.wilaya == wilaya)
    if blacklisted is not None:
        query = query.filter(Customer.is_blacklisted == blacklisted)
    if source:
        query = query.filter(Customer.source == source.upper())
    if search:
        query = query.filter(or_(
            Customer.name.ilike(f"%{search}%"),
            Customer.phone.ilike(f"%{search}%"),
            Customer.email.ilike(f"%{search}%")
        ))

    if start_date:
        from datetime import datetime
        try:
            sd = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
            query = query.filter(Customer.created_at >= sd)
        except ValueError:
            pass
            
    if end_date:
        from datetime import datetime
        try:
            ed = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
            query = query.filter(Customer.created_at <= ed)
        except ValueError:
            pass

    # Sorting with safety check
    allowed_sort = ["total_spent", "total_orders", "created_at", "name"]
    if sortBy not in allowed_sort:
        sortBy = "total_spent"

    sort_col = getattr(Customer, sortBy, Customer.total_spent)
    query = query.order_by(desc(sort_col) if sortDir == "desc" else asc(sort_col))

    total = query.count()
    customers = query.offset((page - 1) * pageSize).limit(pageSize).all()

    # Collect phones + emails to batch-check registered accounts
    phones = {c.phone for c in customers if c.phone}
    emails = {c.email for c in customers if c.email}
    registered_phones: set = set()
    registered_emails: set = set()
    if phones:
        rows = db.query(User.phone).filter(User.phone.in_(phones)).all()
        registered_phones = {r[0] for r in rows if r[0]}
    if emails:
        rows = db.query(User.email).filter(User.email.in_(emails)).all()
        registered_emails = {r[0] for r in rows if r[0]}

    customer_dicts = []
    for c in customers:
        d = {col.name: getattr(c, col.name) for col in c.__table__.columns}
        d["has_account"] = bool(
            (c.phone and c.phone in registered_phones) or
            (c.email and c.email in registered_emails)
        )
        customer_dicts.append(d)

    return {
        "success": True,
        "data": customer_dicts,
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "totalPages": (total + pageSize - 1) // pageSize
    }


@router.get("/stats")
def get_customer_stats(
    store_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get customer analytics: total count, tier distribution, and top spenders.
    """
    try:
        base = db.query(Customer)
        if store_id:
            base = base.filter(Customer.store_id == store_id)

        total = base.count()

        # ── Source distribution ──────────────────────────────────
        from sqlalchemy import case
        source_rows = db.query(
            Customer.source,
            func.count(Customer.id).label("cnt")
        )
        if store_id:
            source_rows = source_rows.filter(Customer.store_id == store_id)
        source_rows = source_rows.group_by(Customer.source).all()

        source_map: dict = {"MANUAL": 0, "INVITED": 0, "ACCOUNT": 0, "ORDER": 0}
        for row in source_rows:
            key = str(row[0] or "MANUAL").upper()
            if key in source_map:
                source_map[key] = int(row[1])
            else:
                source_map["MANUAL"] += int(row[1])

        # ── Blacklisted count ────────────────────────────────────
        blacklisted_count = base.filter(Customer.is_blacklisted == True).count()

        # ── New this month ───────────────────────────────────────
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        new_this_month = base.filter(Customer.created_at >= month_start).count()

        # ── Tier Distribution ────────────────────────────────────
        tier_rows = db.query(
            Customer.tier,
            func.count(Customer.id).label("count"),
            func.sum(Customer.total_spent).label("revenue")
        )
        if store_id:
            tier_rows = tier_rows.filter(Customer.store_id == store_id)
        tier_dist = [
            {"tier": str(t[0] or "BRONZE"), "count": int(t[1] or 0), "revenue": float(t[2] or 0)}
            for t in tier_rows.group_by(Customer.tier).all()
        ]

        # ── Top Customers ────────────────────────────────────────
        top_customers = base.order_by(desc(Customer.total_spent)).limit(5).all()

        return {
            "success": True,
            "data": {
                "totalCustomers": total,
                "newThisMonth": new_this_month,
                "blacklistedCount": blacklisted_count,
                # Source counts — frontend reads source_manual, source_invited, etc.
                "source_manual":  source_map["MANUAL"],
                "source_invited": source_map["INVITED"],
                "source_account": source_map["ACCOUNT"],
                "source_order":   source_map["ORDER"],
                "sources": source_map,
                "tierDistribution": tier_dist,
                "topCustomers": [
                    {
                        "id": str(c.id),
                        "name": str(c.name),
                        "phone": str(c.phone),
                        "tier": str(c.tier or "BRONZE"),
                        "totalSpent": int(c.total_spent or 0),
                        "totalOrders": int(c.total_orders or 0),
                        "source": str(c.source or "MANUAL"),
                    }
                    for c in top_customers
                ]
            }
        }
    except Exception as e:
        import logging, traceback
        logging.error(f"Error in get_customer_stats: {str(e)}")
        logging.error(traceback.format_exc())
        return {
            "success": False,
            "message": f"Erreur: {str(e)}",
            "data": {
                "totalCustomers": 0, "newThisMonth": 0, "blacklistedCount": 0,
                "source_manual": 0, "source_invited": 0, "source_account": 0, "source_order": 0,
                "sources": {}, "tierDistribution": [], "topCustomers": []
            }
        }


@router.get("/{customer_id}", response_model=CustomerSchema)
def get_customer(
    customer_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """Get a single customer with full profile."""
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Client introuvable.")
    return customer


@router.get("/{customer_id}/orders", response_model=dict)
def get_customer_orders(
    customer_id: str,
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    pageSize: int = Query(10, ge=1, le=50),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """Get order history for a specific customer."""
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Client introuvable.")

    query = db.query(Order).filter(
        Order.customer_id == customer_id,
        Order.is_deleted == False
    ).order_by(Order.created_at.desc())

    total = query.count()
    orders = query.offset((page - 1) * pageSize).limit(pageSize).all()

    return {
        "success": True,
        "data": [
            {
                "id": o.id,
                "order_number": o.order_number,
                "status": o.status,
                "total": o.total,
                "created_at": o.created_at.isoformat() if o.created_at else None
            }
            for o in orders
        ],
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "totalPages": (total + pageSize - 1) // pageSize
    }


@router.get("/{customer_id}/account", response_model=dict)
def get_customer_account(
    customer_id: str,
    db: Session = Depends(get_db),
    _: Any = Depends(deps.get_current_active_user)
):
    """Return linked User account info for a customer (matched by phone or email)."""
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Client introuvable.")

    user = None
    if customer.phone:
        user = db.query(User).filter(User.phone == customer.phone).first()
    if not user and customer.email:
        user = db.query(User).filter(User.email == customer.email).first()

    if not user:
        return {"success": True, "has_account": False, "account": None}

    orders = db.query(Order).filter(
        Order.customer_id == customer_id, Order.is_deleted == False
    ).all()

    delivered = [o for o in orders if o.status == "DELIVERED"]
    returned = [o for o in orders if o.status == "RETURNED"]
    total_spent = sum(o.total for o in delivered)

    return {
        "success": True,
        "has_account": True,
        "account": {
            "user_id": str(user.id),
            "name": user.name,
            "email": user.email,
            "phone": user.phone,
            "is_active": user.is_active,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "total_orders": len(orders),
            "delivered_orders": len(delivered),
            "returned_orders": len(returned),
            "total_spent": total_spent,
            "avg_order_value": total_spent // len(delivered) if delivered else 0,
            "tier": customer.tier,
        }
    }


@router.post("/", response_model=CustomerSchema)
def create_customer(
    customer_in: CustomerCreate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """Create a new customer manually."""
    existing = db.query(Customer).filter(
        Customer.phone == customer_in.phone,
        Customer.store_id == customer_in.store_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Un client avec ce numéro de téléphone existe déjà dans cette boutique.")

    db_customer = Customer(
        id=str(uuid.uuid4()),
        **customer_in.model_dump()
    )
    db.add(db_customer)
    db.commit()
    db.refresh(db_customer)
    return db_customer


@router.patch("/{customer_id}", response_model=CustomerSchema)
def update_customer(
    customer_id: str,
    customer_update: CustomerUpdate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """Update customer details."""
    db_customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not db_customer:
        raise HTTPException(status_code=404, detail="Client introuvable.")

    update_data = customer_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if hasattr(db_customer, field):
            setattr(db_customer, field, value)

    db.commit()
    db.refresh(db_customer)
    return db_customer


@router.patch("/{customer_id}/blacklist", response_model=dict)
def toggle_blacklist(
    customer_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """
    Toggle customer blacklist status.
    Expected payload: { blacklist_note: "raison..." }
    Requires ADMIN or MANAGER role.
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Privilèges insuffisants pour gérer la liste noire.")

    db_customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not db_customer:
        raise HTTPException(status_code=404, detail="Client introuvable.")

    db_customer.is_blacklisted = not db_customer.is_blacklisted
    if db_customer.is_blacklisted:
        db_customer.blacklist_note = payload.get("blacklist_note", "Blacklisté par l'administrateur")
    else:
        db_customer.blacklist_note = None

    db.commit()
    db.refresh(db_customer)

    action = "blacklisté" if db_customer.is_blacklisted else "réhabilité"
    return {
        "success": True,
        "is_blacklisted": db_customer.is_blacklisted,
        "message": f"Client {action} avec succès."
    }


@router.delete("/{customer_id}", response_model=dict)
def delete_customer(
    customer_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """Remove a customer. ADMIN only."""
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Privilèges insuffisants pour supprimer un client.")

    db_customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not db_customer:
        raise HTTPException(status_code=404, detail="Client introuvable.")

    db.delete(db_customer)
    db.commit()
    return {"success": True, "message": "Client supprimé avec succès."}


@router.post("/invite", response_model=dict)
def invite_customer(
    payload: dict,
    db: Session = Depends(get_db),
    _: Any = Depends(deps.get_current_active_user)
):
    """Generate a customer invite token (or create guest customer if phone provided)."""
    store_id = payload.get("store_id")
    phone = payload.get("phone", "").strip()
    note = payload.get("note", "")

    if not store_id:
        raise HTTPException(status_code=400, detail="store_id requis")

    invite_token = str(uuid.uuid4())

    if phone:
        existing = db.query(Customer).filter(
            Customer.store_id == store_id,
            Customer.phone == phone
        ).first()
        if not existing:
            guest = Customer(
                id=str(uuid.uuid4()),
                store_id=store_id,
                phone=phone,
                name=phone,
                is_guest=True,
                source="INVITED",
                blacklist_note=note or None,
            )
            db.add(guest)
            db.commit()

    return {"success": True, "invite_token": invite_token}
