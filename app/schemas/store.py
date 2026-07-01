from typing import Optional, Dict, Any
from pydantic import BaseModel
from datetime import datetime


class StoreBase(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    domain: Optional[str] = None
    is_active: Optional[bool] = True
    theme_config: Optional[dict] = {}
    template_id: Optional[str] = "modern"
    social_links: Optional[dict] = {}
    owner_id: Optional[str] = None
    currency: Optional[str] = "DZD"
    language: Optional[str] = "fr"
    timezone: Optional[str] = "Africa/Algiers"
    assignment_logic: Optional[str] = "MANUAL"
    auto_reassign_minutes: Optional[int] = 120
    assignment_active: Optional[bool] = False
    marketing_config: Optional[dict] = {}
    # Extra fields from wizard (ignored by backend, stored via theme_config/social_links)
    contact: Optional[dict] = None

    class Config:
        extra = "ignore"


class StoreCreate(StoreBase):
    name: str
    slug: str
    # owner_id is optional — backend falls back to current_user.id when absent
    owner_id: Optional[str] = None


class StoreUpdate(StoreBase):
    pass


class StoreInDBBase(StoreBase):
    id: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Store(StoreInDBBase):
    pass


class StoreWithCounts(StoreInDBBase):
    """Store schema enriched with SQL-computed counts."""
    _count: Optional[Dict[str, int]] = None

    class Config:
        from_attributes = True
