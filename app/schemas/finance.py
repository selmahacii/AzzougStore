from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.models.finance import WalletType, TransactionType

# ─── Wallet Schemas ───
class WalletBase(BaseModel):
    name: str
    type: WalletType
    description: Optional[str] = None
    is_active: bool = True

class WalletCreate(WalletBase):
    store_id: str
    balance: Optional[int] = 0

class WalletUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[WalletType] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class Wallet(WalletBase):
    id: str
    store_id: str
    balance: int
    total_in: int
    total_out: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# ─── Transaction Schemas ───
class TransactionBase(BaseModel):
    wallet_id: str
    type: TransactionType
    category: Optional[str] = None
    amount: int
    beneficiary: Optional[str] = None
    description: Optional[str] = None
    transaction_date: Optional[datetime] = None

class TransactionCreate(TransactionBase):
    store_id: str
    reference: Optional[str] = None

class FinancialTransaction(TransactionBase):
    id: str
    store_id: str
    reference: str
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class TransactionPagination(BaseModel):
    success: bool
    data: List[FinancialTransaction]
    total: int
    page: int
    pageSize: int
    totalPages: int

class WalletListResponse(BaseModel):
    success: bool
    data: List[Wallet]
