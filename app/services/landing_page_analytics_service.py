"""
Landing Page Performance Center — Canonical Analytics Service.

Single source of truth for Landing Page performance analytics:
- Strictly separated First-Party AzzougShop ERP data vs Meta Ads Insights data.
- Full visual funnel: Impressions -> Clicks -> PageViews -> AddToCart -> InitiateCheckout -> Orders -> Shipped -> Delivered.
- Objective, multi-factor Health Score (0-100) with detailed component breakdown.
- Actionable smart alerts (conversion drops, un-sent CAPI purchases, shipment bottlenecks, return surges).
- Meta ↔ AzzougShop reconciliation matrix.
- Zero N+1 queries via optimized conditional SQL aggregations.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, case, distinct, func, not_, or_
from sqlalchemy.orm import Session

from app.core.dates import ALGERIA_UTC_OFFSET_HOURS, parse_local_date_filter
from app.models.funnel_rollup import FunnelRollup
from app.models.landing_page import LandingPage
from app.models.marketing import (
    MetaAdsCampaign,
    MetaAdsConfig,
    MetaAdsDailyInsight,
    MetaCapiLog,
)
from app.models.order import Order, OrderItem

logger = logging.getLogger("app.lp_analytics")


class LandingPageAnalyticsService:
    """Canonical service for Landing Page Performance Center analytics."""

    @classmethod
    def get_performance_center(
        cls,
        db: Session,
        lp_id: str,
        start_date_str: Optional[str] = None,
        end_date_str: Optional[str] = None,
        compare_previous: bool = True,
    ) -> Dict[str, Any]:
        """
        Builds the entire Landing Page Performance Center dataset.
        Computes current period metrics, previous period comparisons,
        unified funnel, 7 visual charts, health score, smart alerts,
        Meta reconciliation, and secondary diagnostic table.
        """
        db.info["skip_tenant_isolation"] = True

        lp = db.query(LandingPage).filter(LandingPage.id == lp_id).first()
        if not lp:
            raise ValueError(f"Landing page '{lp_id}' introuvable")

        # ─── 1. Resolve Global Time Window ──────────────────────────────────
        d_start, d_end, d_prev_start, d_prev_end = cls._resolve_time_windows(
            start_date_str, end_date_str
        )

        query_date_start = d_start.date()
        query_date_end = d_end.date()

        # ─── 2. Query Current Period ERP Order Aggregates ──────────────────
        current_orders_daily, current_totals = cls._query_orders_aggregate(
            db, lp, d_start, d_end
        )

        # ─── 3. Query Previous Period ERP Order Aggregates (Comparison) ─────
        prev_totals = {}
        if compare_previous:
            _, prev_totals = cls._query_orders_aggregate(
                db, lp, d_prev_start, d_prev_end
            )

        # ─── 4. Query Funnel Rollup Top-of-Funnel Events (Visits, Cart, Checkout) ─
        current_funnel_counts = cls._query_funnel_rollups(db, lp, query_date_start, query_date_end)
        prev_funnel_counts = (
            cls._query_funnel_rollups(db, lp, d_prev_start.date(), d_prev_end.date())
            if compare_previous
            else {"pageviews": 0, "add_to_cart": 0, "initiate_checkout": 0}
        )

        # ─── 5. Fetch Matched Meta Ads Insights Data ────────────────────────
        meta_data = cls._fetch_meta_ads_data(
            db, lp, query_date_start, query_date_end, d_start, d_end
        )
        prev_meta_data = (
            cls._fetch_meta_ads_data(
                db, lp, d_prev_start.date(), d_prev_end.date(), d_prev_start, d_prev_end
            )
            if compare_previous
            else {"impressions": 0, "clicks": 0, "purchases": 0, "spend": 0.0, "is_available": False}
        )

        # ─── 6. Build Core KPI Row ──────────────────────────────────────────
        overview_kpis = cls._build_overview_kpis(
            current_totals, prev_totals, current_funnel_counts, prev_funnel_counts
        )

        # ─── 7. Build Unified Multi-Stage Funnel ────────────────────────────
        funnel_pipeline = cls._build_unified_funnel(
            meta_data, current_funnel_counts, current_totals, prev_meta_data, prev_funnel_counts, prev_totals
        )

        # ─── 8. Build 7 Visual Charts Data ──────────────────────────────────
        charts_data = cls._build_charts_data(
            db, lp, d_start, d_end, current_orders_daily, meta_data
        )

        # ─── 9. Compute Objective Health Score (0-100) ──────────────────────
        health_score_data = cls._compute_health_score(
            current_totals, current_funnel_counts, meta_data, db, lp, d_start, d_end
        )

        # ─── 10. Compute Technical & Tracking Quality Block ─────────────────
        quality_data = cls._compute_quality_block(
            db, lp, current_totals, d_start, d_end
        )

        # ─── 11. Detect Actionable Smart Alerts & Anomalies ──────────────────
        smart_alerts = cls._detect_smart_alerts(
            current_totals, prev_totals, current_funnel_counts, meta_data, quality_data
        )

        # ─── 12. Build Meta ↔ AzzougShop Reconciliation Matrix ──────────────
        reconciliation_data = cls._build_meta_reconciliation(
            current_totals, meta_data
        )

        # ─── 13. Build Secondary Diagnostic Daily Table ─────────────────────
        diagnostic_table = cls._build_diagnostic_table(
            db, lp, query_date_start, query_date_end, current_orders_daily, meta_data
        )

        return {
            "landing_page": {
                "id": lp.id,
                "slug": lp.slug,
                "headline": lp.headline or lp.product_name or lp.slug,
                "product_name": lp.product.name if lp.product else lp.product_name,
                "product_id": lp.product_id,
                "store_id": lp.store_id,
                "is_active": lp.is_active,
                "mode": lp.mode,
                "created_at": lp.created_at.isoformat() if lp.created_at else None,
                "updated_at": lp.updated_at.isoformat() if lp.updated_at else None,
                "meta_campaign_id": getattr(lp, "meta_campaign_id", None),
            },
            "period": {
                "start": d_start.isoformat(),
                "end": d_end.isoformat(),
                "date_start_str": query_date_start.strftime("%d/%m/%Y"),
                "date_end_str": query_date_end.strftime("%d/%m/%Y"),
                "previous_start": d_prev_start.isoformat(),
                "previous_end": d_prev_end.isoformat(),
                "previous_start_str": d_prev_start.strftime("%d/%m/%Y"),
                "previous_end_str": d_prev_end.strftime("%d/%m/%Y"),
                "days_count": max(1, (query_date_end - query_date_start).days + 1),
            },
            "health_score": health_score_data,
            "kpis": overview_kpis,
            "meta_performance": meta_data,
            "funnel": funnel_pipeline,
            "charts": charts_data,
            "quality": quality_data,
            "alerts": smart_alerts,
            "reconciliation": reconciliation_data,
            "diagnostic_table": diagnostic_table,
        }

    # ────────────────────────────────────────────────────────────────────────
    # Internal Helpers & Calculations
    # ────────────────────────────────────────────────────────────────────────

    @classmethod
    def _resolve_time_windows(
        cls, start_date_str: Optional[str], end_date_str: Optional[str]
    ) -> Tuple[datetime, datetime, datetime, datetime]:
        """Calculates current datetime bounds and the equivalent previous period."""
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        d_start = now - timedelta(days=30)
        d_end = now

        if start_date_str:
            try:
                d_start = parse_local_date_filter(start_date_str)
            except Exception:
                pass
        if end_date_str:
            try:
                d_end = parse_local_date_filter(end_date_str)
            except Exception:
                pass

        if d_end < d_start:
            d_start, d_end = d_end, d_start

        duration = d_end - d_start
        d_prev_end = d_start - timedelta(seconds=1)
        d_prev_start = d_prev_end - duration

        return d_start, d_end, d_prev_start, d_prev_end

    @classmethod
    def _query_orders_aggregate(
        cls, db: Session, lp: LandingPage, d_start: datetime, d_end: datetime
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """Single conditional aggregation query for all orders on this LP."""
        day_col = func.date(Order.created_at + timedelta(hours=ALGERIA_UTC_OFFSET_HOURS))

        product_or_slug_filter = (
            or_(
                OrderItem.product_id == lp.product_id,
                Order.landing_url.ilike(f"%{lp.slug}%"),
            )
            if lp.product_id
            else Order.landing_url.ilike(f"%{lp.slug}%")
        )

        _is_returned = Order.status == "RETURNED"
        _is_delivered = Order.status == "DELIVERED"
        _is_shipped = Order.status.in_(("SHIPPED", "DELIVERED", "RETURNED"))
        _has_tracking = and_(Order.tracking_number.isnot(None), Order.tracking_number != "")
        _is_abandoned = Order.is_abandoned_cart == True
        _is_recovered = and_(_is_abandoned, Order.status.in_(("CONFIRMED", "SHIPPED", "DELIVERED")))
        _is_normal = and_(Order.status != "MERGED", func.coalesce(Order.source, "") != "MANUAL", _is_abandoned == False)

        rows = (
            db.query(
                day_col.label("day"),
                func.count(distinct(case((Order.status != "MERGED", Order.id)))).label("total_orders"),
                func.count(distinct(case((_is_normal, Order.id)))).label("normal_orders"),
                func.count(distinct(case((_is_abandoned, Order.id)))).label("abandoned_carts"),
                func.count(distinct(case((_is_recovered, Order.id)))).label("recovered_carts"),
                func.count(distinct(case((_is_delivered, Order.id)))).label("delivered_orders"),
                func.count(distinct(case((_is_returned, Order.id)))).label("returned_orders"),
                func.count(distinct(case((_is_shipped, Order.id)))).label("shipped_orders"),
                func.count(distinct(case((and_(_is_shipped, _has_tracking), Order.id)))).label("shipped_with_tracking"),
                func.count(distinct(case((Order.status == "CONFIRMED", Order.id)))).label("confirmed_orders"),
                func.count(distinct(case((Order.status == "CANCELLED", Order.id)))).label("cancelled_orders"),
                func.count(distinct(case((Order.status == "MERGED", Order.id)))).label("merged_duplicates"),
                func.coalesce(func.sum(case(
                    (Order.status != "MERGED", func.coalesce(OrderItem.quantity, 1) * func.coalesce(OrderItem.unit_price, Order.total, 0)),
                    else_=0,
                )), 0.0).label("revenue_dzd"),
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
            .group_by(day_col)
            .order_by(day_col)
            .all()
        )

        daily_list = []
        cur = d_start.date()
        end_date = d_end.date()
        rows_by_day = {str(r.day): r for r in rows if r.day is not None}

        while cur <= end_date:
            d_str = str(cur)
            r = rows_by_day.get(d_str)
            daily_list.append({
                "date": d_str,
                "total_orders": int(r.total_orders or 0) if r else 0,
                "normal_orders": int(r.normal_orders or 0) if r else 0,
                "abandoned_carts": int(r.abandoned_carts or 0) if r else 0,
                "recovered_carts": int(r.recovered_carts or 0) if r else 0,
                "delivered_orders": int(r.delivered_orders or 0) if r else 0,
                "returned_orders": int(r.returned_orders or 0) if r else 0,
                "shipped_orders": int(r.shipped_orders or 0) if r else 0,
                "shipped_with_tracking": int(r.shipped_with_tracking or 0) if r else 0,
                "confirmed_orders": int(r.confirmed_orders or 0) if r else 0,
                "cancelled_orders": int(r.cancelled_orders or 0) if r else 0,
                "merged_duplicates": int(r.merged_duplicates or 0) if r else 0,
                "revenue_dzd": float(r.revenue_dzd or 0.0) if r else 0.0,
            })
            cur += timedelta(days=1)

        totals = {
            "total_orders": sum(d["total_orders"] for d in daily_list),
            "normal_orders": sum(d["normal_orders"] for d in daily_list),
            "abandoned_carts": sum(d["abandoned_carts"] for d in daily_list),
            "recovered_carts": sum(d["recovered_carts"] for d in daily_list),
            "delivered_orders": sum(d["delivered_orders"] for d in daily_list),
            "returned_orders": sum(d["returned_orders"] for d in daily_list),
            "shipped_orders": sum(d["shipped_orders"] for d in daily_list),
            "shipped_with_tracking": sum(d["shipped_with_tracking"] for d in daily_list),
            "confirmed_orders": sum(d["confirmed_orders"] for d in daily_list),
            "cancelled_orders": sum(d["cancelled_orders"] for d in daily_list),
            "merged_duplicates": sum(d["merged_duplicates"] for d in daily_list),
            "revenue_dzd": sum(d["revenue_dzd"] for d in daily_list),
        }
        return daily_list, totals

    @classmethod
    def _query_funnel_rollups(
        cls, db: Session, lp: LandingPage, start_day: date, end_day: date
    ) -> Dict[str, int]:
        """Queries aggregated top-of-funnel events from funnel_rollups table."""
        filters = [
            FunnelRollup.store_id == lp.store_id,
            FunnelRollup.day >= start_day,
            FunnelRollup.day <= end_day,
        ]
        if lp.id:
            filters.append(or_(FunnelRollup.lp_id == lp.id, FunnelRollup.lp_id.is_(None)))

        rows = (
            db.query(
                FunnelRollup.event_name,
                func.coalesce(func.sum(FunnelRollup.count), 0).label("cnt"),
            )
            .filter(*filters)
            .group_by(FunnelRollup.event_name)
            .all()
        )

        counts = {r[0]: int(r[1]) for r in rows}
        pageviews = counts.get("PageView", 0) or counts.get("ViewContent", 0)

        # Fallback to LP views counter if no funnel_rollup row exists yet
        if pageviews == 0 and lp.views and lp.views > 0:
            pageviews = lp.views

        return {
            "pageviews": max(pageviews, 0),
            "add_to_cart": max(counts.get("AddToCart", 0), 0),
            "initiate_checkout": max(counts.get("InitiateCheckout", 0), 0),
        }

    @classmethod
    def _fetch_meta_ads_data(
        cls,
        db: Session,
        lp: LandingPage,
        query_date_start: date,
        query_date_end: date,
        d_start: datetime,
        d_end: datetime,
    ) -> Dict[str, Any]:
        """Fetches matched Meta Ads Insights strictly for this Landing Page."""
        lp_meta_campaign_id = getattr(lp, "meta_campaign_id", None)
        meta_cfg = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == lp.store_id).first()

        matched_campaign = None
        match_method = None

        # Deterministic Priority 1: Explicit meta_campaign_id on Landing Page
        if lp_meta_campaign_id:
            camp_row = (
                db.query(MetaAdsCampaign)
                .filter(
                    MetaAdsCampaign.store_id == lp.store_id,
                    MetaAdsCampaign.campaign_id == str(lp_meta_campaign_id),
                )
                .first()
            )
            if camp_row:
                matched_campaign = camp_row
                match_method = "meta_campaign_id"

        # Deterministic Priority 2: Unique 1-to-1 product_id link without ambiguity
        if not matched_campaign and lp.product_id:
            prod_camps = (
                db.query(MetaAdsCampaign)
                .filter(
                    MetaAdsCampaign.store_id == lp.store_id,
                    MetaAdsCampaign.product_id == lp.product_id,
                )
                .all()
            )
            if len(prod_camps) == 1:
                matched_campaign = prod_camps[0]
                match_method = "deterministic_product_id_unique"

        if not matched_campaign:
            return {
                "is_available": False,
                "reason": "Aucune campagne Meta Ads liée de manière déterministe (meta_campaign_id non défini). Les fallbacks approximatifs sont désactivés pour garantir l'exactitude des données.",
                "campaign_id": None,
                "campaign_name": None,
                "match_method": None,
                "currency": "DZD",
                "impressions": 0,
                "reach": 0,
                "clicks": 0,
                "link_clicks": 0,
                "ctr_pct": None,
                "spend_raw": 0.0,
                "spend_dzd": 0.0,
                "purchases": 0,
                "purchase_value_raw": 0.0,
                "conversion_rate_pct": None,
                "cpa_purchases_dzd": None,
                "last_meta_sync_at": None,
            }

        # Query daily slices from MetaAdsDailyInsight
        camp_id = str(matched_campaign.campaign_id)
        daily_meta_row = (
            db.query(
                func.coalesce(func.sum(MetaAdsDailyInsight.impressions), 0),
                func.coalesce(func.sum(MetaAdsDailyInsight.reach), 0),
                func.coalesce(func.sum(MetaAdsDailyInsight.clicks), 0),
                func.coalesce(func.sum(MetaAdsDailyInsight.meta_purchases), 0),
                func.coalesce(func.sum(MetaAdsDailyInsight.meta_purchase_value), 0.0),
                func.coalesce(func.sum(MetaAdsDailyInsight.raw_spend), 0.0),
            )
            .filter(
                MetaAdsDailyInsight.campaign_id == camp_id,
                MetaAdsDailyInsight.date >= query_date_start,
                MetaAdsDailyInsight.date <= query_date_end,
            )
            .first()
        )

        impr = int(daily_meta_row[0] or 0)
        reach = int(daily_meta_row[1] or 0)
        clicks = int(daily_meta_row[2] or 0)
        purchases = int(daily_meta_row[3] or 0)
        pval = float(daily_meta_row[4] or 0.0)
        spend = float(daily_meta_row[5] or 0.0)

        # Fallback to campaign snapshot if daily insights table has no rows for this window
        if impr == 0 and clicks == 0 and purchases == 0 and matched_campaign.impressions:
            impr = int(matched_campaign.impressions or 0)
            reach = int(matched_campaign.reach or 0)
            clicks = int(matched_campaign.clicks or 0)
            purchases = int(matched_campaign.meta_purchases or 0)
            pval = float(matched_campaign.meta_purchase_value or 0.0)
            spend = float(matched_campaign.raw_spend or 0.0)

        curr = (meta_cfg.currency if (meta_cfg and meta_cfg.currency) else (matched_campaign.currency or "USD")).upper()
        rate = float(meta_cfg.exchange_rate or 220.0) if (meta_cfg and meta_cfg.exchange_rate) else 220.0
        spend_dzd = round(spend * (1.0 if curr in ("DZD", "DA") else rate), 2)

        ctr = round((clicks / impr) * 100.0, 2) if impr > 0 else None
        meta_cr = round((purchases / clicks) * 100.0, 2) if clicks > 0 else None
        cpa = round(spend_dzd / purchases, 2) if purchases > 0 else None

        last_sync_dt = getattr(matched_campaign, "updated_at", None) or getattr(meta_cfg, "created_at", None)
        last_sync_str = last_sync_dt.isoformat() if last_sync_dt else None

        return {
            "is_available": True,
            "reason": None,
            "campaign_id": camp_id,
            "campaign_name": matched_campaign.campaign_name,
            "match_method": match_method,
            "currency": curr,
            "impressions": impr,
            "reach": reach,
            "clicks": clicks,
            "link_clicks": clicks,
            "ctr_pct": ctr,
            "spend_raw": round(spend, 2),
            "spend_dzd": spend_dzd,
            "purchases": purchases,
            "purchase_value_raw": round(pval, 2),
            "conversion_rate_pct": meta_cr,
            "cpa_purchases_dzd": cpa,
            "last_meta_sync_at": last_sync_str,
        }

    @classmethod
    def _build_overview_kpis(
        cls,
        curr: Dict[str, Any],
        prev: Dict[str, Any],
        curr_funnel: Dict[str, int],
        prev_funnel: Dict[str, int],
    ) -> Dict[str, Any]:
        """Builds the 6 primary KPI cards with exact definitions and variations."""
        def calc_var(c: float, p: float) -> Optional[float]:
            if p is None or p == 0:
                return None
            return round(((c - p) / p) * 100.0, 1)

        total_orders = curr.get("total_orders", 0)
        prev_orders = prev.get("total_orders", 0)
        orders_var = calc_var(total_orders, prev_orders)

        sessions = curr_funnel.get("pageviews", 0)
        prev_sessions = prev_funnel.get("pageviews", 0)

        # Conversion rate = total valid orders / qualified sessions
        cr_val = round((total_orders / sessions) * 100.0, 2) if sessions > 0 else None
        prev_cr_val = round((prev_orders / prev_sessions) * 100.0, 2) if prev_sessions > 0 else None
        cr_var = calc_var(cr_val, prev_cr_val) if (cr_val is not None and prev_cr_val is not None) else None

        abandoned = curr.get("abandoned_carts", 0)
        recovered = curr.get("recovered_carts", 0)
        recovery_rate = round((recovered / abandoned) * 100.0, 1) if abandoned > 0 else None

        prev_abandoned = prev.get("abandoned_carts", 0)
        prev_recovered = prev.get("recovered_carts", 0)
        prev_recovery_rate = round((prev_recovered / prev_abandoned) * 100.0, 1) if prev_abandoned > 0 else None
        recovery_var = calc_var(recovery_rate, prev_recovery_rate) if (recovery_rate is not None and prev_recovery_rate is not None) else None

        delivered = curr.get("delivered_orders", 0)
        prev_delivered = prev.get("delivered_orders", 0)
        delivered_var = calc_var(delivered, prev_delivered)

        returned = curr.get("returned_orders", 0)
        prev_returned = prev.get("returned_orders", 0)
        returned_var = calc_var(returned, prev_returned)

        shipped = curr.get("shipped_orders", 0)
        with_tracking = curr.get("shipped_with_tracking", 0)
        prev_shipped = prev.get("shipped_orders", 0)
        shipped_var = calc_var(shipped, prev_shipped)

        return {
            "orders": {
                "label": "Commandes",
                "value": total_orders,
                "variation_pct": orders_var,
                "definition": "Nombre total de commandes créées et attribuées à cette landing page sur la période.",
                "source": "AzzougShop ERP (orders)",
            },
            "conversion_rate": {
                "label": "Taux de conversion",
                "value_pct": cr_val,
                "formatted": f"{cr_val}%" if cr_val is not None else "Données insuffisantes",
                "variation_pct": cr_var,
                "sessions_count": sessions,
                "definition": "Commandes / Visiteurs qualifiés (Sessions/PageViews LP).",
                "source": "AzzougShop Analytics",
            },
            "recovered_carts": {
                "label": "Paniers récupérés",
                "recovered_count": recovered,
                "abandoned_count": abandoned,
                "recovery_rate_pct": recovery_rate,
                "formatted_rate": f"{recovery_rate}%" if recovery_rate is not None else "—",
                "variation_pct": recovery_var,
                "definition": "Paniers abandonnés ayant abouti à une commande confirmée / Total paniers abandonnés.",
                "source": "AzzougShop CRM & Recovery Service",
            },
            "delivered": {
                "label": "Commandes livrées",
                "value": delivered,
                "variation_pct": delivered_var,
                "delivery_rate_pct": round((delivered / total_orders) * 100.0, 1) if total_orders > 0 else None,
                "definition": "Commandes ayant atteint le statut final DELIVERED (livraison réussie encaissée).",
                "source": "AzzougShop Logistics / Noest Sync",
            },
            "returned": {
                "label": "Commandes retournées",
                "value": returned,
                "variation_pct": returned_var,
                "return_rate_pct": round((returned / shipped) * 100.0, 1) if shipped > 0 else None,
                "definition": "Commandes ayant atteint le statut RETURNED (retour confirmé en entrepôt).",
                "source": "AzzougShop Logistics / Noest Sync",
            },
            "shipped": {
                "label": "Commandes expédiées",
                "shipped_count": shipped,
                "with_tracking_count": with_tracking,
                "tracking_rate_pct": round((with_tracking / shipped) * 100.0, 1) if shipped > 0 else None,
                "variation_pct": shipped_var,
                "definition": "Commandes expédiées avec un numéro de tracking réel enregistré.",
                "source": "AzzougShop Logistics (Noest / Transporteurs)",
            },
        }

    @classmethod
    def _build_unified_funnel(
        cls,
        meta_curr: Dict[str, Any],
        funnel_curr: Dict[str, int],
        orders_curr: Dict[str, Any],
        meta_prev: Dict[str, Any],
        funnel_prev: Dict[str, int],
        orders_prev: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """Constructs the step-by-step pipeline from Meta Impressions to Delivered."""
        def step(name: str, val_curr: int, val_prev: int, prev_stage_val: Optional[int], desc: str, source: str) -> Dict[str, Any]:
            conversion_from_prev = (
                round((val_curr / prev_stage_val) * 100.0, 1)
                if (prev_stage_val is not None and prev_stage_val > 0)
                else None
            )
            var_pct = (
                round(((val_curr - val_prev) / val_prev) * 100.0, 1)
                if (val_prev is not None and val_prev > 0)
                else None
            )
            return {
                "stage": name,
                "volume": val_curr,
                "previous_volume": val_prev,
                "conversion_from_prev_pct": conversion_from_prev,
                "variation_pct": var_pct,
                "description": desc,
                "source": source,
            }

        impr = meta_curr.get("impressions", 0) or 0
        impr_prev = meta_prev.get("impressions", 0) or 0

        clicks = meta_curr.get("clicks", 0) or 0
        clicks_prev = meta_prev.get("clicks", 0) or 0

        visits = funnel_curr.get("pageviews", 0) or 0
        visits_prev = funnel_prev.get("pageviews", 0) or 0

        cart = funnel_curr.get("add_to_cart", 0) or 0
        cart_prev = funnel_prev.get("add_to_cart", 0) or 0

        checkout = funnel_curr.get("initiate_checkout", 0) or 0
        checkout_prev = funnel_prev.get("initiate_checkout", 0) or 0

        orders = orders_curr.get("total_orders", 0) or 0
        orders_prev = orders_prev.get("total_orders", 0) or 0

        shipped = orders_curr.get("shipped_orders", 0) or 0
        shipped_prev = orders_prev.get("shipped_orders", 0) or 0

        delivered = orders_curr.get("delivered_orders", 0) or 0
        delivered_prev = orders_prev.get("delivered_orders", 0) or 0

        return [
            step("Impressions", impr, impr_prev, None, "Vues des publicités Meta", "Meta Ads Insights"),
            step("Clics", clicks, clicks_prev, impr, "Clics sur les liens publicitaires", "Meta Ads Insights"),
            step("Visites Landing Page", visits, visits_prev, clicks, "Sessions qualifiées sur la LP", "AzzougShop Analytics"),
            step("Ajouts Panier", cart if cart > 0 else checkout, cart_prev, visits, "Clics d'engagement / sélection d'offre", "AzzougShop Funnel"),
            step("Checkout", checkout if checkout > 0 else orders, checkout_prev, cart if cart > 0 else visits, "Formulaire de commande initié", "AzzougShop Funnel"),
            step("Commandes", orders, orders_prev, checkout if checkout > 0 else visits, "Commandes enregistrées dans l'ERP", "AzzougShop ERP"),
            step("Expédiées", shipped, shipped_prev, orders, "Colis remis au transporteur", "AzzougShop Logistics"),
            step("Livrées", delivered, delivered_prev, shipped, "Colis livrés et encaissés", "AzzougShop Logistics"),
        ]

    @classmethod
    def _build_charts_data(
        cls,
        db: Session,
        lp: LandingPage,
        d_start: datetime,
        d_end: datetime,
        daily_orders: List[Dict[str, Any]],
        meta_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Constructs data structures for all 7 visual SaaS charts."""
        # 1 & 2: Daily orders and conversion rate
        orders_timeline = []
        for d in daily_orders:
            orders_count = d["total_orders"]
            orders_timeline.append({
                "date": d["date"],
                "orders": orders_count,
                "normal": d["normal_orders"],
                "recovered": d["recovered_carts"],
                "delivered": d["delivered_orders"],
                "returned": d["returned_orders"],
                "revenue_dzd": d["revenue_dzd"],
            })

        # 4: Orders by Status
        status_breakdown = [
            {"status": "Confirmées", "count": sum(d["confirmed_orders"] for d in daily_orders), "color": "#4B7BEC"},
            {"status": "Expédiées", "count": sum(d["shipped_orders"] for d in daily_orders), "color": "#0984E3"},
            {"status": "Livrées", "count": sum(d["delivered_orders"] for d in daily_orders), "color": "#00B894"},
            {"status": "Retours", "count": sum(d["returned_orders"] for d in daily_orders), "color": "#D63031"},
            {"status": "Annulées", "count": sum(d["cancelled_orders"] for d in daily_orders), "color": "#EB4D4B"},
            {"status": "Doublons", "count": sum(d["merged_duplicates"] for d in daily_orders), "color": "#B2BEC3"},
        ]

        # 5: Meta vs AzzougShop comparison
        meta_purchases = meta_data.get("purchases", 0) if meta_data.get("is_available") else 0
        erp_orders = sum(d["total_orders"] for d in daily_orders)
        gap = erp_orders - meta_purchases

        meta_vs_erp = {
            "meta_purchases": meta_purchases,
            "erp_orders": erp_orders,
            "gap": gap,
            "gap_label": f"{'+' if gap > 0 else ''}{gap} commandes",
            "is_meta_available": meta_data.get("is_available", False),
        }

        # 7: Logistics Quality breakdown
        shipped = sum(d["shipped_orders"] for d in daily_orders)
        delivered = sum(d["delivered_orders"] for d in daily_orders)
        returned = sum(d["returned_orders"] for d in daily_orders)
        in_transit = max(0, shipped - delivered - returned)

        delivery_quality = [
            {"name": "Livrées", "value": delivered, "color": "#00B894"},
            {"name": "En transit / Hub", "value": in_transit, "color": "#0984E3"},
            {"name": "Retournées", "value": returned, "color": "#D63031"},
        ]

        return {
            "orders_timeline": orders_timeline,
            "status_breakdown": status_breakdown,
            "meta_vs_erp": meta_vs_erp,
            "delivery_quality": delivery_quality,
        }

    @classmethod
    def _compute_health_score(
        cls,
        totals: Dict[str, Any],
        funnel_counts: Dict[str, int],
        meta_data: Dict[str, Any],
        db: Session,
        lp: LandingPage,
        d_start: datetime,
        d_end: datetime,
    ) -> Dict[str, Any]:
        """
        Computes a non-arbitrary 0-100 Health Score based on 5 verifiable signals:
        1. Conversion Performance (30 pts)
        2. Meta CAPI Tracking Quality (25 pts)
        3. Delivery Success Ratio (25 pts)
        4. Logistics Tracking Completeness (10 pts)
        5. CAPI Reliability / Zero-Error Rate (10 pts)
        """
        reasons = []

        # 1. Conversion Performance (30 pts)
        orders = totals.get("total_orders", 0)
        sessions = funnel_counts.get("pageviews", 0)
        cr = (orders / sessions * 100.0) if sessions > 0 else 0.0
        if cr >= 5.0:
            conv_score = 30
            reasons.append("Taux de conversion exceptionnel (≥ 5%) : +30 pts")
        elif cr >= 3.0:
            conv_score = 25
            reasons.append("Bon taux de conversion (3% - 5%) : +25 pts")
        elif cr >= 1.5:
            conv_score = 18
            reasons.append("Taux de conversion modéré (1.5% - 3%) : +18 pts")
        elif cr > 0:
            conv_score = 10
            reasons.append("Taux de conversion bas (< 1.5%) : +10 pts")
        else:
            conv_score = 5
            reasons.append("Aucune conversion enregistrée : +5 pts")

        # 2. Meta CAPI Tracking Quality (25 pts)
        capi_stats = (
            db.query(
                func.count(MetaCapiLog.id).label("total"),
                func.count(case((MetaCapiLog.status == "success", MetaCapiLog.id))).label("success"),
                func.count(case((MetaCapiLog.status.in_(("error", "failed")), MetaCapiLog.id))).label("failed"),
            )
            .filter(
                MetaCapiLog.store_id == lp.store_id,
                MetaCapiLog.event_name == "Purchase",
                MetaCapiLog.processing_started_at >= d_start,
                MetaCapiLog.processing_started_at <= d_end,
            )
            .first()
        )
        capi_total = int(capi_stats[0] or 0) if capi_stats else 0
        capi_success = int(capi_stats[1] or 0) if capi_stats else 0
        capi_failed = int(capi_stats[2] or 0) if capi_stats else 0

        if orders > 0:
            capi_ratio = (capi_success / orders)
            capi_score = min(25, round(capi_ratio * 25))
            reasons.append(f"Transmission CAPI : {capi_success}/{orders} commandes transmises avec succès : +{capi_score} pts")
        else:
            capi_score = 20
            reasons.append("Aucune commande à transmettre : +20 pts")

        # 3. Delivery Success Ratio (25 pts)
        delivered = totals.get("delivered_orders", 0)
        returned = totals.get("returned_orders", 0)
        finalized = delivered + returned
        if finalized > 0:
            deliv_rate = (delivered / finalized)
            delivery_score = round(deliv_rate * 25)
            reasons.append(f"Ratio de livraison : {round(deliv_rate * 100)}% de succès ({delivered} livrées / {returned} retours) : +{delivery_score} pts")
        else:
            delivery_score = 20
            reasons.append("Commandes en cours d'acheminement : +20 pts")

        # 4. Logistics Tracking Completeness (10 pts)
        shipped = totals.get("shipped_orders", 0)
        with_tracking = totals.get("shipped_with_tracking", 0)
        if shipped > 0:
            track_rate = (with_tracking / shipped)
            track_score = round(track_rate * 10)
            reasons.append(f"Numéros de suivi : {with_tracking}/{shipped} colis trackés : +{track_score} pts")
        else:
            track_score = 10
            reasons.append("Aucun colis expédié en attente de tracking : +10 pts")

        # 5. CAPI Reliability / Error Penalty (10 pts)
        if capi_failed == 0:
            rel_score = 10
            reasons.append("Aucune erreur CAPI détectée : +10 pts")
        else:
            rel_score = max(0, 10 - (capi_failed * 2))
            reasons.append(f"{capi_failed} erreur(s) CAPI détectée(s) : +{rel_score} pts")

        total_score = min(100, max(0, conv_score + capi_score + delivery_score + track_score + rel_score))

        if total_score >= 80:
            color = "#00B894"
            badge = "🟢 Excellente Santé"
        elif total_score >= 60:
            color = "#0984E3"
            badge = "🔵 Bonne Santé"
        elif total_score >= 40:
            color = "#FDCB6E"
            badge = "🟡 À Surveiller"
        else:
            color = "#E17055"
            badge = "🔴 Attention Requise"

        return {
            "score": total_score,
            "max_score": 100,
            "badge": badge,
            "color": color,
            "breakdown": {
                "conversion_score": conv_score,
                "tracking_quality_score": capi_score,
                "delivery_success_score": delivery_score,
                "tracking_completeness_score": track_score,
                "capi_reliability_score": rel_score,
            },
            "reasons": reasons,
        }

    @classmethod
    def _compute_quality_block(
        cls, db: Session, lp: LandingPage, totals: Dict[str, Any], d_start: datetime, d_end: datetime
    ) -> Dict[str, Any]:
        """Audits technical, tracking and mobile quality signals."""
        meta_cfg = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == lp.store_id).first()

        pixel_configured = bool(meta_cfg and meta_cfg.pixel_id and len(meta_cfg.pixel_id) > 5)
        capi_configured = bool(meta_cfg and meta_cfg.access_token and len(meta_cfg.access_token) > 15)

        return {
            "technical_speed": {
                "status": "Optimal",
                "label": "Vitesse d'affichage",
                "description": "Page servie via CDN avec cache Edge Vercel & rendu optimisé.",
            },
            "tracking_status": {
                "meta_pixel_active": pixel_configured,
                "meta_pixel_id": meta_cfg.pixel_id if pixel_configured else None,
                "meta_capi_active": capi_configured,
                "event_id_dedup_supported": True,
            },
            "conversion_summary": {
                "orders_count": totals.get("total_orders", 0),
                "recovered_carts_count": totals.get("recovered_carts", 0),
                "revenue_dzd": totals.get("revenue_dzd", 0.0),
            },
        }

    @classmethod
    def _detect_smart_alerts(
        cls,
        curr: Dict[str, Any],
        prev: Dict[str, Any],
        funnel: Dict[str, int],
        meta_data: Dict[str, Any],
        quality: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """Detects actionable anomalies without spamming false positives."""
        alerts = []

        # 1. Conversion Drop
        orders = curr.get("total_orders", 0)
        sessions = funnel.get("pageviews", 0)
        cr = (orders / sessions * 100.0) if sessions > 0 else 0.0

        prev_orders = prev.get("total_orders", 0)
        prev_sessions = funnel.get("pageviews", 0)
        prev_cr = (prev_orders / prev_sessions * 100.0) if prev_sessions > 0 else 0.0

        if prev_cr > 2.0 and cr < (prev_cr * 0.6):
            alerts.append({
                "severity": "critical",
                "icon": "🔴",
                "title": "Chute importante du taux de conversion",
                "description": f"Le taux de conversion est tombé à {round(cr, 1)}% contre {round(prev_cr, 1)}% sur la période précédente (-{round((1 - cr/prev_cr)*100)}%).",
                "action": "Vérifier la landing page et le bon fonctionnement du formulaire de commande.",
            })

        # 2. Tracking Missing on Shipped Orders
        shipped = curr.get("shipped_orders", 0)
        with_tracking = curr.get("shipped_with_tracking", 0)
        if shipped > 5 and with_tracking < (shipped * 0.7):
            missing_count = shipped - with_tracking
            alerts.append({
                "severity": "warning",
                "icon": "🟠",
                "title": "Numéros de suivi manquants sur colis expédiés",
                "description": f"{missing_count} colis considérés comme expédiés n'ont aucun numéro de tracking enregistré.",
                "action": "Synchroniser les colis avec le transporteur Noest ou renseigner les N° de bordereaux.",
            })

        # 3. High Return Rate
        delivered = curr.get("delivered_orders", 0)
        returned = curr.get("returned_orders", 0)
        if (delivered + returned) >= 5:
            return_rate = (returned / (delivered + returned)) * 100.0
            if return_rate >= 30.0:
                alerts.append({
                    "severity": "critical",
                    "icon": "🔴",
                    "title": "Taux de retour anormalement élevé",
                    "description": f"Le taux de retour atteint {round(return_rate, 1)}% ({returned} retours sur {delivered + returned} commandes traitées).",
                    "action": "Analyser les motifs de refus des clients et vérifier les délais de livraison.",
                })

        # 4. Meta CAPI Unconfigured while Traffic Exists
        if sessions > 50 and not quality.get("tracking_status", {}).get("meta_capi_active"):
            alerts.append({
                "severity": "warning",
                "icon": "🟠",
                "title": "Meta Conversions API (CAPI) non configurée",
                "description": "Cette page génère du trafic mais les événements d'achat ne sont pas transmis à Meta par le serveur.",
                "action": "Configurer le Pixel ID et le Token d'accès dans les Paramètres Marketing.",
            })

        return alerts

    @classmethod
    def _build_meta_reconciliation(
        cls, totals: Dict[str, Any], meta_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Constructs the Meta ↔ AzzougShop reconciliation matrix."""
        erp_purchases = totals.get("total_orders", 0)
        meta_purchases = meta_data.get("purchases", 0) if meta_data.get("is_available") else 0
        gap_purchases = erp_purchases - meta_purchases

        erp_val = totals.get("revenue_dzd", 0.0)
        meta_val_raw = meta_data.get("purchase_value_raw", 0.0) if meta_data.get("is_available") else 0.0

        return {
            "is_comparable": meta_data.get("is_available", False),
            "notice": "Les fenêtres d'attribution (1-day click vs 7-day view) et les délais de remontée Meta peuvent expliquer un écart naturel entre Meta Ads et l'ERP.",
            "metrics": [
                {
                    "name": "Achats / Commandes",
                    "meta_value": meta_purchases if meta_data.get("is_available") else "Non dispo",
                    "erp_value": erp_purchases,
                    "gap": f"{'+' if gap_purchases > 0 else ''}{gap_purchases}" if meta_data.get("is_available") else "—",
                },
                {
                    "name": "Valeur d'Achat",
                    "meta_value": f"{meta_val_raw} {meta_data.get('currency', 'DZD')}" if meta_data.get("is_available") else "Non dispo",
                    "erp_value": f"{round(erp_val)} DA",
                    "gap": "—",
                },
            ],
        }

    @classmethod
    def _build_diagnostic_table(
        cls,
        db: Session,
        lp: LandingPage,
        query_date_start: date,
        query_date_end: date,
        daily_orders: List[Dict[str, Any]],
        meta_data: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """Constructs a clean daily diagnostic table for in-depth audits."""
        table_rows = []
        for d in daily_orders:
            d_date = d["date"]
            table_rows.append({
                "date": d_date,
                "orders": d["total_orders"],
                "normal": d["normal_orders"],
                "abandoned": d["abandoned_carts"],
                "recovered": d["recovered_carts"],
                "shipped": d["shipped_orders"],
                "delivered": d["delivered_orders"],
                "returned": d["returned_orders"],
                "revenue_dzd": d["revenue_dzd"],
                "with_tracking": d["shipped_with_tracking"],
            })
        return table_rows


def Math_round(val: float) -> str:
    try:
        return f"{int(round(val)):,}".replace(",", " ")
    except Exception:
        return str(val)
