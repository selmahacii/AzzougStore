from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, ForeignKey, Text, DateTime, func, Index
from sqlalchemy.orm import relationship
from app.db.base_class import Base


class StockMovement(Base):
    __tablename__ = "stock_movements"

    # ─── Composite Indexes ───
    __table_args__ = (
        Index('idx_stock_prod_created', 'product_id', 'created_at'),
    )

    id = Column(String, primary_key=True, index=True)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)

    # Types: RESTOCK | ORDER_RESERVE | ORDER_CONFIRM | ORDER_RELEASE | RETURN_RESTOCK | MANUAL_ADJUSTMENT
    type = Column(String, nullable=False, index=True)
    quantity = Column(Integer, nullable=False)  # Positive or negative

    order_id = Column(String, ForeignKey("orders.id"), nullable=True)
    warehouse_id = Column(String, ForeignKey("warehouses.id"), nullable=True)
    actor_id = Column(String, ForeignKey("users.id"), nullable=True)
    reason = Column(Text, nullable=True)

    # Traceability
    batch_id = Column(String, nullable=True)
    expiration_date = Column(String, nullable=True)  # ISO date string

    # Audit timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    product = relationship("Product", back_populates="stock_movements")
    actor = relationship("User", foreign_keys=[actor_id])
