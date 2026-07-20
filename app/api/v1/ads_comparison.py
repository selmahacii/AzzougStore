"""
Meta ↔ TikTok comparative dashboard — the "Enterprise" cross-platform view
requested alongside the standalone TikTok Ads Enterprise build. Reads BOTH
platforms' canonical engines (compute_meta_metrics / compute_tiktok_metrics)
side by side; never recomputes a metric independently, never invents a
"combined" number that would hide which platform contributed what.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api import deps
from app.api.deps import get_db
from app.models.user import User

router = APIRouter()


@router.get("/summary", response_model=dict)
def get_ads_comparison_summary(
    store_id: str = Query(...),
    range_days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
    current_user: "User" = Depends(deps.get_current_active_user),
):
    """
    Side-by-side Meta vs TikTok: Learning Score, EMQ, tracking coverage,
    dedup, delivery status counts. Each platform keeps its own cutover
    floor (Meta: 16/07/2026 durable-queue rework; TikTok: its own launch
    date) — the two `time_window`s in the response can legitimately differ,
    labeled explicitly rather than silently forced onto one shared window.
    """
    from app.services.meta_analytics_engine import compute_meta_metrics
    from app.services.tiktok_analytics_engine import compute_tiktok_metrics

    db.info["skip_tenant_isolation"] = True
    until = datetime.now(timezone.utc).replace(tzinfo=None)
    since = until - timedelta(days=range_days)

    meta = compute_meta_metrics(db, store_id, since, until)
    tiktok = compute_tiktok_metrics(db, store_id, since, until)

    def _platform_summary(m: dict) -> dict:
        return {
            "total_sent": m["total_sent"], "success": m["success"], "failed": m["failed"],
            "tracking_coverage": m["tracking_coverage"], "event_match_quality": m["event_match_quality"],
            "dedup_pct": m["dedup_pct"], "learning_score": m["learning_score"]["score"],
            "learning_score_label": m["learning_score"]["label"],
            "time_window": m["time_window"],
        }

    return {
        "success": True,
        "data": {
            "range_days": range_days,
            "meta": _platform_summary(meta),
            "tiktok": _platform_summary(tiktok),
            "comparison": {
                "learning_score_gap": round((meta["learning_score"]["score"] or 0) - (tiktok["learning_score"]["score"] or 0), 1),
                "emq_gap": round((meta["event_match_quality"] or 0) - (tiktok["event_match_quality"] or 0), 1),
                "note": "Écarts calculés uniquement quand les deux plateformes ont des données sur la fenêtre demandée — jamais une comparaison entre une fenêtre vide et une fenêtre pleine sans le signaler.",
            },
        },
    }
