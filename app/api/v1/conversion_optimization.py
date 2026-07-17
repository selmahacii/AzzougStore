"""
Conversion Optimization Center — API layer.

Single endpoint (GET /conversion-optimization/dashboard) returning every
section in one response, matching the frontend's single-page dashboard.
All computation lives in app/services/conversion_optimization_engine.py
(this file only handles auth, date-window parsing and the short-TTL
cache); no metric is computed inline here.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api import deps
from app.core.dates import parse_local_date_filter
from app.db.session import get_db

router = APIRouter()


@router.get("/dashboard", response_model=dict)
def get_conversion_optimization_dashboard(
    store_id: str = Query(...),
    range_days: int = Query(30, ge=1, le=90),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: "object" = Depends(deps.get_current_active_user),
):
    """
    Every section of the Conversion Optimization Center for one store/
    period: overview, funnel, bottlenecks, products, landing pages,
    campaigns, opportunity score, action priorities, benchmark, history.

    Reuses MetaAnalyticsEngine (compute_meta_metrics) for every Meta CAPI
    health signal — never recomputed here. Cached 10 minutes (same pattern
    as the Signal Quality Center) since this aggregates several of the
    already-expensive queries in one request.
    """
    from app.core.analytics_cache import get_cached, set_cached, DEFAULT_TTL_SECONDS
    from app.services import conversion_optimization_engine as engine

    until = datetime.now(timezone.utc).replace(tzinfo=None)
    since = until - timedelta(days=range_days)
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

    cache_key = f"conversion_optimization:{store_id}:{range_days}:{date_from}:{date_to}"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached

    db.info["skip_tenant_isolation"] = True

    overview = engine.compute_conversion_overview(db, store_id, now=until)
    funnel = engine.compute_conversion_funnel(db, store_id, since, until)
    bottlenecks = engine.detect_bottlenecks(db, store_id, since, until)
    products = engine.compute_product_conversion_analysis(db, store_id, since, until)
    campaigns = engine.compute_campaign_conversion_intelligence(db, store_id, since, until)
    opportunity = engine.compute_opportunity_score(db, store_id, since, until)
    actions = engine.compute_action_priorities(bottlenecks)
    benchmark = engine.compute_benchmark(db, store_id, since, until)
    history_daily = engine.compute_evolution_history(db, store_id, since, until, granularity="daily")

    result = {
        "success": True,
        "data": {
            "range_days": range_days,
            "period": {"since": since.isoformat(), "until": until.isoformat()},
            "overview": overview,
            "funnel": funnel,
            "bottlenecks": bottlenecks,
            "products": products,
            "campaigns": campaigns,
            "opportunity_score": opportunity,
            "actions": actions,
            "benchmark": benchmark,
            "history": {"daily": history_daily},
            "calculated_at": until.isoformat(),
        },
    }
    set_cached(cache_key, result, DEFAULT_TTL_SECONDS)
    return result
