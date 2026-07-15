from sqlalchemy import Column, String, Integer, Float, ForeignKey, DateTime, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base


class PayrollRecord(Base):
    """
    Frozen monthly payroll entry for an employee.

    Generated once per (user, period) from the dynamic salary engine, then
    immutable except for the PENDING -> PAID transition. This gives the
    payroll manager a locked accounting record independent of later order
    status changes.
    """
    __tablename__ = "payroll_records"

    __table_args__ = (
        UniqueConstraint("user_id", "period", name="uq_payroll_user_period"),
    )

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    period = Column(String, nullable=False, index=True)  # "YYYY-MM"

    payment_type = Column(String, nullable=True)          # PER_DELIVERED_ORDER | MONTHLY_SALARY
    base_salary = Column(Float, default=0.0)
    bonus = Column(Float, default=0.0)                    # recovered-cart bonus
    total = Column(Float, default=0.0)
    delivered_count = Column(Integer, default=0)          # normal delivered orders
    recovered_count = Column(Integer, default=0)          # recovered carts delivered
    breakdown = Column(JSON, nullable=True)               # full salary engine output snapshot

    status = Column(String, default="PENDING")            # PENDING | PAID
    generated_at = Column(DateTime, server_default=func.now())
    generated_by = Column(String, nullable=True)
    paid_at = Column(DateTime, nullable=True)
    paid_by = Column(String, nullable=True)

    user = relationship("User")
