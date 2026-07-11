from sqlalchemy import Column, String, Integer, ForeignKey, Text, Boolean, JSON, DateTime, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base
from app.core.encryption import EncryptedString

class MarketingChannel(Base):
    __tablename__ = "marketing_channels"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False) # WHATSAPP, INSTAGRAM, SMS, EMAIL
    status = Column(String, default="CONNECTED") # CONNECTED, DISCONNECTED, ERROR
    health_score = Column(Integer, default=100)
    config = Column(JSON, nullable=True) # API keys, IDs, etc.
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)

class MessageTemplate(Base):
    __tablename__ = "message_templates"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False) # WHATSAPP, SMS, EMAIL
    language = Column(String, default="AR") # AR, FR, EN
    content = Column(Text, nullable=False)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)

class MarketingAutomation(Base):
    __tablename__ = "marketing_automations"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    trigger = Column(String, nullable=False) # NEW_ORDER, STATUS_CHANGE, etc.
    action = Column(String, nullable=False) # SEND_MESSAGE
    template_id = Column(String, ForeignKey("message_templates.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    
    template = relationship("MessageTemplate")

class MarketingLog(Base):
    __tablename__ = "marketing_logs"

    id = Column(String, primary_key=True, index=True)
    automation_id = Column(String, ForeignKey("marketing_automations.id"), nullable=True)
    channel_type = Column(String, nullable=False)
    recipient = Column(String, nullable=False)
    status = Column(String, default="SENT") # SENT, DELIVERED, FAILED
    error_message = Column(Text, nullable=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)


class StoreVisitor(Base):
    __tablename__ = "store_visitors"

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    name = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    # How they found the store: facebook, instagram, tiktok, google, direct, other
    source = Column(String, nullable=True)
    page = Column(String, nullable=True)          # which page they were on
    user_agent = Column(Text, nullable=True)
    # Whether they eventually placed an order
    converted = Column(Boolean, default=False)
    conversion_order_id = Column(String, nullable=True)
    visited_at = Column(DateTime, server_default=func.now(), nullable=False)
    # Session fingerprint to avoid double-counting
    session_id = Column(String, nullable=True, index=True)
class MarketingCampaign(Base):
    __tablename__ = "marketing_campaigns"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False) # WHATSAPP, SMS, EMAIL, etc.
    status = Column(String, default="DRAFT") # DRAFT, SCHEDULED, RUNNING, COMPLETED, FAILED
    scheduled_at = Column(DateTime, nullable=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

class MetaAdsConfig(Base):
    __tablename__ = "meta_ads_configs"

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, unique=True, index=True)
    access_token = Column(EncryptedString, nullable=True)
    ad_account_id = Column(String, nullable=True)
    pixel_id = Column(String, nullable=True)
    domain_verification_tag = Column(String, nullable=True)
    is_connected = Column(Boolean, default=False)
    exchange_rate = Column(Float, default=1.0, nullable=True)
    currency = Column(String, default="USD", nullable=True)

    store = relationship("Store")

class TikTokAdsConfig(Base):
    __tablename__ = "tiktok_ads_configs"

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, unique=True, index=True)
    access_token = Column(EncryptedString, nullable=True)
    advertiser_id = Column(String, nullable=True)
    pixel_id = Column(String, nullable=True)
    app_id = Column(String, nullable=True)
    is_connected = Column(Boolean, default=False)
    exchange_rate = Column(Float, default=1.0, nullable=True)
    currency = Column(String, default="USD", nullable=True)

    store = relationship("Store")

class TikTokAdsCampaign(Base):
    __tablename__ = "tiktok_ads_campaigns"

    id = Column(String, primary_key=True, index=True)
    campaign_id = Column(String, unique=True, index=True, nullable=False)
    campaign_name = Column(String, nullable=False)
    spend = Column(Float, default=0.0)  # converted to DZD
    raw_spend = Column(Float, default=0.0, nullable=True)
    currency = Column(String, default="USD", nullable=True)
    impressions = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    reach = Column(Integer, default=0)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    date_start = Column(DateTime, nullable=True)
    date_end = Column(DateTime, nullable=True)

    store = relationship("Store")

class MetaAdsCampaign(Base):
    __tablename__ = "meta_ads_campaigns"

    id = Column(String, primary_key=True, index=True)
    campaign_id = Column(String, unique=True, index=True, nullable=False)
    campaign_name = Column(String, nullable=False)
    spend = Column(Float, default=0.0) # Ad spend in DZD or DA (or local currency)
    raw_spend = Column(Float, default=0.0, nullable=True)
    currency = Column(String, default="USD", nullable=True)
    impressions = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    reach = Column(Integer, default=0)
    # Meta's OWN attributed purchase count/value, pulled straight from the
    # Insights API's `actions`/`action_values` (action_type in
    # PURCHASE_ACTION_TYPES) — i.e. Meta's pixel/CAPI attribution window and
    # dedup logic, not ours. Kept side-by-side with orders_count/revenue
    # (which come from OUR order table matched by utm_campaign) so the
    # dashboard can show both numbers instead of forcing a fake match: the
    # two will never be perfectly identical (different attribution windows,
    # view-through vs click-through, events fired for carts that never became
    # a DB order, etc.) — that gap is real, not a bug.
    meta_purchases = Column(Integer, default=0, nullable=True)
    meta_purchase_value = Column(Float, default=0.0, nullable=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    date_start = Column(DateTime, nullable=True)
    date_end = Column(DateTime, nullable=True)

    store = relationship("Store")


class MetaCapiLog(Base):
    """
    One row per server-side Conversions API send — powers the diagnostics
    dashboard (CAPI status, success rate, deduplication coverage, last errors)
    AND doubles as the persistent retry queue: a transient failure (SSL
    handshake timeout, DNS blip, 5xx) is never silently dropped — it stays
    queryable with status='pending_retry' until the background sweep
    (app.services.meta_capi.retry_pending_events) resends it or it exhausts
    its retry budget (status='failed').
    """
    __tablename__ = "meta_capi_logs"

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=True, index=True)
    order_id = Column(String, nullable=True, index=True)
    event_name = Column(String, nullable=False, index=True)
    event_id = Column(String, nullable=False)
    status = Column(String, nullable=False, index=True)  # success | error | pending_retry | failed
    error_message = Column(Text, nullable=True)
    # network_timeout | network_error | api_4xx | api_5xx | other — lets the
    # dashboard split "network unreachable" from "Meta rejected the request".
    error_category = Column(String, nullable=True, index=True)
    events_received = Column(Integer, nullable=True)

    # Retry queue
    payload = Column(JSON, nullable=True)          # full event dict, replayable as-is
    retry_count = Column(Integer, nullable=False, default=0)
    next_retry_at = Column(DateTime, nullable=True, index=True)
    latency_ms = Column(Integer, nullable=True)

    store = relationship("Store")

