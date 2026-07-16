from sqlalchemy import Column, String, Integer, ForeignKey, Text, DateTime, func
from sqlalchemy.orm import relationship
from app.db.base_class import Base


class OrderEvent(Base):
    __tablename__ = "order_events"

    id = Column(String, primary_key=True, index=True)
    order_id = Column(String, ForeignKey("orders.id"), nullable=False)
    actor_id = Column(String, ForeignKey("users.id"), nullable=True)
    # The role the actor held AT THE TIME of the action (not a live join to
    # users.role, which can change later) — order_service.update_order()
    # already receives actor_role as a parameter but previously only used it
    # to build a free-text prefix inside order.notes, never persisting it as
    # its own field. Needed to answer "depuis quel rôle" for the history
    # timeline (a confirmatrice and a livreur can both act on the same order).
    actor_role = Column(String, nullable=True)

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
