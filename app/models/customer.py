from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, DateTime, func, Index
from sqlalchemy.orm import relationship
from app.db.base_class import Base

class Customer(Base):
    __tablename__ = "customers"  # pyrefly: ignore[bad-override]

    # ─── Composite Indexes ───
    __table_args__ = (
        Index('idx_customer_store_phone', 'store_id', 'phone'),
        Index('idx_customer_store_blacklist', 'store_id', 'is_blacklisted'),
    )

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    phone = Column(String, index=True, nullable=False)
    secondary_phone = Column(String, nullable=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    wilaya = Column(String, index=True, nullable=True)
    address = Column(String, nullable=True)
    tier = Column(String, default="BRONZE")
    total_orders = Column(Integer, default=0)
    total_spent = Column(Integer, default=0)
    total_returned = Column(Integer, default=0)
    # source: MANUAL | INVITED | ACCOUNT | ORDER
    source = Column(String, default="MANUAL", nullable=True)
    is_blacklisted = Column(Boolean, default=False)
    is_guest = Column(Boolean, default=False)
    blacklist_note = Column(String, nullable=True)
    last_order_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    store = relationship("Store", back_populates="customers")
    orders = relationship("Order", back_populates="customer")
