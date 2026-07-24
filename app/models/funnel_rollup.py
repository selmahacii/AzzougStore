"""
Aggregated top-funnel counters — PageView/ViewContent/AddToCart/
InitiateCheckout, one row per (dimensions, hour), NEVER one row per event.
Written exclusively by the Celery flush task in app/services/funnel_tracking.py,
which drains Upstash Redis counters into additive UPSERTs here. Purchase and
Delivered are NOT tracked here — they already have a perfect source of truth
in Order/OrderEvent and re-deriving them into this table would be duplicated,
driftable state for no reason.
"""
import uuid
from sqlalchemy import Column, String, Integer, Date, DateTime, ForeignKey, Index, func
from app.db.base_class import Base


class FunnelRollup(Base):
    __tablename__ = "funnel_rollups"
    # NOTE: the real dedup constraint is a NULL-safe unique index created in
    # migration c850bf4710be — COALESCE(col, '') on the nullable dimensions,
    # because Postgres treats NULL as distinct from NULL in a plain
    # UniqueConstraint, which silently broke additive accumulation for any
    # event missing lp_id/campaign_id/etc (caught by a real end-to-end test,
    # not by this declarative constraint below, which SQLAlchemy still needs
    # declared here for ORM/ForeignKey metadata purposes but is NOT what
    # flush_funnel_counters()'s ON CONFLICT actually targets).
    __table_args__ = (
        Index("idx_funnel_rollup_store_day", "store_id", "day"),
        Index("idx_funnel_rollup_lp_day", "lp_id", "day"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    lp_id = Column(String, ForeignKey("landing_pages.id"), nullable=True, index=True)
    product_id = Column(String, nullable=True, index=True)
    campaign_id = Column(String, nullable=True)
    adset_id = Column(String, nullable=True)
    ad_id = Column(String, nullable=True)
    event_name = Column(String, nullable=False)  # PageView | ViewContent | AddToCart | InitiateCheckout
    day = Column(Date, nullable=False)
    hour = Column(Integer, nullable=False)  # 0-23, Algeria-local
    count = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
