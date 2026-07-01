# ═══════════════════════════════════════════════════════════════
# AzzougShop — Stock Router (Refactored)
# Manual inventory operations: RESTOCK, MANUAL_ADJUSTMENT.
# ORDER_* movements are handled automatically by order_service.
# ═══════════════════════════════════════════════════════════════

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload

from app.api import deps
from app.core.exceptions import (
    PermissionError,
    ProductNotFoundError,
    ValidationError,
)
from app.db.session import get_db
from app.models.product import Product
from app.models.stock import StockMovement
from app.models.user import User
from app.schemas.stock import (
    MovementPagination,
    StockMovementCreate,
    StockSummary,
)
from app.services.inventory_service import inventory_service

router = APIRouter()
logger = logging.getLogger("app.stock")

# Movement types that can be created manually via this endpoint
_MANUAL_TYPES = {"RESTOCK", "MANUAL_ADJUSTMENT"}


# ─── GET /stock/ — List movements ────────────────────────────────────────────

@router.get("/", response_model=MovementPagination)
def list_movements(
    store_id: Optional[str] = None,
    product_id: Optional[str] = None,
    movement_type: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """Paginated stock movement log, optionally filtered."""
    query = db.query(StockMovement)

    if product_id:
        query = query.filter(StockMovement.product_id == product_id)
    if store_id:
        query = query.join(Product).filter(Product.store_id == store_id)
    if movement_type:
        query = query.filter(StockMovement.type == movement_type)
    if warehouse_id:
        query = query.filter(StockMovement.warehouse_id == warehouse_id)

    query = query.options(joinedload(StockMovement.actor))

    total = query.count()
    movements = (
        query
        .order_by(desc(StockMovement.created_at))
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all()
    )

    return {
        "success": True,
        "data": movements,
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "totalPages": (total + pageSize - 1) // pageSize,
    }


# ─── GET /stock/summary ───────────────────────────────────────────────────────

@router.get("/summary", response_model=dict)
def get_stock_summary(
    store_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(deps.get_current_active_user),
):
    """
    Aggregate stock KPIs for a store:
    - Total active products
    - Total stock value (cost_price × available units)
    - Low-stock count (0 < stock <= low_stock_threshold)
    - Out-of-stock count (stock <= 0)
    - Total available units (stock - reserved_stock)
    """
    logger.info(f"Fetching stock summary for store_id: {store_id}")
    
    products = (
        db.query(Product)
        .filter(Product.store_id == store_id, Product.is_active == True)
        .all()
    )
    logger.info(f"Active products found for summary: {len(products)}")

    total_value = 0
    low_stock = 0
    out_of_stock = 0
    total_available = 0

    for p in products:
        stock_val = p.stock if p.stock is not None else 0
        reserved_val = p.reserved_stock if p.reserved_stock is not None else 0
        threshold_val = p.low_stock_threshold if p.low_stock_threshold is not None else 5
        
        available = max(0, stock_val - reserved_val)
        total_available += available
        total_value += available * (p.cost_price or 0)

        if available <= 0:
            out_of_stock += 1
        elif available <= threshold_val:
            low_stock += 1

    return {
        "success": True,
        "data": {
            "totalProducts": len(products),
            "totalStockValue": total_value,
            "lowStockCount": low_stock,
            "outOfStockCount": out_of_stock,
            "totalAvailableStock": total_available,
        },
    }


# ─── GET /stock/alerts ────────────────────────────────────────────────────────

@router.get("/alerts", response_model=dict)
def get_stock_alerts(
    store_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(deps.get_current_active_user),
):
    """Return products that are at or below their low_stock_threshold, considering variant stocks."""
    query = db.query(Product).filter(Product.is_active == True)
    if store_id:
        query = query.filter(Product.store_id == store_id)

    products = query.all()
    threshold = lambda p: p.low_stock_threshold if p.low_stock_threshold is not None else 5
    
    alerts = []
    for p in products:
        is_alert = False
        lowest_stock = p.stock or 0
        
        # Check variants if present
        if p.variants:
            for v in p.variants:
                if isinstance(v, dict):
                    v_stock = int(v.get("stock") or 0)
                    v_reserved = int(v.get("reserved") or 0)
                    v_available = max(0, v_stock - v_reserved)
                    if v_available <= threshold(p):
                        is_alert = True
                    if v_available < lowest_stock:
                        lowest_stock = v_available
        else:
            p_available = max(0, (p.stock or 0) - (p.reserved_stock or 0))
            if p_available <= threshold(p):
                is_alert = True
                lowest_stock = p_available
                
        if is_alert:
            alerts.append((p, lowest_stock))

    # Sort by lowest stock
    alerts_sorted = sorted(alerts, key=lambda item: item[1])

    data = [
        {
            "id": str(p.id),
            "name": p.name if not p.variants else f"{p.name} (Variantes)",
            "stock": lowest_stock,
            "low_stock_threshold": threshold(p),
            "main_image": p.main_image,
            "sku": p.sku,
            "store_id": str(p.store_id) if p.store_id else None,
        }
        for p, lowest_stock in alerts_sorted
    ]

    return {"success": True, "data": data, "total": len(data)}


# ─── POST /stock/ — Manual movement ──────────────────────────────────────────

@router.post("/", response_model=dict, status_code=201)
def create_movement(
    movement: StockMovementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Create a manual stock movement (RESTOCK or MANUAL_ADJUSTMENT).

    ORDER_* movements are NOT accepted here — they are created automatically
    by order_service during order status transitions.

    RESTOCK: quantity must be > 0.
    MANUAL_ADJUSTMENT: quantity can be negative (shrinkage, loss).
    """
    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER"):
        raise PermissionError(message="Seul un gestionnaire peut effectuer des ajustements de stock.")

    if movement.type not in _MANUAL_TYPES:
        raise ValidationError(
            message=f"Type de mouvement manuel invalide: '{movement.type}'. "
                    f"Autorisés: {', '.join(_MANUAL_TYPES)}. "
                    f"Les mouvements ORDER_* sont gérés automatiquement."
        )

    # Validate product belongs to specified store
    product = db.query(Product).filter(Product.id == movement.product_id).first()
    if not product:
        raise ProductNotFoundError()
    if movement.store_id and product.store_id != movement.store_id:
        raise PermissionError(message="Le produit n'appartient pas à la boutique spécifiée.")

    try:
        if movement.type == "RESTOCK":
            if movement.quantity <= 0:
                raise ValidationError(message="La quantité de réapprovisionnement doit être positive.")
            inventory_service.restock(
                db,
                product_id=movement.product_id,
                quantity=movement.quantity,
                actor_id=current_user.id,
                warehouse_id=movement.warehouse_id,
                reason=movement.reason,
                variant_details=movement.variant_details,
            )
        elif movement.type == "MANUAL_ADJUSTMENT":
            inventory_service.manual_adjustment(
                db,
                product_id=movement.product_id,
                quantity=movement.quantity,
                actor_id=current_user.id,
                reason=movement.reason or "Ajustement manuel",
                variant_details=movement.variant_details,
            )

        db.commit()
        db.refresh(product)

        logger.info(
            "Manual stock movement: product=%s type=%s qty=%+d actor=%s",
            movement.product_id, movement.type, movement.quantity, current_user.id,
        )

        return {
            "success": True,
            "data": {
                "id": product.id,
                "stock": product.stock,
                "reserved_stock": product.reserved_stock,
                "available_stock": max(0, product.stock - product.reserved_stock),
            },
        }
    except Exception as e:
        db.rollback()
        logger.error("Error executing manual stock movement: %s", e, exc_info=True)
        from fastapi import HTTPException
        from app.core.exceptions import InsufficientStockError
        if isinstance(e, (InsufficientStockError, ValidationError, ProductNotFoundError, PermissionError)):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))
