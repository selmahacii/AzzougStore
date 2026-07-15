from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, DateTime, func
from sqlalchemy.orm import relationship
from app.db.base_class import Base

class Promotion(Base):
    __tablename__ = "promotions"  # pyrefly: ignore[bad-override]

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    code = Column(String, index=True, nullable=False)
    type = Column(String, default="PERCENTAGE") # PERCENTAGE | FIXED_AMOUNT | FREE_SHIPPING
    value = Column(Integer, default=0)
    min_order_amount = Column(Integer, default=0)
    max_uses = Column(Integer, nullable=True)
    used_count = Column(Integer, default=0)
    starts_at = Column(DateTime, nullable=True)
    ends_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    description = Column(String, nullable=True)
    applicable_categories = Column(String, default="")
    first_purchase_only = Column(Boolean, default=False)
    is_flash_sale = Column(Boolean, default=False)
    flash_sale_ends_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


    store = relationship("Store", back_populates="promotions")
