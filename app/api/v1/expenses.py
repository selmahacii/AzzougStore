"""
Expenses API — Full CRUD for operational expense tracking
Supports category filtering, recurring expenses, and wallet linkage.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date
import uuid

from app.api.deps import get_db
from app.models.expense import Expense, ExpenseCategory, ExpenseStatus

router = APIRouter()


# ─── Schemas ──────────────────────────────────────────────

class ExpenseCreate(BaseModel):
    store_id: str
    category: str
    label: str
    description: Optional[str] = None
    amount: int
    tax_amount: int = 0
    expense_date: date
    is_recurring: bool = False
    recurrence_period: Optional[str] = None
    term_type: str = "SHORT_TERM"   # SHORT_TERM | LONG_TERM
    wallet_id: Optional[str] = None
    beneficiary: Optional[str] = None
    receipt_url: Optional[str] = None
    created_by: Optional[str] = None


class ExpenseUpdate(BaseModel):
    category: Optional[str] = None
    label: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[int] = None
    tax_amount: Optional[int] = None
    status: Optional[str] = None
    term_type: Optional[str] = None
    beneficiary: Optional[str] = None
    receipt_url: Optional[str] = None


class ExpenseOut(BaseModel):
    id: str
    store_id: str
    category: str
    label: str
    description: Optional[str]
    amount: int
    tax_amount: int
    total_amount: int
    status: str
    expense_date: date
    is_recurring: bool
    recurrence_period: Optional[str]
    term_type: Optional[str] = "SHORT_TERM"
    wallet_id: Optional[str]
    beneficiary: Optional[str]
    receipt_url: Optional[str]
    created_by: Optional[str]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# ─── Routes ───────────────────────────────────────────────

@router.get("/", response_model=dict)
def list_expenses(
    store_id: str = Query(...),
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(Expense).filter(Expense.store_id == store_id)

    if category:
        query = query.filter(Expense.category == category)
    if status:
        query = query.filter(Expense.status == status)
    if search:
        query = query.filter(
            Expense.label.ilike(f"%{search}%")
            | Expense.beneficiary.ilike(f"%{search}%")
        )

    total = query.count()
    expenses = (
        query
        .order_by(Expense.expense_date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "success": True,
        "data": [ExpenseOut.model_validate(e).model_dump() for e in expenses],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/summary", response_model=dict)
def expense_summary(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """Aggregate expense data by category for dashboard widgets."""
    from sqlalchemy import func

    results = (
        db.query(
            Expense.category,
            func.sum(Expense.total_amount).label("total"),
            func.count(Expense.id).label("count"),
        )
        .filter(Expense.store_id == store_id)
        .group_by(Expense.category)
        .all()
    )

    total_expenses = sum(r.total or 0 for r in results)

    return {
        "success": True,
        "data": {
            "total": total_expenses,
            "by_category": [
                {"category": r.category, "total": r.total or 0, "count": r.count}
                for r in results
            ],
        },
    }


@router.get("/{expense_id}", response_model=dict)
def get_expense(expense_id: str, db: Session = Depends(get_db)):
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"success": True, "data": ExpenseOut.model_validate(expense).model_dump()}


@router.post("/", response_model=dict)
def create_expense(payload: ExpenseCreate, db: Session = Depends(get_db)):
    total_amount = payload.amount + payload.tax_amount

    expense = Expense(
        id=str(uuid.uuid4()),
        store_id=payload.store_id,
        category=payload.category,
        label=payload.label,
        description=payload.description,
        amount=payload.amount,
        tax_amount=payload.tax_amount,
        total_amount=total_amount,
        expense_date=payload.expense_date,
        is_recurring=payload.is_recurring,
        recurrence_period=payload.recurrence_period,
        term_type=payload.term_type,
        wallet_id=payload.wallet_id,
        beneficiary=payload.beneficiary,
        receipt_url=payload.receipt_url,
        created_by=payload.created_by,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return {"success": True, "data": ExpenseOut.model_validate(expense).model_dump()}


@router.patch("/{expense_id}", response_model=dict)
def update_expense(expense_id: str, payload: ExpenseUpdate, db: Session = Depends(get_db)):
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(expense, field, value)

    # Recalculate total if amount or tax changed
    if "amount" in update_data or "tax_amount" in update_data:
        expense.total_amount = expense.amount + expense.tax_amount

    db.commit()
    db.refresh(expense)
    return {"success": True, "data": ExpenseOut.model_validate(expense).model_dump()}


@router.delete("/{expense_id}", response_model=dict)
def delete_expense(expense_id: str, db: Session = Depends(get_db)):
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    db.delete(expense)
    db.commit()
    return {"success": True, "message": "Expense deleted"}
