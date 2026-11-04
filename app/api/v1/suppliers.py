"""
Suppliers API — Full CRUD for supplier/partner management
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Column, String, Float, Date, Text, ForeignKey
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime, timezone
import uuid

from app.api.deps import get_db
from app.db.base_class import Base
from app.models.supplier import Supplier


# ─── Inline purchase history model ───────────────────────────
class SupplierPurchase(Base):
    __tablename__ = "supplier_purchases"  # pyrefly: ignore[bad-override]

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    supplier_id = Column(String, ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False, index=True)
    store_id = Column(String, nullable=False)
    product_name = Column(String, nullable=False)
    quantity = Column(Float, default=1)
    unit_cost = Column(Float, nullable=False)
    total_cost = Column(Float, nullable=False)
    purchase_date = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(String, default=lambda: datetime.now(timezone.utc).isoformat())  # pyrefly: ignore[bad-override-mutable-attribute]

router = APIRouter()


# ─── Schemas ──────────────────────────────────────────────

class FeeItem(BaseModel):
    label: str
    amount: float
    fee_type: str = "fixed"      # fixed | percentage | per_unit | per_kg
    is_recurring: bool = False


class SupplierCreate(BaseModel):
    store_id: str
    name: str
    code: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    tax_id: Optional[str] = None
    bank_account: Optional[str] = None
    supply_category: Optional[str] = None
    note: Optional[str] = None
    payment_terms_days: Optional[int] = 30
    lead_time_days: Optional[int] = 7
    min_order_qty: Optional[int] = None
    min_order_amount: Optional[int] = None
    credit_limit: Optional[int] = None
    discount_rate: Optional[float] = 0.0
    currency: Optional[str] = "DZD"
    delivery_method: Optional[str] = "standard"
    return_policy: Optional[str] = None
    fees: Optional[List[dict]] = []
    reliability_score: Optional[float] = 100.0
    custom_fields: Optional[dict] = {}
    purchase_price: Optional[int] = None
    margin_percent: Optional[float] = None
    extra_charges: Optional[List[dict]] = []


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    tax_id: Optional[str] = None
    bank_account: Optional[str] = None
    supply_category: Optional[str] = None
    note: Optional[str] = None
    is_active: Optional[bool] = None
    is_verified: Optional[bool] = None
    reliability_score: Optional[float] = None
    payment_terms_days: Optional[int] = None
    lead_time_days: Optional[int] = None
    min_order_qty: Optional[int] = None
    min_order_amount: Optional[int] = None
    credit_limit: Optional[int] = None
    discount_rate: Optional[float] = None
    currency: Optional[str] = None
    delivery_method: Optional[str] = None
    return_policy: Optional[str] = None
    fees: Optional[List[dict]] = None
    custom_fields: Optional[dict] = None
    purchase_price: Optional[int] = None
    margin_percent: Optional[float] = None
    extra_charges: Optional[List[dict]] = None


class SupplierOut(BaseModel):
    id: str
    store_id: str
    name: str
    code: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    address: Optional[str]
    city: Optional[str]
    tax_id: Optional[str]
    bank_account: Optional[str] = None
    supply_category: Optional[str] = None
    total_due: int
    total_paid: int
    total_remaining: int
    reliability_score: float
    note: Optional[str]
    is_active: bool
    is_verified: bool
    payment_terms_days: Optional[int] = 30
    lead_time_days: Optional[int] = 7
    min_order_qty: Optional[int] = None
    min_order_amount: Optional[int] = None
    credit_limit: Optional[int] = None
    discount_rate: Optional[float] = 0.0
    currency: Optional[str] = "DZD"
    delivery_method: Optional[str] = "standard"
    return_policy: Optional[str] = None
    fees: Optional[List[dict]] = []
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    custom_fields: Optional[dict] = {}
    purchase_price: Optional[int] = None
    margin_percent: Optional[float] = None
    extra_charges: Optional[List[dict]] = []

    @field_validator('payment_terms_days', mode='before')
    @classmethod
    def _v_ptd(cls, v): return 30 if v is None else v

    @field_validator('lead_time_days', mode='before')
    @classmethod
    def _v_ltd(cls, v): return 7 if v is None else v

    @field_validator('discount_rate', mode='before')
    @classmethod
    def _v_dr(cls, v): return 0.0 if v is None else v

    @field_validator('currency', mode='before')
    @classmethod
    def _v_cur(cls, v): return 'DZD' if v is None else v

    @field_validator('delivery_method', mode='before')
    @classmethod
    def _v_dm(cls, v): return 'standard' if v is None else v

    @field_validator('total_due', 'total_paid', 'total_remaining', mode='before')
    @classmethod
    def _v_totals(cls, v): return 0 if v is None else v

    @field_validator('reliability_score', mode='before')
    @classmethod
    def _v_rs(cls, v): return 100.0 if v is None else v

    @field_validator('is_active', mode='before')
    @classmethod
    def _v_active(cls, v): return True if v is None else v

    @field_validator('is_verified', mode='before')
    @classmethod
    def _v_verified(cls, v): return False if v is None else v

    @field_validator('fees', mode='before')
    @classmethod
    def _v_fees(cls, v): return [] if v is None else v

    @field_validator('custom_fields', mode='before')
    @classmethod
    def _v_cf(cls, v): return {} if v is None else v

    @field_validator('extra_charges', mode='before')
    @classmethod
    def _v_ec(cls, v): return [] if v is None else v

    class Config:
        from_attributes = True


# ─── Routes ───────────────────────────────────────────────

@router.get("/", response_model=dict)
def list_suppliers(
    store_id: str = Query(...),
    search: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(Supplier).filter(Supplier.store_id == store_id)

    if search:
        query = query.filter(
            Supplier.name.ilike(f"%{search}%")
            | Supplier.code.ilike(f"%{search}%")
            | Supplier.email.ilike(f"%{search}%")
        )

    total = query.count()
    suppliers = query.order_by(Supplier.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "success": True,
        "data": [SupplierOut.model_validate(s).model_dump() for s in suppliers],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ─── GET /suppliers/scorecards — Section 8 "Fournisseurs" ──────────────────
# Doit rester AVANT /{supplier_id} (routage par ordre d'enregistrement).

@router.get("/scorecards", response_model=dict)
def get_supplier_scorecards(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
):
    from sqlalchemy import func as sqlfunc
    from app.models.purchase import Purchase, PurchaseItem
    from app.models.returns import Return

    suppliers = db.query(Supplier).filter(Supplier.store_id == store_id).all()
    if not suppliers:
        return {"success": True, "data": []}
    sids = [s.id for s in suppliers]

    purchase_rows = dict(
        (r[0], r) for r in db.query(
            Purchase.supplier_id,
            sqlfunc.count(Purchase.id),
            sqlfunc.coalesce(sqlfunc.sum(Purchase.total), 0),
            sqlfunc.max(Purchase.created_at),
        )
        .filter(Purchase.supplier_id.in_(sids), Purchase.bon_type == "PURCHASE_ORDER")
        .group_by(Purchase.supplier_id)
        .all()
    )
    return_counts = dict(
        db.query(Return.supplier_id, sqlfunc.count(Return.id))
        .filter(Return.supplier_id.in_(sids))
        .group_by(Return.supplier_id)
        .all()
    )
    # "Produits" par fournisseur : Product n'a pas de supplier_id (un
    # produit n'est pas lié à un fournisseur unique dans ce schéma) —
    # approximé par les produits distincts achetés via bon de commande.
    product_counts = dict(
        db.query(Purchase.supplier_id, sqlfunc.count(sqlfunc.distinct(PurchaseItem.product_id)))
        .join(PurchaseItem, PurchaseItem.purchase_id == Purchase.id)
        .filter(Purchase.supplier_id.in_(sids))
        .group_by(Purchase.supplier_id)
        .all()
    )

    # Délai moyen réel : received_at - created_at, sur les bons reçus
    delay_rows = (
        db.query(Purchase.supplier_id, Purchase.created_at, Purchase.received_at)
        .filter(Purchase.supplier_id.in_(sids), Purchase.received_at.isnot(None))
        .all()
    )
    delays_by_supplier: dict = {}
    for sid, created, received in delay_rows:
        delays_by_supplier.setdefault(sid, []).append((received - created).days)

    data = []
    for s in suppliers:
        pr = purchase_rows.get(s.id)
        nb_commandes = int(pr[1]) if pr else 0
        montant_total = float(pr[2]) if pr else 0.0
        dernier_achat = pr[3].isoformat() if pr and pr[3] else None
        delays = delays_by_supplier.get(s.id, [])
        delai_moyen = round(sum(delays) / len(delays), 1) if delays else None
        retards = len([d for d in delays if d > (s.lead_time_days or 7)])
        data.append({
            "supplier_id": s.id, "name": s.name,
            "nombre_commandes": nb_commandes,
            "montant_total": montant_total,
            "produits": product_counts.get(s.id, 0),
            "delai_moyen_jours": delai_moyen,
            "retards": retards,
            "retours": return_counts.get(s.id, 0),
            "dernier_achat": dernier_achat,
            "score": s.reliability_score,
        })

    data.sort(key=lambda x: x["montant_total"], reverse=True)
    return {"success": True, "data": data}


@router.get("/{supplier_id}", response_model=dict)
def get_supplier(supplier_id: str, db: Session = Depends(get_db)):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return {"success": True, "data": SupplierOut.model_validate(supplier).model_dump()}


@router.post("/", response_model=dict)
def create_supplier(payload: SupplierCreate, db: Session = Depends(get_db)):
    supplier = Supplier(
        id=str(uuid.uuid4()),
        store_id=payload.store_id,
        name=payload.name,
        code=payload.code or f"SUP-{str(uuid.uuid4())[:6].upper()}",
        phone=payload.phone,
        email=payload.email,
        address=payload.address,
        city=payload.city,
        tax_id=payload.tax_id,
        bank_account=payload.bank_account,
        supply_category=payload.supply_category,
        note=payload.note,
        payment_terms_days=payload.payment_terms_days or 30,
        lead_time_days=payload.lead_time_days or 7,
        min_order_qty=payload.min_order_qty,
        min_order_amount=payload.min_order_amount,
        credit_limit=payload.credit_limit,
        discount_rate=payload.discount_rate or 0.0,
        currency=payload.currency or "DZD",
        delivery_method=payload.delivery_method or "standard",
        return_policy=payload.return_policy,
        fees=payload.fees or [],
        reliability_score=payload.reliability_score or 100.0,
        custom_fields=payload.custom_fields or {},
        purchase_price=payload.purchase_price,
        margin_percent=payload.margin_percent,
        extra_charges=payload.extra_charges or [],
    )
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return {"success": True, "data": SupplierOut.model_validate(supplier).model_dump()}


@router.patch("/{supplier_id}", response_model=dict)
def update_supplier(supplier_id: str, payload: SupplierUpdate, db: Session = Depends(get_db)):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(supplier, field, value)

    db.commit()
    db.refresh(supplier)
    return {"success": True, "data": SupplierOut.model_validate(supplier).model_dump()}


@router.delete("/{supplier_id}", response_model=dict)
def delete_supplier(supplier_id: str, db: Session = Depends(get_db)):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    db.delete(supplier)
    db.commit()
    return {"success": True, "message": "Supplier deleted"}


# ─── Purchase History ──────────────────────────────────────────

class PurchaseCreate(BaseModel):
    store_id: str
    product_name: str
    quantity: float = 1
    unit_cost: float
    total_cost: float
    purchase_date: Optional[str] = None
    notes: Optional[str] = None


class PurchaseUpdate(BaseModel):
    product_name: Optional[str] = None
    quantity: Optional[float] = None
    unit_cost: Optional[float] = None
    total_cost: Optional[float] = None
    notes: Optional[str] = None


def _serialize_purchase(p: SupplierPurchase) -> dict:
    return {
        "id": p.id,
        "supplier_id": p.supplier_id,
        "product_name": p.product_name,
        "quantity": p.quantity,
        "unit_cost": p.unit_cost,
        "total_cost": p.total_cost,
        "purchase_date": str(p.purchase_date) if p.purchase_date else None,
        "notes": p.notes,
        "created_at": p.created_at,
    }


@router.get("/{supplier_id}/purchases")
def list_purchases(supplier_id: str, db: Session = Depends(get_db)):
    # Create table if not exists (safe for first run before migration)
    try:
        SupplierPurchase.__table__.create(db.get_bind(), checkfirst=True)  # pyrefly: ignore[missing-attribute]
    except Exception:
        pass
    entries = (
        db.query(SupplierPurchase)
        .filter(SupplierPurchase.supplier_id == supplier_id)
        .order_by(SupplierPurchase.created_at.desc())
        .all()
    )
    return {"success": True, "data": [_serialize_purchase(e) for e in entries]}


@router.post("/{supplier_id}/purchases")
def create_purchase(supplier_id: str, payload: PurchaseCreate, db: Session = Depends(get_db)):
    try:
        SupplierPurchase.__table__.create(db.get_bind(), checkfirst=True)  # pyrefly: ignore[missing-attribute]
    except Exception:
        pass
    entry = SupplierPurchase(
        id=str(uuid.uuid4()),
        supplier_id=supplier_id,
        store_id=payload.store_id,
        product_name=payload.product_name,
        quantity=payload.quantity,
        unit_cost=payload.unit_cost,
        total_cost=payload.total_cost,
        purchase_date=payload.purchase_date,
        notes=payload.notes,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"success": True, "data": _serialize_purchase(entry)}


@router.patch("/{supplier_id}/purchases/{purchase_id}")
def update_purchase(supplier_id: str, purchase_id: str, payload: PurchaseUpdate, db: Session = Depends(get_db)):
    entry = db.query(SupplierPurchase).filter(
        SupplierPurchase.id == purchase_id,
        SupplierPurchase.supplier_id == supplier_id,
    ).first()
    if not entry:
        raise HTTPException(404, "Purchase not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    db.commit()
    db.refresh(entry)
    return {"success": True, "data": _serialize_purchase(entry)}


@router.delete("/{supplier_id}/purchases/{purchase_id}")
def delete_purchase(supplier_id: str, purchase_id: str, db: Session = Depends(get_db)):
    entry = db.query(SupplierPurchase).filter(
        SupplierPurchase.id == purchase_id,
        SupplierPurchase.supplier_id == supplier_id,
    ).first()
    if not entry:
        raise HTTPException(404, "Purchase not found")
    db.delete(entry)
    db.commit()
    return {"success": True}
