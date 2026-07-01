from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class PromotionBase(BaseModel):
    code: str
    type: str
    value: int
    min_order_amount: Optional[int] = 0
    max_uses: Optional[int] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    is_active: bool = True
    description: Optional[str] = None
    applicable_categories: Optional[str] = ""
    first_purchase_only: bool = False
    is_flash_sale: bool = False
    flash_sale_ends_at: Optional[datetime] = None

class PromotionCreate(PromotionBase):
    store_id: str

class PromotionUpdate(BaseModel):
    code: Optional[str] = None
    type: Optional[str] = None
    value: Optional[int] = None
    min_order_amount: Optional[int] = None
    max_uses: Optional[int] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    is_active: Optional[bool] = None
    description: Optional[str] = None
    applicable_categories: Optional[str] = None
    first_purchase_only: Optional[bool] = None
    is_flash_sale: Optional[bool] = None
    flash_sale_ends_at: Optional[datetime] = None

class PromotionInDBBase(PromotionBase):
    id: str
    store_id: str
    used_count: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class Promotion(PromotionInDBBase):
    pass

class PromotionPagination(BaseModel):
    success: bool
    data: List[Promotion]
    total: int
    page: int
    pageSize: int
    totalPages: int
