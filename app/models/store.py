from sqlalchemy import Column, String, Boolean, ForeignKey, JSON, DateTime, Integer, func
from sqlalchemy.orm import relationship
import uuid
from app.db.base_class import Base
from app.core.encryption import EncryptedJSON

class Store(Base):
    __tablename__ = "stores"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False, index=True)
    slug = Column(String, unique=True, index=True, nullable=False)
    domain = Column(String, unique=True, index=True, nullable=True)
    description = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    banner_url = Column(String, nullable=True)
    
    # Configuration
    template_id = Column(String, default="modern")
    theme_config = Column(JSON, default={})
    social_links = Column(JSON, default={"facebook": "", "instagram": ""})
    
    # Regional / ERP Sync
    currency = Column(String, default="DZD")
    language = Column(String, default="fr")
    timezone = Column(String, default="Africa/Algiers")
    
    is_active = Column(Boolean, default=True)
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)
    
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    
    # Assignment Logic
    # options: MANUAL, ROUND_ROBIN, LEAST_LOADED
    assignment_logic = Column(String, default="MANUAL")
    auto_reassign_minutes = Column(Integer, default=120)
    assignment_active = Column(Boolean, default=False)

    # Operational business rules, editable per store by the admin:
    # max_nrp_normal, max_nrp_abandoned, nrp_callback_hours, auto_merge_duplicates
    operations_config = Column(JSON, default={})

    # Marketing & Tracking
    marketing_config = Column(EncryptedJSON, default={"facebook_pixel_id": "", "tiktok_pixel_id": "", "snapchat_pixel_id": "", "google_tag_id": "", "fb_access_token": ""})
    
    # --- Relationships ---
    owner = relationship("User", back_populates="owned_stores", foreign_keys=[owner_id])
    employees = relationship("User", back_populates="employee_store", foreign_keys="[User.employee_store_id]")
    products = relationship("Product", back_populates="store")
    orders = relationship("Order", back_populates="store")
    customers = relationship("Customer", back_populates="store")
    promotions = relationship("Promotion", back_populates="store")
    wallets = relationship("Wallet", back_populates="store")
    financial_transactions = relationship("FinancialTransaction", back_populates="store")
    audit_logs = relationship("AuditLog", back_populates="store")
    reviews = relationship("Review", back_populates="store")
    # New modules
    warehouses = relationship("Warehouse", back_populates="store")
    suppliers = relationship("Supplier", back_populates="store")
    purchases = relationship("Purchase", back_populates="store")
    returns = relationship("Return", back_populates="store")
    expenses = relationship("Expense", back_populates="store")
    delivery_partners = relationship("DeliveryPartner", back_populates="store", cascade="all, delete-orphan")
