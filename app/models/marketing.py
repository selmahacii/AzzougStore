from sqlalchemy import Column, String, Integer, ForeignKey, Text, Boolean, JSON, DateTime, Date, Float, UniqueConstraint, Index
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
    # TikTok Catalog Manager's catalog identifier — distinct from
    # advertiser_id/pixel_id, required by the Catalog API (product/create,
    # product/update, product/delete) to know which catalog to push into.
    catalog_id = Column(String, nullable=True)
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
    # TikTok's OWN attributed conversion count/value, pulled from the Reporting
    # API's "conversion"/"total_complete_payment_rate" style metrics — kept
    # side-by-side with orders_count/revenue (our own utm_campaign-matched
    # order table) for the same reason as Meta's meta_purchases/
    # meta_purchase_value: different attribution methodology, will never be
    # bit-for-bit identical, shown side-by-side instead of faked into one.
    tiktok_conversions = Column(Integer, default=0, nullable=True)
    tiktok_conversion_value = Column(Float, default=0.0, nullable=True)
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
    # Manual override — lets a store owner explicitly link a campaign to a
    # product regardless of ad naming or UTM completeness. Several ad sets
    # split-testing the same product (arbitrary codenames like "vd jdid",
    # "tyara"...) never match the product's name/slug, so the automatic
    # fallback silently dropped their spend/purchases from that product's
    # totals. When set, this takes priority over both the UTM-order match
    # and the name-substring fallback in meta_ads.py's attribution loop.
    product_id = Column(String, ForeignKey("products.id"), nullable=True, index=True)

    store = relationship("Store")


class MetaAdsDailyInsight(Base):
    """
    One row per campaign per calendar day — Meta's own daily figures, pulled
    with time_increment=1 during sync and upserted by (campaign_id, date).

    MetaAdsCampaign above only holds ONE running snapshot per campaign,
    overwritten on every sync with whatever date range was requested — so
    "Achats déclarés par Meta" could never answer "combien aujourd'hui ?"
    and always disagreed with Ads Manager whenever the two sides were
    looking at different ranges. This table makes Meta's numbers sliceable
    by any date range, exactly like our own orders.
    """
    __tablename__ = "meta_ads_daily_insights"
    __table_args__ = (UniqueConstraint("campaign_id", "date", name="uq_meta_daily_campaign_date"),)

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    campaign_id = Column(String, nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    spend = Column(Float, default=0.0)          # converted to DZD
    raw_spend = Column(Float, default=0.0)      # ad-account currency
    impressions = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    reach = Column(Integer, default=0)
    meta_purchases = Column(Integer, default=0)
    meta_purchase_value = Column(Float, default=0.0)


class MetaAdsAdInsight(Base):
    """
    One row per individual AD (Meta hierarchy: Campaign > Ad Set > Ad) —
    MetaAdsCampaign only stores one row per CAMPAIGN, which is Meta's own
    Insights API rollup of every ad/ad-set underneath it. A client running
    several split-tested ads under the same campaign (real case: "tyara",
    "vd jdid", "vd jdida", "vd ai" — Meta's own Ads Manager showed each with
    its own achats/coût-par-achat) only ever saw ONE combined row in the ERP,
    with no way to tell "vd jdid" (239 achats) apart from "vd ai" (1 achat).
    This table makes that same per-ad breakdown available here, upserted by
    ad_id on every sync — purely additive, campaign-level totals unchanged.
    """
    __tablename__ = "meta_ads_ad_insights"
    __table_args__ = (UniqueConstraint("ad_id", name="uq_meta_ad_insight_ad_id"),)

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    campaign_id = Column(String, nullable=False, index=True)
    ad_id = Column(String, nullable=False, index=True)
    ad_name = Column(String, nullable=False)
    adset_id = Column(String, nullable=True, index=True)
    adset_name = Column(String, nullable=True)
    spend = Column(Float, default=0.0)          # converted to DZD
    raw_spend = Column(Float, default=0.0)      # ad-account currency
    currency = Column(String, default="USD", nullable=True)
    impressions = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    reach = Column(Integer, default=0)
    meta_purchases = Column(Integer, default=0)
    meta_purchase_value = Column(Float, default=0.0)
    date_start = Column(DateTime, nullable=True)
    date_end = Column(DateTime, nullable=True)


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
    retry_count = Column(Integer, nullable=False, default=0)  # doubles as attempt_count
    next_retry_at = Column(DateTime, nullable=True, index=True)
    latency_ms = Column(Integer, nullable=True)     # doubles as processing_duration_ms

    # Durable-queue fields (status now also takes: queued | processing | retry).
    # A row is written with status='queued' in the SAME transaction/commit as
    # the order itself (see orders.py) — so even if the process dies right
    # after commit, the row already exists and is picked up on restart.
    processing_started_at = Column(DateTime, nullable=True)  # set on claim; >15min = stuck
    completed_at = Column(DateTime, nullable=True)
    last_http_status = Column(Integer, nullable=True)
    processing_worker = Column(String, nullable=True)  # hostname:pid, diagnostic only

    store = relationship("Store")


class TikTokCapiLog(Base):
    """
    TikTok equivalent of MetaCapiLog — one row per server-side TikTok Events
    API send, same durable-queue contract (queued/processing/retry/
    pending_retry/success/failed/skipped) and same dual role: powers the
    TikTok diagnostics dashboard AND is the persistent retry queue.

    Deliberately its OWN table rather than a shared "ad_platform_capi_logs"
    with a platform column: MetaCapiLog is queried by 13+ endpoints with
    store_id/event_name/status/created_at predicates baked into every
    index — merging platforms into one table would mean every one of those
    indexes gains a platform column, and every existing Meta query gains an
    unnecessary extra filter. Two tables, one proven schema shape, is safer
    than a risky migration of a table already in production. Composite index
    on (store_id, event_name, created_at) applied from day 1 here — the
    2026-07-20 Meta audit found this missing from meta_capi_logs only after
    the table had years of production data; TikTok starts with it.
    """
    __tablename__ = "tiktok_capi_logs"
    __table_args__ = (
        Index("ix_tiktok_capi_logs_store_event_created", "store_id", "event_name", "created_at"),
    )

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=True, index=True)
    order_id = Column(String, nullable=True, index=True)
    event_name = Column(String, nullable=False, index=True)  # ViewContent | AddToCart | InitiateCheckout | CompletePayment | PlaceAnOrder
    event_id = Column(String, nullable=False, index=True)    # shared dedup key with the browser Pixel (ttq.track)
    status = Column(String, nullable=False, index=True)      # queued | processing | retry | pending_retry | success | failed | skipped
    error_message = Column(Text, nullable=True)
    error_category = Column(String, nullable=True, index=True)  # network_timeout | network_error | api_4xx | api_5xx | other
    events_received = Column(Integer, nullable=True)

    # Retry queue
    payload = Column(JSON, nullable=True)
    retry_count = Column(Integer, nullable=False, default=0)
    next_retry_at = Column(DateTime, nullable=True, index=True)
    latency_ms = Column(Integer, nullable=True)

    # Durable-queue fields — same contract as MetaCapiLog.
    processing_started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    last_http_status = Column(Integer, nullable=True)
    processing_worker = Column(String, nullable=True)

    store = relationship("Store")


class TikTokAdsDailyInsight(Base):
    """
    TikTok twin of MetaAdsDailyInsight — one row per campaign per calendar
    day, upserted by (campaign_id, date) from TikTok's Reporting API with
    a daily time granularity, so "combien TikTok a déclaré AUJOURD'HUI ?"
    is answerable without waiting for a full resync of the running
    TikTokAdsCampaign snapshot.
    """
    __tablename__ = "tiktok_ads_daily_insights"
    __table_args__ = (UniqueConstraint("campaign_id", "date", name="uq_tiktok_daily_campaign_date"),)

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    campaign_id = Column(String, nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    spend = Column(Float, default=0.0)          # converted to DZD
    raw_spend = Column(Float, default=0.0)      # ad-account currency
    impressions = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    reach = Column(Integer, default=0)
    tiktok_conversions = Column(Integer, default=0)
    tiktok_conversion_value = Column(Float, default=0.0)


class TikTokAdsAdInsight(Base):
    """
    TikTok twin of MetaAdsAdInsight — one row per individual AD (TikTok
    hierarchy: Campaign > Ad Group > Ad), upserted by ad_id. Covers both
    the "Ad Groups" and "Ads" audit items in one table, same as Meta's
    ad_insight covers both ad-set and ad — TikTok's Reporting API returns
    adgroup_id/adgroup_name alongside ad_id/ad_name at AUCTION_AD level,
    exactly the shape MetaAdsAdInsight already models for adset_id/ad_id.
    """
    __tablename__ = "tiktok_ads_ad_insights"
    __table_args__ = (UniqueConstraint("ad_id", name="uq_tiktok_ad_insight_ad_id"),)

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    campaign_id = Column(String, nullable=False, index=True)
    ad_id = Column(String, nullable=False, index=True)
    ad_name = Column(String, nullable=False)
    adgroup_id = Column(String, nullable=True, index=True)
    adgroup_name = Column(String, nullable=True)
    spend = Column(Float, default=0.0)          # converted to DZD
    raw_spend = Column(Float, default=0.0)      # ad-account currency
    currency = Column(String, default="USD", nullable=True)
    impressions = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    reach = Column(Integer, default=0)
    tiktok_conversions = Column(Integer, default=0)
    tiktok_conversion_value = Column(Float, default=0.0)
    date_start = Column(DateTime, nullable=True)
    date_end = Column(DateTime, nullable=True)


class TikTokCatalogSyncLog(Base):
    """
    TikTok Catalog Feed Enterprise (2026-07-20) — durable queue for
    per-product Catalog API pushes (create/update/delete), same contract
    as TikTokCapiLog: a row is written BEFORE the network call, retried on
    transient failure, never silently dropped. One row per (product_id,
    action) — a product updated twice before the first push settles
    upserts the same row rather than spawning a duplicate.

    Powers the Catalog Health dashboard: how many products are tracked,
    how many succeeded/failed/are pending, per-error-category breakdown,
    last successful sync per product.
    """
    __tablename__ = "tiktok_catalog_sync_logs"
    __table_args__ = (
        Index("ix_tiktok_catalog_sync_store_product", "store_id", "product_id"),
    )

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    product_id = Column(String, ForeignKey("products.id"), nullable=False, index=True)
    tiktok_item_id = Column(String, nullable=True, index=True)  # TikTok's own sku_id once accepted
    action = Column(String, nullable=False)     # create | update | delete
    status = Column(String, nullable=False, index=True)  # queued | processing | retry | pending_retry | success | failed | skipped
    error_message = Column(Text, nullable=True)
    error_category = Column(String, nullable=True, index=True)  # validation | network_timeout | network_error | api_4xx | api_5xx | other
    payload = Column(JSON, nullable=True)        # the catalog item dict actually sent, replayable as-is
    retry_count = Column(Integer, nullable=False, default=0)
    next_retry_at = Column(DateTime, nullable=True, index=True)
    latency_ms = Column(Integer, nullable=True)
    processing_started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    last_http_status = Column(Integer, nullable=True)

    store = relationship("Store")
    product = relationship("Product")

