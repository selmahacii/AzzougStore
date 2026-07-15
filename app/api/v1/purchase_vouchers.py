from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
import os

from app.api.deps import get_db
from app.models.purchase import Purchase, PurchaseItem, ReceptionStatus, PaymentStatus
from app.models.product import Product
from app.models.stock import StockMovement
from app.models.supplier import Supplier
from app.core.config import settings

router = APIRouter()

class PurchaseItemSchema(BaseModel):
    product_id: str
    product_name: str
    quantity: int
    unit_cost: int

class PurchaseOrderCreate(BaseModel):
    store_id: str
    supplier_id: str
    warehouse_id: str
    reference: Optional[str] = None
    subtotal: int
    tax_amount: int = 0
    shipping_cost: int = 0
    total: int
    note: Optional[str] = None
    items: List[PurchaseItemSchema]
    created_by: Optional[str] = None

class ReceptionUpdate(BaseModel):
    items_received: List[dict] # [{"item_id": str, "received_qty": int}]
    note: Optional[str] = None
    photos: List[str] = [] # Uploaded photo URLs

def _serialize_purchase(p: Purchase) -> dict:
    return {
        "id": p.id,
        "store_id": p.store_id,
        "supplier_id": p.supplier_id,
        "supplier_name": p.supplier.name if p.supplier else "N/A",
        "warehouse_id": p.warehouse_id,
        "warehouse_name": p.warehouse.name if p.warehouse else "N/A",
        "reference": p.reference,
        "subtotal": p.subtotal,
        "tax_amount": p.tax_amount,
        "shipping_cost": p.shipping_cost,
        "total": p.total,
        "amount_paid": p.amount_paid,
        "payment_status": p.payment_status.value,
        "reception_status": p.reception_status.value,
        "bon_type": p.bon_type,
        "photos": p.photos or [],
        "validated_at": p.validated_at.isoformat() if p.validated_at else None,
        "validated_by": p.validated_by,
        "note": p.note,
        "received_at": p.received_at.isoformat() if p.received_at else None,
        "created_by": p.created_by,
        "items": [{
            "id": item.id,
            "product_id": item.product_id,
            "product_name": item.product_name,
            "sku": item.sku,
            "quantity": item.quantity,
            "unit_cost": item.unit_cost,
            "total_cost": item.total_cost,
            "received_quantity": item.received_quantity
        } for item in p.items]
    }

@router.get("/", response_model=dict)
def list_vouchers(
    store_id: str = Query(...),
    bon_type: Optional[str] = Query(None), # PURCHASE_ORDER | RECEPTION_VOUCHER
    db: Session = Depends(get_db)
):
    query = db.query(Purchase).filter(Purchase.store_id == store_id)
    if bon_type:
        query = query.filter(Purchase.bon_type == bon_type)
    
    vouchers = query.order_by(Purchase.received_at.desc() if bon_type == 'RECEPTION_VOUCHER' else Purchase.id.desc()).all()
    return {"success": True, "data": [_serialize_purchase(v) for v in vouchers]}

@router.get("/{voucher_id}", response_model=dict)
def get_voucher(voucher_id: str, db: Session = Depends(get_db)):
    voucher = db.query(Purchase).filter(Purchase.id == voucher_id).first()
    if not voucher:
        raise HTTPException(status_code=404, detail="Voucher not found")
    return {"success": True, "data": _serialize_purchase(voucher)}

@router.post("/", response_model=dict)
def create_purchase_order(payload: PurchaseOrderCreate, db: Session = Depends(get_db)):
    voucher_id = str(uuid.uuid4())
    ref = payload.reference or f"PO-{str(uuid.uuid4())[:6].upper()}"

    # Verify duplicate reference
    existing = db.query(Purchase).filter(Purchase.reference == ref).first()
    if existing:
        ref = f"PO-{str(uuid.uuid4())[:8].upper()}"

    purchase = Purchase(
        id=voucher_id,
        store_id=payload.store_id,
        supplier_id=payload.supplier_id,
        warehouse_id=payload.warehouse_id,
        reference=ref,
        subtotal=payload.subtotal,
        tax_amount=payload.tax_amount,
        shipping_cost=payload.shipping_cost,
        total=payload.total,
        amount_paid=0,
        payment_status=PaymentStatus.PENDING,
        reception_status=ReceptionStatus.PENDING,
        bon_type="PURCHASE_ORDER",
        note=payload.note,
        created_by=payload.created_by,
        photos=[]
    )
    db.add(purchase)

    for item in payload.items:
        prod = db.query(Product).filter(Product.id == item.product_id).first()
        p_item = PurchaseItem(
            id=str(uuid.uuid4()),
            purchase_id=voucher_id,
            product_id=item.product_id,
            product_name=item.product_name,
            sku=prod.sku if prod else None,
            quantity=item.quantity,
            unit_cost=item.unit_cost,
            total_cost=item.quantity * item.unit_cost,
            received_quantity=0
        )
        db.add(p_item)

    db.commit()
    db.refresh(purchase)
    return {"success": True, "data": _serialize_purchase(purchase)}

@router.post("/{voucher_id}/receive", response_model=dict)
def receive_purchase_order(voucher_id: str, payload: ReceptionUpdate, db: Session = Depends(get_db)):
    purchase = db.query(Purchase).filter(Purchase.id == voucher_id).first()
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase Order not found")

    purchase.bon_type = "RECEPTION_VOUCHER"
    purchase.reception_status = ReceptionStatus.PARTIAL
    purchase.photos = payload.photos
    purchase.received_at = datetime.now()
    if payload.note:
        purchase.note = f"{purchase.note or ''}\nReception Note: {payload.note}"

    # Update received quantities for items
    fully_received = True
    for item_recv in payload.items_received:
        item_id = item_recv.get("item_id")
        qty = item_recv.get("received_qty", 0)

        item = db.query(PurchaseItem).filter(PurchaseItem.id == item_id).first()
        if item:
            item.received_quantity = qty
            if qty < item.quantity:
                fully_received = False
        else:
            fully_received = False

    if fully_received:
        purchase.reception_status = ReceptionStatus.RECEIVED

    db.commit()
    db.refresh(purchase)
    return {"success": True, "data": _serialize_purchase(purchase)}

@router.post("/{voucher_id}/validate", response_model=dict)
def validate_reception_voucher(voucher_id: str, validator_id: str = Query(...), db: Session = Depends(get_db)):
    purchase = db.query(Purchase).filter(Purchase.id == voucher_id).first()
    if not purchase:
        raise HTTPException(status_code=404, detail="Voucher not found")

    if purchase.validated_at:
        raise HTTPException(status_code=400, detail="Voucher already validated")

    try:
        purchase.validated_at = datetime.now()
        purchase.validated_by = validator_id

        # 1. Update product physical stocks in database
        # 2. Log Restock Movements
        for item in purchase.items:
            # Lock the product row to prevent race conditions during restock
            prod = db.query(Product).filter(Product.id == item.product_id).with_for_update().first()
            if prod:
                # Increase physical stock by the received quantity
                prod.stock = (prod.stock or 0) + item.received_quantity

                # Create Restock Movement
                movement = StockMovement(
                    id=str(uuid.uuid4()),
                    product_id=item.product_id,
                    type="RESTOCK",
                    quantity=item.received_quantity,
                    warehouse_id=purchase.warehouse_id,
                    actor_id=validator_id,
                    reason=f"Restocked from reception voucher {purchase.reference}"
                )
                db.add(movement)

        # 3. Update supplier financials to keep coherent supplier ledger!
        # The total purchase order value is added to what we historically owe the supplier
        supplier = db.query(Supplier).filter(Supplier.id == purchase.supplier_id).first()
        if supplier:
            supplier.total_due = (supplier.total_due or 0) + purchase.total
            supplier.total_remaining = (supplier.total_due or 0) - (supplier.total_paid or 0)

        db.commit()
        db.refresh(purchase)
        return {"success": True, "data": _serialize_purchase(purchase)}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erreur lors de la validation du bon : {str(e)}")

@router.post("/{voucher_id}/upload-photo", response_model=dict)
async def upload_photo(voucher_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    purchase = db.query(Purchase).filter(Purchase.id == voucher_id).first()
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")

    # Save locally to uploads/purchases/ folder
    os.makedirs("uploads/purchases", exist_ok=True)
    file_ext = os.path.splitext(file.filename)[1]
    filename = f"{voucher_id}_{uuid.uuid4().hex}{file_ext}"
    filepath = os.path.join("uploads/purchases", filename)

    with open(filepath, "wb") as f:
        f.write(await file.read())

    # Build public url
    public_url = f"/uploads/purchases/{filename}"
    
    # Append to purchase photos list
    photos = list(purchase.photos or [])
    photos.append(public_url)
    purchase.photos = photos
    
    db.commit()
    db.refresh(purchase)
    return {"success": True, "url": public_url, "photos": purchase.photos}
