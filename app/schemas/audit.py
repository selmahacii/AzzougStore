from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime

class AuditActor(BaseModel):
    id: str
    name: str
    avatar: Optional[str] = None
    role: Optional[str] = None

    class Config:
        from_attributes = True

class AuditLogBase(BaseModel):
    actor_id: Optional[str] = None
    store_id: Optional[str] = None
    entity: str
    entity_id: str
    action: str
    diff: Optional[Any] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None

class AuditLog(AuditLogBase):
    id: str
    created_at: Optional[datetime] = None
    actor: Optional[AuditActor] = None

    class Config:
        from_attributes = True

class AuditPagination(BaseModel):
    success: bool
    data: List[AuditLog]
    total: int
    page: int
    pageSize: int
    totalPages: int
