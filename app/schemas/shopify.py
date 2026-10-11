from typing import Optional, Dict, Any, List
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
import re


SHOPIFY_API_VERSION_DEFAULT = "2026-10"


class ShopifyConnectionBase(BaseModel):
    shop_domain: str
    api_version: str = SHOPIFY_API_VERSION_DEFAULT
    sync_orders: bool = True
    sync_inventory: bool = True
    sync_products: bool = False
    settings: Optional[Dict[str, Any]] = None

    @field_validator("shop_domain")
    @classmethod
    def clean_shop_domain(cls, v: str) -> str:
        if not v:
            raise ValueError("Le domaine Shopify ne peut pas être vide.")
        cleaned = v.strip().lower()
        cleaned = re.sub(r"^https?://", "", cleaned).rstrip("/")
        if not re.match(r"^([a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$", cleaned):
            raise ValueError(f"Domaine Shopify invalide: '{v}'. Doit être de la forme 'boutique.myshopify.com' ou un nom d'hôte valide.")
        return cleaned


class ShopifyConnectionCreate(ShopifyConnectionBase):
    store_id: str
    access_token: Optional[str] = Field(None, description="Shopify Admin API token (shpat_...)")
    webhook_secret: Optional[str] = Field(None, description="Shopify Webhook signing secret")


class ShopifyConnectionUpdate(BaseModel):
    status: Optional[str] = None
    access_token: Optional[str] = None
    webhook_secret: Optional[str] = None
    api_version: Optional[str] = None
    sync_orders: Optional[bool] = None
    sync_inventory: Optional[bool] = None
    sync_products: Optional[bool] = None
    settings: Optional[Dict[str, Any]] = None


class ShopifyConnectionRead(BaseModel):
    id: str
    store_id: str
    shop_domain: str
    status: str
    api_version: str
    has_access_token: bool = False
    has_webhook_secret: bool = False
    masked_access_token: Optional[str] = None
    sync_orders: bool
    sync_inventory: bool
    sync_products: bool
    settings: Dict[str, Any] = {}
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

    @classmethod
    def from_orm_model(cls, obj: Any) -> "ShopifyConnectionRead":
        masked = obj.get_masked_access_token() if hasattr(obj, "get_masked_access_token") else None
        has_token = bool(obj.access_token_encrypted)
        has_secret = bool(obj.webhook_secret_encrypted)
        return cls(
            id=str(obj.id),
            store_id=str(obj.store_id),
            shop_domain=str(obj.shop_domain),
            status=str(obj.status),
            api_version=str(obj.api_version),
            has_access_token=has_token,
            has_webhook_secret=has_secret,
            masked_access_token=masked,
            sync_orders=bool(obj.sync_orders),
            sync_inventory=bool(obj.sync_inventory),
            sync_products=bool(obj.sync_products),
            settings=obj.settings or {},
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )


class ShopifyMappingCreate(BaseModel):
    store_id: str
    entity_type: str = Field(..., description="PRODUCT | VARIANT | ORDER | CUSTOMER")
    internal_id: str
    shopify_id: str
    shopify_secondary_id: Optional[str] = None
    extra_data: Optional[Dict[str, Any]] = None

    @field_validator("entity_type")
    @classmethod
    def validate_entity_type(cls, v: str) -> str:
        upper = v.strip().upper()
        allowed = {"PRODUCT", "VARIANT", "ORDER", "CUSTOMER"}
        if upper not in allowed:
            raise ValueError(f"Type d'entité invalide: '{v}'. Types autorisés: {sorted(allowed)}")
        return upper


class ShopifyMappingRead(BaseModel):
    id: str
    store_id: str
    entity_type: str
    internal_id: str
    shopify_id: str
    shopify_secondary_id: Optional[str] = None
    extra_data: Dict[str, Any] = {}
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ShopifyWebhookInboxRead(BaseModel):
    id: str
    delivery_id: str
    store_id: str
    topic: str
    shop_domain: str
    status: str
    attempts: int
    max_attempts: int
    next_retry_at: Optional[datetime] = None
    processed_at: Optional[datetime] = None
    last_error: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ShopifyInventoryQueueRead(BaseModel):
    id: str
    store_id: str
    product_id: str
    variant_sku: Optional[str] = None
    variant_str: Optional[str] = None
    shopify_inventory_item_id: Optional[str] = None
    shopify_location_id: Optional[str] = None
    target_quantity: int
    previous_quantity: Optional[int] = None
    status: str
    attempts: int
    max_attempts: int
    next_retry_at: Optional[datetime] = None
    last_error: Optional[str] = None
    stock_revision: int
    processed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ShopifyReconciliationItem(BaseModel):
    product_id: str
    product_name: str
    variant_sku: Optional[str] = None
    variant_str: Optional[str] = None
    erp_available: int
    shopify_available: Optional[int] = None
    delta: Optional[int] = None
    status: str  # SYNCED | DIVERGENT | UNMAPPED | MISSING_LOCATION
    proposed_action: str


class ShopifyReconciliationReport(BaseModel):
    store_id: str
    total_items_checked: int
    synced_count: int
    divergent_count: int
    unmapped_count: int
    missing_location_count: int
    dry_run: bool
    items: List[ShopifyReconciliationItem]


class ShopifyReconcileRequest(BaseModel):
    store_id: str
    dry_run: bool = True
    limit: int = 50
