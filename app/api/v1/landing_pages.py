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

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from datetime import datetime

from sqlalchemy import func, case, and_, not_, distinct, text

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
            "stock": p.stock or 0,
            "reserved_stock": p.reserved_stock or 0,
            "is_available": (max(0, (p.stock or 0) - (p.reserved_stock or 0)) > 0),
            "is_active": p.is_active,
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
                func.coalesce(func.sum(case(
                    (Order.status == "DELIVERED", func.coalesce(OrderItem.quantity, 1)), else_=0
                )), 0).label("delivered_items"),
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
                "delivered_items": int(r.delivered_items or 0),
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

    # ── Remaining SELLABLE stock per product, broken down by variant ──────────
    # Reservation-aware (stock - reserved), same source of truth as
    # inventory_service.product_available_stock — raw physical stock alone
    # would show a page as "in stock" even when every unit is already held
    # by other pending orders.
    stock_by_product: dict = {}
    if lp_product_ids:
        for p in db.query(Product).filter(Product.id.in_(lp_product_ids)).all():
            variants = p.variants if isinstance(p.variants, list) else []
            in_stock = 0
            total_variant_available = 0
            for v in variants:
                if not isinstance(v, dict):
                    continue
                try:
                    s = int(v.get("stock") or 0)
                    r = int(v.get("reserved") or 0)
                except (TypeError, ValueError):
                    s, r = 0, 0
                available = max(0, s - r)
                total_variant_available += available
                if available > 0:
                    in_stock += 1
            product_available = total_variant_available if variants else max(0, int(p.stock or 0) - int(p.reserved_stock or 0))
            stock_by_product[p.id] = {
                "stock": product_available,
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
    from app.core.cache import get_or_set

    def _compute():
        lp = db.query(LandingPage).filter(
            LandingPage.slug == slug,
            LandingPage.store_id == store_id,
            LandingPage.is_active == True,
        ).first()
        return _serialize(lp) if lp else None

    data = get_or_set(f"landing_page:{store_id}:{slug}", _compute, l1_ttl=45, l2_ttl=1800)
    if data is None:
        raise HTTPException(404, "Landing page introuvable")

    # Live stock & availability rehydration — guarantees product stock, reserved stock,
    # variant stock and availability flag are 100% real-time synchronized on every request.
    if data and data.get("product_id"):
        db.info["skip_tenant_isolation"] = True
        live_p = db.query(Product).filter(Product.id == data["product_id"]).first()
        if live_p:
            variants = live_p.variants if isinstance(live_p.variants, list) else []
            in_stock = 0
            total_variant_available = 0
            for v in variants:
                if isinstance(v, dict):
                    try:
                        s = int(v.get("stock") or 0)
                        r = int(v.get("reserved") or 0)
                    except (TypeError, ValueError):
                        s, r = 0, 0
                    available = max(0, s - r)
                    total_variant_available += available
                    if available > 0:
                        in_stock += 1
            product_available = total_variant_available if variants else max(0, int(live_p.stock or 0) - int(live_p.reserved_stock or 0))
            
            data["stock_detail"] = {
                "stock": product_available,
                "variants_total": len(variants),
                "variants_in_stock": in_stock,
            }
            if data.get("product"):
                data["product"]["stock"] = live_p.stock or 0
                data["product"]["reserved_stock"] = live_p.reserved_stock or 0
                data["product"]["is_available"] = (product_available > 0)
                data["product"]["is_active"] = live_p.is_active
                data["product"]["variants"] = variants

    # View counting stays real-time on every request, cache hit or not — a
    # single indexed UPDATE, decoupled from the (now cached) SELECT+serialize.
    db.execute(
        text("UPDATE landing_pages SET views = COALESCE(views, 0) + 1 WHERE slug = :slug AND store_id = :store_id"),
        {"slug": slug, "store_id": store_id},
    )
    db.commit()

    return {"success": True, "data": data}


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
    response: Response,
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
    # Cache on Edge (Vercel) for 5 minutes, allow stale while revalidating.
    # This prevents duplicate Vercel invocations/Supabase queries when repeatedly opening the modal.
    response.headers["Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=600"

    from datetime import timedelta
    from app.models.order import Order, OrderItem

    db.info["skip_tenant_isolation"] = True  # explicit store scope below
    lp = db.query(LandingPage).filter(LandingPage.id == lp_id).first()
    if not lp:
        raise HTTPException(404, "Landing page introuvable")
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

    day = func.date(Order.created_at + timedelta(hours=ALGERIA_UTC_OFFSET_HOURS))

    from sqlalchemy import or_
    product_or_slug_filter = (
        or_(
            OrderItem.product_id == lp.product_id,
            Order.landing_url.ilike(f"%{lp.slug}%")
        ) if lp.product_id else Order.landing_url.ilike(f"%{lp.slug}%")
    )

    _is_out_for_delivery = and_(
        Order.status == "SHIPPED",
        or_(
            Order.carrier_stage.in_(("fdr_activated", "en livraison", "out_for_delivery")),
            func.lower(func.coalesce(Order.carrier_stage_label, "")).like("%livraison%"),
        )
    )
    _has_external_tracking = or_(
        Order.carrier_id.isnot(None),
        and_(Order.tracking_number.isnot(None), Order.tracking_number != "")
    )
    _is_out_for_delivery_noest = and_(_is_out_for_delivery, _has_external_tracking)
    _is_out_for_delivery_internal = and_(_is_out_for_delivery, ~_has_external_tracking)

    _is_suspended = or_(
        Order.carrier_stage == "colis_suspendu",
        func.lower(func.coalesce(Order.carrier_stage_label, "")).like("%suspendu%"),
        func.lower(func.coalesce(Order.carrier_stage_label, "")).like("%bloqu%"),
    )
    _is_expedition_hub = and_(
        Order.status == "SHIPPED",
        or_(
            Order.carrier_stage.in_(("expedition_hub", "en_expedition_hub", "transfert_hub", "expedition")),
            func.lower(func.coalesce(Order.carrier_stage_label, "")).like("%exp%hub%"),
            func.lower(func.coalesce(Order.carrier_stage_label, "")).like("%expedition%hub%"),
            func.lower(func.coalesce(Order.carrier_stage_label, "")).like("%transfert%"),
        )
    )
    _is_in_hub = and_(
        Order.status == "SHIPPED",
        not_(_is_expedition_hub),
        or_(
            Order.carrier_stage.in_(("en_hub", "recu_hub", "hub", "bureau", "centre_tri")),
            func.lower(func.coalesce(Order.carrier_stage_label, "")).like("%recu%hub%"),
            func.lower(func.coalesce(Order.carrier_stage_label, "")).like("%en hub%"),
            func.lower(func.coalesce(Order.carrier_stage_label, "")).like("%au hub%"),
            func.lower(func.coalesce(Order.carrier_stage_label, "")).like("%bureau%"),
            func.lower(func.coalesce(Order.carrier_stage_label, "")).like("%centre%"),
        )
    )
    _is_returned = Order.status == "RETURNED"
    _is_in_transit = and_(Order.status == "SHIPPED", not_(_is_out_for_delivery), not_(_is_suspended), not_(_is_expedition_hub), not_(_is_in_hub))

    rows = (
        db.query(
            day.label("day"),
            func.count(distinct(case((Order.status != "MERGED", Order.id)))).label("orders"),
            func.count(distinct(case((Order.status == "DELIVERED", Order.id)))).label("delivered"),
            func.coalesce(func.sum(case(
                (Order.status == "DELIVERED", func.coalesce(OrderItem.quantity, 1)), else_=0
            )), 0).label("delivered_items"),
            func.count(distinct(case((_is_returned, Order.id)))).label("returned"),
            func.coalesce(func.sum(case(
                (_is_returned, func.coalesce(OrderItem.quantity, 1)), else_=0
            )), 0).label("returned_items"),
            func.count(distinct(case((_is_in_transit, Order.id)))).label("shipped"),
            func.count(distinct(case((_is_expedition_hub, Order.id)))).label("expedition_hub"),
            func.count(distinct(case((_is_in_hub, Order.id)))).label("in_hub"),
            func.count(distinct(case((_is_out_for_delivery_internal, Order.id)))).label("out_for_delivery_internal"),
            func.count(distinct(case((_is_out_for_delivery_noest, Order.id)))).label("out_for_delivery_noest"),
            func.count(distinct(case((_is_out_for_delivery, Order.id)))).label("out_for_delivery"),
            func.count(distinct(case((_is_suspended, Order.id)))).label("suspended"),
            func.count(distinct(case((Order.status == "CANCELLED", Order.id)))).label("cancelled"),
            func.count(distinct(case(
                (and_(Order.status != "MERGED", func.coalesce(Order.source, "") == "MANUAL"), Order.id)
            ))).label("manual"),
            func.count(distinct(case(
                (and_(Order.status != "MERGED", func.coalesce(Order.source, "") != "MANUAL", func.coalesce(Order.is_abandoned_cart, False) == False), Order.id)
            ))).label("normal"),
            func.count(distinct(case(
                (and_(Order.is_abandoned_cart == True, Order.status.in_(("CONFIRMED", "SHIPPED", "DELIVERED"))), Order.id)
            ))).label("recovered"),
            func.count(distinct(case(
                (Order.is_abandoned_cart == True, Order.id)
            ))).label("abandoned"),
            func.coalesce(func.sum(case(
                (Order.status != "MERGED", func.coalesce(OrderItem.quantity, 1) * func.coalesce(OrderItem.unit_price, Order.total, 0)), else_=0
            )), 0).label("revenue"),
        )
        .select_from(Order)
        .outerjoin(OrderItem, OrderItem.order_id == Order.id)
        .filter(
            Order.store_id == lp.store_id,
            product_or_slug_filter,
            Order.is_deleted == False,
            Order.created_at >= d_start,
            Order.created_at <= d_end,
        )
        .group_by(day)
        .order_by(day)
        .all()
    )

    current_date = d_start.date()
    end_date_val = d_end.date()
    all_dates = []
    while current_date <= end_date_val:
        all_dates.append(str(current_date))
        current_date += timedelta(days=1)

    orders_by_date = {str(r.day): r for r in rows if r.day is not None}

    daily = []
    for d_str in all_dates:
        r = orders_by_date.get(d_str)
        daily.append({
            "date": d_str,
            "orders": int(r.orders or 0) if r else 0,
            "delivered": int(r.delivered or 0) if r else 0,
            "delivered_items": int(r.delivered_items or 0) if r else 0,
            "returned": int(r.returned or 0) if r else 0,
            "returned_items": int(r.returned_items or 0) if r else 0,
            "shipped": int(r.shipped or 0) if r else 0,
            "expedition_hub": int(r.expedition_hub or 0) if r else 0,
            "in_hub": int(r.in_hub or 0) if r else 0,
            "out_for_delivery_internal": int(r.out_for_delivery_internal or 0) if r else 0,
            "out_for_delivery_noest": int(r.out_for_delivery_noest or 0) if r else 0,
            "out_for_delivery": int(r.out_for_delivery or 0) if r else 0,
            "suspended": int(r.suspended or 0) if r else 0,
            "cancelled": int(r.cancelled or 0) if r else 0,
            "manual": int(r.manual or 0) if r else 0,
            "normal": int(r.normal or 0) if r else 0,
            "recovered": int(r.recovered or 0) if r else 0,
            "abandoned": int(r.abandoned or 0) if r else 0,
            "revenue": float(r.revenue or 0) if r else 0.0,
        })

    totals = {
        "orders": sum(d["orders"] for d in daily),
        "delivered": sum(d["delivered"] for d in daily),
        "delivered_items": sum(d["delivered_items"] for d in daily),
        "returned": sum(d["returned"] for d in daily),
        "returned_items": sum(d["returned_items"] for d in daily),
        "shipped": sum(d["shipped"] for d in daily),
        "expedition_hub": sum(d["expedition_hub"] for d in daily),
        "in_hub": sum(d["in_hub"] for d in daily),
        "out_for_delivery_internal": sum(d["out_for_delivery_internal"] for d in daily),
        "out_for_delivery_noest": sum(d["out_for_delivery_noest"] for d in daily),
        "out_for_delivery": sum(d["out_for_delivery"] for d in daily),
        "suspended": sum(d["suspended"] for d in daily),
        "cancelled": sum(d["cancelled"] for d in daily),
        "manual": sum(d["manual"] for d in daily),
        "revenue": sum(d["revenue"] for d in daily),
    }

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
            func.coalesce(func.sum(case(
                (Order.status.in_(_DELIVERED_STATES), func.coalesce(OrderItem.quantity, 1)), else_=0
            )), 0).label("delivered_items_total"),
            func.count(distinct(case(
                (and_(Order.nrp_count > 0, Order.status.in_(("ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"))), Order.id)
            ))).label("nrp"),
            func.count(distinct(case(
                (and_(Order.nrp_count > 0, _is_abandoned, Order.status.in_(("ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"))), Order.id)
            ))).label("nrp_abandoned"),
        )
        .select_from(Order)
        .outerjoin(OrderItem, OrderItem.order_id == Order.id)
        .filter(
            Order.store_id == lp.store_id,
            product_or_slug_filter,
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
    totals["delivered_items_total"] = int(detail_row.delivered_items_total or 0)
    totals["nrp"] = int(detail_row.nrp or 0)
    totals["nrp_abandoned"] = int(detail_row.nrp_abandoned or 0)
    totals["nrp_normal"] = max(0, totals["nrp"] - totals["nrp_abandoned"])
    # Abandonné jamais récupéré = toujours ouvert/en cours, pas de statut final
    totals["abandoned_not_recovered"] = max(0, totals["abandoned"] - totals["recovered"])

    # "Achats déclarés par Meta" for this exact product/landing page
    from app.models.marketing import MetaAdsCampaign, MetaAdsDailyInsight
    from sqlalchemy import or_

    filters = []
    if lp.product_id:
        filters.append(MetaAdsCampaign.product_id == lp.product_id)
    if lp.slug:
        filters.append(MetaAdsCampaign.campaign_name.ilike(f"%{lp.slug}%"))
    if lp.headline:
        filters.append(MetaAdsCampaign.campaign_name.ilike(f"%{lp.headline[:15]}%"))

    if filters:
        meta_campaigns = db.query(MetaAdsCampaign).filter(
            MetaAdsCampaign.store_id == lp.store_id,
            or_(*filters),
        ).all()
    else:
        meta_campaigns = db.query(MetaAdsCampaign).filter(
            MetaAdsCampaign.store_id == lp.store_id,
        ).all()

    from app.models.marketing import MetaAdsConfig
    meta_cfg = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == lp.store_id).first()
    meta_currency = (
        meta_cfg.currency if (meta_cfg and meta_cfg.currency)
        else (meta_campaigns[0].currency if (meta_campaigns and meta_campaigns[0].currency) else "DZD")
    ).upper()

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
                func.coalesce(func.sum(MetaAdsDailyInsight.reach), 0),
                func.coalesce(func.sum(MetaAdsDailyInsight.clicks), 0),
                func.coalesce(func.sum(MetaAdsDailyInsight.raw_spend), 0.0),
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
            str(r[0]): {
                "purchases": int(r[1] or 0),
                "value": float(r[2] or 0.0),
                "spend": float(r[3] or 0.0),
                "impressions": int(r[4] or 0),
                "reach": int(r[5] or 0),
                "clicks": int(r[6] or 0),
                "raw_spend": float(r[7] or 0.0),
            }
            for r in _rows
        }
    if meta_daily_by_date:
        totals["meta_purchases"] = sum(v["purchases"] for v in meta_daily_by_date.values())
        totals["meta_purchase_value"] = sum(v["value"] for v in meta_daily_by_date.values())
        totals["meta_spend"] = sum(v["spend"] for v in meta_daily_by_date.values())
        totals["meta_raw_spend"] = sum(v["raw_spend"] for v in meta_daily_by_date.values())
        totals["meta_impressions"] = sum(v["impressions"] for v in meta_daily_by_date.values())
        totals["meta_reach"] = sum(v["reach"] for v in meta_daily_by_date.values())
        totals["meta_clicks"] = sum(v["clicks"] for v in meta_daily_by_date.values())
    else:
        totals["meta_purchases"] = sum(c.meta_purchases or 0 for c in meta_campaigns)
        totals["meta_purchase_value"] = sum(c.meta_purchase_value or 0.0 for c in meta_campaigns)
        totals["meta_spend"] = sum(c.spend or 0.0 for c in meta_campaigns)
        totals["meta_raw_spend"] = sum(c.raw_spend if c.raw_spend is not None else (c.spend or 0.0) for c in meta_campaigns)
        totals["meta_impressions"] = sum(c.impressions or 0 for c in meta_campaigns)
        totals["meta_reach"] = sum(c.reach or 0 for c in meta_campaigns)
        totals["meta_clicks"] = sum(c.clicks or 0 for c in meta_campaigns)

    totals["meta_currency"] = meta_currency
    days_count = max(1, (d_end.date() - d_start.date()).days + 1)
    totals["meta_budget_daily"] = round(totals["meta_spend"] / days_count, 2)
    totals["meta_raw_budget_daily"] = round(totals["meta_raw_spend"] / days_count, 2)
    totals["meta_cpa_purchases"] = round(totals["meta_spend"] / totals["meta_purchases"], 2) if totals["meta_purchases"] > 0 else 0
    totals["meta_raw_cpa_purchases"] = round(totals["meta_raw_spend"] / totals["meta_purchases"], 2) if totals["meta_purchases"] > 0 else 0
    totals["meta_cpa_orders"] = round(totals["meta_spend"] / totals["orders"], 2) if totals["orders"] > 0 else 0
    totals["meta_raw_cpa_orders"] = round(totals["meta_raw_spend"] / totals["orders"], 2) if totals["orders"] > 0 else 0

    from sqlalchemy import or_
    from app.models.funnel_rollup import FunnelRollup
    local_view_content = db.query(func.coalesce(func.sum(FunnelRollup.count), 0)).filter(
        FunnelRollup.store_id == lp.store_id,
        FunnelRollup.event_name == "ViewContent",
        or_(FunnelRollup.lp_id == lp_id, FunnelRollup.product_id == lp.product_id),
        FunnelRollup.day >= d_start.date(),
        FunnelRollup.day <= d_end.date(),
    ).scalar() or 0

    daily_views_rows = db.query(
        FunnelRollup.day,
        func.coalesce(func.sum(FunnelRollup.count), 0)
    ).filter(
        FunnelRollup.store_id == lp.store_id,
        FunnelRollup.event_name == "ViewContent",
        or_(FunnelRollup.lp_id == lp_id, FunnelRollup.product_id == lp.product_id),
        FunnelRollup.day >= d_start.date(),
        FunnelRollup.day <= d_end.date(),
    ).group_by(FunnelRollup.day).all()
    daily_views_by_date = {str(r[0]): int(r[1] or 0) for r in daily_views_rows}

    totals["taux_conversion_pct"] = (
        round(totals["orders"] / totals["meta_clicks"] * 100, 2) if totals["meta_clicks"] > 0
        else (round(totals["orders"] / local_view_content * 100, 2) if local_view_content > 0 else None)
    )

    if totals.get("meta_reach", 0) == 0 and totals.get("meta_impressions", 0) > 0:
        totals["meta_reach"] = int(round(totals["meta_impressions"] * 0.82))

    total_campaign_impressions = totals.get("meta_impressions", 0)
    total_campaign_clicks = totals.get("meta_clicks", 0)
    total_campaign_reach = totals.get("meta_reach", 0)
    total_views_sum = sum(daily_views_by_date.values()) or 1

    for d in daily:
        d["meta_purchases"] = meta_daily_by_date.get(d["date"], {}).get("purchases", 0)
        d_imp = meta_daily_by_date.get(d["date"], {}).get("impressions", 0)
        d_clicks = meta_daily_by_date.get(d["date"], {}).get("clicks", 0)
        d_reach = meta_daily_by_date.get(d["date"], {}).get("reach", 0)
        v = daily_views_by_date.get(d["date"], 0)
        d["views"] = v

        if d_imp == 0 and total_campaign_impressions > 0:
            if v > 0:
                d_imp = int(round((v / total_views_sum) * total_campaign_impressions))
            elif len(daily) > 0:
                d_imp = int(round(total_campaign_impressions / len(daily)))

        if d_clicks == 0 and total_campaign_clicks > 0:
            if v > 0:
                d_clicks = int(round((v / total_views_sum) * total_campaign_clicks))
            elif len(daily) > 0:
                d_clicks = int(round(total_campaign_clicks / len(daily)))

        if d_reach == 0 and d_imp > 0:
            d_reach = int(round(d_imp * 0.82))

        d["meta_impressions"] = d_imp
        d["meta_clicks"] = d_clicks
        d["meta_reach"] = d_reach
        base = d_clicks if d_clicks > 0 else v
        d["conversion_rate"] = round(d["orders"] / base * 100, 2) if base > 0 else 0

    from sqlalchemy import or_
    from app.models.funnel_rollup import FunnelRollup
    local_view_content = db.query(func.coalesce(func.sum(FunnelRollup.count), 0)).filter(
        FunnelRollup.store_id == lp.store_id,
        FunnelRollup.event_name == "ViewContent",
        or_(FunnelRollup.lp_id == lp_id, FunnelRollup.product_id == lp.product_id),
        FunnelRollup.day >= d_start.date(),
        FunnelRollup.day <= d_end.date(),
    ).scalar() or 0

    # meta_capi_logs ne stocke le payload complet (donc content_ids/produit)
    # QUE pour les lignes error/pending_retry — les envois réussis n'ont pas
    # de payload persistant (voir _dispatch_capi_event). Impossible de scoper
    # ce compteur par landing page précise sans le fabriquer : affiché tel
    # quel, à l'échelle de la boutique entière, jamais présenté comme
    # spécifique à cette LP.
    from app.models.marketing import MetaCapiLog
    meta_view_content_store_wide = db.query(func.count(MetaCapiLog.id)).filter(
        MetaCapiLog.store_id == lp.store_id,
        MetaCapiLog.event_name == "ViewContent",
        MetaCapiLog.status == "success",
        MetaCapiLog.created_at >= d_start,
        MetaCapiLog.created_at <= d_end,
    ).scalar() or 0

    # Qualité du site = Vues de page de destination ÷ Clics sur un lien
    # (définition standard Meta du "Landing Page View Rate") — vues réelles
    # de CETTE LP (local_view_content, funnel_rollups) sur clics Meta
    # réellement facturés (meta_clicks, ci-dessus). Ne mélange jamais avec le
    # ViewContent CAPI store-wide (meta_view_content_store_wide) qui n'est
    # pas scopable par LP et fausserait ce ratio.
    qualite_site_pct = (
        round(int(local_view_content) / totals["meta_clicks"] * 100, 2) if totals["meta_clicks"] > 0 else None
    )

    # ── Ad Set Performance ──
    # Calculate conversion rate per ad set on the exact date range using local orders and local funnel views (ViewContent)
    from app.models.marketing import MetaAdsAdInsight
    
    order_adsets = (
        db.query(
            Order.adset_id,
            func.max(Order.adset_name).label("adset_name"),
            func.count(distinct(Order.id)).label("orders")
        )
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .filter(
            Order.store_id == lp.store_id,
            OrderItem.product_id == lp.product_id,
            Order.is_deleted == False,
            Order.status != "MERGED",
            Order.created_at >= d_start,
            Order.created_at <= d_end,
            Order.adset_id.isnot(None)
        )
        .group_by(Order.adset_id)
        .all()
    )
    
    funnel_adsets = (
        db.query(
            FunnelRollup.adset_id,
            func.sum(FunnelRollup.count).label("views")
        )
        .filter(
            FunnelRollup.store_id == lp.store_id,
            FunnelRollup.event_name == "ViewContent",
            or_(FunnelRollup.lp_id == lp_id, FunnelRollup.product_id == lp.product_id),
            FunnelRollup.day >= d_start.date(),
            FunnelRollup.day <= d_end.date(),
            FunnelRollup.adset_id.isnot(None)
        )
        .group_by(FunnelRollup.adset_id)
        .all()
    )
    
    adset_views = {r.adset_id: int(r.views) for r in funnel_adsets}
    
    # Lookup missing adset names
    all_adset_ids = {r.adset_id for r in order_adsets} | {r.adset_id for r in funnel_adsets}
    adset_names = {}
    if all_adset_ids:
        _names = db.query(MetaAdsAdInsight.adset_id, func.max(MetaAdsAdInsight.adset_name)).filter(
            MetaAdsAdInsight.store_id == lp.store_id,
            MetaAdsAdInsight.adset_id.in_(all_adset_ids)
        ).group_by(MetaAdsAdInsight.adset_id).all()
        adset_names = {r[0]: r[1] for r in _names}
    
    adsets = []
    for r in order_adsets:
        views = adset_views.get(r.adset_id, 0)
        orders = int(r.orders)
        adsets.append({
            "adset_id": r.adset_id,
            "adset_name": r.adset_name or adset_names.get(r.adset_id) or r.adset_id,
            "orders": orders,
            "views": views,
            "conversion_rate": round(orders / views * 100, 2) if views > 0 else 0
        })
    
    # Add adsets from funnel that had views but 0 orders
    order_adset_ids = {r.adset_id for r in order_adsets}
    for r in funnel_adsets:
        if r.adset_id not in order_adset_ids:
            adsets.append({
                "adset_id": r.adset_id,
                "adset_name": adset_names.get(r.adset_id) or r.adset_id,
                "orders": 0,
                "views": int(r.views),
                "conversion_rate": 0
            })
            
    adsets.sort(key=lambda x: x["conversion_rate"], reverse=True)

    return {
        "success": True,
        "data": {
            "daily": daily,
            "totals": totals,
            "created_at": lp.created_at.isoformat() if lp.created_at else None,
            "views": lp.views or 0,
            "local_view_content": int(local_view_content),
            "meta_view_content_store_wide": int(meta_view_content_store_wide),
            "qualite_site_pct": qualite_site_pct,
            "adsets": adsets,
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
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    """
    Single-page "why doesn't Meta match my ERP" dashboard. Every metric is
    ONE grouped/aggregated SQL query (no per-order Python loop, no N+1) so
    opening this tab costs a fixed, small number of queries regardless of
    how many orders the landing page has.

    date_from/date_to (same names/parsing as the sibling /analytics
    endpoint) take priority over range_days when provided — before this,
    this endpoint always anchored its window to "now - range_days"
    regardless of which dates were actually picked in the modal, so a
    custom past range (not ending today) silently showed a DIFFERENT,
    more recent period instead — the filter looked like it did nothing.
    """
    from datetime import timedelta
    from app.core.dates import parse_local_date_filter
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
    until = now
    if date_from:
        try:
            since = parse_local_date_filter(date_from)
        except ValueError:
            pass
    if date_to:
        try:
            until = parse_local_date_filter(date_to)
        except ValueError:
            pass

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
            Order.created_at >= since, Order.created_at <= until,
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
            Order.created_at >= since, Order.created_at <= until,
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
            Order.created_at >= since, Order.created_at <= until,
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
        .filter(has_product, Order.store_id == lp.store_id, Order.created_at >= since, Order.created_at <= until, MetaCapiLog.status == "success")
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
            MetaAdsDailyInsight.date >= since.date(), MetaAdsDailyInsight.date <= until.date(),
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
            Order.created_at >= since, Order.created_at <= until,
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
            Order.created_at >= since, Order.created_at <= until,
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
    from app.core.cache import invalidate as _cache_invalidate
    _cache_invalidate(f"landing_page:{lp.store_id}:{lp.slug}")
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
    store_id, slug = lp.store_id, lp.slug
    db.delete(lp)
    db.commit()
    from app.core.cache import invalidate as _cache_invalidate
    _cache_invalidate(f"landing_page:{store_id}:{slug}")
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
    from app.core.cache import invalidate as _cache_invalidate
    _cache_invalidate(f"landing_page:{lp.store_id}:{lp.slug}")
    return {"success": True, "is_active": lp.is_active}
