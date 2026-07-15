from sqlalchemy import Column, String, Boolean, ForeignKey, DateTime, JSON, func
from sqlalchemy.orm import relationship
from app.db.base_class import Base
import uuid

class PartnerApiKey(Base):
    __tablename__ = "partner_api_keys"  # pyrefly: ignore[bad-override]

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    name = Column(String, nullable=False)
    hashed_key = Column(String, nullable=False)
    key_preview = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    last_rotated_at = Column(DateTime, server_default=func.now())
    created_at = Column(DateTime, server_default=func.now())

    store = relationship("Store", backref="api_keys")

class PartnerWebhook(Base):
    __tablename__ = "partner_webhooks"  # pyrefly: ignore[bad-override]

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    url = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    events = Column(JSON, nullable=False) # List of event strings
    created_at = Column(DateTime, server_default=func.now())

    store = relationship("Store", backref="webhooks")
