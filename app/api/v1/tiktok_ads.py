from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta, timezone
import uuid
import logging

logger = logging.getLogger(__name__)

from app.api import deps
from app.api.deps import get_db
from app.models.marketing import TikTokAdsConfig, TikTokAdsCampaign
from app.models.order import Order
from app.models.user import User

router = APIRouter()

TIKTOK_API_BASE = "https://business-api.tiktok.com/open_api/v1.3"


class TikTokAdsConfigCreate(BaseModel):
    store_id: str
    access_token: Optional[str] = None
    advertiser_id: Optional[str] = None
    pixel_id: Optional[str] = None
    app_id: Optional[str] = None
    catalog_id: Optional[str] = None
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
        "catalog_id": config.catalog_id,
        "is_connected": config.is_connected,
        "exchange_rate": config.exchange_rate if config.exchange_rate is not None else 1.0,
        "currency": config.currency or "USD",
    }


@router.get("/config", response_model=dict)
def get_tiktok_ads_config(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
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
            catalog_id="",
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
def update_tiktok_ads_config(
    payload: TikTokAdsConfigCreate,
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
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
    config.catalog_id = payload.catalog_id
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
def sync_tiktok_ads(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
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

    # ── Daily insights (production audit 2026-07-20): Meta pulls a daily
    # breakdown (time_increment=1) alongside the campaign rollup so "combien
    # AUJOURD'HUI ?" is answerable without waiting on the running snapshot —
    # TikTok's sync never did. Same non-blocking pattern: failure here never
    # fails the whole sync, only the daily breakdown is missing until the
    # next successful run.
    if not is_simulated:
        try:
            from app.models.marketing import TikTokAdsDailyInsight
            from datetime import date as _date_cls
            import json as _json

            end = datetime.now(timezone.utc).date()
            start = end - timedelta(days=30)
            daily_resp = httpx.get(
                f"{TIKTOK_API_BASE}/report/integrated/get/",
                params={
                    "advertiser_id": config.advertiser_id,
                    "report_type": "BASIC",
                    "data_level": "AUCTION_CAMPAIGN",
                    "dimensions": _json.dumps(["campaign_id", "stat_time_day"]),
                    "metrics": _json.dumps(["spend", "impressions", "clicks", "reach", "conversion"]),
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                    "page_size": 1000,
                },
                headers={"Access-Token": config.access_token},
                timeout=30.0,
            )
            daily_data = daily_resp.json()
            if daily_data.get("code") == 0:
                from sqlalchemy.dialects.postgresql import insert as pg_insert
                from sqlalchemy import func as _sqlfunc
                d_rate = _get_conversion_rate(ad_currency, config.currency, config.exchange_rate)
                rows_to_upsert = []
                for row in daily_data.get("data", {}).get("list", []):
                    dims = row.get("dimensions", {})
                    metrics = row.get("metrics", {})
                    day_str = dims.get("stat_time_day", "")[:10]
                    camp_id = dims.get("campaign_id")
                    if not day_str or not camp_id:
                        continue
                    try:
                        day_val = _date_cls.fromisoformat(day_str)
                    except ValueError:
                        continue
                    d_raw_spend = float(metrics.get("spend", 0.0) or 0.0)
                    rows_to_upsert.append({
                        "id": str(uuid.uuid4()), "store_id": store_id, "campaign_id": camp_id,
                        "date": day_val, "raw_spend": d_raw_spend, "spend": d_raw_spend * d_rate,
                        "impressions": int(float(metrics.get("impressions", 0) or 0)),
                        "clicks": int(float(metrics.get("clicks", 0) or 0)),
                        "reach": int(float(metrics.get("reach", 0) or 0)),
                        "tiktok_conversions": int(float(metrics.get("conversion", 0) or 0)),
                        "tiktok_conversion_value": 0.0,
                    })
                if rows_to_upsert:
                    stmt = pg_insert(TikTokAdsDailyInsight.__table__).values(rows_to_upsert)
                    stmt = stmt.on_conflict_do_update(
                        constraint="uq_tiktok_daily_campaign_date",
                        set_={
                            "raw_spend": stmt.excluded.raw_spend, "spend": stmt.excluded.spend,
                            "impressions": stmt.excluded.impressions, "clicks": stmt.excluded.clicks,
                            "reach": stmt.excluded.reach, "tiktok_conversions": stmt.excluded.tiktok_conversions,
                            "updated_at": _sqlfunc.now(),
                        },
                    )
                    db.execute(stmt)
                    db.commit()
                logger.info(f"[TikTok Ads Sync] Insights quotidiens: {len(rows_to_upsert)} jour(s)-campagne upsertés.")
            else:
                logger.warning(f"[TikTok Ads Sync] Insights quotidiens indisponibles: {daily_data.get('message')}")
        except Exception as exc:
            db.rollback()
            logger.warning(f"[TikTok Ads Sync] Échec insights quotidiens (non bloquant): {exc}")

    # ── Per-ad breakdown (data_level=AUCTION_AD) — covers both "Ad Groups"
    # and "Ads" from the production audit: TikTokAdsCampaign above is one
    # rollup per campaign, exactly the same limitation Meta had before
    # MetaAdsAdInsight. Same non-blocking pattern as the daily block above.
    if not is_simulated:
        try:
            from app.models.marketing import TikTokAdsAdInsight
            import json as _json

            end = datetime.now(timezone.utc).date()
            start = end - timedelta(days=30)
            ad_resp = httpx.get(
                f"{TIKTOK_API_BASE}/report/integrated/get/",
                params={
                    "advertiser_id": config.advertiser_id,
                    "report_type": "BASIC",
                    "data_level": "AUCTION_AD",
                    "dimensions": _json.dumps(["ad_id"]),
                    "metrics": _json.dumps([
                        "ad_name", "adgroup_id", "adgroup_name", "campaign_id",
                        "spend", "impressions", "clicks", "reach", "conversion",
                    ]),
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                    "page_size": 1000,
                },
                headers={"Access-Token": config.access_token},
                timeout=30.0,
            )
            ad_data = ad_resp.json()
            if ad_data.get("code") == 0:
                from sqlalchemy.dialects.postgresql import insert as pg_insert
                from sqlalchemy import func as _sqlfunc
                a_rate = _get_conversion_rate(ad_currency, config.currency, config.exchange_rate)
                ad_rows_to_upsert = []
                for row in ad_data.get("data", {}).get("list", []):
                    dims = row.get("dimensions", {})
                    metrics = row.get("metrics", {})
                    ad_id = dims.get("ad_id")
                    if not ad_id:
                        continue
                    a_raw_spend = float(metrics.get("spend", 0.0) or 0.0)
                    ad_rows_to_upsert.append({
                        "id": str(uuid.uuid4()), "store_id": store_id, "ad_id": ad_id,
                        "campaign_id": metrics.get("campaign_id") or "",
                        "ad_name": metrics.get("ad_name") or "Sans nom",
                        "adgroup_id": metrics.get("adgroup_id"), "adgroup_name": metrics.get("adgroup_name"),
                        "raw_spend": a_raw_spend, "spend": a_raw_spend * a_rate, "currency": ad_currency,
                        "impressions": int(float(metrics.get("impressions", 0) or 0)),
                        "clicks": int(float(metrics.get("clicks", 0) or 0)),
                        "reach": int(float(metrics.get("reach", 0) or 0)),
                        "tiktok_conversions": int(float(metrics.get("conversion", 0) or 0)),
                        "tiktok_conversion_value": 0.0,
                        "date_start": now - timedelta(days=30), "date_end": now,
                    })
                if ad_rows_to_upsert:
                    stmt = pg_insert(TikTokAdsAdInsight.__table__).values(ad_rows_to_upsert)
                    stmt = stmt.on_conflict_do_update(
                        constraint="uq_tiktok_ad_insight_ad_id",
                        set_={
                            "campaign_id": stmt.excluded.campaign_id, "ad_name": stmt.excluded.ad_name,
                            "adgroup_id": stmt.excluded.adgroup_id, "adgroup_name": stmt.excluded.adgroup_name,
                            "raw_spend": stmt.excluded.raw_spend, "spend": stmt.excluded.spend,
                            "currency": stmt.excluded.currency, "impressions": stmt.excluded.impressions,
                            "clicks": stmt.excluded.clicks, "reach": stmt.excluded.reach,
                            "tiktok_conversions": stmt.excluded.tiktok_conversions,
                            "date_start": stmt.excluded.date_start, "date_end": stmt.excluded.date_end,
                            "updated_at": _sqlfunc.now(),
                        },
                    )
                    db.execute(stmt)
                    db.commit()
                logger.info(f"[TikTok Ads Sync] Insights par annonce: {len(ad_rows_to_upsert)} annonce(s) upsertées.")
            else:
                logger.warning(f"[TikTok Ads Sync] Insights par annonce indisponibles: {ad_data.get('message')}")
        except Exception as exc:
            db.rollback()
            logger.warning(f"[TikTok Ads Sync] Échec insights par annonce (non bloquant): {exc}")

    return {
        "success": True,
        "synced": synced,
        "simulated": is_simulated,
        "message": f"{synced} campagnes TikTok synchronisées." + (" (données simulées — vérifiez le token)" if is_simulated else ""),
    }


@router.get("/campaigns", response_model=dict)
def list_tiktok_campaigns(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
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


# ─────────────────────────────────────────────────────────────────────────
# TikTok Events API (server-side) relay — same role as POST /meta-ads/events
# and deliberately PUBLIC for the same reason: called by the anonymous
# shopper's browser (ttq.track fires client-side, this relay fires the
# server-side twin with the SAME event_id for TikTok's own deduplication —
# see app/services/tiktok_capi.py's module docstring). Never add
# current_user here; see tests/test_meta_ads_auth_coverage.py's TikTok
# counterpart for why.
# ─────────────────────────────────────────────────────────────────────────

class TikTokEventUserData(BaseModel):
    email: Optional[str] = None       # raw or pre-hashed
    phone: Optional[str] = None       # raw or pre-hashed
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    external_id: Optional[str] = None
    client_ip_address: Optional[str] = None
    client_user_agent: Optional[str] = None
    ttclid: Optional[str] = None
    ttp: Optional[str] = None         # _ttp cookie, TikTok's fbp/fbc equivalent


class TikTokEventCustomData(BaseModel):
    currency: Optional[str] = None
    value: Optional[float] = None
    content_ids: Optional[list] = None
    content_type: Optional[str] = None
    contents: Optional[list] = None


class TikTokEventPayload(BaseModel):
    store_id: str
    event_name: str                    # PageView, ViewContent, AddToCart, InitiateCheckout, Purchase
    event_time: Optional[int] = None
    event_id: Optional[str] = None     # shared with ttq.track for dedup — see purchase_event_id()
    order_id: Optional[str] = None
    event_source_url: Optional[str] = None
    user_data: Optional[TikTokEventUserData] = None
    custom_data: Optional[TikTokEventCustomData] = None


def _dispatch_tiktok_event(pixel_code: str, access_token: str, store_id: str, event: dict, order_id: Optional[str]) -> None:
    """Background task: ship one browser-mirrored event with retries + durable log — same
    shape as meta_ads.py's _dispatch_capi_event."""
    from app.db.session import SessionLocal
    from app.services.tiktok_capi import send_events

    db = SessionLocal()
    try:
        send_events(
            db, store_id=store_id, access_token=access_token, pixel_code=pixel_code,
            events=[event], order_id=order_id,
        )
    finally:
        db.close()


@router.post("/events", response_model=dict)
def send_tiktok_event(
    payload: TikTokEventPayload,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Server-side TikTok Events API relay. Called by the storefront alongside
    the browser Pixel (ttq.track) with the SAME event_id so TikTok
    deduplicates the two — see app/services/tiktok_capi.py's dedup design.
    The API call runs in a background task — zero latency for the shopper.
    """
    from app.services.tiktok_capi import build_tiktok_user, EVENT_NAME_MAP

    config = db.query(TikTokAdsConfig).filter(TikTokAdsConfig.store_id == payload.store_id).first()
    if not config or not config.pixel_id or not config.access_token or len(config.access_token) < 5:
        # No TikTok config — accept silently, storefront must never break on this.
        return {"success": True, "sent": False, "reason": "no_config"}

    now = payload.event_time or int(datetime.now(timezone.utc).timestamp())
    event_id = payload.event_id or str(uuid.uuid4())

    raw = payload.user_data or TikTokEventUserData()
    forwarded = request.headers.get("x-forwarded-for", "")
    client_ip = raw.client_ip_address or forwarded.split(",")[0].strip() or (request.client.host if request.client else None)
    user_agent = raw.client_user_agent or request.headers.get("user-agent")
    full_name = " ".join(p for p in (raw.first_name, raw.last_name) if p) or None

    user = build_tiktok_user(
        email=raw.email, phone=raw.phone, full_name=full_name, external_id=raw.external_id,
        client_ip=client_ip, user_agent=user_agent, ttclid=raw.ttclid, ttp=raw.ttp,
    )

    event: dict = {
        "event": EVENT_NAME_MAP.get(payload.event_name, payload.event_name),
        "event_time": now,
        "event_id": event_id,
        "user": user,
    }
    if payload.event_source_url:
        event["page"] = {"url": payload.event_source_url}
    if payload.custom_data:
        cd = payload.custom_data.model_dump(exclude_none=True)
        if cd:
            event["properties"] = {
                "content_type": cd.get("content_type", "product"),
                "contents": cd.get("contents") or [{"content_id": cid} for cid in (cd.get("content_ids") or [])],
                "value": cd.get("value"),
                "currency": cd.get("currency"),
            }

    background_tasks.add_task(
        _dispatch_tiktok_event, config.pixel_id, config.access_token, payload.store_id, event, payload.order_id,
    )
    return {"success": True, "sent": True, "event_id": event_id}


# ─────────────────────────────────────────────────────────────────────────
# Diagnostics / Signal Quality Center — TikTok twin of meta_ads.py's
# /diagnostics and /signal-quality, both delegating to compute_tiktok_metrics
# (single source of truth, same pattern as Meta's 13-endpoint migration).
# ─────────────────────────────────────────────────────────────────────────

@router.get("/diagnostics", response_model=dict)
def get_tiktok_diagnostics(
    store_id: str = Query(...),
    include_legacy_data: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    """
    Automatic TikTok tracking health report: config status, CAPI delivery
    stats, deduplication coverage, Learning Score — same structure as
    GET /meta-ads/diagnostics, computed by the same kind of window
    resolution (resolve_metrics_time_window, TikTok's own launch-date
    cutover) so both dashboards behave identically to an admin switching
    between platforms.
    """
    from app.services.tiktok_analytics_engine import compute_tiktok_metrics
    from app.services.meta_analytics_engine import resolve_metrics_time_window
    from app.services.tiktok_analytics_engine import TIKTOK_ENGINE_LAUNCH_DATE

    db.info["skip_tenant_isolation"] = True
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    window_7d = resolve_metrics_time_window(now - timedelta(days=7), now, include_legacy_data=include_legacy_data, cutover_date=TIKTOK_ENGINE_LAUNCH_DATE)
    window_30d = resolve_metrics_time_window(now - timedelta(days=30), now, include_legacy_data=include_legacy_data, cutover_date=TIKTOK_ENGINE_LAUNCH_DATE)

    config = db.query(TikTokAdsConfig).filter(TikTokAdsConfig.store_id == store_id).first()
    m7 = compute_tiktok_metrics(db, store_id, window_7d.effective_since, window_7d.effective_until, include_legacy_data=include_legacy_data)
    m30 = compute_tiktok_metrics(db, store_id, window_30d.effective_since, window_30d.effective_until, include_legacy_data=include_legacy_data)

    return {
        "success": True,
        "data": {
            "config_status": {
                "connected": bool(config and config.is_connected),
                "pixel_configured": bool(config and config.pixel_id),
                "token_configured": bool(config and config.access_token),
            },
            "time_window_7d": window_7d.as_dict(),
            "time_window_30d": window_30d.as_dict(),
            "delivery_7d": {
                "total_sent": m7["total_sent"], "success": m7["success"], "failed": m7["failed"],
                "tracking_coverage": m7["tracking_coverage"],
            },
            "delivery_30d": {
                "total_sent": m30["total_sent"], "success": m30["success"], "failed": m30["failed"],
                "tracking_coverage": m30["tracking_coverage"],
            },
            "event_match_quality": m30["event_match_quality"],
            "dedup_pct": m30["dedup_pct"],
            "learning_score": m30["learning_score"],
        },
    }


@router.get("/signal-quality", response_model=dict)
def get_tiktok_signal_quality(
    store_id: str = Query(...),
    range_days: int = Query(30, ge=1, le=90),
    include_legacy_data: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    """
    Signal Quality Center — TikTok twin of GET /meta-ads/signal-quality:
    Learning Score decomposed into sub-scores, EMQ field coverage, all from
    compute_tiktok_metrics (never recomputed locally).
    """
    from app.services.tiktok_analytics_engine import compute_tiktok_metrics

    db.info["skip_tenant_isolation"] = True
    until = datetime.now(timezone.utc).replace(tzinfo=None)
    since = until - timedelta(days=range_days)
    m = compute_tiktok_metrics(db, store_id, since, until, include_legacy_data=include_legacy_data)

    return {
        "success": True,
        "data": {
            "range_days": range_days,
            "time_window": m["time_window"],
            "status_counts": {
                "success": m["success"], "failed": m["failed"], "retry": m["retry"],
                "pending": m["pending"], "skipped": m["skipped"], "total_sent": m["total_sent"],
            },
            "event_match_quality": m["event_match_quality"],
            "sample_size": m["sample_size"],
            "field_coverage": m["field_coverage"],
            "dedup_pct": m["dedup_pct"],
            "learning_score": m["learning_score"],
            "component_scores": m["component_scores"],
        },
    }


@router.get("/funnel", response_model=dict)
def get_tiktok_funnel(
    store_id: str = Query(...),
    date_start: Optional[str] = Query(None),
    date_end: Optional[str] = Query(None),
    include_legacy_data: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    """
    Funnel Analytics — TikTok twin of GET /meta-ads/funnel: PageView through
    Purchase (CompletePayment) stage volumes/loss, from compute_tiktok_funnel.
    """
    from app.core.dates import parse_local_date_filter
    from app.services.meta_analytics_engine import resolve_metrics_time_window
    from app.services.tiktok_analytics_engine import compute_tiktok_funnel, TIKTOK_ENGINE_LAUNCH_DATE

    db.info["skip_tenant_isolation"] = True
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    requested_start = now - timedelta(days=30)
    requested_end = now
    if date_start:
        try:
            requested_start = parse_local_date_filter(date_start)
        except ValueError:
            pass
    if date_end:
        try:
            requested_end = parse_local_date_filter(date_end)
        except ValueError:
            pass
    window = resolve_metrics_time_window(requested_start, requested_end, include_legacy_data=include_legacy_data, cutover_date=TIKTOK_ENGINE_LAUNCH_DATE)

    funnel = compute_tiktok_funnel(db, store_id, window.effective_since, window.effective_until)
    return {"success": True, "data": {**funnel, "time_window": window.as_dict()}}


# ─────────────────────────────────────────────────────────────────────────
# ERP ↔ TikTok validation — cross-checks our own order count against what
# TikTok's Events API actually accepted (tiktok_capi_logs status='success'
# Purchase rows), same role as Meta's tracking-quality-v2: honestly
# measures what was ACTUALLY sent, never fabricates a reconciled number.
# ─────────────────────────────────────────────────────────────────────────

@router.get("/kpi-validation", response_model=dict)
def get_tiktok_kpi_validation(
    store_id: str = Query(...),
    range_days: int = Query(30, ge=1, le=90),
    include_legacy_data: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    """
    ERP ↔ TikTok reconciliation: how many real orders (ERP) vs how many
    Purchase events TikTok's Events API actually accepted (status=success
    in tiktok_capi_logs) over the same window — a gap here means either
    the relay never fired (frontend issue) or the send failed (network/
    token issue), never silently hidden.
    """
    from app.services.tiktok_analytics_engine import compute_tiktok_metrics

    db.info["skip_tenant_isolation"] = True
    until = datetime.now(timezone.utc).replace(tzinfo=None)
    since = until - timedelta(days=range_days)
    m = compute_tiktok_metrics(db, store_id, since, until, include_legacy_data=include_legacy_data)

    erp_orders_count = (
        db.query(Order)
        .filter(
            Order.store_id == store_id, Order.is_deleted == False,
            Order.status.in_(("CONFIRMED", "SHIPPED", "DELIVERED")),
            Order.created_at >= m["since"], Order.created_at <= until,
        )
        .count()
    )
    tiktok_accepted = m["success"]
    gap = erp_orders_count - tiktok_accepted
    coverage_pct = round(tiktok_accepted / erp_orders_count * 100, 1) if erp_orders_count else None

    return {
        "success": True,
        "data": {
            "time_window": m["time_window"],
            "erp_orders_count": erp_orders_count,
            "tiktok_accepted_purchases": tiktok_accepted,
            "gap": gap,
            "coverage_pct": coverage_pct,
            "dedup_pct": m["dedup_pct"],
            "event_match_quality": m["event_match_quality"],
        },
    }


@router.get("/campaigns/{campaign_id}/ads", response_model=dict)
def list_tiktok_campaign_ads(
    campaign_id: str,
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    """
    Per-ad (Ad Group + Ad) breakdown for one TikTok campaign — twin of
    GET /meta-ads/campaigns/{id}/ads, from TikTokAdsAdInsight (upserted
    during sync_tiktok_ads' AUCTION_AD-level fetch).
    """
    from app.models.marketing import TikTokAdsAdInsight

    db.info["skip_tenant_isolation"] = True
    rows = (
        db.query(TikTokAdsAdInsight)
        .filter(TikTokAdsAdInsight.campaign_id == campaign_id)
        .order_by(TikTokAdsAdInsight.spend.desc())
        .all()
    )
    return {
        "success": True,
        "data": [
            {
                "ad_id": r.ad_id, "ad_name": r.ad_name,
                "adgroup_id": r.adgroup_id, "adgroup_name": r.adgroup_name,
                "spend": r.spend, "raw_spend": r.raw_spend, "currency": r.currency,
                "impressions": r.impressions, "clicks": r.clicks, "reach": r.reach,
                "tiktok_conversions": r.tiktok_conversions,
                "ctr": round(r.clicks / r.impressions * 100, 3) if r.impressions else 0.0,
                "cpc": round(r.spend / r.clicks, 2) if r.clicks else 0.0,
                "cpm": round(r.spend / r.impressions * 1000, 2) if r.impressions else 0.0,
                "cost_per_conversion": round(r.spend / r.tiktok_conversions, 2) if r.tiktok_conversions else 0.0,
            }
            for r in rows
        ],
    }


# ─────────────────────────────────────────────────────────────────────────
# TikTok Catalog Feed Enterprise — see app/services/tiktok_catalog.py.
# /catalog-feed is PUBLIC (fetched directly by TikTok Catalog Manager, same
# reasoning as GET /meta-ads/catalog-feed); /catalog-sync and
# /catalog-health are admin-only.
# ─────────────────────────────────────────────────────────────────────────

@router.get("/catalog-feed")
def get_tiktok_catalog_feed(store_id: str = Query(...), db: Session = Depends(get_db)):
    """
    TikTok Catalog Manager product feed (JSON) — pull-based path, always
    reflects current DB state. Products without a permanent absolute image
    URL are excluded (TikTok would reject them) — same rule as Meta's feed.
    """
    from fastapi.responses import JSONResponse
    from app.models.product import Product
    from app.models.store import Store
    from app.services.tiktok_catalog import build_catalog_item

    store = db.query(Store).filter(Store.id == store_id, Store.is_deleted == False).first()
    if not store:
        raise HTTPException(status_code=404, detail="Boutique introuvable.")
    base_url = f"https://{store.domain}" if store.domain else f"https://{store.slug}.azghub.com"

    products = db.query(Product).filter(
        Product.store_id == store_id, Product.is_active == True, Product.is_upsell_only == False,
    ).all()

    items = []
    for p in products:
        item = build_catalog_item(p, base_url=base_url, store_name=store.name)
        if not item.get("image_link") or not str(item["image_link"]).startswith("http"):
            continue
        items.append(item)

    return JSONResponse({"catalog_id": None, "store": store.name, "products": items, "count": len(items)})


@router.post("/catalog-sync", response_model=dict)
def sync_tiktok_catalog(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    """
    Triggers an incremental push sync via the Catalog API (create/update/
    delete only what changed since the last successful sync per product).
    """
    from app.services.tiktok_catalog import sync_catalog_incremental
    from app.models.store import Store

    config = db.query(TikTokAdsConfig).filter(TikTokAdsConfig.store_id == store_id).first()
    if not config or not config.access_token or not config.catalog_id:
        return {"success": False, "message": "TikTok Catalog non configuré — renseignez catalog_id et access_token."}

    store = db.query(Store).filter(Store.id == store_id, Store.is_deleted == False).first()
    if not store:
        raise HTTPException(status_code=404, detail="Boutique introuvable.")
    base_url = f"https://{store.domain}" if store.domain else f"https://{store.slug}.azghub.com"

    result = sync_catalog_incremental(
        db, store_id, access_token=config.access_token, catalog_id=config.catalog_id,
        base_url=base_url, store_name=store.name, currency=config.currency or "DZD",
    )
    return {"success": True, "data": result}


@router.get("/catalog-health", response_model=dict)
def get_tiktok_catalog_health(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    """
    Catalog Health dashboard: products tracked, success/failed/pending
    breakdown, per-error-category counts, last successful sync, avg
    latency, success rate — all from tiktok_catalog.compute_catalog_health
    (single source of truth, never recomputed per-widget).
    """
    from app.services.tiktok_catalog import compute_catalog_health

    db.info["skip_tenant_isolation"] = True
    health = compute_catalog_health(db, store_id)
    return {"success": True, "data": health}
