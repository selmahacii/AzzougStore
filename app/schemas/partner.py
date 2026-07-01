from pydantic import BaseModel, HttpUrl
from typing import List, Optional
from datetime import datetime

# ─── API Keys ───────────────────────────────────────────
class PartnerApiKeyBase(BaseModel):
    name: str

class PartnerApiKeyCreate(PartnerApiKeyBase):
    store_id: str

class PartnerApiKeyUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None

class PartnerApiKey(PartnerApiKeyBase):
    id: str
    store_id: str
    key_preview: str
    is_active: bool
    last_rotated_at: datetime
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# ─── Webhooks ───────────────────────────────────────────
class PartnerWebhookBase(BaseModel):
    url: str
    events: List[str]

class PartnerWebhookCreate(PartnerWebhookBase):
    store_id: str

class PartnerWebhookUpdate(BaseModel):
    url: Optional[str] = None
    events: Optional[List[str]] = None
    is_active: Optional[bool] = None

class PartnerWebhook(PartnerWebhookBase):
    id: str
    store_id: str
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
