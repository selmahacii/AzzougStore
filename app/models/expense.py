"""
Expense Model — Suivi des dépenses opérationnelles
Tracks all business expenses with categorization, recurring flag,
and optional linkage to a wallet for financial reconciliation.
"""
from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, Text, DateTime, Enum as SqlEnum, Date, Index
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.db.base_class import Base


class ExpenseCategory(str, enum.Enum):
    MARKETING = "MARKETING"       # Meta Ads, Google Ads
    ADVERTISING = "ADVERTISING"   # Facebook Ads, Google Ads
    SHIPPING = "SHIPPING"         # Frais de livraison
    RENT = "RENT"                 # Loyer entrepôt/bureau
    SALARY = "SALARY"             # Salaires
    COMMISSION = "COMMISSION"     # Commission confirmateurs
    PACKAGING = "PACKAGING"       # Emballages, cartons
    SOFTWARE = "SOFTWARE"         # Abonnements outils
    MAINTENANCE = "MAINTENANCE"   # Maintenance matériel
    TAXES = "TAXES"               # Impôts & charges
    SUPPLIER = "SUPPLIER"         # Paiement fournisseur
    FUEL = "FUEL"                 # Carburant flotte
    PRODUCTION = "PRODUCTION"     # Frais de création/production
    OTHER = "OTHER"


class ExpenseStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    PAID = "PAID"
    CANCELLED = "CANCELLED"


class Expense(Base):
    __tablename__ = "expenses"

    # ─── Composite Indexes ───
    __table_args__ = (
        Index('idx_expense_store_category', 'store_id', 'category'),
        Index('idx_expense_store_date', 'store_id', 'expense_date'),
    )

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)

    # Classification
    category = Column(SqlEnum(ExpenseCategory), nullable=False, index=True)
    label = Column(String, nullable=False)  # Human-readable label
    description = Column(Text, nullable=True)

    # Financial
    amount = Column(Integer, nullable=False)  # In DA
    tax_amount = Column(Integer, default=0)
    total_amount = Column(Integer, nullable=False)  # amount + tax

    # Status & Scheduling
    status = Column(SqlEnum(ExpenseStatus), default=ExpenseStatus.PENDING)
    expense_date = Column(Date, nullable=False)
    is_recurring = Column(Boolean, default=False)
    recurrence_period = Column(String, nullable=True)  # "MONTHLY", "WEEKLY", "YEARLY"

    # Optional link to wallet for cash flow tracking
    wallet_id = Column(String, ForeignKey("wallets.id"), nullable=True)

    # Term classification: SHORT_TERM (< 1 year) or LONG_TERM (> 1 year)
    term_type = Column(String, default="SHORT_TERM", nullable=True)  # SHORT_TERM | LONG_TERM

    # Metadata
    receipt_url = Column(String, nullable=True)  # Uploaded receipt image
    beneficiary = Column(String, nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)

    # Relationships
    store = relationship("Store", back_populates="expenses")
    wallet = relationship("Wallet")
    creator = relationship("User", foreign_keys=[created_by])
