from typing import List, Optional, Any
from pydantic import BaseModel, field_validator, field_serializer
from datetime import datetime
import json


class OrderItemBase(BaseModel):
    product_id: Optional[str] = None   # Optional: landing pages may not have a linked product
    product_name: str
    quantity: int
    unit_price: float      # accept float from storefront, stored as int in DB
    image_url: Optional[str] = None
    variant_details: Optional[dict] = None

    @field_validator('variant_details', mode='before')
    @classmethod
    def parse_json_string(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return v
        return v


class OrderItemRead(OrderItemBase):
    id: str
    order_id: str

    class Config:
        from_attributes = True


class OrderCreate(BaseModel):
    store_id: str
    customer_name: str
    customer_phone: str
    customer_phone2: Optional[str] = None
    customer_email: Optional[str] = None
    customer_address: str
    customer_wilaya: str
    customer_commune: Optional[str] = None
    delivery_type: str = "HOME"
    delivery_fee: float = 0
    carrier_id: Optional[str] = None   # FK to delivery_partners.id
    subtotal:   float
    discount:   float = 0
    total:      float
    promo_code: Optional[str] = None
    source:     Optional[str] = None
    notes:      Optional[str] = None
    items:      List[OrderItemBase]
    abandoned_cart_id: Optional[str] = None
    is_pack:    Optional[bool] = False
    is_upsell:  Optional[bool] = False
    is_abandoned_cart: Optional[bool] = False
    abandoned_cart_recovery_fee: Optional[int] = 0
    assigned_to: Optional[str] = None

    # Campaign attribution (captured by the storefront at first touch)
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    utm_content: Optional[str] = None
    utm_term: Optional[str] = None
    campaign_id: Optional[str] = None
    adset_id: Optional[str] = None
    ad_id: Optional[str] = None
    fbclid: Optional[str] = None
    fbp: Optional[str] = None
    fbc: Optional[str] = None
    referrer: Optional[str] = None
    event_source_url: Optional[str] = None


class CarrierRef(BaseModel):
    id: str
    name: str
    code: Optional[str] = None      # carrier slug from `carrier_id` attribute on DeliveryPartner
    logo_url: Optional[str] = None
    fee_home: float = 0
    fee_relay: float = 0

    @classmethod
    def from_partner(cls, p) -> "CarrierRef":
        return cls(
            id=p.id,
            name=p.name,
            code=p.carrier_id,       # carrier_id attr maps to "code" column
            logo_url=getattr(p, "logo_url", None),
            fee_home=getattr(p, "fee_home", 0) or 0,
            fee_relay=getattr(p, "fee_relay", 0) or 0,
        )

    class Config:
        from_attributes = True


class ActorRef(BaseModel):
    id: str
    name: str
    avatar: Optional[str] = None

    class Config:
        from_attributes = True


class StoreRef(BaseModel):
    id: str
    name: str
    slug: str

    class Config:
        from_attributes = True


class OrderRead(BaseModel):
    id: str
    store_id: str
    order_number: str
    store_sequence_number: Optional[int] = None  # Admin/agent display: "Commande N°X"
    customer_name: str
    customer_phone: str
    customer_phone2: Optional[str] = None
    customer_email: Optional[str] = None
    customer_address: Optional[str] = None
    customer_wilaya: Optional[str] = None
    customer_commune: Optional[str] = None
    delivery_type: Optional[str] = "HOME"
    delivery_fee:    int = 0
    subtotal:        int = 0
    discount:        int = 0
    total:           int
    carrier_id:      Optional[str] = None
    promo_code:      Optional[str] = None
    status:          str
    assigned_to:     Optional[str] = None
    source:          Optional[str] = None
    notes:           Optional[str] = None
    internal_notes:  Optional[str] = None
    events_count:    Optional[int] = None  # attached in list_orders — one grouped query per page
    # How many duplicate submissions were merged INTO this order (0 for an
    # order that's never had a duplicate, N for a parent that absorbed N
    # resubmits) — attached in list_orders the same way as events_count.
    # The list endpoint never eager-loads the full child_orders relationship
    # (only the single-order detail endpoint does), so without this a parent
    # order's duplicate history was completely invisible from the list view —
    # exactly what made "Meta Ads says 5, ERP says 1" look like a bug instead
    # of the merge count it actually is.
    duplicate_count: Optional[int] = None
    created_at:      datetime
    updated_at:      Optional[datetime] = None
    tracking_number: Optional[str] = None
    # Noest's own granular courier-side stage (raw event_key + their human
    # label), written on every poll cycle — lets a confirmatrice see
    # real-time carrier progress ("En livraison", etc.) instead of only our
    # own coarse SHIPPED bucket, which never changes until DELIVERED/RETURNED.
    carrier_stage:       Optional[str] = None
    carrier_stage_label: Optional[str] = None
    assignee:        Optional[ActorRef] = None
    is_pack:         Optional[bool] = False
    is_upsell:       Optional[bool] = False
    is_abandoned_cart: Optional[bool] = False
    abandoned_cart_recovery_fee: Optional[int] = 0
    is_duplicate:    Optional[bool] = False

    # Business origin: set once when an abandoned cart is first confirmed.
    # Type badge = f(is_abandoned_cart, recovered_at) — never flips with status.
    recovered_at: Optional[datetime] = None

    # Delivery agent (role LIVREUR)
    livreur_id: Optional[str] = None
    livreur: Optional[ActorRef] = None

    # Confirmation Workflow
    confirmation_start_time: Optional[datetime] = None
    nrp_count: int = 0
    next_callback_time: Optional[datetime] = None

    # Duplicate merge tracking
    parent_order_id: Optional[str] = None
    merged_by: Optional[str] = None
    merged_at: Optional[datetime] = None
    status_before_merge: Optional[str] = None

    # Campaign attribution (admin: which campaign generated this order)
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    utm_content: Optional[str] = None
    utm_term: Optional[str] = None
    campaign_id: Optional[str] = None
    adset_id: Optional[str] = None
    ad_id: Optional[str] = None
    referrer: Optional[str] = None

    @field_serializer(
        "created_at", "updated_at", "recovered_at",
        "confirmation_start_time", "next_callback_time", "merged_at",
    )
    def _serialize_utc(self, value: Optional[datetime]) -> Optional[str]:
        # Timestamps are stored as naive UTC (func.now() on a UTC DB session).
        # Emitting them WITHOUT a zone made the browser parse them as LOCAL
        # time, so in Algeria (UTC+1) an order placed 5 min ago rendered as
        # ~1h old — the confirmatrice read this as a 1-hour reception delay.
        # Tagging naive values as UTC ("...Z") makes clients compute real ages.
        if value is None:
            return None
        if value.tzinfo is None:
            return value.isoformat() + "Z"
        return value.isoformat()

    class Config:
        from_attributes = True


class OrderEventRead(BaseModel):
    id: str
    order_id: str
    actor_id: Optional[str] = None
    actor_role: Optional[str] = None
    from_status: Optional[str] = None
    to_status: str
    note: Optional[str] = None
    call_result: Optional[str] = None
    # Nullable in the DB (Column default=1 is Python/ORM-side only — raw SQL
    # inserts, e.g. data-repair migrations, can leave it NULL) — must accept
    # None or every /orders response breaks the moment one legacy row exists.
    call_attempt: Optional[int] = None
    scheduled_callback_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    actor: Optional[ActorRef] = None

    class Config:
        from_attributes = True


class OrderReadFull(OrderRead):
    """Extended order read with related entities eagerly loaded."""
    items: List[OrderItemRead] = []
    events: List[OrderEventRead] = []
    assignee: Optional[ActorRef] = None
    carrier: Optional[CarrierRef] = None
    store: Optional[StoreRef] = None
    # Merged duplicates pointing to this order (populated by get_order)
    child_orders: List["OrderRead"] = []

    class Config:
        from_attributes = True


class OrderUpdateStatus(BaseModel):
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    livreur_id: Optional[str] = None
    notes: Optional[str] = None
    call_result: Optional[str] = None
    scheduled_callback_at: Optional[datetime] = None


class OrderInfoUpdate(BaseModel):
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_phone2: Optional[str] = None
    customer_wilaya: Optional[str] = None
    customer_commune: Optional[str] = None
    customer_address: Optional[str] = None
    delivery_fee: Optional[float] = None
    tracking_number: Optional[str] = None
    notes: Optional[str] = None
    internal_notes: Optional[str] = None
    is_pack: Optional[bool] = None
    is_upsell: Optional[bool] = None
    is_abandoned_cart: Optional[bool] = None
    abandoned_cart_recovery_fee: Optional[int] = None
    carrier_id: Optional[str] = None
    delivery_type: Optional[str] = None
    items: Optional[List[dict]] = None



class OrderList(BaseModel):
    data: List[OrderReadFull]
    total: int
    page: int
    pageSize: int
    totalPages: int
