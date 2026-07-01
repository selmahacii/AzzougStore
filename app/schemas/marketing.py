from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime

class MarketingChannelBase(BaseModel):
    name: str
    type: str # WHATSAPP, INSTAGRAM, SMS, EMAIL
    status: str = "CONNECTED"
    health_score: int = 100
    config: Optional[dict] = None

class MarketingChannel(MarketingChannelBase):
    id: str
    class Config:
        from_attributes = True

class MessageTemplateBase(BaseModel):
    name: str
    type: str
    language: str = "AR"
    content: str

class MessageTemplateCreate(MessageTemplateBase):
    store_id: Optional[str] = None


class CampaignCreate(BaseModel):
    store_id: str
    name: str
    type: str = "WHATSAPP"
    status: str = "DRAFT"
    scheduled_at: Optional[str] = None


class Campaign(BaseModel):
    id: str
    store_id: str
    name: str
    type: str
    status: str
    scheduled_at: Optional[str] = None

    class Config:
        from_attributes = True

class MessageTemplate(MessageTemplateBase):
    id: str
    class Config:
        from_attributes = True

class MarketingAutomationBase(BaseModel):
    name: str
    trigger: str
    action: str
    template_id: Optional[str] = None
    is_active: bool = True

class MarketingAutomation(MarketingAutomationBase):
    id: str
    template: Optional[MessageTemplate] = None
    class Config:
        from_attributes = True

class MarketingSummary(BaseModel):
    transmissionLoad: int
    successRate: float
    capacityPerDay: str
    latencyMs: int
    activeNodes: bool
