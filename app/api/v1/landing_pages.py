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
    q = db.query(LandingPage).filter(LandingPage.store_id == store_id)

    if start_date:
        try:
            sd = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            q = q.filter(LandingPage.created_at >= sd)
        except ValueError:
            pass

    if end_date:
        try:
            ed = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            q = q.filter(LandingPage.created_at <= ed)
        except ValueError:
            pass

    pages = q.order_by(LandingPage.created_at.desc()).all()
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
        #   - cancelled:  orders cancelled
        #   - duplicates: same-phone repeat submissions (auto-merged)
        _not_manual = func.coalesce(Order.source, "") != "MANUAL"
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
                    (and_(Order.is_abandoned_cart == True, Order.status.in_(_DELIVERED_STATES)), Order.id)
                ))).label("recovered"),
                func.count(distinct(case((Order.status == "CANCELLED", Order.id)))).label("cancelled"),
                func.count(distinct(case((Order.status == "MERGED", Order.id)))).label("duplicates"),
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
            try:
                _sd = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                _metrics_query = _metrics_query.filter(Order.created_at >= _sd)
            except ValueError:
                pass
        if end_date:
            try:
                _ed = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                _metrics_query = _metrics_query.filter(Order.created_at <= _ed)
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
                "cancelled": int(r.cancelled or 0),
                "duplicates": int(r.duplicates or 0),
            }

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
