from sqlalchemy import Column, String, ForeignKey, JSON, DateTime, func
from sqlalchemy.orm import relationship
from app.db.base_class import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"  # pyrefly: ignore[bad-override]

    id = Column(String, primary_key=True, index=True)
    actor_id = Column(String, ForeignKey("users.id"), nullable=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=True)
    
    entity = Column(String, nullable=False)
    entity_id = Column(String, nullable=False)
    action = Column(String, nullable=False)
    
    diff = Column(JSON, nullable=True)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    actor = relationship("User", back_populates="audit_logs")
    store = relationship("Store", back_populates="audit_logs")
