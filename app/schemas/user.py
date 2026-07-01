from typing import Optional, List
from pydantic import BaseModel, EmailStr, field_validator, model_validator

VALID_PAYMENT_TYPES = {"PER_DELIVERED_ORDER", "PER_CONFIRMED_ORDER", "MONTHLY_SALARY"}


class UserBase(BaseModel):
    email: Optional[EmailStr] = None
    is_active: Optional[bool] = True
    role: Optional[str] = "CONFIRMATEUR"
    name: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None
    daily_target: Optional[int] = 10
    employee_store_id: Optional[str] = None
    payment_type: Optional[str] = None
    payment_amount: Optional[int] = None
    payment_recovered_cart: Optional[int] = 0
    payment_lost_cart: Optional[int] = 0
    assigned_store_scope: Optional[str] = "ALL"
    assigned_store_ids: Optional[List[str]] = []
    assigned_product_ids: Optional[List[str]] = []

    @field_validator("payment_type")
    @classmethod
    def validate_payment_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_PAYMENT_TYPES:
            raise ValueError(
                f"Type de paiement invalide. Valeurs acceptées : {', '.join(sorted(VALID_PAYMENT_TYPES))}"
            )
        return v

    @field_validator("payment_amount")
    @classmethod
    def validate_payment_amount(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("Le montant de paiement ne peut pas être négatif.")
        return v

    @model_validator(mode="after")
    def validate_payment_consistency(self) -> "UserBase":
        pt = self.payment_type
        pa = self.payment_amount
        # Both must be set together or both absent
        if pt is not None and pa is None:
            raise ValueError("payment_amount est requis quand payment_type est défini.")
        if pa is not None and pt is None:
            raise ValueError("payment_type est requis quand payment_amount est défini.")
        return self


class UserCreate(UserBase):
    email: EmailStr
    password: str
    name: str


class UserUpdate(UserBase):
    password: Optional[str] = None


class UserInDBBase(UserBase):
    id: Optional[str] = None

    class Config:
        from_attributes = True


class User(UserInDBBase):
    pass


class UserInDB(UserInDBBase):
    hashed_password: str


# ═══════════════════════════════════════════════════════════════
# Schemas for Personnel Management (Employees/Roles interface)
# ═══════════════════════════════════════════════════════════════

class RolePermission(BaseModel):
    name: str
    description: str
    color: str
    count: int
    permissions: List[str]


class InfrastructureStats(BaseModel):
    totalEffectif: int
    onlineCount: int
    qualityIndex: float
    interactionDelay: float   # in minutes
    securityLevel: str
    nodeId: str


class MarketerPerformance(BaseModel):
    id: str
    name: str
    pixel: str
    product: str
    roas: float
    leads: int
    is_active: bool            # ← snake_case (unified with frontend m.is_active)
    budget: float
