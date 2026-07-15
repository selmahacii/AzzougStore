from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, JSON, DateTime, Float, Text, func
from sqlalchemy.orm import relationship
from app.db.base_class import Base
import uuid

class POSSession(Base):
    __tablename__ = "pos_sessions"  # pyrefly: ignore[bad-override]

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    
    start_at = Column(DateTime, server_default=func.now())
    end_at = Column(DateTime, nullable=True)
    
    opening_balance = Column(Integer, default=0)
    closing_balance = Column(Integer, nullable=True)
    real_closing_balance = Column(Integer, nullable=True)
    
    status = Column(String, default="OPEN") # OPEN | CLOSED
    notes = Column(Text, nullable=True)

    user = relationship("User")
    sales = relationship("POSSale", back_populates="session")

class POSSale(Base):
    __tablename__ = "pos_sales"  # pyrefly: ignore[bad-override]

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("pos_sessions.id"), nullable=False)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    customer_id = Column(String, ForeignKey("customers.id"), nullable=True)
    
    receipt_number = Column(String, unique=True, index=True, nullable=False)
    
    subtotal = Column(Integer, default=0)
    tax = Column(Integer, default=0)
    discount = Column(Integer, default=0)
    total = Column(Integer, nullable=False)
    
    payment_method = Column(String, default="CASH") # CASH | CARD | MIXED
    payment_details = Column(JSON, nullable=True)
    
    created_at = Column(DateTime, server_default=func.now())
    
    session = relationship("POSSession", back_populates="sales")
    items = relationship("POSSaleItem", back_populates="sale", cascade="all, delete-orphan")
    customer = relationship("Customer")

class POSSaleItem(Base):
    __tablename__ = "pos_sale_items"  # pyrefly: ignore[bad-override]

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    sale_id = Column(String, ForeignKey("pos_sales.id"), nullable=False)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    
    product_name = Column(String, nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Integer, nullable=False)
    total_price = Column(Integer, nullable=False)
    
    variant_details = Column(JSON, nullable=True)

    sale = relationship("POSSale", back_populates="items")
