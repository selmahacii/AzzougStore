"""
TikTok Analytics Engine — canonical, single source of truth for every
TikTok Events API health metric (Signal Quality Center, Learning Score,
Diagnostics, Funnel, Campaign Learning Health), architecturally mirroring
app/services/meta_analytics_engine.py's compute_meta_metrics().

Reuses, rather than duplicates, every genuinely platform-agnostic piece:
- resolve_metrics_time_window() (meta_analytics_engine.py) — parametrized
  by `cutover_date` specifically so TikTok doesn't need its own copy.
- compute_learning_score() / compute_component_scores() (meta_capi.py) —
  pure functions over an already-computed metrics dict, no Meta-specific
  coupling; the "weighted average of already-measured components" formula
  is the same regardless of which platform produced those components.
- meta_health_label() / classify() (score → French label + color bands) —
  same three-tier vocabulary (Excellent/Bon/Moyen/Faible/Critique) applies
  to any /100 score; a second identical band table would be duplication,
  not a TikTok-specific design choice.

NOT reused (own implementation, same rationale as tiktok_capi.py's circuit
breaker): the actual meta_capi_logs/tiktok_capi_logs SQL queries — those
are genuinely different tables with different column semantics
(event_id dedup population, field-presence keys for EMQ), so sharing them
would require a platform-parametrized query layer that doesn't exist yet
and isn't worth building until a third platform needs the same shape.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.services.meta_capi import compute_learning_score, compute_component_scores, meta_health_label
from app.services.meta_analytics_engine import resolve_metrics_time_window, classify
from app.services.tiktok_capi import compute_match_quality

# TikTok Ads Enterprise durable-queue go-live — this integration's own
# "day one", same role as meta_capi.NEW_ENGINE_CUTOVER_DATE but for
# tiktok_capi_logs. Every tiktok_capi_logs row was written by the durable-
# queue engine from the start (no pre-durable-queue legacy rows exist for
# this platform), so this mostly documents intent for future rows rather
# than excluding any real defect window — kept for architectural parity
# with Meta and so resolve_metrics_time_window's include_legacy_data
# toggle behaves identically across both dashboards.
TIKTOK_ENGINE_LAUNCH_DATE = datetime(2026, 7, 20)


def _pct(numerator: float, denominator: float) -> Optional[float]:
    if not denominator:
        return None
    return round(numerator / denominator * 100, 1)


def _compute_status_metrics(db: Session, base_filters: list) -> Dict[str, Any]:
    from app.models.marketing import TikTokCapiLog

    status_rows = (
        db.query(TikTokCapiLog.status, TikTokCapiLog.error_category, func.count(TikTokCapiLog.id))
        .filter(*base_filters)
        .group_by(TikTokCapiLog.status, TikTokCapiLog.error_category)
        .all()
    )
    by_status: Dict[str, int] = {}
    network_failed = 0
    for status, error_category, count in status_rows:
        by_status[status] = by_status.get(status, 0) + count
        if error_category in ("network_timeout", "network_error"):
            network_failed += count
    success = by_status.get("success", 0)
    failed = by_status.get("failed", 0)
    retry = by_status.get("retry", 0) + by_status.get("pending_retry", 0)
    pending = by_status.get("queued", 0) + by_status.get("processing", 0)
    skipped = by_status.get("skipped", 0)
    total_sent = success + failed + retry + pending + skipped

    valid_purchase_pct = _pct(success, total_sent)
    rejected_pct = _pct(failed, total_sent)
    retry_pct = _pct(retry, total_sent)
    pending_pct = _pct(pending, total_sent)
    coverage_score = _pct(success, total_sent)
    reliability_score = round(max(0.0, 100 - (rejected_pct * 3)), 1) if rejected_pct is not None else None

    calculated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    last_success_at = (
        db.query(func.max(TikTokCapiLog.created_at))
        .filter(*base_filters, TikTokCapiLog.status == "success")
        .scalar()
    ) if total_sent else None

    return {
        "success": success, "failed": failed, "retry": retry, "pending": pending, "skipped": skipped,
        "total_sent": total_sent, "network_failed": network_failed,
        "valid_purchase_pct": valid_purchase_pct, "rejected_pct": rejected_pct,
        "retry_pct": retry_pct, "pending_pct": pending_pct,
        "coverage_score": coverage_score, "reliability_score": reliability_score,
        "calculated_at": calculated_at, "last_success_at": last_success_at,
    }


def _compute_match_quality_sample(db: Session, base_filters: list, sample_cap: int) -> Dict[str, Any]:
    from app.models.marketing import TikTokCapiLog

    sample = (
        db.query(TikTokCapiLog.payload)
        .filter(*base_filters, TikTokCapiLog.status == "success", TikTokCapiLog.payload.isnot(None))
        .order_by(TikTokCapiLog.created_at.desc())
        .limit(sample_cap)
        .all()
    )
    emq_scores: List[float] = []
    field_present_counts: Dict[str, int] = {}
    for (payload,) in sample:
        # _log_send persists the full request body: {"data": [event, ...]} —
        # one event per log row in this integration (send_events is always
        # called with a single-event batch), so the first (only) entry's
        # `user` object is what was actually sent for this row.
        events = (payload or {}).get("data") or []
        user = (events[0].get("user") or {}) if events else {}
        mq = compute_match_quality(user)
        emq_scores.append(mq["score"])
        for f in mq["fields"]:
            if f["present"]:
                field_present_counts[f["key"]] = field_present_counts.get(f["key"], 0) + 1
    sample_n = len(sample)
    avg_emq = round(sum(emq_scores) / sample_n, 1) if sample_n else None
    field_coverage = [
        {"key": key, "coverage_pct": _pct(count, sample_n)}
        for key, count in field_present_counts.items()
    ]
    return {"sample_n": sample_n, "avg_emq": avg_emq, "field_coverage": field_coverage}


def _compute_dedup(db: Session, base_filters: list, total_sent: int) -> Dict[str, Any]:
    from app.models.marketing import TikTokCapiLog

    all_event_id_rows = db.query(TikTokCapiLog.event_id).filter(*base_filters).all()
    counts: Dict[str, int] = {}
    for (eid,) in all_event_id_rows:
        counts[eid] = counts.get(eid, 0) + 1
    dup_n = sum(1 for c in counts.values() if c > 1)
    dedup_pct = round((1 - dup_n / total_sent) * 100, 1) if total_sent else None
    return {"dedup_pct": dedup_pct, "duplicate_event_ids": dup_n}


def compute_tiktok_metrics(
    db: Session,
    store_id: str,
    since: datetime,
    until: datetime,
    *,
    order_ids: Optional[List[str]] = None,
    sample_cap: int = 500,
    include_legacy_data: bool = False,
) -> Dict[str, Any]:
    """
    Canonical TikTok Events API health metrics for a date window — the
    TikTok twin of compute_meta_metrics(). Same contract: every percentage
    is None (not 0.0) when its sample is empty; `since` is floored to
    TIKTOK_ENGINE_LAUNCH_DATE unless include_legacy_data=True.
    """
    from app.models.marketing import TikTokCapiLog

    window = resolve_metrics_time_window(
        since, until, include_legacy_data=include_legacy_data, cutover_date=TIKTOK_ENGINE_LAUNCH_DATE,
    )
    effective_since = window.effective_since

    base_filters = [
        TikTokCapiLog.store_id == store_id,
        TikTokCapiLog.created_at >= effective_since,
        TikTokCapiLog.created_at <= until,
    ]
    if order_ids is not None:
        base_filters.append(TikTokCapiLog.order_id.in_(order_ids))

    status = _compute_status_metrics(db, base_filters)
    match_quality = _compute_match_quality_sample(db, base_filters, sample_cap)
    dedup = _compute_dedup(db, base_filters, status["total_sent"])

    emq_for_scoring = match_quality["avg_emq"] if match_quality["avg_emq"] is not None else 0.0
    learning_score = compute_learning_score({
        "realtime_pct": 100.0,  # TikTok relay is always same-request-cycle background task — no separate backfill path yet
        "event_match_quality": emq_for_scoring,
        "valid_purchase_pct": status["valid_purchase_pct"] or 0.0,
        "dedup_pct": dedup["dedup_pct"] if dedup["dedup_pct"] is not None else 100.0,
        "value_present_pct": status["valid_purchase_pct"] or 0.0,
        "attribution_pct": 0.0,  # Phase 3 (campaign attribution) not yet wired — see TikTok Enterprise roadmap
        "avg_latency_ms": None,
    })
    component_scores = compute_component_scores({
        "total_sent": status["total_sent"], "success": status["success"], "network_failed": status["network_failed"],
        "retry_pct": status["retry_pct"] or 0.0, "pending_pct": status["pending_pct"] or 0.0,
        "event_match_quality": emq_for_scoring, "attribution_pct": 0.0,
        "avg_completeness_pct": emq_for_scoring,
    })
    learning_score_classified = {**learning_score, **classify(learning_score["score"], meta_health_label)}

    return {
        "since": effective_since, "until": until, "requested_since": since,
        "cutover_applied": window.cutover_applied, "time_window": window.as_dict(),
        "calculated_at": status["calculated_at"], "last_success_at": status["last_success_at"],
        "total_sent": status["total_sent"], "success": status["success"], "failed": status["failed"],
        "retry": status["retry"], "pending": status["pending"], "skipped": status["skipped"],
        "network_failed": status["network_failed"],
        "valid_purchase_pct": status["valid_purchase_pct"], "rejected_pct": status["rejected_pct"],
        "tracking_coverage": status["coverage_score"], "server_reliability": status["reliability_score"],
        "event_match_quality": match_quality["avg_emq"], "sample_size": match_quality["sample_n"],
        "field_coverage": match_quality["field_coverage"],
        "dedup_pct": dedup["dedup_pct"], "duplicate_event_ids": dedup["duplicate_event_ids"],
        "learning_score": learning_score_classified,
        "component_scores": component_scores,
    }


# ─── Funnel Analytics ───────────────────────────────────────────────────────

_FUNNEL_STAGES = ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase"]
_FUNNEL_LABELS = {
    "PageView": "Visites", "ViewContent": "Vue Produit", "AddToCart": "Ajout Panier",
    "InitiateCheckout": "Début Checkout", "Purchase": "Achat",
}


def _tiktok_funnel_counts(db: Session, store_id: str, since: datetime, until: datetime) -> Dict[str, int]:
    """
    Same query shape as conversion_optimization_engine.py's _funnel_counts,
    against tiktok_capi_logs instead of meta_capi_logs — TikTok's own event
    names (EVENT_NAME_MAP) are stored on the row, so counts are grouped by
    the SAME internal stage names (PageView/ViewContent/.../Purchase) the
    Meta funnel already uses, letting a comparison dashboard line them up
    directly without a second translation layer.
    """
    from app.models.marketing import TikTokCapiLog
    from app.services.tiktok_capi import EVENT_NAME_MAP

    tiktok_event_names = [EVENT_NAME_MAP[stage] for stage in _FUNNEL_STAGES]
    rows = (
        db.query(TikTokCapiLog.event_name, func.count(func.distinct(TikTokCapiLog.event_id)))
        .filter(
            TikTokCapiLog.store_id == store_id,
            TikTokCapiLog.event_name.in_(tiktok_event_names),
            TikTokCapiLog.created_at >= since, TikTokCapiLog.created_at <= until,
        )
        .group_by(TikTokCapiLog.event_name)
        .all()
    )
    counts_by_tiktok_name = {name: count for name, count in rows}
    return {stage: counts_by_tiktok_name.get(EVENT_NAME_MAP[stage], 0) for stage in _FUNNEL_STAGES}


def compute_tiktok_funnel(db: Session, store_id: str, since: datetime, until: datetime) -> Dict[str, Any]:
    """
    Funnel Analytics — same stage-loss methodology as
    conversion_optimization_engine.compute_conversion_funnel: rate/loss
    computed stage-to-stage, worst bottleneck surfaced, never a fabricated
    "expected" conversion rate.
    """
    from app.services.tiktok_capi import EVENT_NAME_MAP

    counts = _tiktok_funnel_counts(db, store_id, since, until)
    stages = []
    worst_stage = None
    worst_loss_pct = -1.0
    for i, stage in enumerate(_FUNNEL_STAGES):
        volume = counts[stage]
        if i == 0:
            stage_rate, loss_pct = (100.0 if volume else None), None
        else:
            prev_volume = counts[_FUNNEL_STAGES[i - 1]]
            stage_rate = round(volume / prev_volume * 100, 1) if prev_volume else None
            loss_pct = round(100 - stage_rate, 1) if stage_rate is not None else None
        stages.append({
            "stage": stage, "label": _FUNNEL_LABELS[stage], "tiktok_event": EVENT_NAME_MAP[stage],
            "volume": volume, "rate_from_previous_stage": stage_rate, "loss_pct": loss_pct,
        })
        if loss_pct is not None and loss_pct > worst_loss_pct:
            worst_loss_pct = loss_pct
            worst_stage = stage

    bottleneck_message = None
    if worst_stage:
        bottleneck_message = (
            f"La majorité des pertes proviennent de l'étape {_FUNNEL_LABELS[worst_stage]} "
            f"({worst_loss_pct}% de perte à cette étape)."
        )

    return {
        "stages": stages,
        "primary_bottleneck": {"stage": worst_stage, "loss_pct": worst_loss_pct if worst_stage else None, "message": bottleneck_message},
        "population": f"{counts['PageView']} PageView, {counts['Purchase']} Purchase sur la période.",
    }
