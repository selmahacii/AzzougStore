from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, Text
from app.db.base_class import Base

class OrderStatusConfig(Base):
    __tablename__ = "order_statuses"

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    
    code = Column(String, nullable=False) # e.g., 'NEW', 'RECEIVED'
    label = Column(String, nullable=False) # Display name
    color = Column(String, default="#64748b") # HEX color code
    is_system = Column(Boolean, default=False) # If true, cannot be deleted
    order_index = Column(Integer, default=0) # For display ordering
    
    description = Column(Text, nullable=True)
