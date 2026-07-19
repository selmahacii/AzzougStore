"""
Marketing Event Engine — provider-agnostic event store.

These three tables are the foundation described in the migration
q0r1s2t3u4v5_marketing_event_engine: a data-driven business_event ->
provider_event mapping, an append-only event store, and a full attempt
history per event. No provider (Meta, TikTok, GA4...) has its own table
or its own retry logic — they all consume MarketingEvent rows through the
same worker and the same claim pattern already proven by meta_capi_logs.
"""
import uuid
from sqlalchemy import Column, String, Integer, Float, Boolean, JSON, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.base_class import Base


class ProviderEventMapping(Base):
    """
    business_event -> provider_event translation, entirely data-driven —
    adding a provider or changing when a Purchase-equivalent fires (COD:
    on order confirmation vs. only on actual delivery) is a row insert/
    update, never a code change or a deploy.
    """
    __tablename__ = "provider_event_mappings"
    __table_args__ = (
        UniqueConstraint('store_id', 'provider', 'business_event', name='uq_provider_event_mapping'),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id"), nullable=True, index=True)  # NULL = default for every store
    provider = Column(String, nullable=False, index=True)
    business_event = Column(String, nullable=False, index=True)
    provider_event = Column(String, nullable=False)
    strategy = Column(String, nullable=False, default="immediate")  # immediate | on_confirmed | on_delivery
    enabled = Column(Boolean, nullable=False, default=True)


class MarketingEvent(Base):
    """
    Append-only event store — the source of truth for what the ERP decided
    to tell ad platforms. A row is written once and its raw/canonical/
    provider payloads are never overwritten afterwards; only status,
    attempt_count, and the claim fields change as the worker processes it.
    ORDER_MERGED cancels a still-pending row (status='cancelled') instead
    of deleting it — this is exactly the bug fix that motivated the whole
    engine: a merged duplicate must never let a Purchase-equivalent event
    reach a provider, but the fact that it almost did must stay visible.
    """
    __tablename__ = "marketing_events"
    __table_args__ = (
        UniqueConstraint('event_id', name='uq_marketing_event_id'),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String, nullable=False)  # deterministic: {business_event}-{order_id}-{provider}-{payload_version}
    business_event = Column(String, nullable=False, index=True)
    provider = Column(String, nullable=False, index=True)
    provider_event = Column(String, nullable=False)
    order_id = Column(String, ForeignKey("orders.id"), nullable=False, index=True)
    customer_id = Column(String, nullable=True)
    session_id = Column(String, nullable=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)

    # Event Sourcing: three distinct payload stages, never merged into one
    # mutable blob — a replay years from now must be able to reproduce
    # exactly what was decided (raw), what was normalized (canonical), and
    # what actually left the building (provider), independently.
    raw_payload = Column(JSON, nullable=False)
    canonical_payload = Column(JSON, nullable=False)
    provider_payload = Column(JSON, nullable=True)

    payload_version = Column(Integer, nullable=False, default=1)
    provider_version = Column(String, nullable=True)
    api_version = Column(String, nullable=True)
    schema_version = Column(Integer, nullable=False, default=1)

    # Snapshot of the provider config (pixel/advertiser_id/token VERSION —
    # never the raw secret) active at send time, so a replay reuses the
    # historical config instead of whatever is configured today.
    provider_config_snapshot = Column(JSON, nullable=True)

    dedup_hash = Column(String, nullable=False, index=True)

    signal_quality_score = Column(Float, nullable=True)
    signal_quality_detail = Column(JSON, nullable=True)

    status = Column(String, nullable=False, default="pending", index=True)  # pending|processing|sent|failed|retry|cancelled
    attempt_count = Column(Integer, nullable=False, default=0)
    retry_at = Column(DateTime, nullable=True, index=True)
    processed_at = Column(DateTime, nullable=True)
    failed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    api_response = Column(JSON, nullable=True)

    processing_worker = Column(String, nullable=True)
    processing_started_at = Column(DateTime, nullable=True)

    replayed_from = Column(String, ForeignKey("marketing_events.id"), nullable=True, index=True)
    shadow = Column(Boolean, nullable=False, default=False)

    store = relationship("Store")
    attempts = relationship("MarketingEventAttempt", back_populates="event", order_by="MarketingEventAttempt.attempt_number")


class MarketingEventAttempt(Base):
    """
    One row per delivery attempt — never overwritten. This is what makes
    the event store an actual audit trail instead of a queue table that
    only remembers its last attempt: latency, http status, the raw API
    response, and which worker handled it all survive every retry.
    """
    __tablename__ = "marketing_event_attempts"
    __table_args__ = (
        UniqueConstraint('marketing_event_id', 'attempt_number', name='uq_marketing_event_attempt'),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    marketing_event_id = Column(String, ForeignKey("marketing_events.id"), nullable=False, index=True)
    attempt_number = Column(Integer, nullable=False)
    started_at = Column(DateTime, nullable=False)
    finished_at = Column(DateTime, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    http_status = Column(Integer, nullable=True)
    api_response = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    error_category = Column(String, nullable=True)
    processing_worker = Column(String, nullable=True)

    event = relationship("MarketingEvent", back_populates="attempts")
