from pydantic import BaseModel
from typing import Optional

class OrderStatusConfigBase(BaseModel):
    code: str
    label: str
    color: Optional[str] = "#64748b"
    is_system: Optional[bool] = False
    order_index: Optional[int] = 0
    description: Optional[str] = None

class OrderStatusConfigCreate(OrderStatusConfigBase):
    store_id: str

class OrderStatusConfigUpdate(BaseModel):
    label: Optional[str] = None
    color: Optional[str] = None
    order_index: Optional[int] = None
    description: Optional[str] = None

class OrderStatusConfigOut(OrderStatusConfigBase):
    id: str
    store_id: str

    class Config:
        from_attributes = True
