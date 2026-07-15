from sqlalchemy import Column, String, Boolean, Float, Integer, DateTime, Text, ForeignKey, func
from sqlalchemy.orm import relationship
from app.db.base_class import Base
import uuid


class DeliveryPartner(Base):
    __tablename__ = "delivery_partners"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)

    # Maps to the Prisma "code" column (carrier slug: 'yalidine', 'noest', etc.)
    carrier_id = Column("code", String, nullable=False)

    name = Column(String, nullable=False)
    logo_url = Column(String, nullable=True)         # exists in Prisma schema
    is_active = Column(Boolean, default=True)
    is_sandbox = Column(Boolean, default=True)       # added by fix_db_schema

    # New Phase 2 Fields
    type = Column(String, default="EXTERNAL")        # INTERNAL | EXTERNAL
    commission_type = Column(String, default="FIXED") # FIXED | PERCENTAGE
    commission_value = Column(Float, default=0.0)
    performance_score = Column(Float, default=100.0)

    # API credentials — stored as plain JSON text (no encryption key required in dev)
    # The Prisma "api_config" JSON column is used if api_config_encrypted doesn't exist
    api_config_encrypted = Column(Text, nullable=True)  # added by fix_db_schema

    fee_home = Column(Float, default=0.0)            # added by fix_db_schema
    fee_relay = Column(Float, default=0.0)           # added by fix_db_schema
    free_shipping_threshold = Column(Float, nullable=True)  # added by fix_db_schema

    webhook_url = Column(String, nullable=True)      # added by fix_db_schema
    last_test_at = Column(DateTime, nullable=True)   # added by fix_db_schema
    last_test_ok = Column(Boolean, nullable=True)    # added by fix_db_schema
    configured_by = Column(String, nullable=True)    # user ID of last configurator

    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    @property
    def code(self) -> str:
        """Alias so schemas that reference 'code' work alongside 'carrier_id'."""
        return self.carrier_id

    # Relationships
    store = relationship("Store", back_populates="delivery_partners")
    orders = relationship("Order", back_populates="carrier")


class DeliveryFeeGrid(Base):
    __tablename__ = "delivery_fee_grids"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    partner_id = Column(String, ForeignKey("delivery_partners.id", ondelete="CASCADE"), nullable=False)
    wilaya_id = Column(Integer, nullable=False)
    home_fee = Column(Integer, default=0)
    office_fee = Column(Integer, default=0)

    partner = relationship("DeliveryPartner", back_populates="pricing_grid")


class ProductDeliveryPartner(Base):
    __tablename__ = "product_delivery_partners"

    product_id = Column(String, ForeignKey("products.id", ondelete="CASCADE"), primary_key=True)
    partner_id = Column(String, ForeignKey("delivery_partners.id", ondelete="CASCADE"), primary_key=True)

    product = relationship("Product", back_populates="delivery_partners")
    partner = relationship("DeliveryPartner", back_populates="allowed_products")


DeliveryPartner.pricing_grid = relationship("DeliveryFeeGrid", back_populates="partner", cascade="all, delete-orphan")
DeliveryPartner.allowed_products = relationship("ProductDeliveryPartner", back_populates="partner", cascade="all, delete-orphan")
