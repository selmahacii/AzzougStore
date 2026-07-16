"""
Landing Pages CRUD
- GET  /landing-pages/          list all for a store
- POST /landing-pages/          create
- GET  /landing-pages/{id}      get one (admin)
- GET  /landing-pages/slug/{slug} get public (storefront, increments views)
- PATCH /landing-pages/{id}     update
- DELETE /landing-pages/{id}    delete
"""
from __future__ import annotations

import uuid
import re
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime

from sqlalchemy import func, case, and_, distinct

from app.api import deps
from app.db.session import get_db
from app.models.landing_page import LandingPage
from app.models.product import Product

router = APIRouter()
logger = logging.getLogger("app.landing_pages")


def _slugify(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_-]+", "-", s)
    return s[:60]


def _serialize(
    lp: LandingPage,
    product: Optional[Product] = None,
    orders_override: Optional[int] = None,
    metrics: Optional[dict] = None,
    stock_detail: Optional[dict] = None,
) -> dict:
    p = lp.product or product
    return {
        "id":            lp.id,
        "store_id":      lp.store_id,
        "product_id":    lp.product_id,
        "slug":          lp.slug,
        "mode":          lp.mode,
        "is_active":     lp.is_active,
        "views":         lp.views,
        "orders":        orders_override if orders_override is not None else (lp.orders or 0),
        # Reliable per-product performance breakdown (None when not computed,
        # e.g. the single-LP and create/update responses that don't need it).
        "metrics":       metrics,
        "stock_detail":  stock_detail,
        "headline":      lp.headline,
        "subtitle":      lp.subtitle,
        "badge_text":    lp.badge_text,
        "cta_label":     lp.cta_label,
        "cta2_label":    lp.cta2_label,
        "image_url":     lp.image_url or (p.main_image if p else None),
        "video_url":     lp.video_url,
        "cta_headline":  lp.cta_headline,
        "cta_subtitle":  lp.cta_subtitle,
        "product_name":  lp.product_name or (p.name if p else None),
        "product_desc":  lp.product_desc or (p.description if p else None),
        "price":         lp.price if lp.price is not None else (p.price if p else None),
        "compare_price": lp.compare_price if lp.compare_price is not None else (p.compare_price if p else None),
        "primary_color": lp.primary_color,
        "template":      lp.template,
        "benefits":      lp.benefits or [],
        "testimonials":  lp.testimonials or [],
        "steps":         lp.steps or [],
        "stats":         lp.stats or [],
        "faq":           lp.faq or [],
        "gallery":       lp.gallery or [],
        "offers":        lp.offers or [],
        "phone":         lp.phone,
        "banner_image_url": lp.banner_image_url,
        "created_at":    lp.created_at.isoformat() if lp.created_at else None,
        "updated_at":    lp.updated_at.isoformat() if lp.updated_at else None,
        # merged product info for convenience
        "product": {
            "id": p.id, "name": p.name, "slug": p.slug,
            "price": p.price, "compare_price": p.compare_price,
            "main_image": p.main_image, "images": p.images or [],
            "description": p.description,
            "variants": p.variants or [],
            "delivery_fees": p.delivery_fees,
        } if p else None,
        "store": {
            "id": lp.store.id,
            "name": lp.store.name,
            "logo_url": lp.store.logo_url,
            "slug": lp.store.slug,
        } if lp.store else None,
    }


# ─── List ─────────────────────────────────────────────────────────────────────

@router.get("/")
def list_landing_pages(
    store_id: str = Query(...),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    logger.info(f"[LP] list_landing_pages called: store_id={store_id!r}, user={getattr(_auth, 'email', '?')} role={getattr(_auth, 'role', '?')}")
    # start_date/end_date scope the ORDER metrics below (how many commandes,
    # paniers abandonnés, etc. happened in that window) — they must NOT hide
    # landing pages themselves. A page created before the selected range used
    # to vanish entirely from the list just because its created_at fell
    # outside the window, even though its orders during that window were
    # perfectly real and worth seeing.
    pages = (
        db.query(LandingPage)
        .filter(LandingPage.store_id == store_id)
        .order_by(LandingPage.created_at.desc())
        .all()
    )
    logger.info(f"[LP] Found {len(pages)} landing pages for store_id={store_id!r}")

    # ── Live per-product performance metrics (computed from real orders) ──────
    # Everything below is derived directly from the orders table so the numbers
    # are reliable and self-healing, never dependent on a stale stored counter.
    from app.models.order import Order, OrderItem
    lp_product_ids = [lp.product_id for lp in pages if lp.product_id]

    _DELIVERED_STATES = ("CONFIRMED", "SHIPPED", "DELIVERED")

    metrics_by_product: dict = {}
    if lp_product_ids:
        # Single grouped pass with conditional aggregation. Every figure counts
        # DISTINCT orders (a product can appear on several order lines) and is
        # scoped by PRODUCT + STORE — deliberately NOT by source. The checkout
        # "source" tag (landing_page/storefront/facebook/…) is set
        # inconsistently across templates (the dz_cod flow in particular), so
        # filtering on it silently dropped every real order to 0. Every order
        # for this product in this store is a genuine result for the product,
        # so we count them all.
        #   - orders:     real unique orders (excludes MERGED duplicates)
        #   - purchases:  what Meta counts as an "Achat" — a real order placed
        #                 at checkout, excluding duplicates AND admin-created
        #                 manual orders (source=MANUAL). This is the numerator
        #                 of the conversion rate so it matches Meta's method
        #                 (purchases ÷ landing-page views).
        #   - delivered:  orders actually delivered (DELIVERED)
        #   - confirmed_delivered: orders confirmed or shipped or delivered
        #   - recovered:  abandoned carts later confirmed/delivered
        #   - abandoned:  total carts entered via the abandoned-cart flow,
        #                 regardless of whether they were later recovered
        #   - normal:     genuine checkout orders — NOT abandoned carts, not
        #                 admin-created manual orders, not merged duplicates
        #   - cancelled:  orders cancelled
        #   - duplicates: same-phone repeat submissions (auto-merged)
        _not_manual = func.coalesce(Order.source, "") != "MANUAL"
        _is_abandoned = Order.is_abandoned_cart == True
        _metrics_query = (
            db.query(
                OrderItem.product_id,
                func.count(distinct(case((Order.status != "MERGED", Order.id)))).label("orders"),
                func.count(distinct(case(
                    (and_(Order.status != "MERGED", _not_manual), Order.id)
                ))).label("purchases"),
                func.count(distinct(case((Order.status == "DELIVERED", Order.id)))).label("delivered"),
                func.count(distinct(case((Order.status.in_(_DELIVERED_STATES), Order.id)))).label("confirmed_delivered"),
                func.count(distinct(case(
                    (and_(_is_abandoned, Order.status.in_(_DELIVERED_STATES)), Order.id)
                ))).label("recovered"),
                func.count(distinct(case((_is_abandoned, Order.id)))).label("abandoned"),
                func.count(distinct(case(
                    (and_(Order.status != "MERGED", _not_manual, func.coalesce(Order.is_abandoned_cart, False) == False), Order.id)
                ))).label("normal"),
                func.count(distinct(case((Order.status == "CANCELLED", Order.id)))).label("cancelled"),
                func.count(distinct(case((Order.status == "MERGED", Order.id)))).label("duplicates"),
                # Admin/agent-created orders (source=MANUAL) — deliberately
                # EXCLUDED from "purchases"/conversion (not landing-page
                # traffic), but the client must still SEE them: without this
                # figure they were invisible everywhere on this screen.
                func.count(distinct(case(
                    (and_(Order.status != "MERGED", func.coalesce(Order.source, "") == "MANUAL"), Order.id)
                ))).label("manual"),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .filter(
                Order.store_id == store_id,
                Order.is_deleted == False,
                OrderItem.product_id.in_(lp_product_ids),
            )
        )
        # Same start_date/end_date the UI's date-range picker already sends —
        # scopes the per-product indicators (Ordres/Récup/Annulés/Doublons/
        # Livrées) to the selected period instead of always aggregating
        # all-time history.
        if start_date:
            from app.core.dates import parse_local_date_filter
            try:
                _metrics_query = _metrics_query.filter(Order.created_at >= parse_local_date_filter(start_date))
            except ValueError:
                pass
        if end_date:
            from app.core.dates import parse_local_date_filter
            try:
                _metrics_query = _metrics_query.filter(Order.created_at <= parse_local_date_filter(end_date))
            except ValueError:
                pass
        rows = _metrics_query.group_by(OrderItem.product_id).all()
        for r in rows:
            metrics_by_product[r.product_id] = {
                "orders": int(r.orders or 0),
                "purchases": int(r.purchases or 0),
                "delivered": int(r.delivered or 0),
                "confirmed_delivered": int(r.confirmed_delivered or 0),
                "recovered": int(r.recovered or 0),
                "abandoned": int(r.abandoned or 0),
                "normal": int(r.normal or 0),
                "cancelled": int(r.cancelled or 0),
                "duplicates": int(r.duplicates or 0),
                "manual": int(r.manual or 0),
            }

        # "Achats déclarés par Meta" per product — shown as a badge right on
        # the LP card so the client sees Meta's own received-orders count next
        # to the ERP's real counts without opening the Meta Ads module.
        # Sourced from the per-day insights table (time_increment=1 sync) and
        # sliced by the SAME date range as the order metrics above, so both
        # sides of the comparison finally cover the same period. Falls back
        # to the campaign snapshot totals until the daily table has data
        # (first sync after this feature ships).
        from app.models.marketing import MetaAdsCampaign, MetaAdsDailyInsight
        from app.core.dates import parse_local_date_filter
        _campaign_product = {
            c.campaign_id: c.product_id
            for c in db.query(MetaAdsCampaign).filter(
                MetaAdsCampaign.store_id == store_id,
                MetaAdsCampaign.product_id.in_(lp_product_ids),
            ).all()
        }
        # Last-synced timestamp per product — the numbers below are always a
        # snapshot from the last backend sync (auto-sync runs every
        # META_ADS_SYNC_INTERVAL_MINUTES, default 24h), not live. Without
        # this on the card, a real gap with Meta's own live UI reads as a
        # bug instead of the explainable staleness it actually is.
        _synced_at_by_product: dict = {}
        for c in db.query(MetaAdsCampaign).filter(
            MetaAdsCampaign.store_id == store_id,
            MetaAdsCampaign.product_id.in_(lp_product_ids),
        ).all():
            if c.updated_at and (c.product_id not in _synced_at_by_product or c.updated_at > _synced_at_by_product[c.product_id]):
                _synced_at_by_product[c.product_id] = c.updated_at
        # Same source/fallback logic also surfaces Meta's own impressions per
        # product — the LP card can then show "vues" (our storefront counter)
        # side-by-side with "impressions" (Meta's ad delivery count), which
        # answer different questions (page loads vs. ad served) and were
        # previously conflated because only "vues" existed on the card.
        _meta_by_product: dict = {}
        _meta_impressions_by_product: dict = {}
        if _campaign_product:
            _daily_q = db.query(
                MetaAdsDailyInsight.campaign_id,
                func.coalesce(func.sum(MetaAdsDailyInsight.meta_purchases), 0),
                func.coalesce(func.sum(MetaAdsDailyInsight.impressions), 0),
            ).filter(MetaAdsDailyInsight.campaign_id.in_(list(_campaign_product.keys())))
            if start_date:
                try:
                    _daily_q = _daily_q.filter(MetaAdsDailyInsight.date >= parse_local_date_filter(start_date).date())
                except ValueError:
                    pass
            if end_date:
                try:
                    _daily_q = _daily_q.filter(MetaAdsDailyInsight.date <= parse_local_date_filter(end_date).date())
                except ValueError:
                    pass
            _daily_rows = _daily_q.group_by(MetaAdsDailyInsight.campaign_id).all()
            if _daily_rows:
                for _cid, _cnt, _impr in _daily_rows:
                    _pid = _campaign_product.get(_cid)
                    if _pid:
                        _meta_by_product[_pid] = _meta_by_product.get(_pid, 0) + int(_cnt or 0)
                        _meta_impressions_by_product[_pid] = _meta_impressions_by_product.get(_pid, 0) + int(_impr or 0)
            else:
                # Daily table empty (pre-first-sync) — snapshot fallback
                for c in db.query(MetaAdsCampaign).filter(
                    MetaAdsCampaign.store_id == store_id,
                    MetaAdsCampaign.product_id.in_(lp_product_ids),
                ).all():
                    _meta_by_product[c.product_id] = _meta_by_product.get(c.product_id, 0) + int(c.meta_purchases or 0)
                    _meta_impressions_by_product[c.product_id] = _meta_impressions_by_product.get(c.product_id, 0) + int(c.impressions or 0)
        _meta_products = set(_meta_by_product) | set(_meta_impressions_by_product)
        for _pid in _meta_products:
            # A product can have a linked campaign but zero orders in the
            # selected period — still surface Meta's count on the card.
            metrics_by_product.setdefault(_pid, {
                "orders": 0, "purchases": 0, "delivered": 0,
                "confirmed_delivered": 0, "recovered": 0, "abandoned": 0,
                "normal": 0, "cancelled": 0, "duplicates": 0, "manual": 0,
            })
            metrics_by_product[_pid]["meta_purchases"] = _meta_by_product.get(_pid, 0)
            metrics_by_product[_pid]["meta_impressions"] = _meta_impressions_by_product.get(_pid, 0)
            _synced_at = _synced_at_by_product.get(_pid)
            metrics_by_product[_pid]["meta_last_synced_at"] = _synced_at.isoformat() if _synced_at else None

    # ── Remaining stock per product, broken down by variant ───────────────────
    stock_by_product: dict = {}
    if lp_product_ids:
        for p in db.query(Product).filter(Product.id.in_(lp_product_ids)).all():
            variants = p.variants if isinstance(p.variants, list) else []
            in_stock = 0
            total_variant_stock = 0
            for v in variants:
                if not isinstance(v, dict):
                    continue
                try:
                    s = int(v.get("stock") or 0)
                except (TypeError, ValueError):
                    s = 0
                total_variant_stock += s
                if s > 0:
                    in_stock += 1
            stock_by_product[p.id] = {
                "stock": total_variant_stock if variants else int(p.stock or 0),
                "variants_total": len(variants),
                "variants_in_stock": in_stock,
            }

    # Keep the stored LP counter aligned with the reliable live figure
    for lp in pages:
        m = metrics_by_product.get(lp.product_id) if lp.product_id else None
        if m is not None and m["orders"] != (lp.orders or 0):
            lp.orders = m["orders"]
    try:
        db.commit()
    except Exception:
        db.rollback()

    data = []
    for lp in pages:
        m = metrics_by_product.get(lp.product_id) if lp.product_id else None
        st = stock_by_product.get(lp.product_id) if lp.product_id else None
        data.append(_serialize(
            lp,
            orders_override=(m["orders"] if m else None),
            metrics=m,
            stock_detail=st,
        ))
    return {"success": True, "data": data}


# ─── Public: get by slug (storefront) ─────────────────────────────────────────

@router.get("/slug/{slug}")
def get_by_slug(
    slug: str,
    store_id: str = Query(...),
    db: Session = Depends(get_db),
) -> Any:
    lp = db.query(LandingPage).filter(
        LandingPage.slug == slug,
        LandingPage.store_id == store_id,
        LandingPage.is_active == True,
    ).first()
    if not lp:
        raise HTTPException(404, "Landing page introuvable")
    lp.views = (lp.views or 0) + 1
    db.commit()
    return {"success": True, "data": _serialize(lp)}


# ─── Get one ──────────────────────────────────────────────────────────────────

@router.get("/{lp_id}")
def get_landing_page(
    lp_id: str,
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    lp = db.query(LandingPage).filter(LandingPage.id == lp_id).first()
    if not lp:
        raise HTTPException(404, "Landing page introuvable")
    return {"success": True, "data": _serialize(lp)}


# ─── Per-LP analytics: daily order breakdown for the detail panel ─────────────

@router.get("/{lp_id}/analytics")
def get_landing_page_analytics(
    lp_id: str,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    """
    Daily orders/delivered/cancelled/revenue for THIS page's product, plus
    period totals — powers the click-through detail dialog in the LP module.
    Same counting rules as the list metrics: MERGED and soft-deleted orders
    excluded, every order of the product in the store counts (source-agnostic).
    Defaults to the last 30 days when no range is given.
    """
    from datetime import timedelta
    from app.models.order import Order, OrderItem

    db.info["skip_tenant_isolation"] = True  # explicit store scope below
    lp = db.query(LandingPage).filter(LandingPage.id == lp_id).first()
    if not lp:
        raise HTTPException(404, "Landing page introuvable")
    if not lp.product_id:
        return {"success": True, "data": {"daily": [], "totals": {}, "created_at": lp.created_at.isoformat() if lp.created_at else None}}

    from app.core.dates import parse_local_date_filter, ALGERIA_UTC_OFFSET_HOURS
    now = datetime.utcnow()
    d_start = now - timedelta(days=30)
    d_end = now
    if start_date:
        try:
            d_start = parse_local_date_filter(start_date)
        except ValueError:
            pass
    if end_date:
        try:
            d_end = parse_local_date_filter(end_date)
        except ValueError:
            pass

    # Group by Algeria-local calendar day, not raw UTC — otherwise an order
    # placed at 00:03 Algeria time (23:03 UTC the previous day) landed in
    # the wrong day's bucket in the chart below.
    day = func.date(Order.created_at + timedelta(hours=ALGERIA_UTC_OFFSET_HOURS))
    rows = (
        db.query(
            day.label("day"),
            func.count(distinct(case((Order.status != "MERGED", Order.id)))).label("orders"),
            func.count(distinct(case((Order.status == "DELIVERED", Order.id)))).label("delivered"),
            func.count(distinct(case((Order.status == "CANCELLED", Order.id)))).label("cancelled"),
            func.count(distinct(case(
                (and_(Order.status != "MERGED", func.coalesce(Order.source, "") == "MANUAL"), Order.id)
            ))).label("manual"),
            func.coalesce(func.sum(case(
                (Order.status != "MERGED", OrderItem.quantity * OrderItem.unit_price), else_=0
            )), 0).label("revenue"),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .filter(
            Order.store_id == lp.store_id,
            OrderItem.product_id == lp.product_id,
            Order.is_deleted == False,
            Order.created_at >= d_start,
            Order.created_at <= d_end,
        )
        .group_by(day)
        .order_by(day)
        .all()
    )

    daily = [
        {
            "date": str(r.day),
            "orders": int(r.orders or 0),
            "delivered": int(r.delivered or 0),
            "cancelled": int(r.cancelled or 0),
            "manual": int(r.manual or 0),
            "revenue": float(r.revenue or 0),
        }
        for r in rows
    ]
    totals = {
        "orders": sum(d["orders"] for d in daily),
        "delivered": sum(d["delivered"] for d in daily),
        "cancelled": sum(d["cancelled"] for d in daily),
        "manual": sum(d["manual"] for d in daily),
        "revenue": sum(d["revenue"] for d in daily),
    }

    # ── Micro-détail panier normal / abandonné / récupéré / doublons / NRP —
    # même calcul que les badges de la liste des landing pages (une seule
    # requête groupée), pour que le client voie clairement d'où viennent ses
    # commandes sans avoir à deviner. Scopé au même produit + période que le
    # reste de cet endpoint.
    _not_manual = func.coalesce(Order.source, "") != "MANUAL"
    _is_abandoned = Order.is_abandoned_cart == True
    _DELIVERED_STATES = ("CONFIRMED", "SHIPPED", "DELIVERED")
    detail_row = (
        db.query(
            func.count(distinct(case(
                (and_(Order.status != "MERGED", _not_manual, func.coalesce(Order.is_abandoned_cart, False) == False), Order.id)
            ))).label("normal"),
            func.count(distinct(case((_is_abandoned, Order.id)))).label("abandoned"),
            func.count(distinct(case(
                (and_(_is_abandoned, Order.status.in_(_DELIVERED_STATES)), Order.id)
            ))).label("recovered"),
            func.count(distinct(case((Order.status == "MERGED", Order.id)))).label("duplicates"),
            func.count(distinct(case((Order.status.in_(_DELIVERED_STATES), Order.id)))).label("confirmed_delivered"),
            func.count(distinct(case(
                (and_(Order.nrp_count > 0, Order.status.in_(("ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"))), Order.id)
            ))).label("nrp"),
            func.count(distinct(case(
                (and_(Order.nrp_count > 0, _is_abandoned, Order.status.in_(("ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"))), Order.id)
            ))).label("nrp_abandoned"),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .filter(
            Order.store_id == lp.store_id,
            OrderItem.product_id == lp.product_id,
            Order.is_deleted == False,
            Order.created_at >= d_start,
            Order.created_at <= d_end,
        )
        .first()
    )
    totals["normal"] = int(detail_row.normal or 0)
    totals["abandoned"] = int(detail_row.abandoned or 0)
    totals["recovered"] = int(detail_row.recovered or 0)
    totals["duplicates"] = int(detail_row.duplicates or 0)
    totals["confirmed_delivered"] = int(detail_row.confirmed_delivered or 0)
    totals["nrp"] = int(detail_row.nrp or 0)
    totals["nrp_abandoned"] = int(detail_row.nrp_abandoned or 0)
    totals["nrp_normal"] = max(0, totals["nrp"] - totals["nrp_abandoned"])
    # Abandonné jamais récupéré = toujours ouvert/en cours, pas de statut final
    totals["abandoned_not_recovered"] = max(0, totals["abandoned"] - totals["recovered"])

    # "Achats déclarés par Meta" for this exact product — client's main ask
    # was to see, right on the landing page card, what Meta itself reports
    # having received, next to the real order count above. Sourced from the
    # per-day insights table and sliced by the SAME d_start..d_end as the
    # order metrics above, so both sides finally cover the same period —
    # this was the reported "décalage". Falls back to the campaign snapshot
    # totals until the daily table has data (first sync after this ships).
    from app.models.marketing import MetaAdsCampaign, MetaAdsDailyInsight
    meta_campaigns = db.query(MetaAdsCampaign).filter(
        MetaAdsCampaign.store_id == lp.store_id,
        MetaAdsCampaign.product_id == lp.product_id,
    ).all()
    _camp_ids = [c.campaign_id for c in meta_campaigns]
    meta_daily_by_date: dict = {}
    if _camp_ids:
        _rows = (
            db.query(
                MetaAdsDailyInsight.date,
                func.coalesce(func.sum(MetaAdsDailyInsight.meta_purchases), 0),
                func.coalesce(func.sum(MetaAdsDailyInsight.meta_purchase_value), 0.0),
                func.coalesce(func.sum(MetaAdsDailyInsight.spend), 0.0),
                func.coalesce(func.sum(MetaAdsDailyInsight.impressions), 0),
            )
            .filter(
                MetaAdsDailyInsight.campaign_id.in_(_camp_ids),
                MetaAdsDailyInsight.date >= d_start.date(),
                MetaAdsDailyInsight.date <= d_end.date(),
            )
            .group_by(MetaAdsDailyInsight.date)
            .all()
        )
        meta_daily_by_date = {
            str(r[0]): {"purchases": int(r[1] or 0), "value": float(r[2] or 0.0), "spend": float(r[3] or 0.0), "impressions": int(r[4] or 0)}
            for r in _rows
        }
    if meta_daily_by_date:
        totals["meta_purchases"] = sum(v["purchases"] for v in meta_daily_by_date.values())
        totals["meta_purchase_value"] = sum(v["value"] for v in meta_daily_by_date.values())
        totals["meta_spend"] = sum(v["spend"] for v in meta_daily_by_date.values())
        totals["meta_impressions"] = sum(v["impressions"] for v in meta_daily_by_date.values())
    else:
        totals["meta_purchases"] = sum(c.meta_purchases or 0 for c in meta_campaigns)
        totals["meta_purchase_value"] = sum(c.meta_purchase_value or 0.0 for c in meta_campaigns)
        totals["meta_spend"] = sum(c.spend or 0.0 for c in meta_campaigns)
        totals["meta_impressions"] = sum(c.impressions or 0 for c in meta_campaigns)

    # Per-day Meta count merged into the chart data — lets the dialog show
    # "Meta a déclaré X ce jour-là" next to our own daily order bars.
    for d in daily:
        d["meta_purchases"] = meta_daily_by_date.get(d["date"], {}).get("purchases", 0)
        d["meta_impressions"] = meta_daily_by_date.get(d["date"], {}).get("impressions", 0)

    return {
        "success": True,
        "data": {
            "daily": daily,
            "totals": totals,
            "created_at": lp.created_at.isoformat() if lp.created_at else None,
            "views": lp.views or 0,
        },
    }


# ─── GET /{lp_id}/tracking-quality — ERP vs Meta CAPI gap, per Landing Page ──
# Every number here comes from a row that exists in OUR OWN database.
# Deliberately does NOT claim to know: Pixel fires (browser-only, never
# reaches this backend), or Meta's internal Received/Deduplicated/Discarded
# accounting (lives exclusively on Meta's platform, no API credential setup
# in this environment queries it). Those fields are returned as `null` with
# an explicit "unavailable" reason string — never fabricated.

@router.get("/{lp_id}/tracking-quality")
def get_landing_page_tracking_quality(
    lp_id: str,
    range_days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    """
    Single-page "why doesn't Meta match my ERP" dashboard. Every metric is
    ONE grouped/aggregated SQL query (no per-order Python loop, no N+1) so
    opening this tab costs a fixed, small number of queries regardless of
    how many orders the landing page has.
    """
    from datetime import timedelta
    from app.models.order import Order, OrderItem
    from app.models.marketing import MetaCapiLog, MetaAdsCampaign, MetaAdsDailyInsight

    db.info["skip_tenant_isolation"] = True
    lp = db.query(LandingPage).filter(LandingPage.id == lp_id).first()
    if not lp:
        raise HTTPException(404, "Landing page introuvable")
    if not lp.product_id:
        return {"success": True, "data": {"available": False, "reason": "no_product_linked"}}

    now = datetime.utcnow()
    since = now - timedelta(days=range_days)

    # Correlated EXISTS instead of a JOIN to order_items: a JOIN fans out one
    # row per matching OrderItem, so an order with N lines of this product
    # was counted/listed N times everywhere below (confirmed in production:
    # a 4-item order appeared 4 times in "commandes problématiques"). .any()
    # compiles to a single EXISTS subquery — no fan-out, no DISTINCT needed.
    has_product = Order.items.any(OrderItem.product_id == lp.product_id)

    # ── 1. ERP KPIs — ONE grouped query, every count via conditional COUNT ──
    erp_row = (
        db.query(
            func.count(Order.id).label("total"),
            func.count(case((Order.status.in_(("CONFIRMED", "SHIPPED", "DELIVERED")), Order.id))).label("confirmed"),
            func.count(case((Order.status == "CANCELLED", Order.id))).label("cancelled"),
            func.count(case((Order.status == "MERGED", Order.id))).label("merged"),
            func.count(case((func.coalesce(Order.source, "") == "MANUAL", Order.id))).label("manual"),
            func.count(case((func.coalesce(Order.source, "") == "landing_page", Order.id))).label("landing_page_only"),
        )
        .filter(
            Order.store_id == lp.store_id,
            has_product,
            Order.is_deleted == False,
            Order.created_at >= since,
        )
        .first()
    )
    erp = {
        "total_orders": int(erp_row.total or 0),
        "confirmed": int(erp_row.confirmed or 0),
        "cancelled": int(erp_row.cancelled or 0),
        "merged": int(erp_row.merged or 0),
        "manual": int(erp_row.manual or 0),
        "landing_page_only": int(erp_row.landing_page_only or 0),
    }
    # CAPI is only ever attempted for non-MERGED, non-MANUAL/POS orders that
    # have LEFT the ABANDONED state (see send_purchase_for_order's skip logic
    # + the two enqueue trigger points in orders.py — a cart still sitting in
    # ABANDONED was never purchased, so it correctly never gets a CAPI
    # attempt; that's not an anomaly, it's the expected pre-sale state).
    # Confirmed in production: including ABANDONED inflated "jamais tenté"
    # to 98-100% on pages with a lot of still-open abandoned carts.
    # "Éligible" veut dire : cette commande EST devenue une vraie vente
    # (CONFIRMED/SHIPPED/DELIVERED). Une commande encore en appel (NEW/
    # ASSIGNED/CALLED/IN_PROGRESS/RESCHEDULED) n'a pas encore eu sa chance
    # de déclencher le CAPI — la compter comme "jamais tenté" gonflait
    # artificiellement le taux d'écart à 98%+ sur toute page avec beaucoup
    # d'appels en cours. CANCELLED n'est pas une vente non plus — exclue
    # pour la même raison qu'ABANDONED/MERGED/MANUAL.
    _CAPI_ELIGIBLE_STATUSES = ("CONFIRMED", "SHIPPED", "DELIVERED")
    eligible_count = (
        db.query(func.count(Order.id))
        .filter(
            Order.store_id == lp.store_id,
            has_product,
            Order.is_deleted == False,
            Order.created_at >= since,
            Order.status.in_(_CAPI_ELIGIBLE_STATUSES),
            func.coalesce(Order.source, "") != "MANUAL",
        )
        .scalar() or 0
    )

    # ── 2. Meta CAPI status breakdown — ONE grouped query, EXISTS not JOIN ──
    capi_rows = (
        db.query(MetaCapiLog.status, func.count(MetaCapiLog.id))
        .join(Order, Order.id == MetaCapiLog.order_id)
        .filter(
            has_product,
            Order.store_id == lp.store_id,
            MetaCapiLog.event_name == "Purchase",
            Order.created_at >= since,
        )
        .group_by(MetaCapiLog.status)
        .all()
    )
    capi_by_status = {status: count for status, count in capi_rows}
    capi = {
        "sent_total": sum(capi_by_status.values()),
        "success": capi_by_status.get("success", 0),
        "failed": capi_by_status.get("failed", 0),
        "retry": capi_by_status.get("retry", 0) + capi_by_status.get("pending_retry", 0),
        "queued": capi_by_status.get("queued", 0),
        "processing": capi_by_status.get("processing", 0),
        "skipped": capi_by_status.get("skipped", 0),
    }
    no_capi_row_at_all = max(0, eligible_count - capi["sent_total"])

    # ── 2bis. Répartition temps réel / backfill des succès (section 2/3) ──
    # Bornée aux commandes de cette landing page sur la période — jamais un
    # scan de table, juste les lignes déjà sélectionnées ci-dessus par
    # produit+store+date, remplacées par une requête ciblée sur les succès.
    from app.services.meta_capi import classify_capi_log_timing
    from app.models.events import OrderEvent
    success_rows = (
        db.query(Order.id, Order.created_at, MetaCapiLog.created_at)
        .join(MetaCapiLog, and_(MetaCapiLog.order_id == Order.id, MetaCapiLog.event_name == "Purchase"))
        .filter(has_product, Order.store_id == lp.store_id, Order.created_at >= since, MetaCapiLog.status == "success")
        .all()
    )
    _order_ids_success = [r[0] for r in success_rows]
    _abandoned_map = {}
    if _order_ids_success:
        for oid, ts in (
            db.query(OrderEvent.order_id, func.min(OrderEvent.created_at))
            .filter(OrderEvent.order_id.in_(_order_ids_success), OrderEvent.from_status == "ABANDONED")
            .group_by(OrderEvent.order_id).all()
        ):
            _abandoned_map[oid] = ts
    realtime_count = backfill_count = 0
    for oid, order_created, log_created in success_rows:
        reference = _abandoned_map.get(oid, order_created)
        if classify_capi_log_timing(log_created, reference) == "realtime":
            realtime_count += 1
        else:
            backfill_count += 1
    capi["realtime"] = realtime_count
    capi["backfill"] = backfill_count

    # ── 3. Meta Ads Manager's OWN reported purchases for this product,
    # already-synced totals (NOT real-time, NOT Meta's internal dedup math —
    # just what the last sync copied from Meta's Insights API) ──
    meta_campaigns = db.query(MetaAdsCampaign).filter(
        MetaAdsCampaign.store_id == lp.store_id, MetaAdsCampaign.product_id == lp.product_id,
    ).all()
    _camp_ids = [c.campaign_id for c in meta_campaigns]
    meta_ads_purchases = None
    if _camp_ids:
        meta_ads_purchases = db.query(func.coalesce(func.sum(MetaAdsDailyInsight.meta_purchases), 0)).filter(
            MetaAdsDailyInsight.campaign_id.in_(_camp_ids),
            MetaAdsDailyInsight.date >= since.date(),
        ).scalar()
        meta_ads_purchases = int(meta_ads_purchases or 0)

    # ── 4. Gap analysis — honest breakdown of OUR OWN recorded reasons only.
    # "cause inconnue" covers what we genuinely cannot explain from our data,
    # rather than inventing a plausible-sounding cause. Each bucket carries
    # its own count, percentage of the gap, and a short factual explanation
    # — never a guess about WHY the underlying state occurred (e.g. "failed"
    # doesn't speculate on WHY Meta rejected it, that's in error_message).
    gap_total = max(0, eligible_count - capi["success"])
    _gap_counts = {
        "en_attente_queue": capi["queued"],
        "en_cours": capi["processing"],
        "en_retry": capi["retry"],
        "echec_definitif": capi["failed"],
        "exclu_intentionnellement": capi["skipped"],
        "jamais_tente": no_capi_row_at_all,
    }
    _explained = sum(_gap_counts.values())
    _gap_counts["cause_inconnue"] = max(0, gap_total - _explained)
    _gap_explanations = {
        "en_attente_queue": "Commande en file d'attente, pas encore traitée par le worker.",
        "en_cours": "Envoi en cours vers Meta au moment de la mesure.",
        "en_retry": "Premier envoi échoué (réseau/timeout), nouvelle tentative programmée.",
        "echec_definitif": "Budget de tentatives épuisé ou erreur Meta non récupérable (ex: token invalide).",
        "exclu_intentionnellement": "Commande manuelle, fusionnée, ou config Meta absente — exclusion volontaire.",
        "jamais_tente": "Aucune ligne de suivi trouvée pour cette commande — cause à investiguer.",
        "cause_inconnue": "Écart non expliqué par les données actuellement enregistrées.",
    }
    gap_breakdown = {
        key: {
            "count": count,
            "percent": round(count / gap_total * 100, 1) if gap_total else 0.0,
            "explanation": _gap_explanations[key],
        }
        for key, count in _gap_counts.items()
    }

    # ── Score de santé du tracking (par landing page) ──
    # Basé directement sur success/eligible (donc déjà l'inverse de
    # gap_total/eligible) — pas de pondération inventée pour retries/échecs,
    # puisque success_rate encode déjà leur effet final (un retry qui finit
    # par réussir ne pénalise pas le score; un échec définitif si).
    if eligible_count > 0:
        health_score = round(capi["success"] / eligible_count * 100, 1)
        if health_score >= 98:
            health_label, health_color = "Excellent", "green"
        elif health_score >= 95:
            health_label, health_color = "Bon", "yellow"
        elif health_score >= 90:
            health_label, health_color = "À surveiller", "orange"
        else:
            health_label, health_color = "Action requise", "red"
    else:
        health_score, health_label, health_color = None, "Aucune donnée", "gray"

    # ── 5. Problematic orders — capped list, EXISTS not JOIN (no fan-out) ──
    problem_rows = (
        db.query(Order.order_number, Order.status, MetaCapiLog.status, MetaCapiLog.error_message, MetaCapiLog.error_category, Order.id)
        .outerjoin(MetaCapiLog, and_(MetaCapiLog.order_id == Order.id, MetaCapiLog.event_name == "Purchase"))
        .filter(
            Order.store_id == lp.store_id,
            has_product,
            Order.is_deleted == False,
            Order.created_at >= since,
            Order.status.in_(_CAPI_ELIGIBLE_STATUSES),
            func.coalesce(Order.source, "") != "MANUAL",
            func.coalesce(MetaCapiLog.status, "none") != "success",
        )
        .order_by(Order.created_at.desc())
        .limit(30)
        .all()
    )
    problematic_orders = [
        {
            "order_number": r[0], "erp_status": r[1],
            "capi_status": r[2] or "jamais_tente",
            "cause": r[3] or (r[2] or "Aucune ligne CAPI — jamais tenté"),
            "error_category": r[4],
            "order_id": r[5],
        }
        for r in problem_rows
    ]

    # ── 6. Daily history for the chart (7/30/90 chosen by range_days) ──
    day = func.date(Order.created_at)
    history_rows = (
        db.query(
            day.label("day"),
            func.count(distinct(Order.id)).label("erp_orders"),
            func.count(distinct(case((MetaCapiLog.status == "success", Order.id)))).label("capi_success"),
        )
        .outerjoin(MetaCapiLog, and_(MetaCapiLog.order_id == Order.id, MetaCapiLog.event_name == "Purchase"))
        .filter(
            Order.store_id == lp.store_id,
            has_product,
            Order.is_deleted == False,
            Order.created_at >= since,
            Order.status.notin_(("MERGED", "ABANDONED")),
            func.coalesce(Order.source, "") != "MANUAL",
        )
        .group_by(day)
        .order_by(day)
        .all()
    )
    history = [{"date": str(r.day), "erp_orders": int(r.erp_orders or 0), "capi_success": int(r.capi_success or 0)} for r in history_rows]

    return {
        "success": True,
        "data": {
            "available": True,
            "range_days": range_days,
            "erp": erp,
            "eligible_for_capi": eligible_count,
            "capi": capi,
            "meta_ads_purchases": meta_ads_purchases,
            "gap_total": gap_total,
            "gap_total_percent": round(gap_total / eligible_count * 100, 1) if eligible_count else None,
            "gap_breakdown": gap_breakdown,
            "health_score": health_score,
            "health_label": health_label,
            "health_color": health_color,
            "problematic_orders": problematic_orders,
            "history": history,
            "unavailable_metrics": {
                "pixel_purchases": "Non disponible — le Pixel s'exécute uniquement dans le navigateur du client et n'atteint jamais ce backend.",
                "meta_ads_deduplicated": "Non disponible — la logique de déduplication est interne à Meta (Events Manager), aucune API ne l'expose.",
                "meta_ads_rejected": "Non disponible — Meta ne fournit pas le détail des événements rejetés via l'API Graph standard.",
            },
        },
    }


# ─── GET /{lp_id}/tracking-quality/export — diagnostic export (JSON/CSV) ────
# One row per eligible order, every field that exists in OUR database for
# it — no fabricated Pixel/Meta-side columns. Same query shape/limit as the
# problematic-orders table above but without the "!= success" filter (this
# is a full diagnostic dump, not just the problems).

@router.get("/{lp_id}/tracking-quality/export")
def export_landing_page_tracking_diagnostic(
    lp_id: str,
    range_days: int = Query(30, ge=1, le=90),
    format: str = Query("json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    from datetime import timedelta
    from app.models.order import Order, OrderItem
    from app.models.marketing import MetaCapiLog

    db.info["skip_tenant_isolation"] = True
    lp = db.query(LandingPage).filter(LandingPage.id == lp_id).first()
    if not lp:
        raise HTTPException(404, "Landing page introuvable")
    if not lp.product_id:
        raise HTTPException(400, "Aucun produit lié à cette page")

    since = datetime.utcnow() - timedelta(days=range_days)
    rows = (
        db.query(
            Order.order_number, Order.id, Order.status, Order.source, Order.created_at,
            MetaCapiLog.event_id, MetaCapiLog.status, MetaCapiLog.error_message,
            MetaCapiLog.error_category, MetaCapiLog.last_http_status, MetaCapiLog.retry_count,
            MetaCapiLog.created_at, MetaCapiLog.processing_started_at, MetaCapiLog.completed_at,
            MetaCapiLog.latency_ms,
        )
        .join(OrderItem, OrderItem.order_id == Order.id)
        .outerjoin(MetaCapiLog, and_(MetaCapiLog.order_id == Order.id, MetaCapiLog.event_name == "Purchase"))
        .filter(
            Order.store_id == lp.store_id,
            OrderItem.product_id == lp.product_id,
            Order.is_deleted == False,
            Order.created_at >= since,
        )
        .order_by(Order.created_at.desc())
        .limit(2000)
        .all()
    )

    records = [
        {
            "order_number": r[0], "order_id": r[1], "erp_status": r[2], "source": r[3],
            "order_created_at": r[4].isoformat() if r[4] else None,
            "event_id": r[5],
            # Pixel/Relay are frontend-only — never recorded in this table, so
            # never claimed here either. capi_* is the only stage this
            # backend can actually attest to.
            "pixel_fired": "non_disponible",
            "relay_received": "non_disponible",
            "capi_status": r[6] or "jamais_tente",
            "capi_error_message": r[7],
            "capi_error_category": r[8],
            "capi_http_status": r[9],
            "capi_retry_count": r[10],
            "capi_log_created_at": r[11].isoformat() if r[11] else None,
            "capi_processing_started_at": r[12].isoformat() if r[12] else None,
            "capi_completed_at": r[13].isoformat() if r[13] else None,
            "capi_latency_ms": r[14],
        }
        for r in rows
    ]

    if format == "csv":
        import csv
        import io
        from fastapi.responses import StreamingResponse
        buf = io.StringIO()
        if records:
            writer = csv.DictWriter(buf, fieldnames=list(records[0].keys()))
            writer.writeheader()
            writer.writerows(records)
        buf.seek(0)
        return StreamingResponse(
            iter([buf.getvalue()]), media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=diagnostic-{lp.slug}-{range_days}j.csv"},
        )

    return {"success": True, "data": {"range_days": range_days, "count": len(records), "orders": records}}


# ─── Create ───────────────────────────────────────────────────────────────────

@router.post("/", status_code=201)
def create_landing_page(
    payload: dict,
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    store_id   = payload.get("store_id")
    product_id = payload.get("product_id")
    mode       = payload.get("mode", "product")

    if not store_id:
        raise HTTPException(400, "store_id requis")

    # Auto-fill from product if linked
    product: Optional[Product] = None
    if product_id:
        product = db.query(Product).filter(Product.id == product_id, Product.store_id == store_id).first()

    # Build slug
    raw_slug = payload.get("slug") or payload.get("headline") or (product.name if product else "landing")
    base_slug = _slugify(raw_slug)
    slug = base_slug
    i = 2
    while db.query(LandingPage).filter(LandingPage.store_id == store_id, LandingPage.slug == slug).first():
        slug = f"{base_slug}-{i}"
        i += 1

    lp = LandingPage(
        id=str(uuid.uuid4()),
        store_id=store_id,
        product_id=product_id,
        slug=slug,
        mode=mode,
        headline=payload.get("headline") or (product.name if product else ""),
        subtitle=payload.get("subtitle") or (product.description if product else ""),
        badge_text=payload.get("badge_text", "Offre limitée"),
        cta_label=payload.get("cta_label", "Commander maintenant"),
        cta2_label=payload.get("cta2_label", "Voir le produit"),
        image_url=payload.get("image_url") or (product.main_image if product else None),
        video_url=payload.get("video_url"),
        product_name=payload.get("product_name") or (product.name if product else None),
        product_desc=payload.get("product_desc") or (product.description if product else None),
        price=payload.get("price") or (product.price if product else None),
        compare_price=payload.get("compare_price") or (product.compare_price if product else None),
        primary_color=payload.get("primary_color", "#e84393"),
        template=payload.get("template", "premium"),
        benefits=payload.get("benefits", [
            {"icon": "Truck",       "title": "Livraison express", "desc": "48h partout en Algérie"},
            {"icon": "ShieldCheck", "title": "Paiement à livraison", "desc": "Vous payez à réception"},
            {"icon": "RotateCcw",   "title": "Retour 14 jours", "desc": "Échange sans tracas"},
        ]),
        testimonials=payload.get("testimonials", [
            {"name": "Yasmine B.", "location": "Alger",       "text": "Reçu en 2 jours, emballage soigné, produit conforme.", "stars": 5},
            {"name": "Karim M.",   "location": "Oran",        "text": "Exactement comme la photo. Je recommande vivement !", "stars": 5},
            {"name": "Samira L.",  "location": "Constantine", "text": "Service client rapide, très satisfaite de mon achat.", "stars": 5},
        ]),
        steps=payload.get("steps", [
            {"step": "01", "title": "Choisissez", "desc": "Sélectionnez votre produit et quantité."},
            {"step": "02", "title": "Confirmez",  "desc": "Laissez votre nom et numéro de téléphone."},
            {"step": "03", "title": "Recevez",    "desc": "Livraison à domicile sous 48h, payez à la porte."},
        ]),
        stats=payload.get("stats", [
            {"value": 12000, "suffix": "+", "label": "Clients satisfaits"},
            {"value": 98,    "suffix": "%", "label": "Avis positifs"},
            {"value": 48,    "suffix": "h", "label": "Délai livraison"},
        ]),
        faq=payload.get("faq", []),
        gallery=payload.get("gallery", []),
        offers=payload.get("offers", []),
        phone=payload.get("phone"),
        banner_image_url=payload.get("banner_image_url"),
        is_active=payload.get("is_active", True),
    )
    db.add(lp)
    db.commit()
    db.refresh(lp)
    return {"success": True, "data": _serialize(lp, product)}


# ─── Update ───────────────────────────────────────────────────────────────────

UPDATABLE = {
    "headline", "subtitle", "badge_text", "cta_label", "cta2_label",
    "image_url", "video_url", "cta_headline", "cta_subtitle", "product_name", "product_desc",
    "price", "compare_price", "primary_color", "template",
    "benefits", "testimonials", "steps", "stats", "faq", "gallery", "offers",
    "phone", "is_active", "slug", "product_id", "banner_image_url",
}

@router.patch("/{lp_id}")
def update_landing_page(
    lp_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    lp = db.query(LandingPage).filter(LandingPage.id == lp_id).first()
    if not lp:
        raise HTTPException(404, "Landing page introuvable")

    # Record audit log before
    before_dict = {c.name: getattr(lp, c.name) for c in lp.__table__.columns}

    for field, value in payload.items():
        if field in UPDATABLE:
            setattr(lp, field, value)

    db.flush()
    after_dict = {c.name: getattr(lp, c.name) for c in lp.__table__.columns}

    from app.services.audit_service import audit_service
    audit_service.record_change(
        db=db,
        actor_id=_auth.id,
        entity_name="LandingPage",
        entity_id=lp.id,
        action="UPDATE",
        before=before_dict,
        after=after_dict
    )

    db.commit()
    db.refresh(lp)
    return {"success": True, "data": _serialize(lp)}


# ─── Delete ───────────────────────────────────────────────────────────────────

@router.delete("/{lp_id}")
def delete_landing_page(
    lp_id: str,
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    lp = db.query(LandingPage).filter(LandingPage.id == lp_id).first()
    if not lp:
        raise HTTPException(404, "Landing page introuvable")
    db.delete(lp)
    db.commit()
    return {"success": True}


# ─── Toggle active ────────────────────────────────────────────────────────────

@router.patch("/{lp_id}/toggle")
def toggle_landing_page(
    lp_id: str,
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    lp = db.query(LandingPage).filter(LandingPage.id == lp_id).first()
    if not lp:
        raise HTTPException(404, "Landing page introuvable")

    before_dict = {c.name: getattr(lp, c.name) for c in lp.__table__.columns}

    lp.is_active = not lp.is_active  # type: ignore[assignment]
    db.flush()

    after_dict = {c.name: getattr(lp, c.name) for c in lp.__table__.columns}

    from app.services.audit_service import audit_service
    audit_service.record_change(
        db=db,
        actor_id=_auth.id,
        entity_name="LandingPage",
        entity_id=lp.id,
        action="STATUS_CHANGE",
        before=before_dict,
        after=after_dict
    )

    db.commit()
    return {"success": True, "is_active": lp.is_active}
