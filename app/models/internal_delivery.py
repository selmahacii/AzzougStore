from sqlalchemy import Column, String, Integer, ForeignKey, DateTime, func
from sqlalchemy.orm import relationship
from app.db.base_class import Base
import uuid

class InternalDelivery(Base):
    __tablename__ = "internal_deliveries"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    driver_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    order_id = Column(String, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    status = Column(String, default="ASSIGNED")  # ASSIGNED | PICKED_UP | DELIVERED | RETURNED
    commission = Column(Integer, default=0)       # Commission earned in DA
    delivered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    driver = relationship("User")
    order = relationship("Order")
