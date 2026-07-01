from fastapi import APIRouter, Depends, Query, HTTPException, Body
from sqlalchemy.orm import Session
from typing import Optional, List, Any
from datetime import datetime, timezone

from app.db.session import get_db
from app.api import deps
from app.models.promotion import Promotion
from app.schemas.promotion import PromotionPagination, Promotion as PromotionSchema, PromotionCreate, PromotionUpdate
from sqlalchemy import desc
import uuid

router = APIRouter()


@router.get("/", response_model=PromotionPagination)
def get_promotions(
    db: Session = Depends(get_db),
    store_id: Optional[str] = None,
    code: Optional[str] = None,
    active: Optional[bool] = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """List promotions with filtering."""
    query = db.query(Promotion)

    # Scope by store
    if current_user.role == "MANAGER" and current_user.employee_store_id:
        query = query.filter(Promotion.store_id == current_user.employee_store_id)
    elif store_id:
        query = query.filter(Promotion.store_id == store_id)

    if code:
        query = query.filter(Promotion.code == code.upper())
    if active is not None:
        query = query.filter(Promotion.is_active == active)

    total = query.count()
    promotions = query.order_by(desc(Promotion.created_at)).offset((page - 1) * pageSize).limit(pageSize).all()

    return {
        "success": True,
        "data": promotions,
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "totalPages": (total + pageSize - 1) // pageSize
    }


@router.post("/validate", response_model=dict)
def validate_promo_code(
    payload: dict = Body(...),
    db: Session = Depends(get_db)
):
    """
    Validate a promo code for the storefront checkout.
    Expected: { code: "PROMO10", store_id: "...", order_total: 5000 }
    Returns discount details if valid.
    """
    code = (payload.get("code") or "").strip().upper()
    store_id = payload.get("store_id")
    order_total = int(payload.get("order_total", 0))

    if not code or not store_id:
        raise HTTPException(status_code=400, detail="code et store_id sont requis.")

    promo = db.query(Promotion).filter(
        Promotion.code == code,
        Promotion.store_id == store_id,
        Promotion.is_active == True
    ).first()

    if not promo:
        return {"valid": False, "message": "Code promo invalide ou expiré."}

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Check validity dates
    if promo.starts_at and promo.starts_at > now:
        return {"valid": False, "message": "Ce code promo n'est pas encore actif."}
    if promo.ends_at and promo.ends_at < now:
        return {"valid": False, "message": "Ce code promo a expiré."}

    # Check flash sale
    if promo.is_flash_sale and promo.flash_sale_ends_at and promo.flash_sale_ends_at < now:
        return {"valid": False, "message": "La vente flash est terminée."}

    # Check max uses
    if promo.max_uses and promo.used_count >= promo.max_uses:
        return {"valid": False, "message": "Ce code promo a atteint sa limite d'utilisation."}

    # Check min order amount
    if promo.min_order_amount and order_total < promo.min_order_amount:
        return {
            "valid": False,
            "message": f"Montant minimum requis: {promo.min_order_amount} DA"
        }

    # Calculate discount
    discount_amount = 0
    if promo.type == "PERCENTAGE":
        discount_amount = int(order_total * promo.value / 100)
    elif promo.type == "FIXED_AMOUNT":
        discount_amount = min(promo.value, order_total)  # Can't exceed total
    elif promo.type == "FREE_SHIPPING":
        discount_amount = 0  # Handled on the frontend for shipping

    return {
        "valid": True,
        "promo_id": promo.id,
        "code": promo.code,
        "type": promo.type,
        "value": promo.value,
        "discount_amount": discount_amount,
        "description": promo.description,
        "message": f"Code promo appliqué ! Réduction de {discount_amount} DA"
    }


@router.post("/", response_model=PromotionSchema)
def create_promotion(
    promo: PromotionCreate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """Create a new promotion code."""
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Privilèges insuffisants.")

    existing = db.query(Promotion).filter(
        Promotion.store_id == promo.store_id,
        Promotion.code == promo.code.upper()
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ce code promo existe déjà pour cette boutique.")

    db_promo = Promotion(
        id=str(uuid.uuid4()),
        **promo.model_dump()
    )
    db_promo.code = db_promo.code.upper()
    db.add(db_promo)
    db.commit()
    db.refresh(db_promo)
    return db_promo


@router.patch("/{id}", response_model=PromotionSchema)
def update_promotion(
    id: str,
    promo_in: PromotionUpdate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """Update promotion details."""
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Privilèges insuffisants.")

    db_promo = db.query(Promotion).filter(Promotion.id == id).first()
    if not db_promo:
        raise HTTPException(status_code=404, detail="Promotion introuvable.")

    update_data = promo_in.model_dump(exclude_unset=True)
    if "code" in update_data:
        update_data["code"] = update_data["code"].upper()

    for field, value in update_data.items():
        if hasattr(db_promo, field):
            setattr(db_promo, field, value)

    db.commit()
    db.refresh(db_promo)
    return db_promo


@router.patch("/{id}/toggle", response_model=dict)
def toggle_promotion(
    id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """Toggle promotion active/inactive."""
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    db_promo = db.query(Promotion).filter(Promotion.id == id).first()
    if not db_promo:
        raise HTTPException(status_code=404, detail="Promotion introuvable.")

    db_promo.is_active = not db_promo.is_active  # type: ignore[assignment]
    db.commit()

    action = "activée" if db_promo.is_active else "désactivée"
    return {
        "success": True,
        "is_active": db_promo.is_active,
        "message": f"Promotion {action} avec succès."
    }


@router.delete("/{id}", response_model=dict)
def delete_promotion(
    id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    """Delete a promotion. ADMIN only."""
    if current_user.role not in ["SUPER_ADMIN", "ADMIN"]:
        raise HTTPException(status_code=403, detail="Seul un administrateur peut supprimer une promotion.")

    db_promo = db.query(Promotion).filter(Promotion.id == id).first()
    if not db_promo:
        raise HTTPException(status_code=404, detail="Promotion introuvable.")

    db.delete(db_promo)
    db.commit()
    return {"success": True, "message": "Promotion supprimée avec succès."}
