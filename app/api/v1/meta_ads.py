from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from typing import Optional, List, Any, Dict
from datetime import datetime, timedelta, timezone
import uuid
import random
import logging
import hashlib

logger = logging.getLogger(__name__)

from app.api.deps import get_db
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

    # Simple parse dates if provided
    d_start, d_end = None, None
    if date_start and isinstance(date_start, str):
        try:
            d_start = datetime.fromisoformat(date_start.replace('Z', '+00:00'))
        except ValueError:
            pass
    if date_end and isinstance(date_end, str):
        try:
            d_end = datetime.fromisoformat(date_end.replace('Z', '+00:00'))
        except ValueError:
            pass

    campaigns = query.all()
    
    # Calculate ROAS based on orders with utm_campaign
    orders_query = db.query(Order).filter(
        Order.store_id == store_id,
        Order.status != "CANCELLED",
        Order.is_deleted == False
    )
    # Filter orders by period if requested
    # Note: we assume Order has a created_at column (added by final migrations)
    # Let's check or filter in Python for maximum compatibility.
    orders = orders_query.all()
    
    data = []
    global_spend = 0.0
    global_revenue = 0.0
    global_orders_count = 0

    for camp in campaigns:
        # Match order by campaign name (e.g. utm_campaign matches campaign_name or campaign_id)
        camp_orders = [
            o for o in orders
            if o.utm_campaign and (o.utm_campaign.lower() == camp.campaign_name.lower() or o.utm_campaign == camp.campaign_id)
        ]
        
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

        data.append({
            "id": camp.id,
            "campaign_id": camp.campaign_id,
            "campaign_name": camp.campaign_name,
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
            "date_start": camp.date_start.isoformat() if camp.date_start else None,
            "date_end": camp.date_end.isoformat() if camp.date_end else None
        })

    global_roas = round(global_revenue / global_spend, 2) if global_spend > 0 else 0.0

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
    for pid, data in product_attribution.items():
        data["roas"] = round(data["revenue"] / data["spend"], 2) if data["spend"] > 0 else 0.0
        if data["spend"] > 0 or data["revenue"] > 0 or data["impressions"] > 0 or data["orders_count"] > 0:
            breakdown_list.append(data)

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
            "global_profit": round(global_revenue - global_spend, 2)
        }
    }

def get_conversion_rate(ad_currency: str, config_currency: str, config_rate: float) -> float:
    ad_curr = ad_currency.upper() if ad_currency else "USD"
    cfg_curr = (config_currency or "USD").upper()
    cfg_rate = config_rate if config_rate is not None else 1.0
    
    if ad_curr == "DZD":
        return 1.0
        
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
def sync_meta_ads(store_id: str = Query(...), db: Session = Depends(get_db)):
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
        campaigns_data = [
            {
                "campaign_id": f"camp_mock_1_{store_id[:8]}",
                "campaign_name": "Campagne Hiver - Algérie (USD)",
                "spend": 145.50,
                "currency": "USD",
                "impressions": 150000,
                "clicks": 4200,
                "reach": 98000
            },
            {
                "campaign_id": f"camp_mock_2_{store_id[:8]}",
                "campaign_name": "Promo Printemps (EUR)",
                "spend": 88.00,
                "currency": "EUR",
                "impressions": 120000,
                "clicks": 3100,
                "reach": 81000
            },
            {
                "campaign_id": f"camp_mock_3_{store_id[:8]}",
                "campaign_name": "Fidélisation Clients (DZD)",
                "spend": 15000.00,
                "currency": "DZD",
                "impressions": 85000,
                "clicks": 1800,
                "reach": 64000
            }
        ]
    else:
        params = {
            "level": "campaign",
            "fields": "campaign_id,campaign_name,spend,impressions,clicks,reach,date_start,date_stop",
            "date_preset": "last_30d",
        }
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
                )
            else:
                url = f"https://graph.facebook.com/{META_GRAPH_VERSION}/{ad_account_id}/insights"
                response = httpx.get(url, params={**params, "access_token": config.access_token}, timeout=30.0)
            res_data = response.json()
            if "error" in res_data:
                logger.warning(f"[Meta Ads Sync] L'API Meta a retourné une erreur d'insights: {res_data['error']}")
                is_simulated = True
                campaigns_data = [
                    {
                        "campaign_id": f"camp_mock_1_{store_id[:8]}",
                        "campaign_name": "Campagne Hiver - Algérie (USD)",
                        "spend": 145.50,
                        "currency": "USD",
                        "impressions": 150000,
                        "clicks": 4200,
                        "reach": 98000
                    },
                    {
                        "campaign_id": f"camp_mock_2_{store_id[:8]}",
                        "campaign_name": "Promo Printemps (EUR)",
                        "spend": 88.00,
                        "currency": "EUR",
                        "impressions": 120000,
                        "clicks": 3100,
                        "reach": 81000
                    },
                    {
                        "campaign_id": f"camp_mock_3_{store_id[:8]}",
                        "campaign_name": "Fidélisation Clients (DZD)",
                        "spend": 15000.00,
                        "currency": "DZD",
                        "impressions": 85000,
                        "clicks": 1800,
                        "reach": 64000
                    }
                ]
            else:
                raw_camps = res_data.get("data", [])
                campaigns_data = []
                for rc in raw_camps:
                    campaigns_data.append({
                        "campaign_id": rc.get("campaign_id"),
                        "campaign_name": rc.get("campaign_name", "Sans nom"),
                        "spend": float(rc.get("spend", 0.0)),
                        "currency": ad_currency,
                        "impressions": int(rc.get("impressions", 0)),
                        "clicks": int(rc.get("clicks", 0)),
                        "reach": int(rc.get("reach", 0))
                    })
                logger.info(f"[Meta Ads Sync] Succès: {len(campaigns_data)} campagnes récupérées de Meta.")
        except Exception as e:
            logger.error(f"[Meta Ads Sync] Exception lors de la récupération des insights: {e}")
            is_simulated = True
            is_network_error = True
            campaigns_data = [
                {
                    "campaign_id": f"camp_mock_1_{store_id[:8]}",
                    "campaign_name": "Campagne Hiver - Algérie (USD)",
                    "spend": 145.50,
                    "currency": "USD",
                    "impressions": 150000,
                    "clicks": 4200,
                    "reach": 98000
                },
                {
                    "campaign_id": f"camp_mock_2_{store_id[:8]}",
                    "campaign_name": "Promo Printemps (EUR)",
                    "spend": 88.00,
                    "currency": "EUR",
                    "impressions": 120000,
                    "clicks": 3100,
                    "reach": 81000
                },
                {
                    "campaign_id": f"camp_mock_3_{store_id[:8]}",
                    "campaign_name": "Fidélisation Clients (DZD)",
                    "spend": 15000.00,
                    "currency": "DZD",
                    "impressions": 85000,
                    "clicks": 1800,
                    "reach": 64000
                }
            ]

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
    probe = probe_connectivity()
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
def connectivity_test():
    """
    Standalone network probe — runs entirely outside CAPI business logic.
    Tests several transport paths to graph.facebook.com so we can confirm
    exactly which layer HuggingFace (or any other host) blocks.

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
        "python_version": sys.version,
    }

    # 1. Raw stdlib TCP + TLS
    raw = _tcp_tls_probe(TARGET_HOST, TARGET_PORT, TIMEOUT)
    results["1_raw_stdlib_tls"] = {**raw, "verdict": _verdict(raw)}

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
