"""
Supplier Model — Fournisseurs / Partenaires Sourcing
Tracks supplier identity, financial ledger (total due, paid, remaining), reliability scoring.
"""
from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, Text, Float, JSON
from sqlalchemy.orm import relationship
from app.db.base_class import Base


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)

    # Identity
    name = Column(String, nullable=False, index=True)
    code = Column(String, unique=True, index=True, nullable=True)  # e.g. SUP-001
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String, nullable=True)
    tax_id = Column(String, nullable=True)  # NIF / Registre de Commerce

    # Financial Ledger (in DA — centimes)
    total_due = Column(Integer, default=0)       # Total historically owed
    total_paid = Column(Integer, default=0)      # Total paid to date
    total_remaining = Column(Integer, default=0) # total_due - total_paid

    # Quality Metrics
    reliability_score = Column(Float, default=100.0)  # 0-100%
    note = Column(Text, nullable=True)

    # Commercial Conditions
    payment_terms_days = Column(Integer, default=30)
    lead_time_days = Column(Integer, default=7)
    min_order_qty = Column(Integer, nullable=True)
    min_order_amount = Column(Integer, nullable=True)    # DA
    credit_limit = Column(Integer, nullable=True)        # DA
    discount_rate = Column(Float, default=0.0)           # %
    currency = Column(String, default="DZD")
    delivery_method = Column(String, default="standard")
    return_policy = Column(Text, nullable=True)
    bank_account = Column(String, nullable=True)
    supply_category = Column(String, nullable=True)
    fees = Column(JSON, default=list)                    # [{label, amount, fee_type, is_recurring}]
    
    # Phase 2 Supplier Enhancements
    custom_fields = Column(JSON, default=dict)           # key-value custom fields
    purchase_price = Column(Integer, nullable=True)      # standard purchase price
    margin_percent = Column(Float, nullable=True)        # target margin %
    extra_charges = Column(JSON, default=list)           # [{label, amount}]

    # Status
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)

    # Relationships
    store = relationship("Store", back_populates="suppliers")
    purchases = relationship("Purchase", back_populates="supplier", cascade="all, delete-orphan")
    returns = relationship("Return", back_populates="supplier", cascade="all, delete-orphan")
