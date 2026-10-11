import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import (
    Column, String, Boolean, DateTime, Text, ForeignKey, JSON, Integer,
    UniqueConstraint, Index, func
)
from sqlalchemy.orm import relationship
from app.db.base_class import Base
from app.core.encryption import encrypt_string, decrypt_string


SHOPIFY_API_VERSION_DEFAULT = "2026-10"


class ShopifyConnection(Base):
    """
    Shopify connection configuration per store.
    Stores domain, status, API version, and encrypted credentials.
    """
    __tablename__ = "shopify_connections"

    __table_args__ = (
        UniqueConstraint("store_id", name="uq_shopify_connection_store"),
        UniqueConstraint("shop_domain", name="uq_shopify_connection_domain"),
        Index("idx_shopify_conn_store", "store_id"),
        Index("idx_shopify_conn_domain", "shop_domain"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)

    # Validated shop domain (e.g. "my-brand.myshopify.com")
    shop_domain = Column(String, nullable=False, unique=True, index=True)

    # Status: CONNECTED | DISCONNECTED | ERROR | PAUSED
    status = Column(String, default="CONNECTED", nullable=False, index=True)

    # Supported Shopify API version (default: "2026-10")
    api_version = Column(String, default=SHOPIFY_API_VERSION_DEFAULT, nullable=False)

    def __init__(self, **kwargs):
        if "api_version" not in kwargs or not kwargs["api_version"]:
            kwargs["api_version"] = SHOPIFY_API_VERSION_DEFAULT
        super().__init__(**kwargs)

    # Encrypted credentials (AES-128-CBC via Fernet)
    access_token_encrypted = Column(Text, nullable=True)
    webhook_secret_encrypted = Column(Text, nullable=True)

    # Sync flags
    sync_orders = Column(Boolean, default=True, nullable=False)
    sync_inventory = Column(Boolean, default=True, nullable=False)
    sync_products = Column(Boolean, default=False, nullable=False)

    # Additional operational settings (e.g. location_id, webhook_ids, scopes)
    settings = Column(JSON, default=dict)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    store = relationship("Store", back_populates="shopify_connection")

    def set_access_token(self, token: Optional[str]) -> None:
        if token:
            self.access_token_encrypted = encrypt_string(token.strip())
        else:
            self.access_token_encrypted = None

    def get_access_token(self) -> Optional[str]:
        if not self.access_token_encrypted:
            return None
        return decrypt_string(self.access_token_encrypted)

    def set_webhook_secret(self, secret: Optional[str]) -> None:
        if secret:
            self.webhook_secret_encrypted = encrypt_string(secret.strip())
        else:
            self.webhook_secret_encrypted = None

    def get_webhook_secret(self) -> Optional[str]:
        if not self.webhook_secret_encrypted:
            return None
        return decrypt_string(self.webhook_secret_encrypted)

    def get_masked_access_token(self) -> Optional[str]:
        token = self.get_access_token()
        if not token:
            return None
        if len(token) <= 8:
            return "********"
        return f"{token[:4]}****{token[-4:]}"


class ShopifyMapping(Base):
    """
    Bi-directional cross-reference table between Shopify IDs and AzzougShop internal IDs.
    Supports products, variants, orders, and customers.
    """
    __tablename__ = "shopify_mappings"

    __table_args__ = (
        UniqueConstraint("store_id", "entity_type", "shopify_id", name="uq_shopify_map_store_entity_shopify"),
        UniqueConstraint("store_id", "entity_type", "internal_id", name="uq_shopify_map_store_entity_internal"),
        Index("idx_shopify_map_lookup", "store_id", "entity_type", "shopify_id"),
        Index("idx_shopify_map_reverse", "store_id", "entity_type", "internal_id"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)

    # Entity types: PRODUCT | VARIANT | ORDER | CUSTOMER
    entity_type = Column(String, nullable=False, index=True)

    # Internal AzzougShop ID (e.g. Product.id, Order.id, or Product.id:variant_sku)
    internal_id = Column(String, nullable=False, index=True)

    # Shopify numeric or GID string ID
    shopify_id = Column(String, nullable=False, index=True)

    # Secondary identifier (e.g. inventory_item_id for variants, order_number for orders)
    shopify_secondary_id = Column(String, nullable=True, index=True)

    # Metadata (e.g. SKU, titles, barcode, last_sync_at)
    extra_data = Column(JSON, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    store = relationship("Store", back_populates="shopify_mappings")


class ShopifyWebhookInbox(Base):
    """
    Durable inbox table for incoming Shopify webhooks.
    Guarantees idempotency via unique delivery_id (X-Shopify-Webhook-Id),
    tracks processing lifecycle, retry attempts, and sanitized errors.
    """
    __tablename__ = "shopify_webhook_inbox"

    __table_args__ = (
        UniqueConstraint("delivery_id", name="uq_shopify_inbox_delivery_id"),
        Index("idx_shopify_inbox_queue", "status", "next_retry_at", "created_at"),
        Index("idx_shopify_inbox_store_topic", "store_id", "topic"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    # Delivery identifier from X-Shopify-Webhook-Id header (must be unique)
    delivery_id = Column(String, nullable=False, unique=True, index=True)

    store_id = Column(String, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    topic = Column(String, nullable=False, index=True)
    shop_domain = Column(String, nullable=False, index=True)

    # Full webhook payload
    payload = Column(JSON, nullable=False)

    # Lifecycle state: PENDING | PROCESSING | PROCESSED | FAILED | DEAD_LETTER
    status = Column(String, default="PENDING", nullable=False, index=True)

    attempts = Column(Integer, default=0, nullable=False)
    max_attempts = Column(Integer, default=5, nullable=False)

    next_retry_at = Column(DateTime(timezone=True), nullable=True, index=True)
    processed_at = Column(DateTime(timezone=True), nullable=True)

    # Sanitized error message (secrets & tokens stripped)
    last_error = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    store = relationship("Store", back_populates="shopify_webhook_inbox")


class ShopifyInventorySyncQueue(Base):
    """
    Durable outbound queue table for Shopify inventory level synchronization.
    Guarantees asynchronous, transactional, and recoverable updates of sellable stock
    from AzzougShop ERP to Shopify via GraphQL Admin API (inventorySetQuantities).
    """
    __tablename__ = "shopify_inventory_sync_queue"

    __table_args__ = (
        Index("idx_shopify_inv_queue_poll", "status", "next_retry_at", "created_at"),
        Index("idx_shopify_inv_queue_store_item", "store_id", "product_id", "variant_sku"),
        Index("idx_shopify_inv_queue_idemp", "idempotency_key"),
        Index("idx_shopify_inv_queue_status", "status"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(String, ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)

    variant_sku = Column(String, nullable=True, index=True)
    variant_str = Column(String, nullable=True)

    shopify_inventory_item_id = Column(String, nullable=True, index=True)
    shopify_location_id = Column(String, nullable=True)

    target_quantity = Column(Integer, nullable=False)
    previous_quantity = Column(Integer, nullable=True)

    # Status: PENDING | PROCESSING | SUCCESS | FAILED | DEAD_LETTER | COALESCED
    status = Column(String, default="PENDING", nullable=False, index=True)

    attempts = Column(Integer, default=0, nullable=False)
    max_attempts = Column(Integer, default=5, nullable=False)

    next_retry_at = Column(DateTime(timezone=True), nullable=True, index=True)
    last_error = Column(Text, nullable=True)

    idempotency_key = Column(String, nullable=False, default=lambda: str(uuid.uuid4()))
    stock_revision = Column(Integer, default=1, nullable=False)

    processed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    store = relationship("Store", back_populates="shopify_inventory_sync_queue")
    product = relationship("Product")
