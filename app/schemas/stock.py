from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.schemas.product import Product

class StockMovementBase(BaseModel):
    product_id: str
    type: str
    quantity: int
    reason: Optional[str] = None
    store_id: Optional[str] = None
    warehouse_id: Optional[str] = None
    batch_id: Optional[str] = None
    expiration_date: Optional[str] = None
    variant_details: Optional[dict] = None

class StockMovementCreate(StockMovementBase):
    pass

class StockMovementInDB(StockMovementBase):
    id: str
    actor_id: Optional[str] = None
    order_id: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class ActorBase(BaseModel):
    id: str
    name: str
    email: str
    role: str

    class Config:
        from_attributes = True

class StockMovement(StockMovementInDB):
    # Optional nested product or actor info
    actor: Optional[ActorBase] = None
    order_number: Optional[str] = None
    warehouse_name: Optional[str] = None
    product_name: Optional[str] = None

class MovementPagination(BaseModel):
    success: bool
    data: List[StockMovement]
    total: int
    page: int
    pageSize: int
    totalPages: int

class StockSummary(BaseModel):
    totalProducts: int
    totalStockValue: float
    lowStockCount: int
    outOfStockCount: int
    totalAvailableStock: int
