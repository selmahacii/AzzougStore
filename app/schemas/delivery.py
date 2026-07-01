from pydantic import BaseModel
from typing import Optional, List

class DeliveryFeeBase(BaseModel):
    home_fee: float
    office_fee: float

class DeliveryFeeCreate(DeliveryFeeBase):
    wilaya_id: int
    wilaya_name: str

class DeliveryFeeUpdate(BaseModel):
    home_fee: Optional[float] = None
    office_fee: Optional[float] = None

class DeliveryFee(DeliveryFeeBase):
    wilaya_id: int
    wilaya_name: str
    
    class Config:
        from_attributes = True

class DeliveryFeeListResponse(BaseModel):
    success: bool
    data: List[DeliveryFee]
