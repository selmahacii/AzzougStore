from sqlalchemy import Column, String, Boolean, ForeignKey, Integer, JSON, DateTime
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
    # Updated (throttled, see deps._get_current_user_impl) on each
    # authenticated request — the actual "présence" signal. is_active only
    # means the account isn't disabled, it says nothing about whether the
    # person is at their desk right now.
    last_seen_at = Column(DateTime, nullable=True)
    
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
    # Bonus paid per DELIVERED order that was flagged is_upsell (an extra
    # product the confirmatrice added on-call) — same "delivered-only"
    # rule as every other commission (see salary_service.py).
    payment_upsell         = Column(Integer, default=0)
    payment_marketplace_upsell_only = Column(Integer, default=50)
    # Day of month (1-28, capped to stay valid in every month) this employee
    # is due to be paid — admin-configured. Drives the personal SALARY_DUE
    # reminder (app/services/noest_sync.py scan_payday_reminders) sent
    # directly to the employee, separate from the admin-facing PAYROLL_DUE
    # broadcast about generating payroll at all.
    payday = Column(Integer, nullable=True)

    # Affiliate / marketing-partner tracking (role MARKETER). The code is
    # matched against Order.utm_source / Order.campaign_id to attribute real
    # leads and revenue — no data is fabricated when these are unset.
    tracking_code    = Column(String, unique=True, nullable=True, index=True)
    marketing_budget = Column(Integer, nullable=True)  # DA, admin-configured

    # Relationships
    owned_stores = relationship("Store", back_populates="owner", foreign_keys="[Store.owner_id]")
    employee_store = relationship("Store", back_populates="employees", foreign_keys=[employee_store_id])
    assigned_orders = relationship("Order", back_populates="assignee", foreign_keys="[Order.assigned_to]")
    audit_logs = relationship("AuditLog", back_populates="actor")
