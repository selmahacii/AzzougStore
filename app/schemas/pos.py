from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

class POSSaleItemBase(BaseModel):
    product_id: str
    product_name: str
    quantity: int
    unit_price: int
    total_price: int
    variant_details: Optional[dict] = None

class POSSaleItemCreate(POSSaleItemBase):
    pass

class POSSaleItem(POSSaleItemBase):
    id: str
    sale_id: str

    class Config:
        from_attributes = True

class POSSaleBase(BaseModel):
    session_id: str
    store_id: str
    customer_id: Optional[str] = None
    subtotal: int
    tax: int = 0
    discount: int = 0
    total: int
    payment_method: str = "CASH"
    payment_details: Optional[dict] = None

class POSSaleCreate(POSSaleBase):
    items: List[POSSaleItemCreate]

class POSSale(POSSaleBase):
    id: str
    receipt_number: str
    created_at: Optional[datetime] = None
    items: List[POSSaleItem]

    class Config:
        from_attributes = True

class POSSessionBase(BaseModel):
    store_id: str
    user_id: str
    opening_balance: int = 0
    notes: Optional[str] = None

class POSSessionCreate(POSSessionBase):
    pass

class POSSessionUpdate(BaseModel):
    closing_balance: Optional[int] = None
    real_closing_balance: Optional[int] = None
    status: Optional[str] = "CLOSED"
    end_at: Optional[datetime] = None

class POSSession(POSSessionBase):
    id: str
    start_at: datetime
    end_at: Optional[datetime] = None
    status: str
    sales: List[POSSale] = []

    class Config:
        from_attributes = True
