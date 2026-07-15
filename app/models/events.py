from sqlalchemy import Column, String, Integer, ForeignKey, Text, DateTime, func
from sqlalchemy.orm import relationship
from app.db.base_class import Base


class OrderEvent(Base):
    __tablename__ = "order_events"

    id = Column(String, primary_key=True, index=True)
    order_id = Column(String, ForeignKey("orders.id"), nullable=False)
    actor_id = Column(String, ForeignKey("users.id"), nullable=True)

    from_status = Column(String, nullable=True)
    to_status = Column(String, nullable=False)

    # CRM call tracking
    note = Column(Text, nullable=True)
    call_result = Column(String, nullable=True)   # ANSWERED | BUSY | REFUSED | NO_ANSWER
    call_attempt = Column(Integer, default=1)
    scheduled_callback_at = Column(DateTime, nullable=True)  # Scheduled callback
    
    # Audit timestamp
    created_at = Column(DateTime, default=func.now(), index=True)

    # Relationships
    order = relationship("Order", back_populates="events")
    actor = relationship("User", foreign_keys=[actor_id])
