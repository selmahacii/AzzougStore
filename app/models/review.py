from sqlalchemy import Column, String, Integer, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
import uuid
from app.db.base_class import Base

class Review(Base):
    __tablename__ = "reviews"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    product_id = Column(String, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    
    customer_name = Column(String, nullable=False)
    rating = Column(Integer, nullable=False)
    title = Column(String, nullable=True)
    comment = Column(String, nullable=False)
    
    is_verified = Column(Boolean, default=False)
    is_approved = Column(Boolean, default=False)
    
    product = relationship("Product", back_populates="reviews")
    store = relationship("Store", back_populates="reviews")
