from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, JSON, DateTime, Float, func
from sqlalchemy.orm import relationship
from app.db.base_class import Base
import uuid

class UpsellRule(Base):
    __tablename__ = "upsell_rules"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    product_id = Column(String, ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    upsell_product_ids = Column(JSON, default=list)  # List of product IDs offered as upsell
    trigger_conditions = Column(JSON, nullable=True) # e.g. {"min_quantity": 1}
    is_active = Column(Boolean, default=True)

    store = relationship("Store")
    product = relationship("Product", foreign_keys=[product_id])

class UpsellOffer(Base):
    __tablename__ = "upsell_offers"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id = Column(String, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    offered_product_id = Column(String, ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    offered_by = Column(String, ForeignKey("users.id"), nullable=False, index=True) # Confirmatrice/agent who proposed it
    accepted = Column(Boolean, default=False)
    quantity = Column(Integer, default=1)
    value = Column(Integer, default=0) # Value of upsell item in DA (or revenue increase)
    created_at = Column(DateTime, server_default=func.now())

    order = relationship("Order")
    offered_product = relationship("Product")
    agent = relationship("User")

class UpsellCommission(Base):
    __tablename__ = "upsell_commissions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True) # Confirmatrice/agent
    order_id = Column(String, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    amount = Column(Integer, default=0) # Commission in DA
    is_paid = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())

    store = relationship("Store")
    agent = relationship("User")
    order = relationship("Order")
