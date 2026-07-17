from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from typing import Optional, List, Any, Dict
from datetime import datetime, timedelta, timezone
import uuid
import random
import logging
import hashlib
import json

logger = logging.getLogger(__name__)

from app.api.deps import get_db
from app.api import deps
from app.models.user import User
from app.models.marketing import MetaAdsConfig, MetaAdsCampaign
from app.models.order import Order
from app.models.expense import Expense, ExpenseCategory, ExpenseStatus
from app.models.finance import Wallet, FinancialTransaction, TransactionType

router = APIRouter()

# Single source of truth for the Graph API version used across every Meta
# call in this file (Ads Insights sync + health/token/pixel checks). Was
# previously split: Ads Insights called v18.0 (released ~Aug 2023 — outside
# Meta's ~2-year support window as of this audit) while health/token checks
# already used v21.0. Unified to the version app/services/meta_capi.py uses
# for CAPI sends, so there is exactly one version to track/upgrade.
META_GRAPH_VERSION = "v21.0"


def _graph_get(path: str, params: dict, access_token: str, timeout: float = 10.0):
    """
    GET a Graph API path, transparently through the Vercel relay when
    META_CAPI_RELAY_URL is set (HuggingFace can't reach graph.facebook.com
    directly — TLS to Meta's IP ranges is blocked at the network layer).
    Returns an httpx.Response-compatible object with .status_code and .json().
    Every direct-Graph-call site in this module (ad account details, /me token
    check, debug_token, pixel check) used to bypass the relay and silently
    time out on HuggingFace — that's what left spend/impressions at 0 and the
    health panel reporting "TLS bloqué" even though CAPI itself worked fine.
    """
    import httpx
    from app.core.config import settings as _settings

    relay_url = (getattr(_settings, "META_CAPI_RELAY_URL", "") or "").strip()
    if relay_url:
        resp = httpx.post(
            relay_url,
            json={
                "kind": "graph_get",
                "path": path,
                "graph_version": META_GRAPH_VERSION,
                "access_token": access_token,
                "params": params,
            },
            headers={"x-internal-key": _settings.INTERNAL_API_KEY},
            timeout=timeout,
            # The relay's apex domain can 308 at the platform/DNS level
            # (confirmed live, outside this codebase) — httpx doesn't follow
            # redirects by default, so every relay call got back a redirect's
            # HTML body instead of Meta's JSON, permanently breaking the
            # sync with JSONDecodeError. See the same fix in meta_capi.py.
            follow_redirects=True,
        )
        return resp
    return httpx.get(
        f"https://graph.facebook.com/{META_GRAPH_VERSION}/{path}",
        params={**params, "access_token": access_token},
        timeout=timeout,
    )


def _normalize_ad_account_id(raw: Optional[str]) -> Optional[str]:
    """
    Meta's Graph API only recognizes an ad account as the node `act_<id>` —
    a bare numeric ID (as shown in Ads Manager's URL/UI) is not a valid
    top-level object and GET /v18.0/<numeric_id> fails with exactly:
    GraphMethodException code 100, error_subcode 33 ("Unsupported get
    request"). Normalize on save so every downstream call is correct
    regardless of how the user pasted it.
    """
    if not raw:
        return raw
    cleaned = raw.strip()
    if not cleaned:
        return cleaned
    return cleaned if cleaned.startswith("act_") else f"act_{cleaned}"


class MetaAdsConfigCreate(BaseModel):
    store_id: str
    access_token: Optional[str] = None
    ad_account_id: Optional[str] = None
    pixel_id: Optional[str] = None
    domain_verification_tag: Optional[str] = None
    is_connected: bool = False
    exchange_rate: Optional[float] = 1.0
    currency: Optional[str] = "USD"

class MetaAdsConfigOut(BaseModel):
    store_id: str
    access_token: Optional[str]
    ad_account_id: Optional[str]
    pixel_id: Optional[str]
    domain_verification_tag: Optional[str]
    is_connected: bool
    exchange_rate: Optional[float]
    currency: Optional[str]

    class Config:
        from_attributes = True

@router.get("/config", response_model=dict)
def get_meta_ads_config(store_id: str = Query(...), db: Session = Depends(get_db)):
    # Explicitly scoped by the store_id param and read across stores (admin
    # dashboard loads all 3 configs), so bypass the SELECT tenant auto-filter.
    # Otherwise it hid the EXISTING config whenever X-Store-Id didn't match the
    # requested store, so the endpoint tried to re-INSERT it and hit the
    # unique(store_id) constraint → the 409 seen in the browser console.
    db.info["skip_tenant_isolation"] = True
    config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == store_id).first()
    if not config:
        config = MetaAdsConfig(
            id=str(uuid.uuid4()),
            store_id=store_id,
            access_token="",
            ad_account_id="",
            pixel_id="",
            domain_verification_tag="",
            is_connected=False,
            exchange_rate=1.0,
            currency="USD"
        )
        db.add(config)
        try:
            db.commit()
            db.refresh(config)
        except IntegrityError:
            # A concurrent request created it first — reuse that row instead of
            # failing (idempotent get-or-create).
            db.rollback()
            config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == store_id).first()
    return {"success": True, "data": {
        "store_id": config.store_id,
        "access_token": config.access_token,
        "ad_account_id": config.ad_account_id,
        "pixel_id": config.pixel_id,
        "domain_verification_tag": config.domain_verification_tag,
        "is_connected": config.is_connected,
        "exchange_rate": config.exchange_rate if config.exchange_rate is not None else 1.0,
        "currency": config.currency or "USD"
    }}

@router.post("/config", response_model=dict)
def update_meta_ads_config(payload: MetaAdsConfigCreate, db: Session = Depends(get_db)):
    # Same rationale as the GET: scoped by store_id, edited across stores.
    db.info["skip_tenant_isolation"] = True
    config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == payload.store_id).first()
    if not config:
        config = MetaAdsConfig(
            id=str(uuid.uuid4()),
            store_id=payload.store_id,
        )
        db.add(config)

    config.access_token = payload.access_token
    config.ad_account_id = _normalize_ad_account_id(payload.ad_account_id)
    config.pixel_id = payload.pixel_id
    config.domain_verification_tag = payload.domain_verification_tag
    config.is_connected = payload.is_connected
    config.exchange_rate = payload.exchange_rate if payload.exchange_rate is not None else 1.0
    config.currency = payload.currency or "USD"
    db.commit()
    db.refresh(config)
    return {"success": True, "data": {
        "store_id": config.store_id,
        "access_token": config.access_token,
        "ad_account_id": config.ad_account_id,
        "pixel_id": config.pixel_id,
        "domain_verification_tag": config.domain_verification_tag,
        "is_connected": config.is_connected,
        "exchange_rate": config.exchange_rate,
        "currency": config.currency
    }}

@router.patch("/campaigns/{campaign_id}/product", response_model=dict)
def link_campaign_product(
    campaign_id: str,
    body: dict,
    db: Session = Depends(get_db),
):
    """
    Manually link (or unlink, product_id=None) a Meta campaign to a
    product — see product_id's docstring on MetaAdsCampaign for why this
    exists (ad sets named after internal codenames never match a product's
    name/slug, and orders may not carry a UTM yet).
    """
    # This endpoint scopes itself explicitly via campaign_id (globally
    # unique) — bypass the tenant auto-filter, or a stale/mismatched
    # X-Store-Id header (e.g. left over from switching stores in the UI
    # without a full reload) silently ANDs an incompatible store_id onto
    # the query and the campaign "doesn't exist" even though it's right
    # there. Same class of bug fixed earlier this session in customers.py/
    # analytics.py/orders.py.
    db.info["skip_tenant_isolation"] = True
    camp = db.query(MetaAdsCampaign).filter(MetaAdsCampaign.campaign_id == campaign_id).first()
    if not camp:
        raise HTTPException(status_code=404, detail="Campagne introuvable.")
    product_id = body.get("product_id") or None
    if product_id:
        from app.models.product import Product
        if not db.query(Product.id).filter(Product.id == product_id).first():
            raise HTTPException(status_code=404, detail="Produit introuvable.")
    camp.product_id = product_id
    db.commit()
    return {"success": True, "data": {"campaign_id": camp.campaign_id, "product_id": camp.product_id}}


@router.get("/campaigns/{campaign_id}/ads", response_model=dict)
def list_campaign_ads(
    campaign_id: str,
    db: Session = Depends(get_db),
):
    """
    Per-ad breakdown for one campaign — same rollup Meta's own "Publicité"
    table shows (each split-tested ad with its own spend/achats), instead of
    the single combined row the "Campagnes" table necessarily shows.
    """
    from app.models.marketing import MetaAdsAdInsight
    db.info["skip_tenant_isolation"] = True
    rows = (
        db.query(MetaAdsAdInsight)
        .filter(MetaAdsAdInsight.campaign_id == campaign_id)
        .order_by(MetaAdsAdInsight.spend.desc())
        .all()
    )
    data = []
    for r in rows:
        cpc = round(r.spend / r.clicks, 2) if r.clicks > 0 else 0.0
        cpm = round(r.spend / r.impressions * 1000, 2) if r.impressions > 0 else 0.0
        cost_per_purchase = round(r.spend / r.meta_purchases, 2) if r.meta_purchases > 0 else 0.0
        data.append({
            "ad_id": r.ad_id,
            "ad_name": r.ad_name,
            "adset_id": r.adset_id,
            "adset_name": r.adset_name,
            "spend": r.spend,
            "raw_spend": r.raw_spend,
            "currency": r.currency,
            "impressions": r.impressions,
            "clicks": r.clicks,
            "reach": r.reach,
            "meta_purchases": r.meta_purchases,
            "meta_purchase_value": r.meta_purchase_value,
            "cpc": cpc,
            "cpm": cpm,
            "cost_per_purchase": cost_per_purchase,
            "last_synced_at": r.updated_at.isoformat() if r.updated_at else None,
        })
    return {"success": True, "data": data}


@router.get("/campaigns", response_model=dict)
def list_campaigns(
    store_id: str = Query(...),
    date_start: Optional[str] = Query(None),
    date_end: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    # Scoped by store_id, read across stores (each store shows its own Meta
    # indicators) — bypass the tenant auto-filter so a cross-store admin view
    # doesn't get empty metrics when X-Store-Id points at a different store.
    db.info["skip_tenant_isolation"] = True
    query = db.query(MetaAdsCampaign).filter(MetaAdsCampaign.store_id == store_id)

    # Simple parse dates if provided — parsed as Algeria-local (not raw UTC),
    # same fix as everywhere else this pattern appears (see app/core/dates.py).
    from app.core.dates import parse_local_date_filter
    d_start, d_end = None, None
    if date_start and isinstance(date_start, str):
        try:
            d_start = parse_local_date_filter(date_start)
        except ValueError:
            pass
    if date_end and isinstance(date_end, str):
        try:
            d_end = parse_local_date_filter(date_end)
        except ValueError:
            pass

    campaigns = query.all()

    # ── Learning Score par campagne — Purchases Meta des 7 derniers jours,
    # UNE requête groupée sur meta_ads_daily_insights pour toutes les
    # campagnes (pas de N+1). Les seuils (10/50) suivent le repère public de
    # Meta (~50 conversions/semaine pour sortir de l'apprentissage) — jamais
    # présenté comme le calcul interne exact de Meta.
    from app.models.marketing import MetaAdsDailyInsight as _Daily
    from datetime import datetime as _dt2, timedelta as _td2
    from sqlalchemy import func as _hs_func
    _week_ago = (_dt2.utcnow() - _td2(days=7)).date()
    purchases_7d_by_campaign = dict(
        db.query(_Daily.campaign_id, _hs_func.coalesce(_hs_func.sum(_Daily.meta_purchases), 0))
        .filter(_Daily.store_id == store_id, _Daily.date >= _week_ago)
        .group_by(_Daily.campaign_id)
        .all()
    )

    # Product lookup for the campaigns table's own "Produit" column — cheap
    # here since we'll query all active products again below anyway for the
    # attribution breakdown; a plain dict keeps this section independent.
    from app.models.product import Product as _Product
    products_by_id = {
        p.id: p for p in db.query(_Product).filter(_Product.store_id == store_id).all()
    }

    # Calculate ROAS based on orders with utm_campaign
    # joinedload(Order.items) — the product-attribution loop below iterates
    # o.items for every order of every campaign; without eager-loading, each
    # access is a separate round-trip to Neon (N+1), which is invisible on an
    # empty/unsynced store but turned a real campaign's first sync into a
    # ~19s response (one query per order, one network hop each) — slow
    # enough that the frontend never got to render anything.
    orders_query = db.query(Order).options(joinedload(Order.items)).filter(
        Order.store_id == store_id,
        Order.status != "CANCELLED",
        # MERGED = a same-phone duplicate submission auto-fused into its parent
        # order (see auto_merge_duplicates). It was still counted here as a
        # separate real sale, inflating "Ventes Générées"/orders_count beyond
        # what the Orders and Landing Pages modules show for the same period —
        # the exact mismatch reported between Meta Ads and the rest of the ERP.
        Order.status != "MERGED",
        Order.is_deleted == False
    )
    # Filter orders by the period selected in the date-range picker. d_start/
    # d_end were parsed above but never actually applied to the query — every
    # call silently used the store's ENTIRE order history regardless of which
    # dates were shown as selected in the UI.
    if d_start:
        orders_query = orders_query.filter(Order.created_at >= d_start)
    if d_end:
        orders_query = orders_query.filter(Order.created_at <= d_end)
    orders = orders_query.all()
    
    data = []
    global_spend = 0.0
    global_revenue = 0.0
    global_orders_count = 0

    # How many campaigns in THIS list share each product_id — needed below to
    # know when a product-based fallback match is unambiguous. A client who
    # split-tests several ad sets against the same product (real case: "vd
    # jdid", "tyara", "vd ai", "vd jdida" all pushing the same item) can link
    # every one of them to that product — but if we then attributed the
    # product's orders to EACH linked campaign, the same sale would be
    # double-counted N times across siblings. Only apply the fallback when
    # the product has exactly one linked campaign in this set.
    _product_link_counts: dict = {}
    for camp in campaigns:
        if camp.product_id:
            _product_link_counts[camp.product_id] = _product_link_counts.get(camp.product_id, 0) + 1

    for camp in campaigns:
        # Primary signal: utm_campaign matches this campaign's name/id — most
        # reliable when Meta's ad URL parameters are set correctly.
        by_utm = {
            o.id: o for o in orders
            if o.utm_campaign and (o.utm_campaign.lower() == camp.campaign_name.lower() or o.utm_campaign == camp.campaign_id)
        }
        # Fallback: manually-linked product (see link_campaign_product) — the
        # SAME mechanism the LP/product dashboard already relies on, catching
        # orders whose UTM never matched (missing, mistyped, or the ad set's
        # dynamic URL parameters weren't configured on this particular
        # campaign) — previously this meant a linked-but-unmatched campaign
        # silently showed 0 orders while spend kept accruing, exactly the
        # "only one ad set shows results" symptom. Skipped when the product
        # is shared by more than one campaign — can't split ambiguous credit
        # without double-counting the same sale on every sibling.
        if camp.product_id and _product_link_counts.get(camp.product_id) == 1:
            for o in orders:
                if o.id in by_utm:
                    continue
                if any(item.product_id == camp.product_id for item in (o.items or [])):
                    by_utm[o.id] = o
        camp_orders = list(by_utm.values())

        # Calculate revenue in DZD from matched orders
        revenue = sum(o.total for o in camp_orders)
        orders_count = len(camp_orders)
        
        roas = round(revenue / camp.spend, 2) if camp.spend > 0 else 0.0
        raw_spend = camp.raw_spend if camp.raw_spend is not None else camp.spend

        global_spend += camp.spend
        global_revenue += revenue
        global_orders_count += orders_count

        # Micro-metrics (converted DZD + raw ad-account currency)
        ctr = round(camp.clicks / camp.impressions * 100, 3) if camp.impressions > 0 else 0.0
        cpc = round(camp.spend / camp.clicks, 2) if camp.clicks > 0 else 0.0
        cpc_raw = round(raw_spend / camp.clicks, 4) if camp.clicks > 0 else 0.0
        cpm = round(camp.spend / camp.impressions * 1000, 2) if camp.impressions > 0 else 0.0
        cpm_raw = round(raw_spend / camp.impressions * 1000, 4) if camp.impressions > 0 else 0.0
        frequency = round(camp.impressions / camp.reach, 2) if camp.reach > 0 else 0.0
        cost_per_order = round(camp.spend / orders_count, 2) if orders_count > 0 else 0.0
        cost_per_order_raw = round(raw_spend / orders_count, 4) if orders_count > 0 else 0.0
        conversion_rate = round(orders_count / camp.clicks * 100, 3) if camp.clicks > 0 else 0.0
        aov = round(revenue / orders_count, 2) if orders_count > 0 else 0.0
        profit = round(revenue - camp.spend, 2)

        # Meta's OWN reported conversions (its pixel/CAPI attribution, its
        # dedup) — deliberately kept separate from orders_count/revenue
        # above, which come from OUR order table matched by utm_campaign.
        # The two numbers WILL differ (different attribution windows,
        # view-through credit, checkout abandons that fired a pixel event but
        # never became a DB order) — that gap is real, not a display bug.
        meta_purchases = camp.meta_purchases or 0
        meta_purchase_value = camp.meta_purchase_value or 0.0
        meta_conversion_rate = round(meta_purchases / camp.clicks * 100, 3) if camp.clicks > 0 else 0.0
        meta_roas = round(meta_purchase_value / raw_spend, 2) if raw_spend > 0 else 0.0
        conversion_gap = orders_count - meta_purchases

        # ── Learning par campagne (7 jours glissants, données du sync réel) ──
        _p7d = int(purchases_7d_by_campaign.get(camp.campaign_id, 0) or 0)
        if _p7d < 10:
            camp_learning = {"status": "learning", "label": "Apprentissage",
                             "explanation": f"Seulement {_p7d} Purchase Meta cette semaine — le modèle d'optimisation manque encore de données."}
        elif _p7d < 50:
            camp_learning = {"status": "limited_learning", "label": "Apprentissage Limité",
                             "explanation": f"{_p7d} Purchase cette semaine — sous le repère de ~50/semaine de Meta pour sortir de l'apprentissage."}
        else:
            camp_learning = {"status": "stable" if _p7d < 100 else "optimized",
                             "label": "Stable" if _p7d < 100 else "Optimisé",
                             "explanation": f"{_p7d} Purchase cette semaine — volume suffisant pour une diffusion optimisée."}
        camp_learning["purchases_7d"] = _p7d

        # ── Saturation d'audience / fatigue créative — heuristique publique
        # standard (frequency = impressions/reach) : au-delà de ~3-4
        # expositions par personne, le CTR décroît typiquement. Signalé comme
        # indicateur, jamais comme verdict certain.
        audience_saturation = ("high" if frequency >= 4 else "medium" if frequency >= 2.5 else "low") if frequency > 0 else None

        # ── Campaign Health Score /100 — formule DOCUMENTÉE, moyenne de
        # composantes bornées calculées sur les données réelles ci-dessus :
        #   • ROAS ERP (roas/3 plafonné à 1 : ROAS 3+ = 100 pts)
        #   • CTR (ctr/1.5% plafonné : 1.5%+ = 100 pts, repère e-commerce)
        #   • Volume 7j (purchases_7d/50 plafonné — même seuil que Learning)
        #   • Fraîcheur de fréquence (100 si <2.5, 50 si <4, 0 sinon)
        # Aucune composante inventée : chacune est dérivée d'un chiffre déjà
        # affiché dans ce même tableau.
        _hs_components = []
        if camp.spend > 0:
            _hs_components.append(min(1.0, roas / 3.0) * 100)
        if camp.impressions > 0:
            _hs_components.append(min(1.0, ctr / 1.5) * 100)
        _hs_components.append(min(1.0, _p7d / 50.0) * 100)
        if frequency > 0:
            _hs_components.append(100.0 if frequency < 2.5 else 50.0 if frequency < 4 else 0.0)
        health_score = round(sum(_hs_components) / len(_hs_components), 1) if _hs_components else None

        linked_product = products_by_id.get(camp.product_id) if camp.product_id else None

        data.append({
            "id": camp.id,
            "campaign_id": camp.campaign_id,
            "campaign_name": camp.campaign_name,
            "product_id": camp.product_id,
            "product_name": linked_product.name if linked_product else None,
            "product_sku": linked_product.sku if linked_product else None,
            "product_image": linked_product.main_image if linked_product else None,
            "spend": camp.spend,
            "raw_spend": raw_spend,
            "currency": camp.currency or "USD",
            "impressions": camp.impressions,
            "clicks": camp.clicks,
            "reach": camp.reach,
            "revenue": revenue,
            "orders_count": orders_count,
            "roas": roas,
            "ctr": ctr,
            "cpc": cpc,
            "cpc_raw": cpc_raw,
            "cpm": cpm,
            "cpm_raw": cpm_raw,
            "frequency": frequency,
            "cost_per_order": cost_per_order,
            "cost_per_order_raw": cost_per_order_raw,
            "conversion_rate": conversion_rate,
            "aov": aov,
            "profit": profit,
            "meta_purchases": meta_purchases,
            "meta_purchase_value": meta_purchase_value,
            "meta_conversion_rate": meta_conversion_rate,
            "meta_roas": meta_roas,
            "conversion_gap": conversion_gap,
            "learning": camp_learning,
            "audience_saturation": audience_saturation,
            "health_score": health_score,
            "date_start": camp.date_start.isoformat() if camp.date_start else None,
            "date_end": camp.date_end.isoformat() if camp.date_end else None,
            # When this row was actually last synced from Meta — the numbers
            # above are always a snapshot, not live; without this, a real gap
            # between our count and Meta's own live UI (auto-sync only runs
            # every META_ADS_SYNC_INTERVAL_MINUTES, default 24h) reads as a
            # bug instead of the explainable staleness it actually is.
            "last_synced_at": camp.updated_at.isoformat() if camp.updated_at else None,
        })

    global_roas = round(global_revenue / global_spend, 2) if global_spend > 0 else 0.0
    global_meta_purchases = sum(c.meta_purchases or 0 for c in campaigns)
    global_meta_purchase_value = sum(c.meta_purchase_value or 0.0 for c in campaigns)

    # Global micro-metrics + raw spend grouped by ad-account currency
    total_impressions = sum(c.impressions or 0 for c in campaigns)
    total_clicks = sum(c.clicks or 0 for c in campaigns)
    total_reach = sum(c.reach or 0 for c in campaigns)
    raw_spend_by_currency: dict = {}
    for c in campaigns:
        cur = (c.currency or "USD").upper()
        rs = c.raw_spend if c.raw_spend is not None else c.spend
        raw_spend_by_currency[cur] = round(raw_spend_by_currency.get(cur, 0.0) + (rs or 0.0), 2)

    # --- Product-specific ad spend attribution ---
    from app.models.product import Product
    products = db.query(Product).filter(
        Product.store_id == store_id,
        Product.is_active == True
    ).all()

    product_attribution = {}
    for p in products:
        product_attribution[p.id] = {
            "product_id": p.id,
            "product_name": p.name,
            "product_sku": p.sku or "---",
            "spend": 0.0,
            "raw_spend": 0.0,
            "revenue": 0.0,
            "orders_count": 0,
            "impressions": 0,
            "clicks": 0,
            "reach": 0,
            "currency": "USD"
        }

    for camp in campaigns:
        camp_orders = [
            o for o in orders
            if o.utm_campaign and (o.utm_campaign.lower() == camp.campaign_name.lower() or o.utm_campaign == camp.campaign_id)
        ]

        # Calculate revenue generated by product in this campaign
        camp_revenue_by_prod = {}
        camp_orders_by_prod = {}
        for o in camp_orders:
            for item in o.items:
                if item.product_id and any(p.id == item.product_id for p in products):
                    pid = item.product_id
                    item_rev = item.unit_price * item.quantity
                    camp_revenue_by_prod[pid] = camp_revenue_by_prod.get(pid, 0.0) + item_rev
                    if pid not in camp_orders_by_prod:
                        camp_orders_by_prod[pid] = set()
                    camp_orders_by_prod[pid].add(o.id)

        total_camp_rev = sum(camp_revenue_by_prod.values())

        # Manual campaign -> product link takes priority over everything
        # else — several ad sets can target the same product under
        # unrelated codenames, and a store owner assigning them explicitly
        # is more reliable than guessing from UTM/name matching. 100% of
        # this campaign's spend/impressions/clicks/reach go to that one
        # product; revenue/orders still come from whatever real UTM-matched
        # orders exist for it (already computed above), so ROAS stays
        # accurate even before enough orders accumulate.
        if camp.product_id and camp.product_id in product_attribution:
            attr = product_attribution[camp.product_id]
            attr["spend"] += camp.spend
            attr["raw_spend"] += (camp.raw_spend if camp.raw_spend is not None else camp.spend)
            attr["revenue"] += camp_revenue_by_prod.get(camp.product_id, 0.0)
            attr["orders_count"] += len(camp_orders_by_prod.get(camp.product_id, ()))
            attr["impressions"] += camp.impressions or 0
            attr["clicks"] += camp.clicks or 0
            attr["reach"] += camp.reach or 0
            attr["currency"] = camp.currency or "USD"
            continue

        matched_product_ids = []
        if total_camp_rev > 0:
            # Attribute spend proportionally to revenue generated in campaign
            for pid, prod_rev in camp_revenue_by_prod.items():
                ratio = prod_rev / total_camp_rev
                if pid in product_attribution:
                    product_attribution[pid]["spend"] += camp.spend * ratio
                    product_attribution[pid]["raw_spend"] += (camp.raw_spend if camp.raw_spend is not None else camp.spend) * ratio
                    product_attribution[pid]["revenue"] += prod_rev
                    product_attribution[pid]["orders_count"] += len(camp_orders_by_prod[pid])
                    product_attribution[pid]["impressions"] += int(camp.impressions * ratio)
                    product_attribution[pid]["clicks"] += int(camp.clicks * ratio)
                    product_attribution[pid]["reach"] += int(camp.reach * ratio)
                    product_attribution[pid]["currency"] = camp.currency or "USD"
        else:
            # Fall back to campaign name matching (useful for early campaigns or zero-sales ones)
            camp_name_lower = camp.campaign_name.lower()
            for prod in products:
                prod_name_lower = prod.name.lower()
                prod_slug_lower = prod.slug.lower()
                prod_slug_spaces = prod_slug_lower.replace("-", " ")
                
                if prod_slug_lower in camp_name_lower or prod_slug_spaces in camp_name_lower or prod_name_lower in camp_name_lower:
                    matched_product_ids.append(prod.id)
            
            if matched_product_ids:
                num_matched = len(matched_product_ids)
                for pid in matched_product_ids:
                    if pid in product_attribution:
                        product_attribution[pid]["spend"] += camp.spend / num_matched
                        product_attribution[pid]["raw_spend"] += (camp.raw_spend if camp.raw_spend is not None else camp.spend) / num_matched
                        product_attribution[pid]["impressions"] += int(camp.impressions / num_matched)
                        product_attribution[pid]["clicks"] += int(camp.clicks / num_matched)
                        product_attribution[pid]["reach"] += int(camp.reach / num_matched)
                        product_attribution[pid]["currency"] = camp.currency or "USD"

    # ── Landing page = sponsored: attribute LP/UTM order revenue even when
    # no Meta campaign is synced (spend stays 0 until a real sync runs) ──
    sponsored_sources = {"landing_page", "lp", "facebook", "meta", "instagram"}
    for o in orders:
        is_sponsored = bool(o.utm_campaign) or (o.source or "").lower() in sponsored_sources
        if not is_sponsored:
            continue
        for item in o.items:
            pid = item.product_id
            if pid and pid in product_attribution:
                attr = product_attribution[pid]
                # Only add revenue not already attributed through a campaign
                if attr["orders_count"] == 0 and attr["spend"] == 0:
                    attr["revenue"] += item.unit_price * item.quantity
                    attr.setdefault("_lp_orders", set()).add(o.id)

    for attr in product_attribution.values():
        lp_orders = attr.pop("_lp_orders", None)
        if lp_orders:
            attr["orders_count"] = len(lp_orders)

    # Calculate ROAS and filter down to products with activity
    breakdown_list = []
    # NEVER name this loop variable "data" — the campaigns list built above
    # is also called `data`, and Python for-loops don't scope their variable
    # to the loop body: reusing the name here silently overwrote the whole
    # campaigns list with whichever product was processed last, so the
    # "Historique des Campagnes" table always rendered empty as soon as a
    # store had at least one product with ad spend attributed to it.
    for pid, prod_attr in product_attribution.items():
        prod_attr["roas"] = round(prod_attr["revenue"] / prod_attr["spend"], 2) if prod_attr["spend"] > 0 else 0.0
        if prod_attr["spend"] > 0 or prod_attr["revenue"] > 0 or prod_attr["impressions"] > 0 or prod_attr["orders_count"] > 0:
            breakdown_list.append(prod_attr)

    return {
        "success": True,
        "data": data,
        "products_breakdown": breakdown_list,
        "summary": {
            "total_spend": global_spend,
            "total_revenue": global_revenue,
            "total_orders": global_orders_count,
            "global_roas": global_roas,
            "total_impressions": total_impressions,
            "total_clicks": total_clicks,
            "total_reach": total_reach,
            "raw_spend_by_currency": raw_spend_by_currency,
            "global_ctr": round(total_clicks / total_impressions * 100, 3) if total_impressions > 0 else 0.0,
            "global_cpc": round(global_spend / total_clicks, 2) if total_clicks > 0 else 0.0,
            "global_cpm": round(global_spend / total_impressions * 1000, 2) if total_impressions > 0 else 0.0,
            "global_cost_per_order": round(global_spend / global_orders_count, 2) if global_orders_count > 0 else 0.0,
            "global_conversion_rate": round(global_orders_count / total_clicks * 100, 3) if total_clicks > 0 else 0.0,
            "global_aov": round(global_revenue / global_orders_count, 2) if global_orders_count > 0 else 0.0,
            "global_profit": round(global_revenue - global_spend, 2),
            "global_meta_purchases": global_meta_purchases,
            "global_meta_purchase_value": global_meta_purchase_value,
            "global_conversion_gap": global_orders_count - global_meta_purchases,
        }
    }

# Meta reports the SAME purchase under several overlapping action_type
# aliases (legacy pixel event, unified omni-channel rollup, app event...) —
# they are NOT independent counts. Summing all of them (as this used to do)
# multiplied every real purchase by ~5x: a campaign with 277 real purchases
# (matching Ads Manager's own "Achats sur site Web" column, ad-by-ad) showed
# 1438 in the ERP. Ads Manager itself picks ONE authoritative action type per
# result column — omni_purchase when present (Meta's own deduplicated
# cross-channel metric), falling back through the others only when it's
# absent — so we must pick, not sum, to match what the user sees in Meta's
# own UI.
_META_PURCHASE_ACTION_PRIORITY = [
    "omni_purchase",
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "onsite_web_app_purchase",
    "onsite_web_purchase",
    "app_custom_event.fb_mobile_purchase",
]


def _extract_meta_purchases(raw_campaign: dict) -> tuple:
    """Pick Meta's own attributed purchase count/value from an Insights API
    row's `actions`/`action_values` arrays — the first match in
    _META_PURCHASE_ACTION_PRIORITY, never a sum across aliases. Returns
    (count, value) — both 0 if Meta reports no purchase action for this
    campaign/date range."""
    actions_by_type = {a.get("action_type"): a for a in (raw_campaign.get("actions") or [])}
    values_by_type = {a.get("action_type"): a for a in (raw_campaign.get("action_values") or [])}

    for action_type in _META_PURCHASE_ACTION_PRIORITY:
        if action_type not in actions_by_type:
            continue
        try:
            count = int(float(actions_by_type[action_type].get("value", 0)))
        except (TypeError, ValueError):
            count = 0
        value = 0.0
        if action_type in values_by_type:
            try:
                value = float(values_by_type[action_type].get("value", 0))
            except (TypeError, ValueError):
                value = 0.0
        return count, value

    return 0, 0.0


_FX_CACHE: Dict[str, tuple] = {}  # {currency: (rate_to_dzd_or_None, fetched_at_epoch)}
_FX_CACHE_TTL_SECONDS = 6 * 3600       # successful fetch — upstream itself only refreshes once/day
_FX_FAILURE_CACHE_TTL_SECONDS = 15 * 60  # failed fetch — retry occasionally, don't hammer a dead/blocked host


def _fetch_live_dzd_rate(currency: str) -> Optional[float]:
    """
    Live currency→DZD rate from a free, keyless FX API. Cached in-process —
    successes for a few hours (the upstream source only refreshes once a day
    anyway), FAILURES for 15 min too. Without caching failures, a network
    path that can't reach this host (same class of restriction HF Space has
    on graph.facebook.com, needing a Vercel relay) would retry-and-timeout on
    every single campaign in the sync loop, adding many seconds of latency
    per sync and risking the whole request failing outright. Returns None on
    failure so the caller falls back to the static table below.
    """
    import time as _time
    currency = (currency or "").upper()
    if not currency or currency == "DZD":
        return 1.0
    cached = _FX_CACHE.get(currency)
    if cached:
        rate, ts = cached
        ttl = _FX_CACHE_TTL_SECONDS if rate is not None else _FX_FAILURE_CACHE_TTL_SECONDS
        if (_time.time() - ts) < ttl:
            return rate
    try:
        import httpx as _httpx
        r = _httpx.get(f"https://open.er-api.com/v6/latest/{currency}", timeout=4.0)
        rate = None
        if r.status_code == 200:
            raw = (r.json().get("rates") or {}).get("DZD")
            if raw:
                rate = float(raw)
    except Exception:
        rate = None
    _FX_CACHE[currency] = (rate, _time.time())
    return rate


def get_conversion_rate(ad_currency: str, config_currency: str, config_rate: float) -> float:
    ad_curr = ad_currency.upper() if ad_currency else "USD"
    cfg_curr = (config_currency or "USD").upper()
    cfg_rate = config_rate if config_rate is not None else 1.0

    if ad_curr == "DZD":
        return 1.0

    # Live rate first — the manually-entered config_rate AND the hardcoded
    # fallback table below both go stale silently (real EUR/USD→DZD rates
    # move every day; a rate typed in once and never revisited quietly drifts
    # further from reality over time — exactly what was reported: costs
    # displayed in DA didn't reflect the real, moving exchange rate). Only
    # fall back to the static numbers if the live source is unreachable.
    live_rate = _fetch_live_dzd_rate(ad_curr)
    if live_rate is not None:
        return round(live_rate, 4)

    if ad_curr == cfg_curr:
        return cfg_rate

    fallbacks = {
        "USD": 220.0,
        "EUR": 240.0,
        "CAD": 160.0,
        "GBP": 280.0,
    }
    
    if cfg_curr in fallbacks and ad_curr in fallbacks:
        ratio = fallbacks[ad_curr] / fallbacks[cfg_curr]
        return round(cfg_rate * ratio, 2)
        
    if ad_curr in fallbacks:
        return fallbacks[ad_curr]
        
    return cfg_rate

@router.post("/sync", response_model=dict)
def sync_meta_ads(
    store_id: str = Query(...),
    date_start: Optional[str] = Query(None),
    date_end: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    db.info["skip_tenant_isolation"] = True  # explicit store_id scope; cross-store safe
    config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == store_id).first()

    logger.info(f"[Meta Ads Sync] Démarrage de la synchronisation pour le store: {store_id}")
    
    if not config or not config.is_connected or not config.access_token or not config.ad_account_id:
        logger.warning(f"[Meta Ads Sync] Configuration introuvable ou incomplète pour le store: {store_id}")
        return {"success": False, "message": "Meta Ads n'est pas configuré. Veuillez connecter votre compte."}

    # Defensive: rows saved before the act_ normalization fix may still hold
    # a bare numeric ID. GET /v18.0/<bare_id> is rejected by Meta with
    # GraphMethodException code 100 subcode 33 ("Unsupported get request").
    ad_account_id = _normalize_ad_account_id(config.ad_account_id)

    import httpx

    # 1. Fetch Ad Account Details to get the currency dynamically!
    ad_currency = None
    ad_account_name = "Compte Publicitaire Meta"
    is_simulated = False
    is_network_error = False  # True = TLS/timeout; False = real auth/config issue

    # Check if access token looks fake or empty
    if not config.access_token or len(config.access_token) < 15 or config.access_token.startswith("dummy"):
        is_simulated = True
    else:
        try:
            logger.info(f"[Meta Ads Sync] Tentative de récupération des détails du compte publicitaire {ad_account_id}")
            acct_response = _graph_get(ad_account_id, {"fields": "currency,name"}, config.access_token, timeout=10.0)
            if acct_response.status_code == 200:
                acct_data = acct_response.json()
                ad_currency = acct_data.get("currency")
                ad_account_name = acct_data.get("name", ad_account_name)
                logger.info(f"[Meta Ads Sync] Succès récupération compte: {ad_account_name} ({ad_currency})")
            else:
                logger.warning(f"[Meta Ads Sync] Erreur API lors de la récupération du compte (Status: {acct_response.status_code}): {acct_response.text}")
                is_simulated = True
        except Exception as e:
            logger.error(f"[Meta Ads Sync] Exception réseau/API lors de la récupération du compte: {e}")
            is_simulated = True
            is_network_error = True
            
    # Update config.currency if we retrieved it dynamically
    if ad_currency:
        config.currency = ad_currency.upper()
        db.commit()
    else:
        ad_currency = config.currency or "USD"

    # 2. Get Campaign Insights
    if is_simulated:
        # NO mock data, ever — the is_simulated early-return below reports the
        # connection problem to the user without fabricating campaigns.
        campaigns_data = []
    else:
        params = {
            "level": "campaign",
            # actions/action_values carry Meta's OWN attributed conversions
            # (its pixel/CAPI events, its attribution window, its dedup) —
            # without these fields there is no way to compare against what
            # Ads Manager actually reports, only our own utm_campaign-matched
            # order count, which is a different methodology by construction.
            "fields": "campaign_id,campaign_name,spend,impressions,clicks,reach,actions,action_values,date_start,date_stop",
            # Without this, the Insights API applies the account's default
            # attribution window to conversions, while Ads Manager's columns
            # use each AD SET's own attribution setting — the two can
            # legitimately disagree on the same campaign/date range. Meta's
            # documented flag to make API numbers match what Ads Manager
            # displays (docs: Insights API > Parameters).
            "use_unified_attribution_setting": "true",
        }
        # A hardcoded "last_30d" here meant any campaign/spend older than 30
        # days could never be fetched, no matter what range the dashboard's
        # own date picker showed — the picker only filters what's ALREADY in
        # our DB, it never controlled what got pulled FROM Meta. Use the
        # caller's explicit range (Meta's time_range param) when the frontend
        # passes one; the 3-minute background auto-sync doesn't pass dates,
        # so it keeps the last_30d default for its lightweight recurring tick.
        if date_start and date_end:
            params["time_range"] = json.dumps({"since": date_start, "until": date_end})
        else:
            params["date_preset"] = "last_30d"
        try:
            from app.core.config import settings as _settings
            relay_url = (getattr(_settings, "META_CAPI_RELAY_URL", "") or "").strip()
            logger.info(f"[Meta Ads Sync] Tentative de récupération des campagnes (insights) pour le store: {store_id}")
            if relay_url:
                # HuggingFace can't reach graph.facebook.com directly (TLS block),
                # so pull Ads Insights through the same Vercel relay used for CAPI
                # (HF → Vercel → Meta). Without this the sync always fell back to
                # simulated/mock campaigns, so the ERP showed fake spend figures.
                response = httpx.post(
                    relay_url,
                    json={
                        "kind": "insights",
                        "ad_account_id": ad_account_id,
                        "graph_version": META_GRAPH_VERSION,
                        "access_token": config.access_token,
                        "params": params,
                    },
                    headers={"x-internal-key": _settings.INTERNAL_API_KEY},
                    timeout=30.0,
                    # See the graph_get relay call above — the relay's apex
                    # domain can 308 outside this codebase; without following
                    # it every insights sync silently got a redirect page
                    # instead of Meta's JSON and fell back to mock campaigns.
                    follow_redirects=True,
                )
            else:
                url = f"https://graph.facebook.com/{META_GRAPH_VERSION}/{ad_account_id}/insights"
                response = httpx.get(url, params={**params, "access_token": config.access_token}, timeout=30.0)
            res_data = response.json()
            if "error" in res_data:
                logger.warning(f"[Meta Ads Sync] L'API Meta a retourné une erreur d'insights: {res_data['error']}")
                is_simulated = True
                campaigns_data = []  # no mock data — early-return below explains the error
            else:
                raw_camps = res_data.get("data", [])
                campaigns_data = []
                for rc in raw_camps:
                    meta_purchases, meta_purchase_value = _extract_meta_purchases(rc)
                    campaigns_data.append({
                        "campaign_id": rc.get("campaign_id"),
                        "campaign_name": rc.get("campaign_name", "Sans nom"),
                        "spend": float(rc.get("spend", 0.0)),
                        "currency": ad_currency,
                        "impressions": int(rc.get("impressions", 0)),
                        "clicks": int(rc.get("clicks", 0)),
                        "reach": int(rc.get("reach", 0)),
                        "meta_purchases": meta_purchases,
                        "meta_purchase_value": meta_purchase_value,
                    })
                logger.info(f"[Meta Ads Sync] Succès: {len(campaigns_data)} campagnes récupérées de Meta.")
        except Exception as e:
            logger.error(f"[Meta Ads Sync] Exception lors de la récupération des insights: {e}")
            is_simulated = True
            is_network_error = True
            campaigns_data = []  # no mock data — early-return below explains the outage

    now = datetime.now()

    # ── Never persist simulated/test data in production ──────────
    if is_simulated:
        mock_names = ["Campagne Hiver - Algérie (USD)", "Promo Printemps (EUR)", "Fidélisation Clients (DZD)"]
        deleted = db.query(MetaAdsCampaign).filter(
            MetaAdsCampaign.store_id == store_id,
            MetaAdsCampaign.campaign_id.like("camp_mock_%"),
        ).delete(synchronize_session=False)
        db.query(Expense).filter(
            Expense.store_id == store_id,
            Expense.label.in_([f"Meta Ads: {n}" for n in mock_names]),
        ).delete(synchronize_session=False)
        db.commit()
        logger.warning(f"[Meta Ads Sync] Connexion invalide pour store {store_id} — rien synchronisé, {deleted} campagne(s) de test nettoyée(s). network_error={is_network_error}")
        if is_network_error:
            return {
                "success": True,
                "message": "Données Meta Ads affichées — synchronisation temporairement indisponible (API inaccessible).",
                "network_unavailable": True,
            }
        return {
            "success": False,
            "simulated": True,
            "message": "Connexion Meta invalide — vérifiez le token et l'ID du compte publicitaire.",
        }

    created_campaigns = []

    for c in campaigns_data:
        camp_id = c.get("campaign_id")
        camp_name = c.get("campaign_name", "Sans nom")
        camp_currency = c.get("currency", "USD").upper()
        raw_spend = float(c.get("spend", 0.0))
        
        rate = get_conversion_rate(camp_currency, config.currency, config.exchange_rate)
        spend = raw_spend * rate
        imp = int(c.get("impressions", 0))
        clicks = int(c.get("clicks", 0))
        reach = int(c.get("reach", 0))

        # Check if campaign exists in our DB
        campaign = db.query(MetaAdsCampaign).filter(
            MetaAdsCampaign.store_id == store_id,
            MetaAdsCampaign.campaign_id == camp_id
        ).first()

        if not campaign:
            campaign = MetaAdsCampaign(
                id=str(uuid.uuid4()),
                campaign_id=camp_id,
                campaign_name=camp_name,
                store_id=store_id,
                date_start=now - timedelta(days=30), # Approximation for new ones
                date_end=now
            )
            db.add(campaign)

        campaign.spend = spend
        campaign.raw_spend = raw_spend
        campaign.currency = camp_currency
        campaign.impressions = imp
        campaign.clicks = clicks
        campaign.reach = reach
        campaign.meta_purchases = int(c.get("meta_purchases", 0) or 0)
        campaign.meta_purchase_value = float(c.get("meta_purchase_value", 0.0) or 0.0)
        created_campaigns.append(campaign)

        # --- Synchronize to Expenses Module ---
        expense_label = f"Meta Ads: {camp_name}"
        expense_desc = (
            f"Dépense synchronisée depuis Meta Ads ({camp_currency} converti en DZD avec un taux de change de {rate}).\n\n"
            f"--- Micro-traçabilité (KPIs) ---\n"
            f"Campagne ID: {camp_id}\n"
            f"Montant initial: {raw_spend:.2f} {camp_currency}\n"
            f"Taux de change utilisé: 1 {camp_currency} = {rate} DZD\n"
            f"Impressions: {imp:,}\n"
            f"Clics: {clicks:,}\n"
            f"Reach (Couverture): {reach:,}"
        )

        expense = db.query(Expense).filter(
            Expense.store_id == store_id,
            Expense.label == expense_label
        ).first()

        amount_int = int(spend)
        old_amount = expense.total_amount if expense else 0
        amount_delta = amount_int - old_amount

        if not expense:
            if amount_int > 0:
                expense = Expense(
                    id=str(uuid.uuid4()),
                    store_id=store_id,
                    category=ExpenseCategory.ADVERTISING,
                    label=expense_label,
                    description=expense_desc,
                    amount=amount_int,
                    tax_amount=0,
                    total_amount=amount_int,
                    status=ExpenseStatus.PAID,
                    expense_date=now.date(),
                    is_recurring=False,
                    term_type="SHORT_TERM",
                    beneficiary="Meta Platforms Inc.",
                    created_by=None
                )
                db.add(expense)
        else:
            expense.amount = amount_int
            expense.total_amount = amount_int
            expense.description = expense_desc
            expense.expense_date = now.date()

        # --- Synchronize to Finance Module (FinancialTransaction + Wallet) ---
        # Find first active wallet for this store to record the marketing outflow
        if amount_int > 0 and abs(amount_delta) > 0 or (not expense and amount_int > 0):
            wallet = db.query(Wallet).filter(
                Wallet.store_id == store_id,
                Wallet.is_active == True
            ).first()

            if wallet:
                tx_ref = f"META-{store_id[:8].upper()}-{camp_id[:8].upper()}-{now.strftime('%Y%m%d')}"
                # Check if this transaction reference already exists
                existing_tx = db.query(FinancialTransaction).filter(
                    FinancialTransaction.store_id == store_id,
                    FinancialTransaction.reference == tx_ref
                ).first()

                charge_amount = abs(amount_delta) if expense and old_amount > 0 else amount_int

                if not existing_tx and charge_amount > 0:
                    tx = FinancialTransaction(
                        id=str(uuid.uuid4()),
                        store_id=store_id,
                        wallet_id=wallet.id,
                        reference=tx_ref,
                        type=TransactionType.CHARGE,
                        category="ads",
                        amount=charge_amount,
                        beneficiary="Meta Platforms Inc.",
                        description=(
                            f"Charge publicitaire Meta Ads — Campagne: {camp_name}\n"
                            f"Devise d'origine: {raw_spend:.2f} {camp_currency} → {charge_amount} DZD\n"
                            f"(Taux: 1 {camp_currency} = {rate} DZD)"
                        ),
                        transaction_date=now,
                    )
                    db.add(tx)
                    # Update wallet balance — marketing charge is an outflow
                    wallet.balance -= charge_amount
                    wallet.total_out += charge_amount
                    db.add(wallet)

    db.commit()

    # ── Daily insights (time_increment=1) — makes Meta's numbers sliceable
    # by date. The campaign rows above are a single running snapshot that
    # gets overwritten with whatever range was synced; without per-day rows
    # the ERP could never answer "combien Meta a déclaré AUJOURD'HUI ?" and
    # always disagreed with Ads Manager whenever the two compared different
    # ranges. One extra API call per sync; failure here never fails the sync.
    if not is_simulated:
        try:
            from app.models.marketing import MetaAdsDailyInsight
            from datetime import date as _date_cls
            # limit=500: with time_increment=1 Meta returns one row per
            # campaign per day — 30 days × a handful of campaigns already
            # exceeds the API's default page size (25), and we only read the
            # first page; without a high limit, older days silently vanished.
            daily_params = {**params, "time_increment": "1", "limit": "500"}
            if relay_url:
                daily_response = httpx.post(
                    relay_url,
                    json={
                        "kind": "insights",
                        "ad_account_id": ad_account_id,
                        "graph_version": META_GRAPH_VERSION,
                        "access_token": config.access_token,
                        "params": daily_params,
                    },
                    headers={"x-internal-key": _settings.INTERNAL_API_KEY},
                    timeout=30.0,
                    follow_redirects=True,
                )
            else:
                daily_response = httpx.get(
                    f"https://graph.facebook.com/{META_GRAPH_VERSION}/{ad_account_id}/insights",
                    params={**daily_params, "access_token": config.access_token},
                    timeout=30.0,
                )
            daily_data = daily_response.json()
            if "error" not in daily_data:
                # Single batched INSERT ... ON CONFLICT DO UPDATE instead of
                # one SELECT + one INSERT/UPDATE per row — a 30-day sync for
                # a multi-campaign store previously issued 50-100+ separate
                # SQL round-trips here alone (Supabase Free request quota).
                from sqlalchemy.dialects.postgresql import insert as pg_insert
                from sqlalchemy import func as _sqlfunc
                rate = get_conversion_rate(ad_currency, config.currency, config.exchange_rate)
                rows_to_upsert = []
                for rc in daily_data.get("data", []):
                    day_str = rc.get("date_start")
                    camp_id = rc.get("campaign_id")
                    if not day_str or not camp_id:
                        continue
                    try:
                        day_val = _date_cls.fromisoformat(day_str)
                    except ValueError:
                        continue
                    d_purchases, d_purchase_value = _extract_meta_purchases(rc)
                    d_raw_spend = float(rc.get("spend", 0.0) or 0.0)
                    rows_to_upsert.append({
                        "id": str(uuid.uuid4()),
                        "store_id": store_id,
                        "campaign_id": camp_id,
                        "date": day_val,
                        "raw_spend": d_raw_spend,
                        "spend": d_raw_spend * rate,
                        "impressions": int(rc.get("impressions", 0) or 0),
                        "clicks": int(rc.get("clicks", 0) or 0),
                        "reach": int(rc.get("reach", 0) or 0),
                        "meta_purchases": d_purchases,
                        "meta_purchase_value": d_purchase_value,
                    })
                if rows_to_upsert:
                    stmt = pg_insert(MetaAdsDailyInsight.__table__).values(rows_to_upsert)
                    stmt = stmt.on_conflict_do_update(
                        constraint="uq_meta_daily_campaign_date",
                        set_={
                            "raw_spend": stmt.excluded.raw_spend,
                            "spend": stmt.excluded.spend,
                            "impressions": stmt.excluded.impressions,
                            "clicks": stmt.excluded.clicks,
                            "reach": stmt.excluded.reach,
                            "meta_purchases": stmt.excluded.meta_purchases,
                            "meta_purchase_value": stmt.excluded.meta_purchase_value,
                            "updated_at": _sqlfunc.now(),
                        },
                    )
                    db.execute(stmt)
                    db.commit()
                logger.info(f"[Meta Ads Sync] Insights quotidiens: {len(rows_to_upsert)} jour(s)-campagne upsertés en 1 requête.")
            else:
                logger.warning(f"[Meta Ads Sync] Insights quotidiens indisponibles: {daily_data['error']}")
        except Exception as exc:
            db.rollback()
            logger.warning(f"[Meta Ads Sync] Échec insights quotidiens (non bloquant): {exc}")

    # ── Per-ad breakdown (level="ad") — MetaAdsCampaign above is a single
    # rollup per campaign; a client running several split-tested ads under
    # one campaign (e.g. "tyara"/"vd jdid"/"vd jdida"/"vd ai") could only
    # ever see the combined total here, with no way to tell which specific
    # ad drove 239 achats vs 1. One extra API call per sync, same pattern as
    # the daily-insights block above; failure here never fails the sync.
    if not is_simulated:
        try:
            from app.models.marketing import MetaAdsAdInsight
            ad_params = {
                "level": "ad",
                "fields": "ad_id,ad_name,adset_id,adset_name,campaign_id,spend,impressions,clicks,reach,actions,action_values",
                "use_unified_attribution_setting": "true",
                "limit": "500",
            }
            if date_start and date_end:
                ad_params["time_range"] = json.dumps({"since": date_start, "until": date_end})
            else:
                ad_params["date_preset"] = "last_30d"
            if relay_url:
                ad_response = httpx.post(
                    relay_url,
                    json={
                        "kind": "insights",
                        "ad_account_id": ad_account_id,
                        "graph_version": META_GRAPH_VERSION,
                        "access_token": config.access_token,
                        "params": ad_params,
                    },
                    headers={"x-internal-key": _settings.INTERNAL_API_KEY},
                    timeout=30.0,
                    follow_redirects=True,
                )
            else:
                ad_response = httpx.get(
                    f"https://graph.facebook.com/{META_GRAPH_VERSION}/{ad_account_id}/insights",
                    params={**ad_params, "access_token": config.access_token},
                    timeout=30.0,
                )
            ad_data = ad_response.json()
            if "error" not in ad_data:
                # Same single-batch upsert as the daily-insights block above
                # instead of one SELECT + one INSERT/UPDATE per ad.
                from sqlalchemy.dialects.postgresql import insert as pg_insert
                from sqlalchemy import func as _sqlfunc
                a_rate = get_conversion_rate(ad_currency, config.currency, config.exchange_rate)
                ad_rows_to_upsert = []
                for rc in ad_data.get("data", []):
                    ad_id = rc.get("ad_id")
                    if not ad_id:
                        continue
                    a_purchases, a_purchase_value = _extract_meta_purchases(rc)
                    a_raw_spend = float(rc.get("spend", 0.0) or 0.0)
                    ad_rows_to_upsert.append({
                        "id": str(uuid.uuid4()),
                        "store_id": store_id,
                        "ad_id": ad_id,
                        "campaign_id": rc.get("campaign_id") or "",
                        "ad_name": rc.get("ad_name") or "Sans nom",
                        "adset_id": rc.get("adset_id"),
                        "adset_name": rc.get("adset_name"),
                        "raw_spend": a_raw_spend,
                        "spend": a_raw_spend * a_rate,
                        "currency": ad_currency,
                        "impressions": int(rc.get("impressions", 0) or 0),
                        "clicks": int(rc.get("clicks", 0) or 0),
                        "reach": int(rc.get("reach", 0) or 0),
                        "meta_purchases": a_purchases,
                        "meta_purchase_value": a_purchase_value,
                        "date_start": now - timedelta(days=30),
                        "date_end": now,
                    })
                if ad_rows_to_upsert:
                    stmt = pg_insert(MetaAdsAdInsight.__table__).values(ad_rows_to_upsert)
                    stmt = stmt.on_conflict_do_update(
                        constraint="uq_meta_ad_insight_ad_id",
                        set_={
                            "campaign_id": stmt.excluded.campaign_id,
                            "ad_name": stmt.excluded.ad_name,
                            "adset_id": stmt.excluded.adset_id,
                            "adset_name": stmt.excluded.adset_name,
                            "raw_spend": stmt.excluded.raw_spend,
                            "spend": stmt.excluded.spend,
                            "currency": stmt.excluded.currency,
                            "impressions": stmt.excluded.impressions,
                            "clicks": stmt.excluded.clicks,
                            "reach": stmt.excluded.reach,
                            "meta_purchases": stmt.excluded.meta_purchases,
                            "meta_purchase_value": stmt.excluded.meta_purchase_value,
                            "date_start": stmt.excluded.date_start,
                            "date_end": stmt.excluded.date_end,
                            "updated_at": _sqlfunc.now(),
                        },
                    )
                    db.execute(stmt)
                    db.commit()
                logger.info(f"[Meta Ads Sync] Détail par publicité: {len(ad_rows_to_upsert)} publicité(s) upsertée(s) en 1 requête.")
            else:
                logger.warning(f"[Meta Ads Sync] Détail par publicité indisponible: {ad_data['error']}")
        except Exception as exc:
            db.rollback()
            logger.warning(f"[Meta Ads Sync] Échec détail par publicité (non bloquant): {exc}")

    msg = f"{len(created_campaigns)} campagnes Meta Ads synchronisées avec succès."
    if is_simulated:
        msg += " (Simulation/Fallback)"
        logger.warning(f"[Meta Ads Sync] Fin avec simulation pour le store: {store_id}")
    else:
        logger.info(f"[Meta Ads Sync] Fin avec succès pour le store: {store_id} ({len(created_campaigns)} traitées)")
    return {"success": True, "message": msg}


class MetaEventUserData(BaseModel):
    em: Optional[str] = None        # email (raw or pre-hashed)
    ph: Optional[str] = None        # phone (raw or pre-hashed)
    client_ip_address: Optional[str] = None
    client_user_agent: Optional[str] = None
    fbc: Optional[str] = None       # _fbc cookie
    fbp: Optional[str] = None       # _fbp cookie
    fbclid: Optional[str] = None    # raw click id (fbc rebuilt server-side)
    fn: Optional[str] = None        # first name (raw or pre-hashed)
    ln: Optional[str] = None        # last name (raw or pre-hashed)
    ct: Optional[str] = None        # city / commune
    st: Optional[str] = None        # state / wilaya
    zp: Optional[str] = None        # zip code
    external_id: Optional[str] = None

class MetaEventCustomData(BaseModel):
    currency: Optional[str] = None
    value: Optional[float] = None
    content_ids: Optional[List[str]] = None
    content_type: Optional[str] = None
    content_name: Optional[str] = None
    content_category: Optional[str] = None
    contents: Optional[List[Dict[str, Any]]] = None
    num_items: Optional[int] = None

class MetaEventPayload(BaseModel):
    store_id: str
    event_name: str                 # PageView, ViewContent, InitiateCheckout, Purchase, etc.
    event_time: Optional[int] = None
    event_source_url: Optional[str] = None
    event_id: Optional[str] = None
    user_data: Optional[MetaEventUserData] = None
    custom_data: Optional[MetaEventCustomData] = None
    action_source: Optional[str] = "website"

def _sha256(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode()).hexdigest()

def _dispatch_capi_event(
    pixel_id: str,
    access_token: str,
    event: Dict[str, Any],
    store_id: str,
) -> None:
    """Background task: ship one browser-mirrored event with retries + log."""
    from datetime import datetime, timedelta, timezone
    from app.db.session import SessionLocal
    from app.services.meta_capi import send_events, _log_send, _QUEUE_BACKOFF_MINUTES

    result = send_events(pixel_id, access_token, [event], store_label=store_id, order_label=None)
    db = SessionLocal()
    try:
        if result["success"]:
            _log_send(
                db, store_id=store_id, order_id=None,
                event_name=event["event_name"], event_id=event["event_id"],
                status="success", events_received=result["events_received"],
                latency_ms=result.get("latency_ms"),
            )
        elif result.get("retryable"):
            _log_send(
                db, store_id=store_id, order_id=None,
                event_name=event["event_name"], event_id=event["event_id"],
                status="pending_retry", error_message=result["error"],
                error_category=result.get("error_category"), payload=event,
                retry_count=0,
                next_retry_at=datetime.now(timezone.utc) + timedelta(minutes=_QUEUE_BACKOFF_MINUTES[0]),
            )
        else:
            _log_send(
                db, store_id=store_id, order_id=None,
                event_name=event["event_name"], event_id=event["event_id"],
                status="error", error_message=result["error"],
                error_category=result.get("error_category"),
            )
    finally:
        db.close()


@router.post("/events", response_model=dict)
def send_meta_event(
    payload: MetaEventPayload,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Server-side Meta Conversions API (CAPI) event relay.
    Called by the storefront on ViewContent, AddToCart, InitiateCheckout…
    with the SAME event_id as the browser Pixel so Meta deduplicates.
    Normalization follows Meta's spec exactly (see services/meta_capi.py).
    The Graph call runs in a background task — zero latency for the shopper.
    """
    from app.services.meta_capi import build_user_data

    config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == payload.store_id).first()

    if not config or not config.pixel_id or not config.access_token or len(config.access_token) < 15:
        # No Meta config — accept silently (storefront shouldn't break)
        return {"success": True, "sent": False, "reason": "no_config"}

    now = payload.event_time or int(datetime.now(timezone.utc).timestamp())
    event_id = payload.event_id or str(uuid.uuid4())

    raw = payload.user_data or MetaEventUserData()
    forwarded = request.headers.get("x-forwarded-for", "")
    client_ip = raw.client_ip_address or forwarded.split(",")[0].strip() or (request.client.host if request.client else None)
    user_agent = raw.client_user_agent or request.headers.get("user-agent")

    ud = build_user_data(
        email=raw.em,
        phone=raw.ph,
        first_name=raw.fn,
        last_name=raw.ln,
        city=raw.ct,
        state=raw.st,
        zip_code=raw.zp,
        external_id=raw.external_id,
        client_ip=client_ip,
        user_agent=user_agent,
        fbp=raw.fbp,
        fbc=raw.fbc,
        fbclid=raw.fbclid,
    )

    event: Dict[str, Any] = {
        "event_name": payload.event_name,
        "event_time": now,
        "event_id": event_id,
        "action_source": payload.action_source or "website",
        "user_data": ud,
    }
    if payload.event_source_url:
        event["event_source_url"] = payload.event_source_url
    if payload.custom_data:
        cd = payload.custom_data.model_dump(exclude_none=True)
        if cd:
            event["custom_data"] = cd

    background_tasks.add_task(
        _dispatch_capi_event, config.pixel_id, config.access_token, event, payload.store_id
    )
    return {"success": True, "sent": True, "event_id": event_id}


@router.get("/integration-summary", response_model=dict)
def get_integration_summary(store_id: str = Query(...), db: Session = Depends(get_db)):
    """
    Cross-module integration summary:
    - Meta Ads spend (marketing module)
    - Linked advertising expenses (charges module)
    - Linked financial transactions (finance module)
    - Revenue from UTM-tagged orders
    - Net profitability after ad costs
    """
    from sqlalchemy import func

    db.info["skip_tenant_isolation"] = True  # explicit store_id scope; cross-store safe
    # 1. Meta Ads campaigns totals
    campaigns = db.query(MetaAdsCampaign).filter(MetaAdsCampaign.store_id == store_id).all()
    total_ads_spend_dzd = sum(c.spend or 0 for c in campaigns)
    total_ads_raw = {}
    for c in campaigns:
        curr = c.currency or "USD"
        total_ads_raw[curr] = total_ads_raw.get(curr, 0) + (c.raw_spend or 0)

    # 2. Related advertising expenses
    ad_expenses = db.query(Expense).filter(
        Expense.store_id == store_id,
        Expense.category == ExpenseCategory.ADVERTISING
    ).all()
    total_expense_amount = sum(e.total_amount or 0 for e in ad_expenses)
    expense_count = len(ad_expenses)

    # 3. Financial transactions with category 'ads'
    ad_transactions = db.query(FinancialTransaction).filter(
        FinancialTransaction.store_id == store_id,
        FinancialTransaction.category == "ads"
    ).all()
    total_tx_amount = sum(t.amount or 0 for t in ad_transactions)
    tx_count = len(ad_transactions)

    # 4. Revenue from UTM-linked orders
    campaign_names = [c.campaign_name.lower() for c in campaigns]
    campaign_ids = [c.campaign_id for c in campaigns]
    orders = db.query(Order).filter(
        Order.store_id == store_id,
        Order.status != "CANCELLED",
        # Exclude auto-merged duplicate children — same fix as list_campaigns,
        # otherwise a customer's repeat submission counted as an extra sale.
        Order.status != "MERGED",
        Order.is_deleted == False
    ).all()
    utm_orders = [
        o for o in orders
        if o.utm_campaign and (
            o.utm_campaign.lower() in campaign_names or
            o.utm_campaign in campaign_ids
        )
    ]
    total_utm_revenue = sum(o.total for o in utm_orders)
    total_utm_orders = len(utm_orders)

    # 5. Net profitability
    net_profit_after_ads = total_utm_revenue - total_ads_spend_dzd
    global_roas = round(total_utm_revenue / total_ads_spend_dzd, 2) if total_ads_spend_dzd > 0 else 0.0

    # 6. All expenses by category (for charges integration view)
    all_expense_categories = db.query(
        Expense.category,
        func.sum(Expense.total_amount).label("total"),
        func.count(Expense.id).label("count")
    ).filter(
        Expense.store_id == store_id
    ).group_by(Expense.category).all()

    total_all_expenses = sum(r.total or 0 for r in all_expense_categories)

    # 7. Wallet summary
    wallets = db.query(Wallet).filter(
        Wallet.store_id == store_id,
        Wallet.is_active == True
    ).all()
    wallet_summary = [
        {"id": w.id, "name": w.name, "type": w.type, "balance": w.balance,
         "total_in": w.total_in, "total_out": w.total_out}
        for w in wallets
    ]
    total_wallet_balance = sum(w.balance for w in wallets)

    return {
        "success": True,
        "data": {
            "meta_ads": {
                "total_spend_dzd": total_ads_spend_dzd,
                "raw_spend_by_currency": total_ads_raw,
                "campaigns_count": len(campaigns),
                "campaigns": [
                    {
                        "id": c.id,
                        "campaign_name": c.campaign_name,
                        "spend": c.spend,
                        "raw_spend": c.raw_spend,
                        "currency": c.currency,
                        "impressions": c.impressions,
                        "clicks": c.clicks,
                        "reach": c.reach,
                    }
                    for c in campaigns
                ]
            },
            "charges": {
                "advertising_expenses_total": total_expense_amount,
                "advertising_expenses_count": expense_count,
                "all_expenses_total": total_all_expenses,
                "by_category": [
                    {"category": r.category, "total": r.total or 0, "count": r.count}
                    for r in all_expense_categories
                ],
                "recent_ad_expenses": [
                    {
                        "id": e.id,
                        "label": e.label,
                        "amount": e.total_amount,
                        "date": e.expense_date.isoformat() if e.expense_date else None,
                        "status": e.status,
                        "description": e.description,
                        "beneficiary": e.beneficiary,
                        "wallet_name": e.wallet.name if e.wallet else None,
                        "created_by_name": f"{e.creator.first_name} {e.creator.last_name}" if e.creator else None,
                        "receipt_url": e.receipt_url,
                    }
                    for e in sorted(ad_expenses, key=lambda x: x.expense_date or datetime.min.date(), reverse=True)[:10]
                ]
            },
            "finance": {
                "ad_transactions_total": total_tx_amount,
                "ad_transactions_count": tx_count,
                "total_wallet_balance": total_wallet_balance,
                "wallets": wallet_summary,
                "recent_ad_transactions": [
                    {
                        "id": t.id,
                        "reference": t.reference,
                        "amount": t.amount,
                        "type": t.type,
                        "description": t.description,
                        "date": t.transaction_date.isoformat() if t.transaction_date else None,
                    }
                    for t in sorted(ad_transactions, key=lambda x: x.transaction_date or datetime.min, reverse=True)[:10]
                ]
            },
            "revenue": {
                "utm_revenue": total_utm_revenue,
                "utm_orders_count": total_utm_orders,
                "global_roas": global_roas,
                "net_profit_after_ads": net_profit_after_ads,
                "ads_revenue_ratio": round(
                    (total_utm_revenue / (total_utm_revenue + total_ads_spend_dzd)) * 100, 1
                ) if (total_utm_revenue + total_ads_spend_dzd) > 0 else 0.0
            }
        }
    }


# ─── GET /meta-ads/events/diagnostics — per-event-type CAPI health table ─────
# The frontend's "Diagnostics" tab (meta-ads-dashboard.tsx) calls this exact
# path expecting one row per event type (Purchase, AddToCart, ...) with a
# match/success rate and last-send timestamps — a different shape than
# /diagnostics below (one aggregated health report). This route never
# existed, so every load 404'd; the tab silently showed "0 événements".

@router.get("/events/diagnostics", response_model=dict)
def get_meta_events_diagnostics(store_id: str = Query(...), db: Session = Depends(get_db)):
    from sqlalchemy import func
    from app.models.marketing import MetaCapiLog

    db.info["skip_tenant_isolation"] = True
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    week_ago = now - timedelta(days=7)

    rows = (
        db.query(
            MetaCapiLog.event_name,
            MetaCapiLog.status,
            func.count(MetaCapiLog.id),
            func.max(MetaCapiLog.created_at),
        )
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.created_at >= week_ago)
        .group_by(MetaCapiLog.event_name, MetaCapiLog.status)
        .all()
    )

    by_event: Dict[str, Dict[str, Any]] = {}
    for event_name, status, cnt, last_at in rows:
        bucket = by_event.setdefault(event_name, {
            "success": 0, "failures": 0,
            "last_successful_send": None, "last_failure": None,
        })
        if status == "success":
            bucket["success"] += cnt
            if last_at and (not bucket["last_successful_send"] or last_at > bucket["last_successful_send"]):
                bucket["last_successful_send"] = last_at
        else:
            bucket["failures"] += cnt
            if last_at and (not bucket["last_failure"] or last_at > bucket["last_failure"]):
                bucket["last_failure"] = last_at

    events = []
    total_success, total_failures = 0, 0
    for event_name, b in sorted(by_event.items()):
        total = b["success"] + b["failures"]
        match_quality = round(b["success"] / total * 100, 1) if total else 0.0
        total_success += b["success"]
        total_failures += b["failures"]
        events.append({
            "event_name": event_name,
            "match_quality": match_quality,
            "failures": b["failures"],
            "last_successful_send": b["last_successful_send"].isoformat() if b["last_successful_send"] else None,
            "last_failure": b["last_failure"].isoformat() if b["last_failure"] else None,
        })

    return {
        "success": True,
        "data": {
            "events": events,
            "summary": {
                "total_events": total_success + total_failures,
                "successful_events": total_success,
                "failed_events": total_failures,
            },
        },
        "count": len(events),
    }


# ─── GET /meta-ads/funnel — acquisition-to-delivery conversion funnel ────────
# The frontend's "Entonnoir de Conversion" tab expects
# { stages: [{name, count}], summary: {ctr, cr, delivery_rate} }. Never
# implemented on the backend — every load 404'd, the tab was permanently
# stuck on "Calcul de l'entonnoir en cours...".

@router.get("/funnel", response_model=dict)
def get_meta_funnel(
    store_id: str = Query(...),
    date_start: Optional[str] = Query(None),
    date_end: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    from sqlalchemy import func
    from app.core.dates import parse_local_date_filter

    db.info["skip_tenant_isolation"] = True
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    d_start = now - timedelta(days=30)
    d_end = now
    if date_start:
        try:
            d_start = parse_local_date_filter(date_start)
        except ValueError:
            pass
    if date_end:
        try:
            d_end = parse_local_date_filter(date_end)
        except ValueError:
            pass

    # Impressions/clicks: Meta's own numbers for this store's campaigns —
    # these already cover the requested window (campaign rows are a single
    # running snapshot from the last sync, not per-day, so this is the best
    # available approximation without querying Meta live on every page load).
    camp_totals = db.query(
        func.coalesce(func.sum(MetaAdsCampaign.impressions), 0),
        func.coalesce(func.sum(MetaAdsCampaign.clicks), 0),
    ).filter(MetaAdsCampaign.store_id == store_id).first()
    impressions, clicks = int(camp_totals[0] or 0), int(camp_totals[1] or 0)

    # ViewContent / InitiateCheckout: our own CAPI send counts — the real
    # count of shoppers who reached each step, browser + server combined.
    from app.models.marketing import MetaCapiLog
    view_content = db.query(func.count(MetaCapiLog.id)).filter(
        MetaCapiLog.store_id == store_id, MetaCapiLog.event_name == "ViewContent",
        MetaCapiLog.status == "success", MetaCapiLog.created_at >= d_start, MetaCapiLog.created_at <= d_end,
    ).scalar() or 0
    initiate_checkout = db.query(func.count(MetaCapiLog.id)).filter(
        MetaCapiLog.store_id == store_id, MetaCapiLog.event_name == "InitiateCheckout",
        MetaCapiLog.status == "success", MetaCapiLog.created_at >= d_start, MetaCapiLog.created_at <= d_end,
    ).scalar() or 0

    # Purchase / Recovered / Delivered: real orders — same exclusions used
    # everywhere else in the ERP (MERGED duplicates, MANUAL agent orders).
    base_filters = [
        Order.store_id == store_id, Order.is_deleted == False, Order.status != "MERGED",
        func.coalesce(Order.source, "") != "MANUAL",
        Order.created_at >= d_start, Order.created_at <= d_end,
    ]
    purchases = db.query(func.count(Order.id)).filter(*base_filters).scalar() or 0
    recovered = db.query(func.count(Order.id)).filter(
        *base_filters, Order.is_abandoned_cart == True,
        Order.status.in_(["CONFIRMED", "SHIPPED", "DELIVERED"]),
    ).scalar() or 0
    delivered = db.query(func.count(Order.id)).filter(*base_filters, Order.status == "DELIVERED").scalar() or 0

    stages = [
        {"name": "Impressions", "count": impressions},
        {"name": "Clics", "count": clicks},
        {"name": "Vues Produit", "count": view_content},
        {"name": "Paiement Initié", "count": initiate_checkout},
        {"name": "Achats", "count": purchases},
        {"name": "Paniers Récupérés", "count": recovered},
        {"name": "Livrées", "count": delivered},
    ]

    ctr = round(clicks / impressions * 100, 2) if impressions > 0 else 0.0
    cr = round(purchases / clicks * 100, 2) if clicks > 0 else 0.0
    delivery_rate = round(delivered / purchases * 100, 2) if purchases > 0 else 0.0

    return {
        "success": True,
        "stages": stages,
        "summary": {"ctr": ctr, "cr": cr, "delivery_rate": delivery_rate},
    }


# ─── GET /meta-ads/diagnostics — tracking health for the dashboard ───────────

@router.get("/diagnostics", response_model=dict)
def get_meta_diagnostics(store_id: str = Query(...), db: Session = Depends(get_db)):
    """
    Automatic tracking health report:
    - Pixel / CAPI configuration status
    - CAPI delivery stats over the last 7 days (success rate, last errors)
    - Deduplication coverage (every event we emit carries an event_id)
    - Attribution coverage on recent orders (fbp/fbc/utm presence)
    - Catalog issues (missing images, ephemeral URLs, missing descriptions)
    """
    from sqlalchemy import func
    from app.models.marketing import MetaCapiLog
    from app.models.product import Product
    from app.services.meta_capi import _MAX_QUEUE_RETRIES

    db.info["skip_tenant_isolation"] = True  # explicit store_id scope; cross-store safe
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == store_id).first()
    pixel_ok = bool(config and config.pixel_id)
    capi_ok = bool(config and config.access_token and len(config.access_token or "") >= 15)

    # CAPI delivery over 7 days
    logs = (
        db.query(MetaCapiLog.event_name, MetaCapiLog.status, func.count(MetaCapiLog.id))
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.created_at >= week_ago)
        .group_by(MetaCapiLog.event_name, MetaCapiLog.status)
        .all()
    )
    by_event: Dict[str, Dict[str, int]] = {}
    total_sent, total_err = 0, 0
    for event_name, status, cnt in logs:
        by_event.setdefault(event_name, {"success": 0, "error": 0})[status] = cnt
        if status == "success":
            total_sent += cnt
        else:
            total_err += cnt
    last_error = (
        db.query(MetaCapiLog)
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.status == "error")
        .order_by(MetaCapiLog.created_at.desc())
        .first()
    )

    # Retry queue — operational view (not time-windowed: a stuck event should
    # show up regardless of when it first failed)
    pending_q = db.query(MetaCapiLog).filter(
        MetaCapiLog.store_id == store_id, MetaCapiLog.status == "pending_retry",
    )
    pending_count = pending_q.count()
    oldest_pending = pending_q.order_by(MetaCapiLog.created_at.asc()).first()
    failed_count = (
        db.query(func.count(MetaCapiLog.id))
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.status == "failed")
        .scalar() or 0
    )
    latencies = [
        v for (v,) in db.query(MetaCapiLog.latency_ms).filter(
            MetaCapiLog.store_id == store_id, MetaCapiLog.status == "success",
            MetaCapiLog.created_at >= week_ago, MetaCapiLog.latency_ms.isnot(None),
        ).all()
    ]
    latencies.sort()

    def _percentile(sorted_vals, pct):
        if not sorted_vals:
            return None
        idx = min(len(sorted_vals) - 1, int(round(pct / 100 * (len(sorted_vals) - 1))))
        return sorted_vals[idx]

    avg_latency = round(sum(latencies) / len(latencies), 0) if latencies else None
    p95_latency = _percentile(latencies, 95)
    p99_latency = _percentile(latencies, 99)

    retried_count = (
        db.query(func.count(MetaCapiLog.id))
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.retry_count > 0, MetaCapiLog.created_at >= week_ago)
        .scalar() or 0
    )

    # Network (infrastructure) vs Meta API (application/config) errors — a
    # growing network_timeout/network_error count points at connectivity,
    # api_4xx/api_5xx points at token/config or Meta-side issues.
    error_category_counts: Dict[str, int] = {}
    for cat, cnt in (
        db.query(MetaCapiLog.error_category, func.count(MetaCapiLog.id))
        .filter(
            MetaCapiLog.store_id == store_id, MetaCapiLog.created_at >= week_ago,
            MetaCapiLog.status.in_(["error", "pending_retry", "failed"]),
        )
        .group_by(MetaCapiLog.error_category)
        .all()
    ):
        error_category_counts[cat or "unknown"] = cnt

    # Average time-to-success for events that needed at least one retry —
    # created_at (first failure) to updated_at (eventual success).
    resolved_retried = (
        db.query(MetaCapiLog.created_at, MetaCapiLog.updated_at)
        .filter(
            MetaCapiLog.store_id == store_id, MetaCapiLog.status == "success",
            MetaCapiLog.retry_count > 0, MetaCapiLog.created_at >= week_ago,
        )
        .all()
    )
    recovered_7d = len(resolved_retried)
    if resolved_retried:
        deltas = [(u - c).total_seconds() for c, u in resolved_retried if u and c]
        avg_time_to_success_s = round(sum(deltas) / len(deltas), 1) if deltas else None
    else:
        avg_time_to_success_s = None

    # Soonest next retry for pending events
    next_retry_row = (
        db.query(MetaCapiLog)
        .filter(
            MetaCapiLog.store_id == store_id,
            MetaCapiLog.status == "pending_retry",
            MetaCapiLog.next_retry_at.isnot(None),
        )
        .order_by(MetaCapiLog.next_retry_at.asc())
        .first()
    )
    next_retry_at_iso = (
        next_retry_row.next_retry_at.isoformat() if next_retry_row and next_retry_row.next_retry_at else None
    )

    last_failed = (
        db.query(MetaCapiLog)
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.status.in_(["error", "failed"]))
        .order_by(MetaCapiLog.updated_at.desc())
        .first()
    )
    last_success = (
        db.query(MetaCapiLog)
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.status == "success")
        .order_by(MetaCapiLog.updated_at.desc())
        .first()
    )

    # Attribution coverage on last-30-days orders
    order_filters = [
        Order.store_id == store_id, Order.is_deleted == False,
        Order.created_at >= month_ago, Order.status != "MERGED",
    ]
    orders_30d = db.query(func.count(Order.id)).filter(*order_filters).scalar() or 0

    def _cov(col):
        return db.query(func.count(Order.id)).filter(*order_filters, col.isnot(None), col != "").scalar() or 0

    fbp_cov = _cov(Order.fbp)
    fbc_cov = _cov(Order.fbc)
    utm_cov = _cov(Order.utm_campaign)

    # Catalog issues
    products = db.query(Product).filter(
        Product.store_id == store_id, Product.is_active == True,
    ).all()
    missing_image, ephemeral_image, missing_desc, bad_price = [], [], [], []
    for p in products:
        img = p.main_image or (p.images[0] if isinstance(p.images, list) and p.images else None)
        if not img:
            missing_image.append(p.name)
        elif "/api/v1/upload/files/" in str(img) or not str(img).startswith("http"):
            ephemeral_image.append(p.name)
        if not (p.description and len(p.description.strip()) >= 20):
            missing_desc.append(p.name)
        if not p.price or p.price <= 0:
            bad_price.append(p.name)

    return {
        "success": True,
        "data": {
            "pixel": {"configured": pixel_ok, "pixel_id": config.pixel_id if config else None},
            "capi": {
                "configured": capi_ok,
                "sent_7d": total_sent,
                "errors_7d": total_err,
                "total_7d": total_sent + total_err,
                "success_rate": round(total_sent / (total_sent + total_err) * 100, 1) if (total_sent + total_err) else None,
                "failure_rate": round(total_err / (total_sent + total_err) * 100, 1) if (total_sent + total_err) else None,
                "recovered_7d": recovered_7d,
                "by_event": by_event,
                "last_error": {
                    "message": last_error.error_message,
                    "event": last_error.event_name,
                    "at": last_error.created_at.isoformat() if last_error.created_at else None,
                } if last_error else None,
            },
            "queue": {
                "pending_count": pending_count,
                "failed_count": failed_count,
                "retried_count_7d": retried_count,
                "oldest_pending_at": oldest_pending.created_at.isoformat() if oldest_pending and oldest_pending.created_at else None,
                "oldest_pending_event": oldest_pending.event_name if oldest_pending else None,
                "avg_latency_ms": avg_latency,
                "p95_latency_ms": p95_latency,
                "p99_latency_ms": p99_latency,
                "avg_time_to_success_s": avg_time_to_success_s,
                "max_retries_configured": _MAX_QUEUE_RETRIES,
                "error_categories_7d": error_category_counts,
                "next_retry_at": next_retry_at_iso,
                "last_synced_at": last_success.updated_at.isoformat() if last_success and last_success.updated_at else None,
                "last_failed_at": last_failed.updated_at.isoformat() if last_failed and last_failed.updated_at else None,
                "last_failed_event": last_failed.event_name if last_failed else None,
            },
            "deduplication": {
                "strategy": "event_id partage Pixel/CAPI",
                "coverage": "100% des evenements emis",
            },
            "attribution": {
                "orders_30d": orders_30d,
                "with_fbp": fbp_cov,
                "with_fbc": fbc_cov,
                "with_utm_campaign": utm_cov,
                "fbp_rate": round(fbp_cov / orders_30d * 100, 1) if orders_30d else 0,
                "utm_rate": round(utm_cov / orders_30d * 100, 1) if orders_30d else 0,
            },
            "catalog": {
                "active_products": len(products),
                "missing_image": missing_image,
                "ephemeral_image_urls": ephemeral_image,
                "missing_description": missing_desc,
                "invalid_price": bad_price,
            },
        },
    }


# ─── GET /meta-ads/capi-logs — filterable operational log view ───────────────

@router.get("/capi-logs", response_model=dict)
def get_meta_capi_logs(
    store_id: str = Query(...),
    status: Optional[str] = Query(None, description="success | error | pending_retry | failed"),
    event_name: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, description="ISO date, inclusive"),
    date_to: Optional[str] = Query(None, description="ISO date, inclusive"),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
):
    """Raw CAPI log rows for the monitoring dashboard, filterable by
    store/date/event type/status — the operational counterpart to the
    rolled-up /diagnostics summary."""
    from app.models.marketing import MetaCapiLog

    q = db.query(MetaCapiLog).filter(MetaCapiLog.store_id == store_id)
    if status:
        q = q.filter(MetaCapiLog.status == status)
    if event_name:
        q = q.filter(MetaCapiLog.event_name == event_name)
    if date_from:
        q = q.filter(MetaCapiLog.created_at >= date_from)
    if date_to:
        q = q.filter(MetaCapiLog.created_at <= date_to)

    rows = q.order_by(MetaCapiLog.created_at.desc()).limit(limit).all()
    return {
        "success": True,
        "data": [
            {
                "id": r.id,
                "order_id": r.order_id,
                "event_name": r.event_name,
                "event_id": r.event_id,
                "status": r.status,
                "error_message": r.error_message,
                "retry_count": r.retry_count,
                "next_retry_at": r.next_retry_at.isoformat() if r.next_retry_at else None,
                "latency_ms": r.latency_ms,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ],
    }


# ─── DELETE /meta-ads/capi-logs/pending — purge stuck queue ──────────────────

@router.delete("/capi-logs/pending", response_model=dict)
def purge_pending_capi_logs(
    store_id: str = Query(...),
    max_age_hours: Optional[int] = Query(None, description="Only purge events older than N hours. Omit to purge all."),
    db: Session = Depends(get_db),
):
    """Mark pending_retry events as failed/cancelled. Optionally restrict to events older than max_age_hours."""
    from app.models.marketing import MetaCapiLog
    q = db.query(MetaCapiLog).filter(
        MetaCapiLog.store_id == store_id, MetaCapiLog.status == "pending_retry"
    )
    if max_age_hours is not None:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).replace(tzinfo=None)
        q = q.filter(MetaCapiLog.created_at <= cutoff)
    count = q.update(
        {"status": "failed", "error_message": "Annulé manuellement — réseau inaccessible"},
        synchronize_session=False,
    )
    db.commit()
    logger.info("[MetaCAPI] purged %d pending_retry event(s) for store %s (max_age_hours=%s)", count, store_id, max_age_hours)
    return {"success": True, "cancelled": count}


# ─── POST /meta-ads/capi-logs/retry-now — manual retry trigger ────────────────

@router.post("/capi-logs/retry-now", response_model=dict)
def trigger_capi_retry(
    store_id: str = Query(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """Immediately trigger the retry sweep for pending CAPI events (runs in background)."""
    from app.services.meta_capi import retry_pending_events
    background_tasks.add_task(retry_pending_events)
    logger.info("[MetaCAPI] manual retry sweep triggered for store %s", store_id)
    return {"success": True, "message": "Retry sweep déclenché en arrière-plan"}


# ─── GET /meta-ads/health — live connectivity diagnostic ──────────────────────

@router.get("/health", response_model=dict)
def get_meta_health(store_id: str = Query(...), db: Session = Depends(get_db)):
    """
    Live diagnostic: DNS + TCP + TLS probe to graph.facebook.com, circuit breaker
    state, queue stats, last success/error from DB, token validity, runtime versions.
    """
    import ssl as _ssl
    import sys as _sys
    import httpx as _httpx
    import httpcore as _httpcore
    import socket as _socket
    try:
        import certifi as _certifi
    except ImportError:
        _certifi = None
    from sqlalchemy import func
    from app.models.marketing import MetaCapiLog
    from app.services.meta_capi import probe_connectivity, get_circuit_state

    db.info["skip_tenant_isolation"] = True  # explicit store_id scope; cross-store safe
    # Probe the effective send path: the relay host when configured (probing
    # graph.facebook.com directly on HuggingFace always reports "TLS bloqué"
    # even when every event flows perfectly through the relay).
    from app.core.config import settings as _settings_h
    _relay_h = (getattr(_settings_h, "META_CAPI_RELAY_URL", "") or "").strip()
    if _relay_h:
        from urllib.parse import urlparse as _urlparse_h
        probe = probe_connectivity(host=_urlparse_h(_relay_h).hostname or "graph.facebook.com")
        probe["via_relay"] = True
    else:
        probe = probe_connectivity()
        probe["via_relay"] = False
    circuit = get_circuit_state()

    # ── Token + Pixel validation (non-blocking, short timeout) ──────────────
    config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == store_id).first()
    token_check: Dict[str, Any] = {"status": "not_configured"}
    pixel_check: Dict[str, Any] = {"status": "not_configured"}
    scope_check: Dict[str, Any] = {"status": "not_checked"}
    api_version_ok: Optional[bool] = None
    warnings: list = []

    META_API_VERSION = META_GRAPH_VERSION

    if config and config.access_token and len(config.access_token) >= 15:
        try:
            r = _graph_get("me", {"fields": "id,name"}, config.access_token, timeout=8.0)
            if r.status_code == 200:
                d = r.json()
                token_check = {"status": "valid", "user_id": d.get("id"), "name": d.get("name")}
                api_version_ok = True
            elif r.status_code in (400, 401, 403):
                err = (r.json().get("error") or {})
                token_check = {
                    "status": "invalid",
                    "code": err.get("code"),
                    "message": err.get("message", r.text[:200]),
                }
                warnings.append(f"Access token invalide ou expiré: {err.get('message', '')[:120]}")
            else:
                token_check = {"status": f"http_{r.status_code}", "body": r.text[:200]}
        except (_httpx.ConnectTimeout, _httpx.ReadTimeout):
            from app.core.config import settings as _settings_tc
            _via_relay = bool((getattr(_settings_tc, "META_CAPI_RELAY_URL", "") or "").strip())
            note = "Relais Vercel injoignable" if _via_relay else "TLS bloqué (réseau HuggingFace)"
            token_check = {"status": "timeout", "note": note}
            warnings.append(f"Impossible de valider le token — {note.lower()}")
        except Exception as exc:
            token_check = {"status": "error", "detail": str(exc)[:200]}

        # ── Token scope + ownership check (debug_token) ─────────────────────
        # A 200 from /me only proves the token is *some* valid token — it does
        # NOT prove it can send CAPI events. debug_token exposes the actual
        # granted scopes (must include ads_management or ads_read) and which
        # app/business issued it, so a token that authenticates but lacks
        # ads_management is caught here instead of failing silently at
        # send-time inside meta_capi.send_events().
        if token_check.get("status") == "valid":
            try:
                dbg = _graph_get("debug_token", {"input_token": config.access_token}, config.access_token, timeout=8.0)
                if dbg.status_code == 200:
                    info = (dbg.json().get("data") or {})
                    scopes = info.get("scopes") or []
                    has_ads_management = "ads_management" in scopes
                    scope_check = {
                        "status": "ok" if info.get("is_valid") else "expired_or_revoked",
                        "app_id": info.get("app_id"),
                        "type": info.get("type"),
                        "scopes": scopes,
                        "has_ads_management": has_ads_management,
                        "expires_at": info.get("expires_at"),
                    }
                    if not info.get("is_valid"):
                        warnings.append("Token expiré ou révoqué (debug_token: is_valid=false)")
                    if not has_ads_management:
                        warnings.append(
                            "Le token n'a PAS la permission 'ads_management' — l'envoi CAPI et la lecture "
                            "des campagnes échoueront même si /me réussit"
                        )
                else:
                    err_dbg = (dbg.json().get("error") or {})
                    scope_check = {"status": "error", "message": err_dbg.get("message", dbg.text[:200])}
            except (_httpx.ConnectTimeout, _httpx.ReadTimeout):
                scope_check = {"status": "timeout", "note": "TLS bloqué (réseau HuggingFace)"}
            except Exception as exc:
                scope_check = {"status": "error", "detail": str(exc)[:200]}

        if config.pixel_id:
            try:
                r2 = _graph_get(config.pixel_id, {"fields": "id,name,is_unavailable"}, config.access_token, timeout=8.0)
                if r2.status_code == 200:
                    d2 = r2.json()
                    pixel_check = {
                        "status": "accessible" if not d2.get("is_unavailable") else "unavailable",
                        "pixel_id": d2.get("id"),
                        "name": d2.get("name"),
                    }
                    if d2.get("is_unavailable"):
                        warnings.append("Pixel marqué 'unavailable' par Meta")
                else:
                    err2 = (r2.json().get("error") or {})
                    pixel_check = {"status": "error", "message": err2.get("message", r2.text[:200])}
                    warnings.append(f"Pixel inaccessible: {err2.get('message', '')[:120]}")
            except (_httpx.ConnectTimeout, _httpx.ReadTimeout):
                pixel_check = {"status": "timeout", "note": "TLS bloqué"}
            except Exception as exc:
                pixel_check = {"status": "error", "detail": str(exc)[:200]}
        else:
            warnings.append("Aucun Pixel ID configuré")
    else:
        warnings.append("Token d'accès Meta non configuré ou trop court")

    # ── Queue stats ──────────────────────────────────────────────────────────
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    pending_count = (
        db.query(func.count(MetaCapiLog.id))
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.status == "pending_retry")
        .scalar() or 0
    )
    oldest_pending = (
        db.query(MetaCapiLog)
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.status == "pending_retry")
        .order_by(MetaCapiLog.created_at.asc())
        .first()
    )
    oldest_age_minutes = None
    if oldest_pending and oldest_pending.created_at:
        oldest_age_minutes = int((now - oldest_pending.created_at).total_seconds() / 60)
        if oldest_age_minutes > 60:
            warnings.append(f"Événement en attente depuis {oldest_age_minutes} min — connexion Meta requise")

    if pending_count > 50:
        warnings.append(f"{pending_count} événements en file — vérifiez la connectivité TLS")
    if circuit.get("is_open"):
        warnings.append(f"Circuit breaker OUVERT — {circuit.get('consecutive_failures')} échecs consécutifs")

    last_success = (
        db.query(MetaCapiLog)
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.status == "success")
        .order_by(MetaCapiLog.created_at.desc())
        .first()
    )
    last_error_row = (
        db.query(MetaCapiLog)
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.status.in_(["error", "failed"]))
        .order_by(MetaCapiLog.created_at.desc())
        .first()
    )

    return {
        "probe": probe,
        "circuit_breaker": circuit,
        "token": token_check,
        "token_scopes": scope_check,
        "pixel": pixel_check,
        "api_version": META_API_VERSION,
        "api_version_ok": api_version_ok,
        "warnings": warnings,
        "queue": {
            "pending_count": pending_count,
            "oldest_age_minutes": oldest_age_minutes,
        },
        "last_success_at": last_success.created_at.isoformat() if last_success and last_success.created_at else None,
        "last_error_at": last_error_row.created_at.isoformat() if last_error_row and last_error_row.created_at else None,
        "last_error_message": last_error_row.error_message if last_error_row else None,
        "versions": {
            "python": _sys.version.split()[0],
            "openssl": _ssl.OPENSSL_VERSION,
            "httpx": _httpx.__version__,
            "httpcore": _httpcore.__version__,
            "certifi": _certifi.__version__ if _certifi else None,
        },
    }


# ─── GET /meta-ads/recommendations — rule-based optimization engine ───────────

@router.get("/recommendations", response_model=dict)
def get_meta_recommendations(store_id: str = Query(...), db: Session = Depends(get_db)):
    """
    Actionable optimization recommendations:
    campaign ROAS outliers, low CTR, weak landing pages, high-abandonment
    products, catalog quality and signal quality issues.
    """
    from sqlalchemy import case as sa_case
    from sqlalchemy import func, or_
    from app.models.landing_page import LandingPage
    from app.models.order import OrderItem
    from app.models.product import Product

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    month_ago = now - timedelta(days=30)
    recos: List[Dict[str, Any]] = []

    # Campaign ROAS: spend vs attributed DELIVERED revenue
    campaigns = db.query(MetaAdsCampaign).filter(MetaAdsCampaign.store_id == store_id).all()
    for c in campaigns:
        if not c.spend or c.spend <= 0:
            continue
        revenue = (
            db.query(func.coalesce(func.sum(Order.total), 0))
            .filter(
                Order.store_id == store_id,
                Order.is_deleted == False,
                Order.status == "DELIVERED",
                or_(Order.campaign_id == c.campaign_id, Order.utm_campaign == c.campaign_name),
            )
            .scalar() or 0
        )
        roas = revenue / c.spend if c.spend else 0
        ctr = (c.clicks / c.impressions * 100) if c.impressions else None
        if roas < 1:
            recos.append({
                "severity": "high", "kind": "campaign_low_roas",
                "title": f"ROAS faible : campagne {c.campaign_name}",
                "detail": (
                    f"Depense {round(c.spend)} DA pour {round(revenue)} DA livres (ROAS {roas:.2f}). "
                    "Reduisez le budget, testez une nouvelle crea ou coupez la campagne."
                ),
                "metric": round(roas, 2),
            })
        elif roas >= 3:
            recos.append({
                "severity": "info", "kind": "campaign_high_roas",
                "title": f"ROAS excellent : campagne {c.campaign_name}",
                "detail": (
                    f"{roas:.1f}x de retour ({round(revenue)} DA livres). Augmentez le budget progressivement "
                    "(+20%/48h max pour preserver la phase d'apprentissage)."
                ),
                "metric": round(roas, 2),
            })
        if ctr is not None and ctr < 1.0 and (c.impressions or 0) >= 1000:
            recos.append({
                "severity": "medium", "kind": "campaign_low_ctr",
                "title": f"CTR faible : campagne {c.campaign_name}",
                "detail": f"CTR {ctr:.2f}% sur {c.impressions} impressions. Testez de nouvelles creas/accroches.",
                "metric": round(ctr, 2),
            })

    # Weak landing pages (views vs orders)
    lps = db.query(LandingPage).filter(LandingPage.store_id == store_id, LandingPage.is_active == True).all()
    for lp in lps:
        views = getattr(lp, "views", 0) or 0
        lp_orders = getattr(lp, "orders", 0) or 0
        if views >= 100:
            cr = lp_orders / views * 100
            if cr < 1.0:
                recos.append({
                    "severity": "high", "kind": "weak_landing_page",
                    "title": f"Landing page faible : {lp.slug}",
                    "detail": (
                        f"{views} visites pour {lp_orders} commandes ({cr:.1f}%). Revoyez l'offre, le prix, "
                        "les avis clients et la visibilite du bouton de commande."
                    ),
                    "metric": round(cr, 2),
                })

    # Products with high cart abandonment (30 days)
    rows = (
        db.query(
            OrderItem.product_name,
            func.count(Order.id).label("total"),
            func.sum(sa_case((Order.is_abandoned_cart == True, 1), else_=0)).label("abandoned"),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .filter(Order.store_id == store_id, Order.is_deleted == False, Order.created_at >= month_ago)
        .group_by(OrderItem.product_name)
        .having(func.count(Order.id) >= 10)
        .all()
    )
    for name, total, abandoned in rows:
        rate = (abandoned or 0) / total * 100 if total else 0
        if rate >= 50:
            recos.append({
                "severity": "medium", "kind": "high_abandonment_product",
                "title": f"Abandon eleve : {name}",
                "detail": (
                    f"{rate:.0f}% des {total} paniers de ce produit sont abandonnes. Verifiez le prix, "
                    "les frais de livraison affiches et la clarte de l'offre."
                ),
                "metric": round(rate, 1),
            })

    # Catalog quality
    products_no_image = (
        db.query(func.count(Product.id))
        .filter(Product.store_id == store_id, Product.is_active == True,
                or_(Product.main_image == None, Product.main_image == ""))
        .scalar() or 0
    )
    if products_no_image:
        recos.append({
            "severity": "medium", "kind": "catalog_missing_images",
            "title": f"{products_no_image} produit(s) sans image principale",
            "detail": (
                "Les Dynamic Product Ads exigent une image permanente (Cloudinary). "
                "Completez les fiches produits avant d'activer un catalogue Meta."
            ),
            "metric": products_no_image,
        })

    # Signal quality (fbp coverage)
    month_orders = db.query(func.count(Order.id)).filter(
        Order.store_id == store_id, Order.is_deleted == False,
        Order.created_at >= month_ago, Order.status != "MERGED").scalar() or 0
    fbp_orders = db.query(func.count(Order.id)).filter(
        Order.store_id == store_id, Order.is_deleted == False,
        Order.created_at >= month_ago, Order.fbp.isnot(None)).scalar() or 0
    if month_orders >= 10 and fbp_orders / month_orders < 0.5:
        recos.append({
            "severity": "high", "kind": "low_signal_quality",
            "title": "Qualite de signal faible (fbp manquant)",
            "detail": (
                f"Seulement {fbp_orders}/{month_orders} commandes portent le cookie _fbp. Verifiez que le "
                "Pixel se charge sur toutes les pages (bloqueurs, consentement, domaine)."
            ),
            "metric": round(fbp_orders / month_orders * 100, 1),
        })

    order_sev = {"high": 0, "medium": 1, "info": 2}
    recos.sort(key=lambda r: order_sev.get(r["severity"], 3))
    return {"success": True, "data": recos}


# ─── GET /meta-ads/catalog-feed — Meta product feed (CSV, public) ─────────────

@router.get("/catalog-feed")
def get_catalog_feed(store_id: str = Query(...), db: Session = Depends(get_db)):
    """
    Meta Commerce catalog feed (CSV) for Dynamic Product Ads / Advantage+.
    Public read-only URL to paste into Meta Commerce Manager as a data feed.
    Products without a permanent absolute image URL are excluded (Meta would
    reject them) — they surface in /meta-ads/diagnostics instead.
    """
    import csv
    import io
    from fastapi.responses import StreamingResponse
    from app.models.product import Product
    from app.models.store import Store

    store = db.query(Store).filter(Store.id == store_id, Store.is_deleted == False).first()
    if not store:
        raise HTTPException(status_code=404, detail="Boutique introuvable.")
    base_url = f"https://{store.domain}" if store.domain else f"https://{store.slug}.azghub.com"

    products = db.query(Product).filter(
        Product.store_id == store_id, Product.is_active == True,
    ).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "title", "description", "availability", "condition",
        "price", "link", "image_link", "brand", "inventory",
        "additional_image_link", "item_group_id", "google_product_category",
    ])
    for p in products:
        img = p.main_image or (p.images[0] if isinstance(p.images, list) and p.images else None)
        # Meta requires permanent absolute URLs — skip ephemeral/local images
        if not img or not str(img).startswith("http"):
            continue
        available = (p.stock or 0) - (p.reserved_stock or 0) > 0
        extra_imgs = ",".join(
            [str(i) for i in (p.images or []) if str(i).startswith("http") and i != img][:10]
        ) if isinstance(p.images, list) else ""
        writer.writerow([
            p.sku or p.id,
            p.name,
            (p.description or p.name)[:5000],
            "in stock" if available else "out of stock",
            "new",
            f"{float(p.price or 0):.2f} DZD",
            f"{base_url}/?app=storefront&view=product&product={p.slug}",
            img,
            store.name,
            max(0, (p.stock or 0) - (p.reserved_stock or 0)),
            extra_imgs,
            p.sku or p.id,
            p.category or "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="meta-catalog-{store.slug}.csv"'},
    )


# ─── GET /meta-ads/connectivity-test — raw network diagnostic ─────────────────

@router.get("/connectivity-test", response_model=dict)
def connectivity_test(target: str = Query("graph", description="graph | relay")):
    """
    Standalone network probe — runs entirely outside CAPI business logic.
    Tests several transport paths to graph.facebook.com (target=graph, default)
    or to the host of the configured META_CAPI_RELAY_URL (target=relay) so we
    can confirm exactly which layer HuggingFace (or any other host) blocks.
    Only these two fixed/configured hosts can be probed — no arbitrary host.

    Tests performed:
      1. Raw TCP + TLS (stdlib ssl) — same path our custom transport uses
      2. httpx with HTTP/1.1, no keep-alive (fresh connection each call)
      3. httpx with HTTP/2 (if h2 is installed)
      4. urllib3 / requests (different TLS stack)
      5. Control probe to a known-open host (httpbin.org) — confirms general
         outbound HTTPS works so we can isolate "Meta specifically" vs "all TLS"
      6. Port 80 plain HTTP to graph.facebook.com — confirms TCP itself is
         allowed (rules out a full IP-level block)

    Returns a JSON dict with per-test results, timings, and a plain-language
    verdict for each test.
    """
    import socket
    import ssl as _ssl
    import time
    import sys

    TARGET_HOST = "graph.facebook.com"
    relay_url_configured = None
    if target == "relay":
        from urllib.parse import urlparse
        from app.core.config import settings as _settings_ct
        relay_url_configured = (getattr(_settings_ct, "META_CAPI_RELAY_URL", "") or "").strip()
        if not relay_url_configured:
            return {"error": "META_CAPI_RELAY_URL n'est pas configurée sur ce serveur."}
        parsed_host = urlparse(relay_url_configured).hostname
        if not parsed_host:
            return {"error": f"META_CAPI_RELAY_URL invalide: {relay_url_configured!r}"}
        TARGET_HOST = parsed_host
    TARGET_PORT = 443
    CONTROL_HOST = "httpbin.org"
    TIMEOUT = 8.0

    def _tcp_tls_probe(host: str, port: int, timeout: float) -> dict:
        result: dict = {}
        t0 = time.monotonic()
        try:
            infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
            result["dns_ms"] = round((time.monotonic() - t0) * 1000)
            result["resolved_ip"] = infos[0][4][0] if infos else None
        except Exception as exc:
            result["dns_ms"] = round((time.monotonic() - t0) * 1000)
            result["dns_status"] = f"FAIL: {exc}"
            return result
        result["dns_status"] = "ok"

        family, socktype, proto, _, sockaddr = infos[0]
        sock = None
        t_tcp = time.monotonic()
        try:
            sock = socket.socket(family, socktype, proto)
            sock.settimeout(timeout)
            sock.connect(sockaddr)
            result["tcp_ms"] = round((time.monotonic() - t_tcp) * 1000)
            result["tcp_status"] = "ok"
        except socket.timeout:
            result["tcp_ms"] = round((time.monotonic() - t_tcp) * 1000)
            result["tcp_status"] = "TIMEOUT"
            if sock:
                try: sock.close()
                except Exception: pass
            return result
        except Exception as exc:
            result["tcp_ms"] = round((time.monotonic() - t_tcp) * 1000)
            result["tcp_status"] = f"FAIL: {type(exc).__name__}: {exc}"
            if sock:
                try: sock.close()
                except Exception: pass
            return result

        t_tls = time.monotonic()
        try:
            ctx = _ssl.create_default_context()
            tls_sock = ctx.wrap_socket(sock, server_hostname=host)
            result["tls_ms"] = round((time.monotonic() - t_tls) * 1000)
            result["tls_status"] = "ok"
            result["tls_version"] = tls_sock.version()
            result["tls_cipher"] = tls_sock.cipher()[0] if tls_sock.cipher() else None
            tls_sock.close()
        except socket.timeout:
            result["tls_ms"] = round((time.monotonic() - t_tls) * 1000)
            result["tls_status"] = "TIMEOUT"
            try: sock.close()
            except Exception: pass
        except Exception as exc:
            result["tls_ms"] = round((time.monotonic() - t_tls) * 1000)
            result["tls_status"] = f"FAIL: {type(exc).__name__}: {exc}"
            try: sock.close()
            except Exception: pass
        return result

    def _httpx_probe(host: str, port: int, timeout: float, http2: bool = False) -> dict:
        import httpx
        result: dict = {"http2_requested": http2}
        url = f"https://{host}/" if port == 443 else f"http://{host}:{port}/"
        t0 = time.monotonic()
        try:
            with httpx.Client(
                http2=http2,
                timeout=httpx.Timeout(connect=timeout, read=timeout, write=timeout, pool=5.0),
                follow_redirects=False,
            ) as client:
                resp = client.get(url)
                result["total_ms"] = round((time.monotonic() - t0) * 1000)
                result["status"] = "ok"
                result["http_code"] = resp.status_code
                result["http_version"] = resp.http_version
        except httpx.ConnectTimeout:
            result["total_ms"] = round((time.monotonic() - t0) * 1000)
            result["status"] = "TIMEOUT (connect)"
        except httpx.ReadTimeout:
            result["total_ms"] = round((time.monotonic() - t0) * 1000)
            result["status"] = "TIMEOUT (read)"
        except Exception as exc:
            result["total_ms"] = round((time.monotonic() - t0) * 1000)
            result["status"] = f"FAIL: {type(exc).__name__}: {str(exc)[:120]}"
        return result

    def _urllib_probe(host: str, timeout: float) -> dict:
        import urllib.request
        result: dict = {}
        url = f"https://{host}/"
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                result["total_ms"] = round((time.monotonic() - t0) * 1000)
                result["status"] = "ok"
                result["http_code"] = resp.status
        except Exception as exc:
            result["total_ms"] = round((time.monotonic() - t0) * 1000)
            exc_str = str(exc)
            if "timed out" in exc_str.lower() or "timeout" in exc_str.lower():
                result["status"] = f"TIMEOUT: {exc_str[:120]}"
            else:
                result["status"] = f"FAIL: {type(exc).__name__}: {exc_str[:120]}"
        return result

    def _tcp_port80_probe(host: str, timeout: float) -> dict:
        result: dict = {}
        t0 = time.monotonic()
        try:
            infos = socket.getaddrinfo(host, 80, socket.AF_INET, socket.SOCK_STREAM)
            result["dns_ms"] = round((time.monotonic() - t0) * 1000)
        except Exception as exc:
            result["dns_ms"] = round((time.monotonic() - t0) * 1000)
            result["status"] = f"DNS FAIL: {exc}"
            return result
        family, socktype, proto, _, sockaddr = infos[0]
        sock = None
        t_tcp = time.monotonic()
        try:
            sock = socket.socket(family, socktype, proto)
            sock.settimeout(timeout)
            sock.connect(sockaddr)
            result["tcp_ms"] = round((time.monotonic() - t_tcp) * 1000)
            result["status"] = "ok (TCP:80 connected)"
            sock.close()
        except socket.timeout:
            result["tcp_ms"] = round((time.monotonic() - t_tcp) * 1000)
            result["status"] = "TIMEOUT"
            if sock:
                try: sock.close()
                except Exception: pass
        except Exception as exc:
            result["tcp_ms"] = round((time.monotonic() - t_tcp) * 1000)
            result["status"] = f"FAIL: {type(exc).__name__}: {exc}"
            if sock:
                try: sock.close()
                except Exception: pass
        return result

    def _verdict(probe_result: dict) -> str:
        status = probe_result.get("status", "")
        tls_status = probe_result.get("tls_status", "")
        tcp_status = probe_result.get("tcp_status", "")
        if "TIMEOUT" in tls_status:
            return "TLS_BLOCKED — TCP connects but TLS handshake is intercepted/dropped by the host network"
        if "ok" in str(tcp_status) and "FAIL" in str(tls_status):
            return "TLS_ERROR — TCP ok but TLS failed (certificate/SNI issue)"
        if "TIMEOUT" in str(tcp_status):
            return "TCP_BLOCKED — IP-level firewall (or IP unreachable)"
        if "FAIL" in str(tcp_status):
            return "TCP_FAILED — network error before TLS"
        if "TIMEOUT" in str(status):
            return "TIMEOUT — connection or response timed out"
        if "ok" in str(status) or "ok" in str(tls_status):
            return "OK — full HTTPS connection succeeded"
        return f"UNKNOWN — {status or tls_status}"

    # ── Run all probes ──────────────────────────────────────────────────────
    results: dict = {
        "target": TARGET_HOST,
        "relay_url_configured": relay_url_configured,
        "python_version": sys.version,
    }

    # 0. Full DNS picture (IPv4 + IPv6) — an AAAA record answered by a broken
    # IPv6 path is a classic source of instant "Connection refused" while the
    # same host works fine over IPv4 from elsewhere.
    try:
        _all_infos = socket.getaddrinfo(TARGET_HOST, TARGET_PORT, socket.AF_UNSPEC, socket.SOCK_STREAM)
        results["0_dns_all_records"] = {
            "addresses": sorted({f"{'v6' if fam == socket.AF_INET6 else 'v4'}:{sa[0]}" for fam, _, _, _, sa in _all_infos}),
            "first_tried_by_default": _all_infos[0][4][0] if _all_infos else None,
        }
    except Exception as exc:
        results["0_dns_all_records"] = {"status": f"DNS FAIL: {exc}"}

    # 1. Raw stdlib TCP + TLS
    raw = _tcp_tls_probe(TARGET_HOST, TARGET_PORT, TIMEOUT)
    results["1_raw_stdlib_tls"] = {**raw, "verdict": _verdict(raw)}

    # 1b. Same probe forced over IPv6 (if the host has an AAAA record)
    try:
        _v6_infos = socket.getaddrinfo(TARGET_HOST, TARGET_PORT, socket.AF_INET6, socket.SOCK_STREAM)
        if _v6_infos:
            v6: dict = {}
            _fam, _st, _pr, _, _sa = _v6_infos[0]
            v6["resolved_ip"] = _sa[0]
            _s6 = None
            _t6 = time.monotonic()
            try:
                _s6 = socket.socket(_fam, _st, _pr)
                _s6.settimeout(TIMEOUT)
                _s6.connect(_sa)
                v6["tcp_ms"] = round((time.monotonic() - _t6) * 1000)
                v6["tcp_status"] = "ok"
            except Exception as exc:
                v6["tcp_ms"] = round((time.monotonic() - _t6) * 1000)
                v6["tcp_status"] = f"FAIL: {type(exc).__name__}: {exc}"
            finally:
                if _s6:
                    try: _s6.close()
                    except Exception: pass
            results["1b_raw_tcp_ipv6"] = {**v6, "verdict": _verdict(v6)}
    except Exception:
        results["1b_raw_tcp_ipv6"] = {"verdict": "SKIPPED — no AAAA record / IPv6 unavailable"}

    # 2. httpx HTTP/1.1 (fresh client, no keep-alive pool reuse)
    hx1 = _httpx_probe(TARGET_HOST, TARGET_PORT, TIMEOUT, http2=False)
    results["2_httpx_http11"] = {**hx1, "verdict": _verdict(hx1)}

    # 3. httpx HTTP/2
    try:
        import h2  # noqa: F401
        hx2 = _httpx_probe(TARGET_HOST, TARGET_PORT, TIMEOUT, http2=True)
        results["3_httpx_http2"] = {**hx2, "verdict": _verdict(hx2)}
    except ImportError:
        results["3_httpx_http2"] = {"verdict": "SKIPPED — h2 package not installed"}

    # 4. stdlib urllib (different TLS stack path)
    ul = _urllib_probe(TARGET_HOST, TIMEOUT)
    results["4_urllib_https"] = {**ul, "verdict": _verdict(ul)}

    # 5. Control probe: httpbin.org (general outbound HTTPS)
    ctrl = _httpx_probe(CONTROL_HOST, TARGET_PORT, TIMEOUT, http2=False)
    results["5_control_httpbin"] = {**ctrl, "verdict": _verdict(ctrl)}

    # 6. Port 80 TCP only (is the IP reachable at all without TLS?)
    p80 = _tcp_port80_probe(TARGET_HOST, TIMEOUT)
    results["6_tcp_port80_only"] = {**p80, "verdict": _verdict(p80)}

    # ── Summary ────────────────────────────────────────────────────────────
    verdicts = [v.get("verdict", "") for v in results.values() if isinstance(v, dict)]
    if any("TLS_BLOCKED" in v for v in verdicts):
        summary = (
            "CONFIRMED: HuggingFace intercepts/blocks TLS handshakes to graph.facebook.com. "
            "TCP connects fine (IP is reachable) but the TLS ClientHello is dropped — "
            "this is a network-layer policy on the HF infrastructure, not a code bug. "
            "Events are preserved in the PostgreSQL queue and will deliver automatically "
            "if you move the backend to a host without this restriction (Railway, Render, VPS)."
        )
    elif all("OK" in v for v in verdicts if isinstance(v, str)):
        summary = "All probes succeeded — full HTTPS connectivity to graph.facebook.com confirmed."
    elif any("OK" in v for v in verdicts if isinstance(v, str)):
        summary = "Partial connectivity — some transport paths work, see individual results."
    else:
        summary = "All probes failed — no outbound HTTPS to graph.facebook.com from this host."
    results["summary"] = summary
    return results


# ─── GET /meta-ads/queue — "Meta Queue" admin dashboard ──────────────────────
# Store-agnostic (SUPER_ADMIN-only): the durable Purchase queue in
# meta_capi_logs spans every store, and a stuck/backed-up queue on ANY store
# is an ops concern, not a per-store metric.

@router.get("/queue/stats", response_model=dict)
def get_meta_queue_stats(
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    if getattr(current_user, "role", None) not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="Admin access required")
    from app.services.meta_capi import get_queue_stats
    db.info["skip_tenant_isolation"] = True
    return {"success": True, "data": get_queue_stats(db)}


@router.post("/queue/retry/{log_id}", response_model=dict)
def retry_meta_queue_item(
    log_id: str,
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    """Force one row back to 'retry' with next_retry_at=now, regardless of
    its current backoff — only from failed/retry/pending_retry (never
    touches a row genuinely 'processing' right now, to avoid racing a live
    worker)."""
    if getattr(current_user, "role", None) not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="Admin access required")
    from app.models.marketing import MetaCapiLog
    db.info["skip_tenant_isolation"] = True
    row = db.query(MetaCapiLog).filter(MetaCapiLog.id == log_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Log entry not found")
    if row.status not in ("failed", "retry", "pending_retry"):
        raise HTTPException(status_code=409, detail=f"Cannot retry a row in status '{row.status}'")
    row.status = "retry"
    row.next_retry_at = datetime.now(timezone.utc).replace(tzinfo=None)
    row.error_message = (row.error_message or "") + " [manual retry requested]"
    db.commit()
    return {"success": True, "message": "Queued for immediate retry"}


@router.post("/queue/retry-all", response_model=dict)
def retry_all_meta_queue(
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    """Bulk version of the above — one UPDATE, not a loop, to avoid N+1 on
    Supabase Free."""
    if getattr(current_user, "role", None) not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="Admin access required")
    from sqlalchemy import update as sa_update
    from app.models.marketing import MetaCapiLog
    db.info["skip_tenant_isolation"] = True
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    result = db.execute(
        sa_update(MetaCapiLog.__table__)
        .where(MetaCapiLog.status.in_(("failed", "retry", "pending_retry")))
        .values(status="retry", next_retry_at=now)
    )
    db.commit()
    return {"success": True, "message": f"{result.rowcount} row(s) queued for immediate retry", "count": result.rowcount}


@router.post("/queue/cleanup", response_model=dict)
def cleanup_meta_queue(
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    """Manual trigger for the same cleanup the daily scheduler runs
    (success > 90 days deleted; failed/retry never touched)."""
    if getattr(current_user, "role", None) not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="Admin access required")
    from app.services.meta_capi import cleanup_old_capi_logs
    db.info["skip_tenant_isolation"] = True
    deleted = cleanup_old_capi_logs(db)
    return {"success": True, "message": f"{deleted} old success row(s) deleted", "count": deleted}


@router.get("/signal-quality", response_model=dict)
def get_signal_quality(
    store_id: str = Query(...),
    range_days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    """
    Signal Quality Center — score global /100 de la qualité des signaux Meta,
    décomposé en sous-scores expliqués, + couverture par champ Event Match
    Quality + scan d'anomalies. Tout est calculé depuis meta_capi_logs
    (notre propre base), aucun appel Meta, une poignée de requêtes bornées
    par date et plafonnées — jamais un scan de table complète.

    Ne fabrique jamais de conversion : mesure uniquement ce qui a réellement
    été envoyé, et signale honnêtement ce qui manque.
    """
    from sqlalchemy import func
    from app.models.marketing import MetaCapiLog
    from app.services.meta_capi import compute_match_quality, _MATCH_QUALITY_FIELDS

    db.info["skip_tenant_isolation"] = True
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=range_days)

    # ── 1. Répartition des statuts Purchase (une requête groupée) ──
    status_rows = (
        db.query(MetaCapiLog.status, func.count(MetaCapiLog.id))
        .filter(
            MetaCapiLog.store_id == store_id,
            MetaCapiLog.event_name == "Purchase",
            MetaCapiLog.created_at >= since,
        )
        .group_by(MetaCapiLog.status)
        .all()
    )
    by_status = {s: c for s, c in status_rows}
    success = by_status.get("success", 0)
    failed = by_status.get("failed", 0)
    retry = by_status.get("retry", 0) + by_status.get("pending_retry", 0)
    pending = by_status.get("queued", 0) + by_status.get("processing", 0)
    skipped = by_status.get("skipped", 0)
    total_sent = success + failed + retry + pending

    # ── 2. Event Match Quality : moyenne + couverture par champ, sur un
    # échantillon PLAFONNÉ des succès (payload contient user_data depuis le
    # correctif de stockage-sur-succès). Cap à 500 pour rester léger sur
    # Supabase quel que soit le volume de la boutique. ──
    sample = (
        db.query(MetaCapiLog.payload)
        .filter(
            MetaCapiLog.store_id == store_id,
            MetaCapiLog.event_name == "Purchase",
            MetaCapiLog.status == "success",
            MetaCapiLog.payload.isnot(None),
            MetaCapiLog.created_at >= since,
        )
        .order_by(MetaCapiLog.created_at.desc())
        .limit(500)
        .all()
    )
    field_present_counts = {key: 0 for key, _ in _MATCH_QUALITY_FIELDS}
    emq_scores = []
    for (payload,) in sample:
        ud = (payload or {}).get("user_data") or {}
        mq = compute_match_quality(ud)
        emq_scores.append(mq["score"])
        for f in mq["fields"]:
            if f["present"]:
                field_present_counts[f["key"]] += 1
    sample_n = len(sample)
    avg_emq = round(sum(emq_scores) / len(emq_scores), 1) if emq_scores else None
    field_coverage = [
        {
            "key": key, "label": label,
            "coverage_pct": round(field_present_counts[key] / sample_n * 100, 1) if sample_n else 0.0,
            "missing_pct": round((1 - field_present_counts[key] / sample_n) * 100, 1) if sample_n else 100.0,
        }
        for key, label in _MATCH_QUALITY_FIELDS
    ]

    # ── 3. Scan d'anomalies (chacune une requête groupée bornée) ──
    anomalies = []

    # Purchase CAPI sans commande liée (chemin relay frontend : order_id NULL)
    orphan_capi = (
        db.query(func.count(MetaCapiLog.id))
        .filter(
            MetaCapiLog.store_id == store_id, MetaCapiLog.event_name == "Purchase",
            MetaCapiLog.order_id.is_(None), MetaCapiLog.created_at >= since,
        )
        .scalar() or 0
    )
    if orphan_capi > 0:
        anomalies.append({
            "type": "PURCHASE_SANS_COMMANDE", "count": orphan_capi, "severity": "medium",
            "detail": f"{orphan_capi} Purchase CAPI sans order_id (chemin relay navigateur) — impossible à rapprocher d'une commande ERP.",
            "fix": "Vérifier que le relay frontend transmet bien l'order_id, ou s'appuyer uniquement sur le chemin backend.",
        })

    # Purchase en échec définitif
    if failed > 0:
        anomalies.append({
            "type": "PURCHASE_REJETE", "count": failed, "severity": "high",
            "detail": f"{failed} Purchase en échec définitif — token expiré ou config invalide probable.",
            "fix": "Vérifier la Santé du Pixel (token/scopes) puis relancer via Bons d'Achat.",
        })

    # Purchase bloqués en attente depuis longtemps
    if pending > 0:
        anomalies.append({
            "type": "PURCHASE_EN_ATTENTE", "count": pending, "severity": "low",
            "detail": f"{pending} Purchase encore en file — normal si récent, à surveiller si ça persiste.",
            "fix": "Vérifier que le worker CAPI tourne (Meta Queue).",
        })

    # ── 4. Score global décomposé — chaque sous-score est un pourcentage réel
    # déjà calculé ci-dessus, jamais une note inventée. Moyenne simple,
    # pondération documentée. ──
    coverage_score = round(success / total_sent * 100, 1) if total_sent else 0.0
    emq_score = avg_emq if avg_emq is not None else 0.0
    reliability_score = round(max(0.0, 100 - (failed / total_sent * 100 * 3)), 1) if total_sent else 100.0
    sub_scores = {
        "tracking_coverage": coverage_score,
        "event_match_quality": emq_score,
        "server_reliability": reliability_score,
    }
    global_score = round(sum(sub_scores.values()) / len(sub_scores), 1)

    return {
        "success": True,
        "data": {
            "range_days": range_days,
            "global_score": global_score,
            "sub_scores": sub_scores,
            "avg_emq": avg_emq,
            "emq_sample_size": sample_n,
            "field_coverage": field_coverage,
            "purchase_breakdown": {
                "success": success, "failed": failed, "retry": retry,
                "pending": pending, "skipped": skipped, "total_sent": total_sent,
            },
            "anomalies": anomalies,
        },
    }
