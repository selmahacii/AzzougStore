"""
Return Model — Logistique inverse (retour vers fournisseur)
Represents return entries linked to an original purchase, with line items,
reimbursement tracking, and reason classification.
"""
from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, Text, DateTime, Enum as SqlEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.db.base_class import Base


class ReturnReason(str, enum.Enum):
    DEFECTIVE = "DEFECTIVE"
    WRONG_ITEM = "WRONG_ITEM"
    DAMAGED = "DAMAGED"
    QUALITY_ISSUE = "QUALITY_ISSUE"
    OVERSTOCK = "OVERSTOCK"
    OTHER = "OTHER"


class RefundStatus(str, enum.Enum):
    PENDING = "PENDING"
    PARTIAL = "PARTIAL"
    REFUNDED = "REFUNDED"
    CREDIT_NOTE = "CREDIT_NOTE"
    REJECTED = "REJECTED"


class ReturnStatus(str, enum.Enum):
    PENDING = "PENDING"
    IN_TRANSIT = "IN_TRANSIT"
    RECEIVED_BY_SUPPLIER = "RECEIVED_BY_SUPPLIER"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"


class Return(Base):
    __tablename__ = "returns"

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    supplier_id = Column(String, ForeignKey("suppliers.id"), nullable=False, index=True)
    warehouse_id = Column(String, ForeignKey("warehouses.id"), nullable=False, index=True)
    purchase_id = Column(String, ForeignKey("purchases.id"), nullable=True, index=True)  # Source PO

    # Reference
    reference = Column(String, unique=True, index=True, nullable=False)  # RET-8827

    # Financials (in DA)
    total_credit = Column(Integer, default=0)  # Expected credit/refund amount
    amount_refunded = Column(Integer, default=0)

    # Status
    reason = Column(SqlEnum(ReturnReason), default=ReturnReason.DEFECTIVE)
    refund_status = Column(SqlEnum(RefundStatus), default=RefundStatus.PENDING)
    status = Column(SqlEnum(ReturnStatus), default=ReturnStatus.PENDING)

    # Metadata
    note = Column(Text, nullable=True)
    shipped_at = Column(DateTime, nullable=True)
    closed_at = Column(DateTime, nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)

    # Relationships
    store = relationship("Store", back_populates="returns")
    supplier = relationship("Supplier", back_populates="returns")
    warehouse = relationship("Warehouse", back_populates="returns")
    source_purchase = relationship("Purchase", foreign_keys=[purchase_id])
    creator = relationship("User", foreign_keys=[created_by])
    items = relationship("ReturnItem", back_populates="return_entry", cascade="all, delete-orphan")


class ReturnItem(Base):
    __tablename__ = "return_items"

    id = Column(String, primary_key=True, index=True)
    return_id = Column(String, ForeignKey("returns.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(String, ForeignKey("products.id"), nullable=False, index=True)

    # Snapshot
    product_name = Column(String, nullable=False)
    sku = Column(String, nullable=True)
    quantity = Column(Integer, nullable=False)
    unit_credit = Column(Integer, nullable=False)  # Credit per unit
    total_credit = Column(Integer, nullable=False)

    # Relationships
    return_entry = relationship("Return", back_populates="items")
    product = relationship("Product")
