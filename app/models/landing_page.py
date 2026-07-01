from sqlalchemy import Column, String, Boolean, Integer, Text, JSON, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from app.db.base_class import Base
import uuid


class LandingPage(Base):
    __tablename__ = "landing_pages"

    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    store_id    = Column(String, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id  = Column(String, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)

    slug        = Column(String, nullable=False, index=True)  # URL: /lp/{slug}
    mode        = Column(String, default="product")            # 'product' | 'standalone'
    is_active   = Column(Boolean, default=True)
    views       = Column(Integer, default=0)
    orders      = Column(Integer, default=0)

    # ── Hero ──────────────────────────────────────────────────
    headline      = Column(String, nullable=True)
    subtitle      = Column(Text, nullable=True)
    badge_text    = Column(String, nullable=True)        # e.g. "Offre limitée"
    cta_label     = Column(String, nullable=True)        # primary button
    cta2_label    = Column(String, nullable=True)        # secondary button
    image_url     = Column(String, nullable=True)        # hero image / product image
    video_url     = Column(String, nullable=True)        # optional background video
    banner_image_url = Column(String, nullable=True)     # banner / publicity image below the form or on the page

    # ── CTA Banner (Final) ────────────────────────────────────
    cta_headline  = Column(String, nullable=True)
    cta_subtitle  = Column(Text, nullable=True)

    # ── Product info (standalone mode or override) ────────────
    product_name  = Column(String, nullable=True)
    product_desc  = Column(Text, nullable=True)
    price         = Column(Integer, nullable=True)
    compare_price = Column(Integer, nullable=True)

    # ── Style ─────────────────────────────────────────────────
    primary_color = Column(String, default="#e84393")
    template      = Column(String, default="dark")       # 'dark' | 'light' | 'brand'

    # ── Rich content sections (JSON arrays) ──────────────────
    # benefits:     [{icon, title, desc}]
    # testimonials: [{name, location, text, stars, avatar}]
    # steps:        [{step, title, desc}]
    # stats:        [{value, suffix, label}]
    # faq:          [{question, answer}]
    # gallery:      [url, ...]
    benefits     = Column(JSON, default=list)
    testimonials = Column(JSON, default=list)
    steps        = Column(JSON, default=list)
    stats        = Column(JSON, default=list)
    faq          = Column(JSON, default=list)
    gallery      = Column(JSON, default=list)
    offers       = Column(JSON, default=list)


    # ── Contact ────────────────────────────────────────────────
    phone        = Column(String, nullable=True)

    # ── Tracking ──────────────────────────────────────────────
    tracking_config = Column(JSON, default={"pixel_id": "", "event_name": "Purchase"})

    created_at   = Column(DateTime, default=func.now())
    updated_at   = Column(DateTime, default=func.now(), onupdate=func.now())

    store   = relationship("Store")
    product = relationship("Product")
