"""
Warehouse Model — Cluster de stockage
Enriched with relationships to Purchases, Returns, and stock inventory.
"""
from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, Text, JSON
from sqlalchemy.orm import relationship
from app.db.base_class import Base


class Warehouse(Base):
    __tablename__ = "warehouses"

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)

    # Identity
    code = Column(String, nullable=False, unique=True, index=True)  # e.g. W-ALG-01
    name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    wilaya = Column(String, nullable=True, index=True)

    # Capacity
    capacity = Column(Integer, nullable=True)
    current_load = Column(Integer, default=0)
    manager_name = Column(String, nullable=True)

    # Metadata
    note = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)

    # Relationships
    store = relationship("Store", back_populates="warehouses")
    purchases = relationship("Purchase", back_populates="warehouse")
    returns = relationship("Return", back_populates="warehouse")
