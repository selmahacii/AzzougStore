"""
Purchases API — Full CRUD for purchase orders (PO) management
Includes line items (PurchaseItem) create/read within a PO.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid

from app.api.deps import get_db
from app.models.purchase import Purchase, PurchaseItem, PaymentStatus, ReceptionStatus
from app.models.supplier import Supplier
from app.models.finance import Wallet, FinancialTransaction, TransactionType

router = APIRouter()


# ─── Schemas ──────────────────────────────────────────────

class PurchaseItemCreate(BaseModel):
    product_id: str
    product_name: str
    sku: Optional[str] = None
    quantity_ordered: int
    quantity_received: int
    unit_cost: int


class PurchaseCreate(BaseModel):
    store_id: str
    supplier_id: str
    warehouse_id: str
    note: Optional[str] = None
    items: List[PurchaseItemCreate] = []
    created_by: Optional[str] = None


class PurchaseUpdate(BaseModel):
    payment_status: Optional[str] = None
    reception_status: Optional[str] = None
    amount_paid: Optional[int] = None
    note: Optional[str] = None


class PurchaseItemOut(BaseModel):
    id: str
    product_id: str
    product_name: str
    sku: Optional[str] = None
    quantity: int = 0
    unit_cost: int = 0
    total_cost: int = 0
    received_quantity: int = 0

    class Config:
        from_attributes = True


class PurchaseOut(BaseModel):
    id: str
    store_id: str
    supplier_id: str
    warehouse_id: str
    reference: str
    subtotal: int = 0
    tax_amount: int = 0
    shipping_cost: int = 0
    total: int = 0
    amount_paid: int = 0
    payment_status: str
    reception_status: str
    note: Optional[str] = None
    created_by: Optional[str] = None
    received_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    items: List[PurchaseItemOut] = []

    class Config:
        from_attributes = True


# ─── Helpers ──────────────────────────────────────────────

def _gen_ref(db: Session) -> str:
    """Generate next PO reference like PO-00001"""
    count = db.query(Purchase).count()
    return f"PO-{count + 1:05d}"


# ─── Routes ───────────────────────────────────────────────

@router.get("/", response_model=dict)
def list_purchases(
    store_id: str = Query(...),
    search: str = Query(""),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(Purchase).filter(Purchase.store_id == store_id)

    if search:
        query = query.filter(
            Purchase.reference.ilike(f"%{search}%")
        )
    if status:
        query = query.filter(Purchase.reception_status == status)

    total = query.count()
    purchases = (
        query
        .options(joinedload(Purchase.items))
        .order_by(Purchase.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "success": True,
        "data": [PurchaseOut.model_validate(p).model_dump() for p in purchases],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{purchase_id}", response_model=dict)
def get_purchase(purchase_id: str, db: Session = Depends(get_db)):
    purchase = (
        db.query(Purchase)
        .options(joinedload(Purchase.items))
        .filter(Purchase.id == purchase_id)
        .first()
    )
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return {"success": True, "data": PurchaseOut.model_validate(purchase).model_dump()}


@router.post("/", response_model=dict)
def create_purchase(payload: PurchaseCreate, db: Session = Depends(get_db)):
    # Build items
    items = []
    subtotal = 0
    for item_data in payload.items:
        total_cost = item_data.quantity_ordered * item_data.unit_cost
        subtotal += total_cost
        items.append(PurchaseItem(
            id=str(uuid.uuid4()),
            product_id=item_data.product_id,
            product_name=item_data.product_name,
            sku=item_data.sku,
            quantity=item_data.quantity_ordered,
            received_quantity=item_data.quantity_received,
            unit_cost=item_data.unit_cost,
            total_cost=total_cost,
        ))

    purchase = Purchase(
        id=str(uuid.uuid4()),
        store_id=payload.store_id,
        supplier_id=payload.supplier_id,
        warehouse_id=payload.warehouse_id,
        reference=_gen_ref(db),
        subtotal=subtotal,
        total=subtotal,
        note=payload.note,
        created_by=payload.created_by,
        items=items,
    )
    db.add(purchase)

    # Update supplier ledger
    supplier = db.query(Supplier).filter(Supplier.id == payload.supplier_id).first()
    if supplier:
        supplier.total_due += subtotal
        supplier.total_remaining = supplier.total_due - supplier.total_paid

    db.commit()
    db.refresh(purchase)
    return {"success": True, "data": PurchaseOut.model_validate(purchase).model_dump()}


@router.patch("/{purchase_id}", response_model=dict)
def update_purchase(purchase_id: str, payload: PurchaseUpdate, db: Session = Depends(get_db)):
    purchase = db.query(Purchase).filter(Purchase.id == purchase_id).first()
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")

    update_data = payload.model_dump(exclude_unset=True)

    # Handle payment tracking
    if "amount_paid" in update_data:
        old_paid = purchase.amount_paid or 0
        new_paid = update_data["amount_paid"]
        diff = new_paid - old_paid
        purchase.amount_paid = new_paid
        if new_paid >= purchase.total:
            purchase.payment_status = PaymentStatus.PAID
        elif new_paid > 0:
            purchase.payment_status = PaymentStatus.PARTIAL

        # Update supplier ledger
        supplier = db.query(Supplier).filter(Supplier.id == purchase.supplier_id).first()
        if supplier:
            supplier.total_paid += diff
            supplier.total_remaining = supplier.total_due - supplier.total_paid
            
        # Update Treasury (Wallet)
        if diff > 0:
            wallet = db.query(Wallet).filter(Wallet.store_id == purchase.store_id).first()
            if wallet:
                tx = FinancialTransaction(
                    id=str(uuid.uuid4()),
                    reference=f"PUR-{purchase.reference}-{int(datetime.now(timezone.utc).timestamp())}",
                    wallet_id=wallet.id,
                    store_id=purchase.store_id,
                    type=TransactionType.DISBURSEMENT,
                    category="supplier_payment",
                    amount=-diff,
                    description=f"Paiement Fournisseur ({supplier.name if supplier else 'Inconnu'}) - {purchase.reference}",
                    transaction_date=datetime.now(timezone.utc).replace(tzinfo=None),
                )
                wallet.balance -= diff
                wallet.total_out += diff
                db.add(tx)

    if "reception_status" in update_data:
        purchase.reception_status = update_data["reception_status"]
        if update_data["reception_status"] == "RECEIVED":
            purchase.received_at = datetime.now(timezone.utc).replace(tzinfo=None)  # type: ignore[assignment]

    if "payment_status" in update_data:
        purchase.payment_status = update_data["payment_status"]

    if "note" in update_data:
        purchase.note = update_data["note"]

    db.commit()
    db.refresh(purchase)
    return {"success": True, "data": PurchaseOut.model_validate(purchase).model_dump()}


@router.delete("/{purchase_id}", response_model=dict)
def delete_purchase(purchase_id: str, db: Session = Depends(get_db)):
    purchase = db.query(Purchase).filter(Purchase.id == purchase_id).first()
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    db.delete(purchase)
    db.commit()
    return {"success": True, "message": "Purchase deleted"}
