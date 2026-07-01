from pydantic import BaseModel
from typing import List, Optional

class WarehouseBase(BaseModel):
    code: str
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    wilaya: Optional[str] = None
    note: Optional[str] = None
    manager_name: Optional[str] = None
    capacity: Optional[int] = None

class WarehouseCreate(WarehouseBase):
    store_id: str

class WarehouseUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    wilaya: Optional[str] = None
    note: Optional[str] = None
    manager_name: Optional[str] = None
    capacity: Optional[int] = None

class Warehouse(WarehouseBase):
    id: str
    store_id: str
    is_active: Optional[bool] = True
    products: List[str] = [] # Mock implementation for now
    
    class Config:
        from_attributes = True

class WarehouseListResponse(BaseModel):
    success: bool
    data: List[Warehouse]
