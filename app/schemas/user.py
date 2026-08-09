from typing import Optional, List
from pydantic import BaseModel, EmailStr, field_validator, model_validator

VALID_PAYMENT_TYPES = {"PER_DELIVERED_ORDER", "MONTHLY_SALARY"}


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
    payment_upsell: Optional[int] = 0
    payment_marketplace_upsell_only: Optional[int] = 50
    payday: Optional[int] = None  # day of month (1-28) this employee is due to be paid
    assigned_store_scope: Optional[str] = "ALL"
    assigned_store_ids: Optional[List[str]] = []
    assigned_product_ids: Optional[List[str]] = []
    permissions: Optional[List[str]] = []
    module_visibility: Optional[dict] = {}
    tracking_code: Optional[str] = None
    marketing_budget: Optional[int] = None

    @field_validator("payment_type")
    @classmethod
    def validate_payment_type(cls, v: Optional[str]) -> Optional[str]:
        # Legacy DB rows may hold PER_CONFIRMED_ORDER — normalize instead of
        # crashing response serialization (salary is only paid on DELIVERED).
        if v == "PER_CONFIRMED_ORDER":
            return "PER_DELIVERED_ORDER"
        if v is not None and v not in VALID_PAYMENT_TYPES:
            raise ValueError(
                f"Type de paiement invalide. Valeurs accept├®es : {', '.join(sorted(VALID_PAYMENT_TYPES))}"
            )
        return v

    @field_validator("payment_amount")
    @classmethod
    def validate_payment_amount(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("Le montant de paiement ne peut pas ├¬tre n├®gatif.")
        return v

    @field_validator("payday")
    @classmethod
    def validate_payday(cls, v: Optional[int]) -> Optional[int]:
        # Capped to 28 so it's a valid day in every month, including February.
        if v is not None and not (1 <= v <= 28):
            raise ValueError("Le jour de paie doit être compris entre 1 et 28.")
        return v

    @model_validator(mode="after")
    def validate_payment_consistency(self) -> "UserBase":
        pt = self.payment_type
        pa = self.payment_amount
        # Both must be set together or both absent
        if pt is not None and pa is None:
            raise ValueError("payment_amount est requis quand payment_type est d├®fini.")
        if pa is not None and pt is None:
            raise ValueError("payment_type est requis quand payment_amount est d├®fini.")
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


# ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
# Schemas for Personnel Management (Employees/Roles interface)
# ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

class RolePermission(BaseModel):
    name: str
    description: str
    color: str
    count: int
    permissions: List[str]


class InfrastructureStats(BaseModel):
    totalEffectif: int
    onlineCount: int
    # Real average confirmation rate (%) across confirmatrices with at
    # least one assigned order in the window — None when nobody has any
    # (nothing to average), never a fabricated placeholder number.
    qualityIndex: Optional[float] = None
    # Real average minutes between an order's creation and its first
    # recorded status-changing event (first confirmatrice touch), scoped
    # to the same window. None when there's no event data yet to average.
    interactionDelay: Optional[float] = None
    nodeId: str


class MarketerPerformance(BaseModel):
    id: str
    name: str
    pixel: Optional[str] = None       # real tracking_code, or None if unconfigured
    product: str = "Multi-produits"
    roas: float = 0.0                 # real: attributed delivered revenue / budget
    leads: int = 0                    # real: orders attributed via tracking_code
    is_active: bool
    budget: float = 0.0                # real: admin-configured marketing_budget
    revenue: float = 0.0               # attributed delivered revenue (DA)
    tracking_configured: bool = False  # False -> UI should show "Non configure", not a fake code
