from sqlalchemy import Column, String, Boolean, ForeignKey, Integer, JSON
from sqlalchemy.orm import relationship
from app.db.base_class import Base

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="CONFIRMATEUR")
    avatar = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    daily_target = Column(Integer, default=10)
    
    employee_store_id = Column(String, ForeignKey("stores.id"), nullable=True)

    # Assignments
    assigned_store_scope = Column(String, default="ALL") # ALL | SPECIFIC
    assigned_store_ids   = Column(JSON,   default=[])   # List of store UUIDs
    assigned_product_ids = Column(JSON,   default=[])   # List of product UUIDs

    # Payment configuration
    payment_type   = Column(String,  nullable=True)   # PER_DELIVERED_ORDER | MONTHLY_SALARY
    payment_amount = Column(Integer, nullable=True)   # DA — rate per order OR monthly salary
    payment_recovered_cart = Column(Integer, default=0)
    payment_lost_cart      = Column(Integer, default=0)

    # Relationships
    owned_stores = relationship("Store", back_populates="owner", foreign_keys="[Store.owner_id]")
    employee_store = relationship("Store", back_populates="employees", foreign_keys=[employee_store_id])
    assigned_orders = relationship("Order", back_populates="assignee", foreign_keys="[Order.assigned_to]")
    audit_logs = relationship("AuditLog", back_populates="actor")
