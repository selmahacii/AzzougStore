"""
Returns API — Full CRUD for reverse logistics (returns to supplier)
Links to source Purchase, tracks refund status and credit amounts.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid

from app.api.deps import get_db
from app.models.returns import Return, ReturnItem, ReturnReason, RefundStatus, ReturnStatus
from app.models.stock import StockMovement
from app.models.product import Product

router = APIRouter()


# ─── Schemas ──────────────────────────────────────────────

class ReturnItemCreate(BaseModel):
    product_id: str
    product_name: str
    sku: Optional[str] = None
    quantity: int
    unit_credit: int


class ReturnCreate(BaseModel):
    store_id: str
    supplier_id: str
    warehouse_id: str
    purchase_id: Optional[str] = None
    reason: str = "DEFECTIVE"
    note: Optional[str] = None
    reduce_stock: bool = True
    items: List[ReturnItemCreate] = []
    created_by: Optional[str] = None


class ReturnUpdate(BaseModel):
    status: Optional[str] = None
    refund_status: Optional[str] = None
    amount_refunded: Optional[int] = None
    note: Optional[str] = None


class ReturnItemOut(BaseModel):
    id: str
    product_id: str
    product_name: str
    sku: Optional[str]
    quantity: int
    unit_credit: int
    total_credit: int

    class Config:
        from_attributes = True


class ReturnOut(BaseModel):
    id: str
    store_id: str
    supplier_id: str
    warehouse_id: str
    purchase_id: Optional[str]
    reference: str
    total_credit: int
    amount_refunded: int
    reason: str
    refund_status: str
    status: str
    note: Optional[str]
    created_by: Optional[str]
    shipped_at: Optional[datetime]
    closed_at: Optional[datetime]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    items: List[ReturnItemOut] = []

    class Config:
        from_attributes = True


# ─── Helpers ──────────────────────────────────────────────

def _gen_ref(db: Session) -> str:
    count = db.query(Return).count()
    return f"RET-{count + 1:05d}"


# ─── Routes ───────────────────────────────────────────────

@router.get("/", response_model=dict)
def list_returns(
    store_id: str = Query(...),
    search: str = Query(""),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(Return).filter(Return.store_id == store_id)

    if search:
        query = query.filter(Return.reference.ilike(f"%{search}%"))
    if status:
        query = query.filter(Return.status == status)

    total = query.count()
    returns = (
        query
        .options(joinedload(Return.items))
        .order_by(Return.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "success": True,
        "data": [ReturnOut.model_validate(r).model_dump() for r in returns],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{return_id}", response_model=dict)
def get_return(return_id: str, db: Session = Depends(get_db)):
    ret = (
        db.query(Return)
        .options(joinedload(Return.items))
        .filter(Return.id == return_id)
        .first()
    )
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")
    return {"success": True, "data": ReturnOut.model_validate(ret).model_dump()}


@router.post("/", response_model=dict)
def create_return(payload: ReturnCreate, db: Session = Depends(get_db)):
    items = []
    total_credit = 0
    for item_data in payload.items:
        tc = item_data.quantity * item_data.unit_credit
        total_credit += tc
        items.append(ReturnItem(
            id=str(uuid.uuid4()),
            product_id=item_data.product_id,
            product_name=item_data.product_name,
            sku=item_data.sku,
            quantity=item_data.quantity,
            unit_credit=item_data.unit_credit,
            total_credit=tc,
        ))

    try:
        ret = Return(
            id=str(uuid.uuid4()),
            store_id=payload.store_id,
            supplier_id=payload.supplier_id,
            warehouse_id=payload.warehouse_id,
            purchase_id=payload.purchase_id,
            reference=_gen_ref(db),
            reason=payload.reason,
            total_credit=total_credit,
            note=payload.note,
            created_by=payload.created_by,
            items=items,
        )
        db.add(ret)
        
        # Handle automated stock reduction
        if payload.reduce_stock:
            for item_data in payload.items:
                # Lock product to prevent concurrent race conditions
                product = db.query(Product).filter(Product.id == item_data.product_id).with_for_update().first()
                if product:
                    from app.core.exceptions import InsufficientStockError
                    available = (product.stock or 0) - (product.reserved_stock or 0)
                    if available < item_data.quantity:
                        raise InsufficientStockError(
                            product_id=product.id,
                            requested=item_data.quantity,
                            available=available
                        )
                    product.stock = (product.stock or 0) - item_data.quantity
                    movement = StockMovement(**{
                        "id": str(uuid.uuid4()),
                        "product_id": item_data.product_id,
                        "quantity": item_data.quantity,
                        "type": "OUT",
                        "warehouse_id": payload.warehouse_id,
                        "reason": f"Retour Fournisseur #{ret.reference}"
                    })
                    db.add(movement)
                    db.add(product)

        db.commit()
        db.refresh(ret)
        return {"success": True, "data": ReturnOut.model_validate(ret).model_dump()}
    except Exception as e:
        db.rollback()
        if hasattr(e, "status_code"):
            raise e
        from app.core.exceptions import InsufficientStockError
        if isinstance(e, InsufficientStockError):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=500, detail=f"Erreur lors de la création du retour : {str(e)}")


@router.patch("/{return_id}", response_model=dict)
def update_return(return_id: str, payload: ReturnUpdate, db: Session = Depends(get_db)):
    try:
        ret = db.query(Return).filter(Return.id == return_id).first()
        if not ret:
            raise HTTPException(status_code=404, detail="Return not found")

        if payload.status is not None:
            prev_status = ret.status
            ret.status = payload.status
            if payload.status == "CLOSED":
                ret.closed_at = datetime.now(timezone.utc).replace(tzinfo=None)  # type: ignore[assignment]
            elif payload.status == "IN_TRANSIT":
                ret.shipped_at = datetime.now(timezone.utc).replace(tzinfo=None)  # type: ignore[assignment]
            # Reintegrate stock when return is validated/received
            if payload.status in ("RECEIVED", "CLOSED") and prev_status not in ("RECEIVED", "CLOSED"):
                for item in ret.items:
                    # Lock product to prevent race conditions
                    product = db.query(Product).filter(Product.id == item.product_id).with_for_update().first()
                    if product:
                        product.stock = (product.stock or 0) + item.quantity
                        movement = StockMovement(**{
                            "id": str(uuid.uuid4()),
                            "product_id": item.product_id,
                            "quantity": item.quantity,
                            "type": "RETURN_RESTOCK",
                            "reason": f"Réintégration stock retour #{ret.id[:8]}"
                        })
                        db.add(movement)

        if payload.refund_status is not None:
            ret.refund_status = payload.refund_status

        if payload.amount_refunded is not None:
            ret.amount_refunded = payload.amount_refunded

        if payload.note is not None:
            ret.note = payload.note

        db.commit()
        db.refresh(ret)
        return {"success": True, "data": ReturnOut.model_validate(ret).model_dump()}
    except Exception as e:
        db.rollback()
        if hasattr(e, "status_code"):
            raise e
        raise HTTPException(status_code=500, detail=f"Erreur lors de la mise à jour du retour : {str(e)}")


@router.delete("/{return_id}", response_model=dict)
def delete_return(return_id: str, db: Session = Depends(get_db)):
    try:
        ret = db.query(Return).filter(Return.id == return_id).first()
        if not ret:
            raise HTTPException(status_code=404, detail="Return not found")
        db.delete(ret)
        db.commit()
        return {"success": True, "message": "Return deleted"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erreur lors de la suppression du retour : {str(e)}")
