"""
Purchase Model — Entrées d'achat fournisseur
Represents a purchase order (PO) from a supplier, with line items.
Each PO targets a specific warehouse and has payment/reception tracking.
"""
from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, Text, DateTime, JSON, Enum as SqlEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.db.base_class import Base


class PaymentStatus(str, enum.Enum):
    PENDING = "PENDING"
    PARTIAL = "PARTIAL"
    PAID = "PAID"


class ReceptionStatus(str, enum.Enum):
    PENDING = "PENDING"
    PARTIAL = "PARTIAL"
    RECEIVED = "RECEIVED"
    CANCELLED = "CANCELLED"


class Purchase(Base):
    __tablename__ = "purchases"

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    supplier_id = Column(String, ForeignKey("suppliers.id"), nullable=False, index=True)
    warehouse_id = Column(String, ForeignKey("warehouses.id"), nullable=False, index=True)

    # Reference
    reference = Column(String, unique=True, index=True, nullable=False)  # PO-99281

    # Financials (in DA)
    subtotal = Column(Integer, default=0)
    tax_amount = Column(Integer, default=0)
    shipping_cost = Column(Integer, default=0)
    total = Column(Integer, default=0)
    amount_paid = Column(Integer, default=0)

    # Status
    payment_status = Column(SqlEnum(PaymentStatus), default=PaymentStatus.PENDING)
    reception_status = Column(SqlEnum(ReceptionStatus), default=ReceptionStatus.PENDING)

    # Bon fields
    bon_type = Column(String, default="PURCHASE_ORDER")  # PURCHASE_ORDER | RECEPTION_VOUCHER
    photos = Column(JSON, default=list)  # list of uploaded photo URLs
    validated_at = Column(DateTime, nullable=True)
    validated_by = Column(String, ForeignKey("users.id"), nullable=True)

    # Metadata
    note = Column(Text, nullable=True)
    received_at = Column(DateTime, nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)

    # Relationships
    store = relationship("Store", back_populates="purchases")
    supplier = relationship("Supplier", back_populates="purchases")
    warehouse = relationship("Warehouse", back_populates="purchases")
    creator = relationship("User", foreign_keys=[created_by])
    validator = relationship("User", foreign_keys=[validated_by])
    items = relationship("PurchaseItem", back_populates="purchase", cascade="all, delete-orphan")


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id = Column(String, primary_key=True, index=True)
    purchase_id = Column(String, ForeignKey("purchases.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(String, ForeignKey("products.id"), nullable=False, index=True)

    # Snapshot
    product_name = Column(String, nullable=False)
    sku = Column(String, nullable=True)
    quantity = Column(Integer, nullable=False)
    unit_cost = Column(Integer, nullable=False)  # Cost per unit in DA
    total_cost = Column(Integer, nullable=False)  # quantity * unit_cost
    received_quantity = Column(Integer, default=0)

    # Relationships
    purchase = relationship("Purchase", back_populates="items")
    product = relationship("Product")
