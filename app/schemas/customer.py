from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class CustomerBase(BaseModel):
    name: str
    phone: str
    secondary_phone: Optional[str] = None
    email: Optional[str] = None
    wilaya: Optional[str] = None
    address: Optional[str] = None
    tier: str = "BRONZE"
    is_blacklisted: bool = False
    is_guest: bool = False
    blacklist_note: Optional[str] = None

class CustomerCreate(CustomerBase):
    store_id: str
    source: Optional[str] = "MANUAL"

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    secondary_phone: Optional[str] = None
    email: Optional[str] = None
    wilaya: Optional[str] = None
    address: Optional[str] = None
    tier: Optional[str] = None
    is_blacklisted: Optional[bool] = None
    blacklist_note: Optional[str] = None

class CustomerInDBBase(CustomerBase):
    id: str
    store_id: str
    total_orders: int
    total_spent: int
    total_returned: int
    last_order_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class Customer(CustomerInDBBase):
    has_account: bool = False
    source: Optional[str] = None
    note: Optional[str] = None
    tags: Optional[List[str]] = None
    rfm_score: Optional[str] = None

class CustomerPagination(BaseModel):
    success: bool
    data: List[Customer]
    total: int
    page: int
    pageSize: int
    totalPages: int
