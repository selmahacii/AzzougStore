"""
Meta Analytics Engine — canonical, single source of truth for every Meta
CAPI health metric shown on the dashboard (Signal Quality Center,
Optimization Advisor, per-campaign view, daily Learning Score, KPI
Validation page).

Why this exists (audit 2026-07-17): the same-named metric was computed
with different formulas/populations in different endpoints of
app/api/v1/meta_ads.py:
  - attribution_pct: store-wide used (success - orphan_campaign) / success
    (population = successfully-sent CAPI events), while the per-campaign
    Optimization Advisor used (orders_count - no_utm_count) / orders_count
    (population = raw orders) — same key name, different denominators.
  - total_sent: store-wide excluded `skipped` logs, per-campaign included
    them.
  - dedup_pct: store-wide divided by `timing_n` (successes only, capped at
    1000), per-campaign divided by `total_sent` (all statuses, uncapped).
These divergences fed the SAME weighted Learning Score under the same key,
so the store-wide and per-campaign Learning Scores were not comparable
even for identical underlying data.

Every endpoint that needs a Meta CAPI health metric MUST call
`compute_meta_metrics()` below instead of recomputing it locally. See
MetricDefinition / METRIC_REGISTRY at the bottom for what each field means,
its exact formula, population, period and source.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.services.meta_capi import (
    NEW_ENGINE_CUTOVER_DATE,
    compute_match_quality,
    scan_payload_quality,
    classify_capi_log_timing,
    evaluate_purchase_signal_quality,
    compute_learning_score,
    compute_component_scores,
    compute_meta_optimization_score,
    meta_health_label,
    detect_funnel_bottleneck,
    _MATCH_QUALITY_FIELDS,
)

# Une seule palette de couleurs par label de bande — les labels eux-mêmes
# viennent des fonctions canoniques ci-dessus (meta_health_label &co,
# meta_capi.py:1688+), jamais un second barème de seuils inventé ici. Le
# frontend consomme `level`/`color` tels quels : aucune logique de seuil
# ne doit être ré-écrite en TSX.
_LEVEL_COLORS: Dict[str, str] = {
    "Excellent": "#00B894", "Excellente": "#00B894", "Très bon": "#00B894",
    "Bon": "#0984E3", "Bonne": "#0984E3",
    "Moyen": "#FDCB6E", "À surveiller": "#FDCB6E",
    "Faible": "#E17055",
    "Critique": "#E17055",
    "Non disponible": "#B2BEC3",
}


def classify(score: Optional[float], label_fn) -> Dict[str, Any]:
    """
    Attache un label et une couleur canoniques à un score déjà calculé —
    ne recalcule jamais le score lui-même. `label_fn` est une des
    fonctions de bandes de meta_capi.py (meta_health_label,
    campaign_classification_label, meta_optimization_label).
    """
    label = label_fn(score)
    return {"score": score, "label": label, "color": _LEVEL_COLORS.get(label, _LEVEL_COLORS["Non disponible"])}


@dataclass
class MetricsTimeWindow:
    """
    Everything a diagnostic endpoint needs to know about the period it's
    computing over, and NOTHING it should ever derive itself. Every field
    here answers a question a frontend widget (or a human reading a JSON
    response) can legitimately ask:
      - requested_since / requested_until: what the caller asked for,
        verbatim — never silently discarded, so a mismatch is visible.
      - effective_since / effective_until: what was ACTUALLY used to
        query the database — this is what every KPI number reflects.
      - cutover_applied: True when effective_since was pulled forward to
        NEW_ENGINE_CUTOVER_DATE because the caller asked for something
        earlier and did not explicitly opt into legacy data.
      - include_legacy_data: echoes the caller's own choice back, so it's
        never ambiguous whether pre-cutover rows were deliberately
        included or accidentally excluded.
      - label: a ready-to-display French string ("16/07/2026 → 20/07/2026
        (donnée historique exclue)") — every widget shows the SAME
        wording instead of each one formatting the window differently.
    """
    requested_since: datetime
    requested_until: datetime
    effective_since: datetime
    effective_until: datetime
    cutover_applied: bool
    include_legacy_data: bool
    label: str

    def as_dict(self) -> Dict[str, Any]:
        return {
            "requested_since": self.requested_since, "requested_until": self.requested_until,
            "effective_since": self.effective_since, "effective_until": self.effective_until,
            "cutover_applied": self.cutover_applied, "include_legacy_data": self.include_legacy_data,
            "label": self.label,
        }


def resolve_metrics_time_window(
    since: datetime,
    until: datetime,
    *,
    include_legacy_data: bool = False,
    cutover_date: Optional[datetime] = None,
) -> MetricsTimeWindow:
    """
    THE single place that decides what date range an ad-platform diagnostic
    actually queries over. Every endpoint that currently does its own
    `now - timedelta(days=N)` (see the Priorité 2 audit — 8 endpoints do
    this independently, with 7/30-day values hardcoded and no cutover
    awareness) should call this instead and use its `.effective_since`/
    `.effective_until` for every query, and expose `.as_dict()` in its
    response so the frontend can render the period unambiguously — no
    endpoint should ever compute or format a date window on its own.

    `cutover_date` defaults to NEW_ENGINE_CUTOVER_DATE (Meta's 16/07/2026
    durable-queue go-live) — omit it for every Meta call site, unchanged
    behavior. Pass a different date for another platform's own durable-
    queue go-live (e.g. TikTok Ads Enterprise, see
    app/services/tiktok_analytics_engine.py's TIKTOK_ENGINE_LAUNCH_DATE) —
    this is what makes the function genuinely platform-generic instead of
    Meta needing a second, duplicated copy of this same resolution logic.

    Applies the same cutover floor already used by compute_meta_metrics
    (kept in perfect sync: this function is now that logic's only
    implementation — compute_meta_metrics delegates to it rather than
    repeating it).
    """
    cutover = cutover_date if cutover_date is not None else NEW_ENGINE_CUTOVER_DATE
    effective_since = since if include_legacy_data else max(since, cutover)
    cutover_applied = effective_since != since

    cutover_label = cutover.strftime("%d/%m/%Y")
    since_label = effective_since.strftime("%d/%m/%Y")
    until_label = until.strftime("%d/%m/%Y")
    label = f"{since_label} → {until_label}"
    if cutover_applied:
        label += f" (données antérieures au {cutover_label} exclues)"
    elif include_legacy_data and since < cutover:
        label += f" (inclut des données antérieures au {cutover_label} — comparaison explicite avant/après)"

    return MetricsTimeWindow(
        requested_since=since, requested_until=until,
        effective_since=effective_since, effective_until=until,
        cutover_applied=cutover_applied, include_legacy_data=include_legacy_data,
        label=label,
    )


def compute_funnel_metrics(stages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Ré-exporté depuis meta_capi.detect_funnel_bottleneck — point d'entrée
    UNIQUE pour l'analyse de funnel, pour que tout appelant (endpoint ou
    futur dashboard) passe par le moteur plutôt que d'importer
    meta_capi directement.
    """
    return detect_funnel_bottleneck(stages)


def _pct(numerator: float, denominator: float) -> Optional[float]:
    """
    Rounds a percentage, or returns None (not 0.0) when the denominator is
    0 — an empty sample is "no data", never "0% quality". Callers display
    None as N/A rather than a misleading 0%.
    """
    if not denominator:
        return None
    return round(numerator / denominator * 100, 1)


# ─────────────────────────────────────────────────────────────────────────
# Priorité 2 (2026-07-20) — compute_meta_metrics() extracted into the
# sub-functions below, one per section it already had (status counts /
# match quality sample / timing+dedup / attribution / composite scores).
# Pure refactor: same queries, same formulas, same populations, same
# return shapes — compute_meta_metrics() just orchestrates these instead
# of inlining ~250 lines. No caller-visible behavior change.
# ─────────────────────────────────────────────────────────────────────────

def _compute_status_metrics(db: Session, base_filters: list) -> Dict[str, Any]:
    """Section 1: envoi status counts + the percentages/scores derived from them."""
    from app.models.marketing import MetaCapiLog

    status_rows = (
        db.query(MetaCapiLog.status, MetaCapiLog.error_category, func.count(MetaCapiLog.id))
        .filter(*base_filters)
        .group_by(MetaCapiLog.status, MetaCapiLog.error_category)
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
    coverage_score = _pct(success, total_sent)  # "Tracking Coverage" == meta_acceptance, un seul nom
    reliability_score = (
        round(max(0.0, 100 - (rejected_pct * 3)), 1) if rejected_pct is not None else None
    )

    # Horodatage — pour que le dashboard affiche EXPLICITEMENT sur quoi le
    # calcul porte (mode temps réel : recalculé à chaque appel de cette
    # fonction, jamais un cache), plutôt que de laisser deviner si le
    # chiffre affiché est frais ou périmé.
    calculated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    last_success_at = (
        db.query(func.max(MetaCapiLog.created_at))
        .filter(*base_filters, MetaCapiLog.status == "success")
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


def _compute_match_quality_sample(
    db: Session, base_filters: list, order_ids: Optional[List[str]], sample_cap: int,
) -> Dict[str, Any]:
    """Section 2: Event Match Quality — moyenne + couverture par champ, sur un
    échantillon plafonné des Purchase réussis. None si aucun succès sur la
    fenêtre (jamais 0%, qui laisserait croire à des champs vides alors
    qu'il n'y a simplement eu aucun envoi réussi à mesurer)."""
    from app.models.marketing import MetaCapiLog

    _sample_query = (
        db.query(MetaCapiLog.payload)
        .filter(*base_filters, MetaCapiLog.status == "success", MetaCapiLog.payload.isnot(None))
        .order_by(MetaCapiLog.created_at.desc())
    )
    # Le cap ne s'applique qu'en store-wide (order_ids=None) — une campagne
    # unique reste naturellement bornée par son propre volume, capper
    # aurait sous-échantillonné sans raison par rapport à l'ancien calcul
    # par-campagne (non plafonné).
    sample = (_sample_query.limit(sample_cap) if order_ids is None else _sample_query).all()
    field_present_counts = {key: 0 for key, _ in _MATCH_QUALITY_FIELDS}
    emq_scores: List[float] = []
    completeness_scores: List[float] = []
    missing_value = missing_currency = missing_event_time = wrong_currency = 0
    for (payload,) in sample:
        ud = (payload or {}).get("user_data") or {}
        mq = compute_match_quality(ud)
        emq_scores.append(mq["score"])
        for f in mq["fields"]:
            if f["present"]:
                field_present_counts[f["key"]] += 1
        pq = scan_payload_quality(payload)
        missing_value += int(pq["missing_value"])
        missing_currency += int(pq["missing_currency"])
        wrong_currency += int(pq["wrong_currency"])
        missing_event_time += int(pq["missing_event_time"])
        completeness_scores.append(evaluate_purchase_signal_quality(payload)["completeness_pct"])
    sample_n = len(sample)
    avg_emq = round(sum(emq_scores) / sample_n, 1) if sample_n else None
    avg_completeness_pct = round(sum(completeness_scores) / sample_n, 1) if sample_n else None
    from app.services.meta_capi import _META_FIELD_CLASSIFICATION
    field_coverage = [
        {
            "key": key, "label": label,
            "coverage_pct": _pct(field_present_counts[key], sample_n),
            "missing_pct": _pct(sample_n - field_present_counts[key], sample_n),
            # Expose la classification pour que le dashboard affiche
            # explicitement "Non applicable" (email sur un funnel COD) au lieu
            # d'un pourcentage qui laisserait croire à un défaut à corriger.
            "classification": _META_FIELD_CLASSIFICATION.get(key, "recommended"),
        }
        for key, label in _MATCH_QUALITY_FIELDS
    ]
    value_present_pct = _pct(sample_n - missing_value, sample_n)
    missing_currency_pct = _pct(missing_currency, sample_n)
    missing_event_time_pct = _pct(missing_event_time, sample_n)

    return {
        "sample_n": sample_n, "avg_emq": avg_emq, "avg_completeness_pct": avg_completeness_pct,
        "field_coverage": field_coverage, "field_present_counts": field_present_counts,
        "value_present_pct": value_present_pct,
        "missing_value": missing_value, "missing_currency": missing_currency,
        "missing_currency_pct": missing_currency_pct,
        "missing_event_time": missing_event_time, "missing_event_time_pct": missing_event_time_pct,
        "wrong_currency": wrong_currency,
    }


def _compute_timing_and_dedup(
    db: Session, base_filters: list, order_ids: Optional[List[str]],
    effective_since: datetime, until: datetime, timing_cap: int, total_sent: int,
) -> Dict[str, Any]:
    """Section 3: Temps réel / Backfill / Latence / Déduplication — UNE requête
    jointe bornée par date et plafonnée. dedup_pct est calculé sur
    `total_sent` (tous statuts), pas seulement les succès plafonnés —
    sinon un doublon parmi des envois `failed`/`retry` restait invisible
    côté store-wide."""
    from app.models.marketing import MetaCapiLog
    from app.models.order import Order
    from app.models.audit import AuditLog

    backfill_order_ids = {
        row[0] for row in (
            db.query(AuditLog.entity_id)
            .filter(AuditLog.action == "capi_marked_backfill", AuditLog.entity == "order",
                    AuditLog.created_at >= effective_since, AuditLog.created_at <= until)
            .all()
        )
    }
    timing_query = (
        db.query(MetaCapiLog.order_id, MetaCapiLog.created_at, MetaCapiLog.latency_ms, MetaCapiLog.event_id,
                  Order.created_at)
        .join(Order, Order.id == MetaCapiLog.order_id)
        .filter(*base_filters, MetaCapiLog.status == "success")
        .order_by(MetaCapiLog.created_at.desc())
    )
    timing_rows = timing_query.limit(timing_cap).all() if order_ids is None else timing_query.all()

    realtime_n = backfill_n = 0
    latencies: List[int] = []
    for oid, log_created_at, latency_ms, event_id, order_created_at in timing_rows:
        is_backfill = oid in backfill_order_ids or classify_capi_log_timing(log_created_at, order_created_at) == "backfill"
        if is_backfill:
            backfill_n += 1
        else:
            realtime_n += 1
        if latency_ms is not None:
            latencies.append(latency_ms)
    timing_n = realtime_n + backfill_n
    realtime_pct = _pct(realtime_n, timing_n)
    backfill_pct = _pct(backfill_n, timing_n)
    avg_latency_ms = round(sum(latencies) / len(latencies)) if latencies else None
    max_latency_ms = max(latencies) if latencies else None

    # Dédoublonnage : compté sur TOUS les statuts envoyés (total_sent), pas
    # seulement les succès plafonnés — même échantillon que total_sent.
    all_event_id_rows = (
        db.query(MetaCapiLog.event_id)
        .filter(*base_filters)
        .all()
    )
    all_event_id_counts: Dict[str, int] = {}
    for (eid,) in all_event_id_rows:
        all_event_id_counts[eid] = all_event_id_counts.get(eid, 0) + 1
    dup_n = sum(1 for c in all_event_id_counts.values() if c > 1)
    dedup_pct = round((1 - dup_n / total_sent) * 100, 1) if total_sent else None

    return {
        "realtime_n": realtime_n, "backfill_n": backfill_n, "timing_n": timing_n,
        "realtime_pct": realtime_pct, "backfill_pct": backfill_pct,
        "avg_latency_ms": avg_latency_ms, "max_latency_ms": max_latency_ms,
        "dedup_pct": dedup_pct,
    }


def _compute_attribution(db: Session, base_filters: list, success: int) -> Dict[str, Any]:
    """Section 4: Attribution — UNE SEULE définition partout : parmi les
    Purchase envoyés avec succès, la part rattachable à une campagne connue
    (order.campaign_id ou utm_campaign)."""
    from app.models.marketing import MetaCapiLog
    from app.models.order import Order

    orphan_campaign = (
        db.query(func.count(MetaCapiLog.id))
        .join(Order, Order.id == MetaCapiLog.order_id)
        .filter(*base_filters, MetaCapiLog.status == "success",
                Order.campaign_id.is_(None), func.coalesce(Order.utm_campaign, "") == "")
        .scalar() or 0
    )
    attribution_pct = _pct(success - orphan_campaign, success)
    return {"attribution_pct": attribution_pct, "orphan_campaign": orphan_campaign}


def _compute_composite_scores(
    *, coverage_score, avg_emq, reliability_score, realtime_pct, valid_purchase_pct,
    dedup_pct, value_present_pct, attribution_pct, avg_latency_ms, total_sent, success,
    network_failed, retry_pct, pending_pct, avg_completeness_pct, effective_since, until,
    field_coverage,
) -> Dict[str, Any]:
    """Section 5: Scores composés — chaque sous-score réutilise un chiffre
    déjà calculé en amont, jamais recalculé indépendamment."""
    emq_for_scoring = avg_emq if avg_emq is not None else 0.0
    global_score = round(
        sum(v if v is not None else 0.0 for v in (coverage_score, emq_for_scoring, reliability_score)) / 3, 1
    )

    _learning_components = {
        "realtime_pct": realtime_pct or 0.0,
        "event_match_quality": emq_for_scoring,
        "valid_purchase_pct": valid_purchase_pct or 0.0,
        "dedup_pct": dedup_pct if dedup_pct is not None else 100.0,
        "value_present_pct": value_present_pct or 0.0,
        "attribution_pct": attribution_pct or 0.0,
        "avg_latency_ms": avg_latency_ms,
    }
    learning_score = compute_learning_score(_learning_components)

    component_scores = compute_component_scores({
        "total_sent": total_sent, "success": success, "network_failed": network_failed,
        "retry_pct": retry_pct or 0.0, "pending_pct": pending_pct or 0.0,
        "event_match_quality": emq_for_scoring, "attribution_pct": attribution_pct or 0.0,
        "avg_completeness_pct": avg_completeness_pct or 0.0,
    })
    weekly_purchase_rate = success / max((until - effective_since).days / 7, 1)
    optimization_score = compute_meta_optimization_score(
        learning_score["score"], component_scores, {"purchase": weekly_purchase_rate}
    )

    # ── Classification — label + couleur attachés à CHAQUE score exposé, en
    # utilisant les bandes canoniques de meta_capi.py. Le frontend ne doit
    # plus jamais réinventer un `score >= X ? couleur`. ──
    learning_score_classified = {**learning_score, **classify(learning_score["score"], meta_health_label)}
    global_score_classified = classify(global_score, meta_health_label)
    component_scores_classified = {
        key: classify(value, meta_health_label) for key, value in component_scores.items()
    }
    # ATTENTION : field_coverage a déjà une clé "label" (le nom du champ,
    # "Email"/"FBP"/...) — la classification qualité utilise donc des clés
    # distinctes (quality_label/quality_color) pour ne jamais l'écraser.
    field_coverage_classified = [
        {**f, "quality_label": (c := classify(f["coverage_pct"], meta_health_label))["label"], "quality_color": c["color"]}
        for f in field_coverage
    ]

    return {
        "global_score": global_score, "global_score_classified": global_score_classified,
        "learning_score_classified": learning_score_classified,
        "component_scores": component_scores, "component_scores_classified": component_scores_classified,
        "optimization_score": optimization_score,
        "field_coverage_classified": field_coverage_classified,
    }


def compute_meta_metrics(
    db: Session,
    store_id: str,
    since: datetime,
    until: datetime,
    *,
    order_ids: Optional[List[str]] = None,
    sample_cap: int = 500,
    timing_cap: int = 1000,
    include_legacy_data: bool = False,
) -> Dict[str, Any]:
    """
    Canonical Meta CAPI health metrics for a date window.

    - order_ids=None: store-wide (every Purchase MetaCapiLog for this
      store in [since, until]).
    - order_ids=[...]: scoped to those orders only (per-campaign view) —
      SAME formulas, SAME populations as store-wide, just filtered to a
      smaller order set, so results are directly comparable.

    Every percentage is None when its sample is empty (see `_pct`) —
    never silently coerced to 0.0. Callers decide how to render None
    (typically "N/A" / "Aucune donnée disponible").

    `since` is floored to NEW_ENGINE_CUTOVER_DATE (2026-07-16) unless
    include_legacy_data=True is passed explicitly — a caller asking for
    "last 90 days" three months from now should still not silently drag
    pre-cutover rows (known defects fixed by the durable-queue rework)
    into a metric presented as reflecting the current engine's quality.
    Pass include_legacy_data=True for the rare case an admin explicitly
    wants a before/after comparison across the cutover.
    """
    from app.models.marketing import MetaCapiLog

    window = resolve_metrics_time_window(since, until, include_legacy_data=include_legacy_data)
    effective_since = window.effective_since

    base_filters = [
        MetaCapiLog.store_id == store_id,
        MetaCapiLog.event_name == "Purchase",
        MetaCapiLog.created_at >= effective_since,
        MetaCapiLog.created_at <= until,
    ]
    if order_ids is not None:
        # order_ids == [] (campagne sans commande matchée) doit renvoyer un
        # jeu de résultats vide, jamais tout le store — in_([]) le fait déjà
        # nativement en SQLAlchemy (génère une condition toujours fausse).
        base_filters.append(MetaCapiLog.order_id.in_(order_ids))

    status = _compute_status_metrics(db, base_filters)
    success, failed, retry, pending, skipped = (
        status["success"], status["failed"], status["retry"], status["pending"], status["skipped"]
    )
    total_sent, network_failed = status["total_sent"], status["network_failed"]
    valid_purchase_pct, rejected_pct = status["valid_purchase_pct"], status["rejected_pct"]
    retry_pct, pending_pct = status["retry_pct"], status["pending_pct"]
    coverage_score, reliability_score = status["coverage_score"], status["reliability_score"]
    calculated_at, last_success_at = status["calculated_at"], status["last_success_at"]

    match_quality = _compute_match_quality_sample(db, base_filters, order_ids, sample_cap)
    sample_n, avg_emq = match_quality["sample_n"], match_quality["avg_emq"]
    avg_completeness_pct = match_quality["avg_completeness_pct"]
    field_coverage = match_quality["field_coverage"]
    field_present_counts = match_quality["field_present_counts"]
    value_present_pct = match_quality["value_present_pct"]
    missing_value, missing_currency = match_quality["missing_value"], match_quality["missing_currency"]
    missing_currency_pct = match_quality["missing_currency_pct"]
    missing_event_time, missing_event_time_pct = (
        match_quality["missing_event_time"], match_quality["missing_event_time_pct"]
    )
    wrong_currency = match_quality["wrong_currency"]

    timing = _compute_timing_and_dedup(db, base_filters, order_ids, effective_since, until, timing_cap, total_sent)
    realtime_n, backfill_n, timing_n = timing["realtime_n"], timing["backfill_n"], timing["timing_n"]
    realtime_pct, backfill_pct = timing["realtime_pct"], timing["backfill_pct"]
    avg_latency_ms, max_latency_ms = timing["avg_latency_ms"], timing["max_latency_ms"]
    dedup_pct = timing["dedup_pct"]

    attribution = _compute_attribution(db, base_filters, success)
    attribution_pct, orphan_campaign = attribution["attribution_pct"], attribution["orphan_campaign"]

    scores = _compute_composite_scores(
        coverage_score=coverage_score, avg_emq=avg_emq, reliability_score=reliability_score,
        realtime_pct=realtime_pct, valid_purchase_pct=valid_purchase_pct, dedup_pct=dedup_pct,
        value_present_pct=value_present_pct, attribution_pct=attribution_pct, avg_latency_ms=avg_latency_ms,
        total_sent=total_sent, success=success, network_failed=network_failed, retry_pct=retry_pct,
        pending_pct=pending_pct, avg_completeness_pct=avg_completeness_pct,
        effective_since=effective_since, until=until, field_coverage=field_coverage,
    )
    global_score, global_score_classified = scores["global_score"], scores["global_score_classified"]
    learning_score_classified = scores["learning_score_classified"]
    component_scores, component_scores_classified = scores["component_scores"], scores["component_scores_classified"]
    optimization_score = scores["optimization_score"]
    field_coverage_classified = scores["field_coverage_classified"]

    return {
        # "since" is the window ACTUALLY used (post-cutover floor unless
        # include_legacy_data=True) — what every number below was computed
        # over. "requested_since" preserves what the caller originally
        # asked for, so a widget can show both ("Fenêtre : 16/07/2026 →
        # aujourd'hui" even if the caller requested 90 days back) instead
        # of silently reporting a period that doesn't match the data.
        # "time_window" carries the full MetricsTimeWindow (incl. the
        # ready-to-display `label`) for callers that want it directly
        # instead of reassembling it from the individual keys below.
        "since": effective_since, "until": until,
        "requested_since": since,
        "cutover_applied": window.cutover_applied,
        "time_window": window.as_dict(),
        "calculated_at": calculated_at, "last_success_at": last_success_at,
        "calculation_mode": "realtime_on_demand",
        "total_sent": total_sent, "success": success, "failed": failed,
        "retry": retry, "pending": pending, "skipped": skipped, "network_failed": network_failed,
        "valid_purchase_pct": valid_purchase_pct, "rejected_pct": rejected_pct,
        "retry_pct": retry_pct, "pending_pct": pending_pct,
        "tracking_coverage": coverage_score, "server_reliability": reliability_score,
        "event_match_quality": avg_emq, "match_quality": avg_emq,
        "sample_size": sample_n, "field_coverage": field_coverage_classified,
        "field_present_counts": field_present_counts,
        "value_present_pct": value_present_pct, "missing_value_count": missing_value,
        "missing_currency_pct": missing_currency_pct, "missing_currency_count": missing_currency,
        "missing_event_time_pct": missing_event_time_pct, "missing_event_time_count": missing_event_time,
        "wrong_currency_count": wrong_currency,
        "realtime_pct": realtime_pct, "backfill_pct": backfill_pct,
        "realtime_count": realtime_n, "backfill_count": backfill_n, "timing_sample_size": timing_n,
        "avg_latency_ms": avg_latency_ms, "max_latency_ms": max_latency_ms,
        "dedup_pct": dedup_pct,
        "attribution_pct": attribution_pct, "orphan_campaign": orphan_campaign,
        "avg_completeness_pct": avg_completeness_pct,
        "global_score": global_score, "signal_score": global_score_classified,
        "learning_score": learning_score_classified,
        "component_scores": component_scores, "component_scores_classified": component_scores_classified,
        "optimization_score": optimization_score,
    }


# ─────────────────────────────────────────────────────────────────────────
# KPI registry — one MetricDefinition per dashboard indicator. Documents
# what compute_meta_metrics() actually does, so a formula change is a
# deliberate, reviewable edit to ONE entry here instead of a silent drift
# across N copy-pasted endpoints.
# ─────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class MetricDefinition:
    name: str
    label: str
    description: str
    formula: str
    population: str
    period: str
    source: str
    benchmark: Optional[str] = None
    na_when_empty: bool = True
    unit: str = "%"
    # Bandes de seuils affichées telles quelles par le frontend (label +
    # couleur déjà résolus par classify()) — documentées ici pour que la
    # provenance du niveau/couleur affiché soit traçable depuis le
    # registre, jamais réinventée en TSX.
    bands: str = "90/75/55/35/0 -> Excellent/Bon/Moyen/Faible/Critique (meta_health_label)"
    recommendation: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name, "label": self.label, "description": self.description,
            "formula": self.formula, "population": self.population, "period": self.period,
            "source": self.source, "benchmark": self.benchmark, "na_when_empty": self.na_when_empty,
            "unit": self.unit, "bands": self.bands, "recommendation": self.recommendation,
        }


METRIC_REGISTRY: Dict[str, MetricDefinition] = {
    d.name: d for d in [
        MetricDefinition(
            name="learning_score",
            label="Learning Score",
            description="Score unique répondant à \"Meta reçoit-il des signaux assez bons pour bien apprendre ?\".",
            formula="Moyenne pondérée : realtime 20%, EMQ 20%, valid_purchase 20%, dedup 10%, value_present 10%, attribution 10%, latence 10%.",
            population="Tous les MetaCapiLog Purchase de la fenêtre (store-wide ou scoping campagne).",
            period="30 jours glissants (par défaut, configurable via date_from/date_to).",
            source="compute_meta_metrics() -> compute_learning_score()",
            benchmark=">=80 = sain, 50-79 = à surveiller, <50 = critique",
            recommendation="Si faible : identifier le composant le plus bas (estimated_gains) et le corriger en priorité — jamais ajuster le score directement.",
        ),
        MetricDefinition(
            name="global_score",
            label="Signal Score",
            description="Moyenne simple à 3 termes : couverture d'envoi, EMQ, fiabilité serveur.",
            formula="(tracking_coverage + event_match_quality + server_reliability) / 3",
            population="Idem learning_score.",
            period="30 jours glissants.",
            source="compute_meta_metrics()",
            recommendation="Si faible : vérifier lequel des 3 sous-scores tire la moyenne vers le bas dans la réponse détaillée.",
        ),
        MetricDefinition(
            name="event_match_quality",
            label="Event Match Quality (EMQ)",
            description="Proxy honnête de l'EMQ Meta (le score exact n'est jamais exposé par l'API) — complétude des 12 champs recommandés.",
            formula="présents / 12 champs (em, ph, fn, ln, ct, st, country, external_id, ip, user_agent, fbp, fbc) × 100, moyenné sur l'échantillon.",
            population="Purchase status='success' avec payload non-null, échantillon plafonné à 500 (store-wide) / non plafonné (par campagne).",
            period="30 jours glissants.",
            source="compute_match_quality() appelé par compute_meta_metrics()",
            benchmark="Meta : >=6/10 acceptable, <4/10 problématique",
            recommendation="Si bas : vérifier field_coverage pour identifier quel champ (fbp/fbc/ip/user_agent en tête) manque le plus souvent côté checkout.",
        ),
        MetricDefinition(
            name="tracking_coverage",
            label="Tracking Coverage",
            description="Part des Purchase envoyés qui ont été acceptés par Meta (statut success).",
            formula="success / total_sent × 100",
            population="Tous statuts confondus (success/failed/retry/pending/skipped).",
            period="30 jours glissants.",
            source="compute_meta_metrics()",
            recommendation="Si bas : voir purchase_breakdown (failed/retry/pending) pour la cause dominante.",
        ),
        MetricDefinition(
            name="server_reliability",
            label="Server Reliability",
            description="Fiabilité applicative de l'envoi (pénalise les rejets Meta, pas les pannes réseau propres).",
            formula="max(0, 100 - rejected_pct × 3), rejected_pct = failed / total_sent × 100",
            population="Idem tracking_coverage.",
            period="30 jours glissants.",
            source="compute_meta_metrics()",
            recommendation="Si bas : vérifier la Santé du Pixel (token/scopes) — un rejet Meta n'est presque jamais un problème réseau.",
        ),
        MetricDefinition(
            name="attribution_pct",
            label="Attribution",
            description="Part des Purchase réussis rattachables à une campagne connue (campaign_id ou utm_campaign sur la commande).",
            formula="(success - orphan_campaign) / success × 100",
            population="Purchase status='success' uniquement.",
            period="30 jours glissants.",
            source="compute_meta_metrics() — définition UNIQUE, remplace l'ancienne divergence store-wide vs par-campagne.",
            recommendation="Si bas : vérifier le tracking UTM sur les liens publicitaires (souvent des ventes organiques/directes, normal en partie).",
        ),
        MetricDefinition(
            name="realtime_pct",
            label="Temps réel",
            description="Part des Purchase envoyés en temps réel (vs rattrapés en backfill).",
            formula="realtime_n / (realtime_n + backfill_n) × 100",
            population="Purchase status='success', jointure Order pour la classification temps réel/backfill.",
            period="30 jours glissants.",
            source="classify_capi_log_timing() + compute_meta_metrics()",
            recommendation="Si bas : vérifier que l'envoi CAPI se déclenche bien au moment de la commande, pas seulement lors d'un rattrapage manuel.",
        ),
        MetricDefinition(
            name="backfill_pct",
            label="Backfill",
            description="Complément de realtime_pct.",
            formula="backfill_n / (realtime_n + backfill_n) × 100",
            population="Idem realtime_pct.",
            period="30 jours glissants.",
            source="compute_meta_metrics()",
        ),
        MetricDefinition(
            name="dedup_pct",
            label="Déduplication",
            description="Part des event_id envoyés sans doublon (Pixel + CAPI partagent le même event_id).",
            formula="(1 - doublons / total_sent) × 100",
            population="TOUS les statuts (total_sent) — avant cet engine, le store-wide ne comptait que les succès plafonnés à 1000.",
            period="30 jours glissants.",
            source="compute_meta_metrics()",
            recommendation="Si bas : investiguer manuellement — un event_id dupliqué n'est jamais attendu (contrainte unique en base).",
        ),
        MetricDefinition(
            name="valid_purchase_pct",
            label="Purchase valides",
            description="Part des Purchase acceptés par Meta.",
            formula="success / total_sent × 100",
            population="Tous statuts.",
            period="30 jours glissants.",
            source="compute_meta_metrics()",
        ),
        MetricDefinition(
            name="rejected_pct",
            label="Purchase rejetés",
            description="Part des Purchase rejetés par Meta (status=failed).",
            formula="failed / total_sent × 100",
            population="Tous statuts.",
            period="30 jours glissants.",
            source="compute_meta_metrics()",
        ),
        MetricDefinition(
            name="value_present_pct",
            label="Valeur monétaire",
            description="Part des Purchase avec une valeur monétaire non nulle dans custom_data.value.",
            formula="(échantillon - missing_value) / échantillon × 100",
            population="Même échantillon que l'EMQ (Purchase success, plafonné à 500 store-wide).",
            period="30 jours glissants.",
            source="scan_payload_quality() + compute_meta_metrics()",
            recommendation="Si bas : vérifier order.total sur les commandes concernées (produit gratuit ? item sans prix ?).",
        ),
        MetricDefinition(
            name="avg_latency_ms",
            label="Latence moyenne",
            description="Délai moyen entre la commande (ou sa reprise) et l'envoi effectif du Purchase à Meta.",
            formula="moyenne(latency_ms) sur les envois réussis de la fenêtre.",
            population="Purchase status='success' avec latency_ms renseigné.",
            period="30 jours glissants.",
            source="compute_meta_metrics()",
            unit="ms",
            bands="<=5000ms -> 100, >=60000ms -> 0, dégradé linéairement entre les deux (_latency_to_score)",
        ),
        MetricDefinition(
            name="component_scores",
            label="Meta Optimization Advisor — sous-scores",
            description="Décomposition en 6 sous-scores nommés (meta_acceptance, matching, attribution, delivery, queue, event_quality), chacun réutilisant un chiffre déjà calculé ci-dessus.",
            formula="Voir compute_component_scores() — jamais un chiffre recalculé indépendamment.",
            population="Idem compute_meta_metrics() dans son ensemble.",
            period="30 jours glissants.",
            source="compute_component_scores()",
        ),
        MetricDefinition(
            name="optimization_score",
            label="Meta Optimization Advisor — score global",
            description="Score global /100 pondérant learning_score, meta_acceptance, queue, event_quality et l'adéquation de volume (Purchase/semaine vs repère ~50/semaine).",
            formula="Voir compute_meta_optimization_score() — pondération _META_OPTIMIZATION_WEIGHTS.",
            population="Idem compute_meta_metrics().",
            period="30 jours glissants.",
            source="compute_meta_optimization_score()",
            bands="90/80/65/45/0 -> Excellent/Très bon/Bon/Moyen/Critique (meta_optimization_label)",
        ),
        MetricDefinition(
            name="funnel",
            label="Funnel (goulot d'étranglement)",
            description="Étape du funnel (AddToCart -> InitiateCheckout -> Purchase, etc.) où le taux de passage réel est le plus en dessous de son repère indicatif.",
            formula="Voir detect_funnel_bottleneck() — ratio entre étapes consécutives comparé à un seuil par transition (_FUNNEL_TRANSITIONS).",
            population="Stages fournis par GET /meta-ads/funnel (comptages déjà agrégés, jamais recalculés ici).",
            period="Période sélectionnée sur le dashboard (indépendante de la fenêtre 30 jours des autres KPI).",
            source="compute_funnel_metrics() (ré-export de meta_capi.detect_funnel_bottleneck)",
            na_when_empty=False,
        ),
    ]
}


def get_metric_registry_payload() -> List[Dict[str, Any]]:
    """Sérialisation JSON du registre — endpoint unique consommé par le frontend pour les métadonnées (labels, formules, bandes, recommandations), jamais dupliquées en TSX."""
    return [d.to_dict() for d in METRIC_REGISTRY.values()]
