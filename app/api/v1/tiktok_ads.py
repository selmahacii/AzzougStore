from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta, timezone
import uuid
import logging

logger = logging.getLogger(__name__)

from app.api.deps import get_db
from app.models.marketing import TikTokAdsConfig, TikTokAdsCampaign
from app.models.order import Order

router = APIRouter()

TIKTOK_API_BASE = "https://business-api.tiktok.com/open_api/v1.3"


class TikTokAdsConfigCreate(BaseModel):
    store_id: str
    access_token: Optional[str] = None
    advertiser_id: Optional[str] = None
    pixel_id: Optional[str] = None
    app_id: Optional[str] = None
    is_connected: bool = False
    exchange_rate: Optional[float] = 1.0
    currency: Optional[str] = "USD"


def _config_out(config: TikTokAdsConfig) -> dict:
    return {
        "store_id": config.store_id,
        "access_token": config.access_token,
        "advertiser_id": config.advertiser_id,
        "pixel_id": config.pixel_id,
        "app_id": config.app_id,
        "is_connected": config.is_connected,
        "exchange_rate": config.exchange_rate if config.exchange_rate is not None else 1.0,
        "currency": config.currency or "USD",
    }


@router.get("/config", response_model=dict)
def get_tiktok_ads_config(store_id: str = Query(...), db: Session = Depends(get_db)):
    # Same fix already applied to meta-ads/config: explicitly scoped by the
    # store_id param, so bypass the SELECT tenant auto-filter. Without this,
    # whenever X-Store-Id (the active-store header) didn't match the
    # requested store_id, the tenant filter hid the EXISTING row, this
    # endpoint concluded "no config yet" and tried to re-INSERT it, and hit
    # the unique(store_id) constraint — the exact 409/IntegrityError seen
    # live for Trust Shop's config.
    db.info["skip_tenant_isolation"] = True
    config = db.query(TikTokAdsConfig).filter(TikTokAdsConfig.store_id == store_id).first()
    if not config:
        config = TikTokAdsConfig(
            id=str(uuid.uuid4()),
            store_id=store_id,
            access_token="",
            advertiser_id="",
            pixel_id="",
            app_id="",
            is_connected=False,
            exchange_rate=1.0,
            currency="USD",
        )
        db.add(config)
        try:
            db.commit()
        except IntegrityError:
            # Two requests for the same store_id (e.g. the storefront and the
            # admin dashboard both loading tiktok-ads/config in parallel) both
            # saw "no config yet" and both tried to insert — the loser hits
            # the store_id unique constraint and 500s/409s instead of just
            # returning the row the winner created. Roll back and read it.
            db.rollback()
            config = db.query(TikTokAdsConfig).filter(TikTokAdsConfig.store_id == store_id).first()
        else:
            db.refresh(config)
    return {"success": True, "data": _config_out(config)}


@router.post("/config", response_model=dict)
def update_tiktok_ads_config(payload: TikTokAdsConfigCreate, db: Session = Depends(get_db)):
    # Same rationale as the GET above: scoped explicitly by store_id, edited
    # across stores from the admin dashboard.
    db.info["skip_tenant_isolation"] = True
    config = db.query(TikTokAdsConfig).filter(TikTokAdsConfig.store_id == payload.store_id).first()
    if not config:
        config = TikTokAdsConfig(id=str(uuid.uuid4()), store_id=payload.store_id)
        db.add(config)

    config.access_token = payload.access_token
    config.advertiser_id = payload.advertiser_id
    config.pixel_id = payload.pixel_id
    config.app_id = payload.app_id
    config.is_connected = payload.is_connected
    config.exchange_rate = payload.exchange_rate if payload.exchange_rate is not None else 1.0
    config.currency = payload.currency or "USD"
    db.commit()
    db.refresh(config)
    return {"success": True, "data": _config_out(config)}


def _get_conversion_rate(ad_currency: str, config_currency: str, config_rate: float) -> float:
    """Same conversion logic as Meta Ads: convert the ad-account currency to DZD."""
    ad_curr = (ad_currency or "USD").upper()
    cfg_curr = (config_currency or "USD").upper()
    cfg_rate = config_rate if config_rate is not None else 1.0

    if ad_curr == "DZD":
        return 1.0
    if ad_curr == cfg_curr:
        return cfg_rate

    fallbacks = {"USD": 220.0, "EUR": 240.0, "CAD": 160.0, "GBP": 280.0}
    if cfg_curr in fallbacks and ad_curr in fallbacks:
        return round(cfg_rate * fallbacks[ad_curr] / fallbacks[cfg_curr], 2)
    if ad_curr in fallbacks:
        return fallbacks[ad_curr]
    return cfg_rate


def _simulated_campaigns(store_id: str) -> list:
    # NO mock data, ever — a failed/unconfigured TikTok connection returns an
    # empty list and the is_simulated early-return explains the problem.
    return []


@router.post("/sync", response_model=dict)
def sync_tiktok_ads(store_id: str = Query(...), db: Session = Depends(get_db)):
    """
    Sync campaign insights from the TikTok Business API for this store's
    advertiser account. Falls back to simulated data when the token is
    missing/invalid so the dashboard stays usable.
    """
    config = db.query(TikTokAdsConfig).filter(TikTokAdsConfig.store_id == store_id).first()
    logger.info(f"[TikTok Ads Sync] Démarrage pour le store: {store_id}")

    if not config or not config.is_connected or not config.access_token or not config.advertiser_id:
        logger.warning(f"[TikTok Ads Sync] Configuration incomplète pour le store: {store_id}")
        return {"success": False, "message": "TikTok Ads n'est pas configuré. Veuillez connecter votre compte."}

    import httpx

    ad_currency = None
    is_simulated = False
    is_network_error = False  # True = TLS/DNS/timeout reaching TikTok itself; False = credentials/API rejected us

    def _log_network_exception(step: str, exc: Exception) -> bool:
        """
        Log with enough detail to tell "TikTok's API is unreachable from this
        server" (network/TLS — the same class of problem Meta Ads hit,
        needing a relay) apart from "the token/advertiser_id is wrong" (a
        config problem the user needs to fix in the TikTok Ads dashboard
        connection form). Returns True if this looks like a network issue.
        """
        is_net = isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.RemoteProtocolError))
        logger.error(
            f"[TikTok Ads Sync] Exception {step} — type={type(exc).__name__} "
            f"network_error={is_net} détail={exc}"
        )
        if is_net:
            logger.error(
                "[TikTok Ads Sync] business-api.tiktok.com semble inaccessible depuis ce serveur "
                "(comme graph.facebook.com l'était avant le relais Vercel pour Meta Ads) — "
                "si ce message se répète, TikTok pourrait nécessiter le même relais réseau."
            )
        return is_net

    if len(config.access_token or "") < 15 or (config.access_token or "").startswith("dummy"):
        logger.warning(f"[TikTok Ads Sync] Access Token absent/factice pour le store: {store_id} — données simulées.")
        is_simulated = True
    else:
        # 1. Advertiser info (currency + name)
        try:
            resp = httpx.get(
                f"{TIKTOK_API_BASE}/advertiser/info/",
                params={"advertiser_ids": f'["{config.advertiser_id}"]'},
                headers={"Access-Token": config.access_token},
                timeout=15.0,
            )
            data = resp.json()
            if data.get("code") == 0 and data.get("data", {}).get("list"):
                info = data["data"]["list"][0]
                ad_currency = info.get("currency")
                logger.info(f"[TikTok Ads Sync] Compte: {info.get('name')} ({ad_currency})")
            else:
                logger.warning(
                    f"[TikTok Ads Sync] Erreur advertiser/info: code={data.get('code')} "
                    f"message={data.get('message')} — vérifiez Access Token / Advertiser ID."
                )
                is_simulated = True
        except Exception as e:
            is_network_error = _log_network_exception("advertiser/info", e)
            is_simulated = True

    if ad_currency:
        config.currency = ad_currency.upper()
        db.commit()
    else:
        ad_currency = config.currency or "USD"

    # 2. Campaign insights (last 30 days)
    if is_simulated:
        campaigns_data = _simulated_campaigns(store_id)
    else:
        _BASE_METRICS = ["spend", "impressions", "clicks", "reach", "campaign_name"]
        # TikTok's OWN attributed conversions (their pixel/events-API
        # attribution) — never requested before, so the dashboard only ever
        # showed our own utm_campaign-matched order count with no way to see
        # TikTok's number or the gap between them. Requested as a SEPARATE,
        # optional attempt: some ad accounts reject unknown/unsupported
        # metric names with a non-zero `code` for the WHOLE call, which
        # would otherwise wipe out spend/impressions/clicks/reach too and
        # silently fall back to mock data — worse than just missing the
        # conversion numbers.
        _WITH_CONVERSIONS = _BASE_METRICS + ["conversion", "cost_per_conversion"]

        def _fetch_report(metrics: list[str]):
            end = datetime.now(timezone.utc).date()
            start = end - timedelta(days=30)
            import json as _json
            resp = httpx.get(
                f"{TIKTOK_API_BASE}/report/integrated/get/",
                params={
                    "advertiser_id": config.advertiser_id,
                    "report_type": "BASIC",
                    "data_level": "AUCTION_CAMPAIGN",
                    "dimensions": '["campaign_id"]',
                    "metrics": _json.dumps(metrics),
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                    "page_size": 100,
                },
                headers={"Access-Token": config.access_token},
                timeout=30.0,
            )
            return resp.json()

        try:
            data = _fetch_report(_WITH_CONVERSIONS)
            has_conversions = True
            if data.get("code") != 0:
                logger.warning(
                    f"[TikTok Ads Sync] Métriques de conversion rejetées ({data.get('message')}), "
                    f"nouvel essai sans elles."
                )
                data = _fetch_report(_BASE_METRICS)
                has_conversions = False

            if data.get("code") != 0:
                logger.warning(f"[TikTok Ads Sync] Erreur report: {data.get('message')}")
                is_simulated = True
                campaigns_data = _simulated_campaigns(store_id)
            else:
                campaigns_data = []
                for row in data.get("data", {}).get("list", []):
                    dims = row.get("dimensions", {})
                    metrics = row.get("metrics", {})
                    conversions = int(float(metrics.get("conversion", 0) or 0)) if has_conversions else 0
                    campaigns_data.append({
                        "campaign_id": dims.get("campaign_id"),
                        "campaign_name": metrics.get("campaign_name", "Sans nom"),
                        "spend": float(metrics.get("spend", 0.0) or 0.0),
                        "currency": ad_currency,
                        "impressions": int(float(metrics.get("impressions", 0) or 0)),
                        "clicks": int(float(metrics.get("clicks", 0) or 0)),
                        "reach": int(float(metrics.get("reach", 0) or 0)),
                        "tiktok_conversions": conversions,
                        # No reliable revenue-value metric requested (only
                        # cost_per_conversion exists, which reconstructs SPEND
                        # not revenue — labeling that "value" would mislead).
                        # Left at 0 until a confirmed value metric is added.
                        "tiktok_conversion_value": 0.0,
                    })
                logger.info(f"[TikTok Ads Sync] Succès: {len(campaigns_data)} campagnes récupérées.")
        except Exception as e:
            is_network_error = _log_network_exception("report/integrated/get", e)
            is_simulated = True
            campaigns_data = _simulated_campaigns(store_id)

    now = datetime.now()

    # ── Never persist simulated/test data in production ──────────
    if is_simulated:
        deleted = db.query(TikTokAdsCampaign).filter(
            TikTokAdsCampaign.store_id == store_id,
            TikTokAdsCampaign.campaign_id.like("tt_mock_%"),
        ).delete(synchronize_session=False)
        db.commit()
        logger.warning(
            f"[TikTok Ads Sync] Connexion invalide pour store {store_id} — rien synchronisé, "
            f"{deleted} campagne(s) de test nettoyée(s). network_error={is_network_error}"
        )
        return {
            "success": False,
            "simulated": True,
            "network_error": is_network_error,
            "message": (
                "TikTok Ads semble inaccessible depuis le serveur (problème réseau, pas vos identifiants) — réessayez plus tard."
                if is_network_error else
                "Connexion TikTok invalide — aucune donnée synchronisée. Vérifiez l'Access Token et l'Advertiser ID."
            ),
        }

    synced = 0
    for c in campaigns_data:
        camp_id = c.get("campaign_id")
        if not camp_id:
            continue
        camp_currency = (c.get("currency") or "USD").upper()
        raw_spend = float(c.get("spend", 0.0))
        rate = _get_conversion_rate(camp_currency, config.currency, config.exchange_rate)

        campaign = db.query(TikTokAdsCampaign).filter(
            TikTokAdsCampaign.store_id == store_id,
            TikTokAdsCampaign.campaign_id == camp_id,
        ).first()
        if not campaign:
            campaign = TikTokAdsCampaign(
                id=str(uuid.uuid4()),
                campaign_id=camp_id,
                campaign_name=c.get("campaign_name", "Sans nom"),
                store_id=store_id,
                date_start=now - timedelta(days=30),
                date_end=now,
            )
            db.add(campaign)

        campaign.campaign_name = c.get("campaign_name", campaign.campaign_name)
        campaign.spend = raw_spend * rate
        campaign.raw_spend = raw_spend
        campaign.currency = camp_currency
        campaign.impressions = int(c.get("impressions", 0))
        campaign.clicks = int(c.get("clicks", 0))
        campaign.reach = int(c.get("reach", 0))
        campaign.tiktok_conversions = int(c.get("tiktok_conversions", 0) or 0)
        campaign.tiktok_conversion_value = float(c.get("tiktok_conversion_value", 0.0) or 0.0)
        synced += 1

    db.commit()
    return {
        "success": True,
        "synced": synced,
        "simulated": is_simulated,
        "message": f"{synced} campagnes TikTok synchronisées." + (" (données simulées — vérifiez le token)" if is_simulated else ""),
    }


@router.get("/campaigns", response_model=dict)
def list_tiktok_campaigns(store_id: str = Query(...), db: Session = Depends(get_db)):
    """
    Campaigns with UTM revenue attribution and full micro-metrics,
    in DZD and in the raw ad-account currency.
    """
    campaigns = db.query(TikTokAdsCampaign).filter(TikTokAdsCampaign.store_id == store_id).all()

    orders = db.query(Order).filter(
        Order.store_id == store_id,
        Order.status != "CANCELLED",
        # MERGED = a same-phone duplicate submission auto-fused into its
        # parent order. Without this exclusion a duplicate is counted TWICE
        # (once as itself, once via its parent) — same fix already applied
        # to Meta Ads' equivalent query.
        Order.status != "MERGED",
        Order.is_deleted == False,
    ).all()

    data = []
    global_spend = 0.0
    global_revenue = 0.0
    global_orders_count = 0
    global_tiktok_conversions = 0

    for camp in campaigns:
        camp_orders = [
            o for o in orders
            if o.utm_campaign and (
                o.utm_campaign.lower() == camp.campaign_name.lower()
                or o.utm_campaign == camp.campaign_id
            )
        ]
        # TikTok-sourced orders can also match by source
        revenue = sum(o.total for o in camp_orders)
        orders_count = len(camp_orders)
        raw_spend = camp.raw_spend if camp.raw_spend is not None else camp.spend

        roas = round(revenue / camp.spend, 2) if camp.spend > 0 else 0.0
        ctr = round(camp.clicks / camp.impressions * 100, 3) if camp.impressions > 0 else 0.0
        cpc = round(camp.spend / camp.clicks, 2) if camp.clicks > 0 else 0.0
        cpc_raw = round(raw_spend / camp.clicks, 4) if camp.clicks > 0 else 0.0
        cpm = round(camp.spend / camp.impressions * 1000, 2) if camp.impressions > 0 else 0.0
        cpm_raw = round(raw_spend / camp.impressions * 1000, 4) if camp.impressions > 0 else 0.0
        frequency = round(camp.impressions / camp.reach, 2) if camp.reach > 0 else 0.0
        cost_per_order = round(camp.spend / orders_count, 2) if orders_count > 0 else 0.0
        # Raw ad-account currency version, same as cpc_raw/cpm_raw above and
        # Meta Ads' identical cost_per_order_raw — "Coût / Vente" was only
        # ever shown converted to DZD, with no way to see it in the account's
        # own currency the way spend/CPC/CPM already could.
        cost_per_order_raw = round(raw_spend / orders_count, 4) if orders_count > 0 else 0.0
        conversion_rate = round(orders_count / camp.clicks * 100, 3) if camp.clicks > 0 else 0.0
        aov = round(revenue / orders_count, 2) if orders_count > 0 else 0.0
        profit = round(revenue - camp.spend, 2)

        # TikTok's OWN reported conversions — deliberately separate from
        # orders_count/revenue above (see Meta Ads' identical pattern).
        tiktok_conversions = camp.tiktok_conversions or 0
        conversion_gap = orders_count - tiktok_conversions

        global_spend += camp.spend
        global_revenue += revenue
        global_orders_count += orders_count
        global_tiktok_conversions += tiktok_conversions

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
            "tiktok_conversions": tiktok_conversions,
            "conversion_gap": conversion_gap,
            "date_start": camp.date_start.isoformat() if camp.date_start else None,
            "date_end": camp.date_end.isoformat() if camp.date_end else None,
        })

    total_impressions = sum(c.impressions or 0 for c in campaigns)
    total_clicks = sum(c.clicks or 0 for c in campaigns)
    total_reach = sum(c.reach or 0 for c in campaigns)
    raw_spend_by_currency: dict = {}
    for c in campaigns:
        cur = (c.currency or "USD").upper()
        rs = c.raw_spend if c.raw_spend is not None else c.spend
        raw_spend_by_currency[cur] = round(raw_spend_by_currency.get(cur, 0.0) + (rs or 0.0), 2)

    return {
        "success": True,
        "data": data,
        "summary": {
            "total_spend": global_spend,
            "total_revenue": global_revenue,
            "total_orders": global_orders_count,
            "global_roas": round(global_revenue / global_spend, 2) if global_spend > 0 else 0.0,
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
            "global_tiktok_conversions": global_tiktok_conversions,
            "global_conversion_gap": global_orders_count - global_tiktok_conversions,
        },
    }
