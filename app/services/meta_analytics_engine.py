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

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.services.meta_capi import (
    compute_match_quality,
    scan_payload_quality,
    classify_capi_log_timing,
    evaluate_purchase_signal_quality,
    compute_learning_score,
    compute_component_scores,
    _MATCH_QUALITY_FIELDS,
)


def _pct(numerator: float, denominator: float) -> Optional[float]:
    """
    Rounds a percentage, or returns None (not 0.0) when the denominator is
    0 — an empty sample is "no data", never "0% quality". Callers display
    None as N/A rather than a misleading 0%.
    """
    if not denominator:
        return None
    return round(numerator / denominator * 100, 1)


def compute_meta_metrics(
    db: Session,
    store_id: str,
    since: datetime,
    until: datetime,
    *,
    order_ids: Optional[List[str]] = None,
    sample_cap: int = 500,
    timing_cap: int = 1000,
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
    """
    from app.models.marketing import MetaCapiLog
    from app.models.order import Order
    from app.models.audit import AuditLog

    base_filters = [
        MetaCapiLog.store_id == store_id,
        MetaCapiLog.event_name == "Purchase",
        MetaCapiLog.created_at >= since,
        MetaCapiLog.created_at <= until,
    ]
    if order_ids is not None:
        # order_ids == [] (campagne sans commande matchée) doit renvoyer un
        # jeu de résultats vide, jamais tout le store — in_([]) le fait déjà
        # nativement en SQLAlchemy (génère une condition toujours fausse).
        base_filters.append(MetaCapiLog.order_id.in_(order_ids))

    # ── 1. Statuts — total_sent inclut TOUJOURS skipped (harmonisé : avant
    # cet engine, le store-wide l'omettait et le par-campagne l'incluait). ──
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

    # ── 2. Event Match Quality — moyenne + couverture par champ, sur un
    # échantillon PLAFONNÉ des Purchase réussis (payload contient user_data
    # depuis le correctif de stockage-sur-succès). None si aucun succès sur
    # la fenêtre (jamais 0%, qui laisserait croire à des champs vides alors
    # qu'il n'y a simplement eu aucun envoi réussi à mesurer). ──
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
    field_coverage = [
        {
            "key": key, "label": label,
            "coverage_pct": _pct(field_present_counts[key], sample_n),
            "missing_pct": _pct(sample_n - field_present_counts[key], sample_n),
        }
        for key, label in _MATCH_QUALITY_FIELDS
    ]
    value_present_pct = _pct(sample_n - missing_value, sample_n)
    missing_currency_pct = _pct(missing_currency, sample_n)
    missing_event_time_pct = _pct(missing_event_time, sample_n)

    # ── 3. Temps réel / Backfill / Latence / Déduplication — UNE requête
    # jointe bornée par date et plafonnée. dedup_pct est désormais calculé
    # sur `total_sent` (tous statuts) et non plus sur les seuls succès
    # plafonnés — sinon un doublon parmi des envois `failed`/`retry` restait
    # invisible côté store-wide. ──
    backfill_order_ids = {
        row[0] for row in (
            db.query(AuditLog.entity_id)
            .filter(AuditLog.action == "capi_marked_backfill", AuditLog.entity == "order",
                    AuditLog.created_at >= since, AuditLog.created_at <= until)
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
    event_id_counts: Dict[str, int] = {}
    for oid, log_created_at, latency_ms, event_id, order_created_at in timing_rows:
        is_backfill = oid in backfill_order_ids or classify_capi_log_timing(log_created_at, order_created_at) == "backfill"
        if is_backfill:
            backfill_n += 1
        else:
            realtime_n += 1
        if latency_ms is not None:
            latencies.append(latency_ms)
        event_id_counts[event_id] = event_id_counts.get(event_id, 0) + 1
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

    # ── 4. Attribution — UNE SEULE définition partout : parmi les Purchase
    # envoyés avec succès, la part rattachable à une campagne connue
    # (order.campaign_id ou utm_campaign). Ex-Advisor utilisait
    # (orders_count - no_utm_count)/orders_count (population = commandes
    # brutes, pas CAPI réussis) — c'était la régression : deux dénominateurs
    # différents sous le même nom. ──
    orphan_campaign = (
        db.query(func.count(MetaCapiLog.id))
        .join(Order, Order.id == MetaCapiLog.order_id)
        .filter(*base_filters, MetaCapiLog.status == "success",
                Order.campaign_id.is_(None), func.coalesce(Order.utm_campaign, "") == "")
        .scalar() or 0
    )
    attribution_pct = _pct(success - orphan_campaign, success)

    # ── 5. Scores composés — chaque sous-score réutilise un chiffre déjà
    # calculé ci-dessus, jamais recalculé indépendamment. ──
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

    return {
        "since": since, "until": until,
        "total_sent": total_sent, "success": success, "failed": failed,
        "retry": retry, "pending": pending, "skipped": skipped, "network_failed": network_failed,
        "valid_purchase_pct": valid_purchase_pct, "rejected_pct": rejected_pct,
        "retry_pct": retry_pct, "pending_pct": pending_pct,
        "tracking_coverage": coverage_score, "server_reliability": reliability_score,
        "event_match_quality": avg_emq, "match_quality": avg_emq,
        "sample_size": sample_n, "field_coverage": field_coverage,
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
        "global_score": global_score,
        "learning_score": learning_score,
        "component_scores": component_scores,
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
        ),
        MetricDefinition(
            name="global_score",
            label="Signal Score",
            description="Moyenne simple à 3 termes : couverture d'envoi, EMQ, fiabilité serveur.",
            formula="(tracking_coverage + event_match_quality + server_reliability) / 3",
            population="Idem learning_score.",
            period="30 jours glissants.",
            source="compute_meta_metrics()",
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
        ),
        MetricDefinition(
            name="tracking_coverage",
            label="Tracking Coverage",
            description="Part des Purchase envoyés qui ont été acceptés par Meta (statut success).",
            formula="success / total_sent × 100",
            population="Tous statuts confondus (success/failed/retry/pending/skipped).",
            period="30 jours glissants.",
            source="compute_meta_metrics()",
        ),
        MetricDefinition(
            name="server_reliability",
            label="Server Reliability",
            description="Fiabilité applicative de l'envoi (pénalise les rejets Meta, pas les pannes réseau propres).",
            formula="max(0, 100 - rejected_pct × 3), rejected_pct = failed / total_sent × 100",
            population="Idem tracking_coverage.",
            period="30 jours glissants.",
            source="compute_meta_metrics()",
        ),
        MetricDefinition(
            name="attribution_pct",
            label="Attribution",
            description="Part des Purchase réussis rattachables à une campagne connue (campaign_id ou utm_campaign sur la commande).",
            formula="(success - orphan_campaign) / success × 100",
            population="Purchase status='success' uniquement.",
            period="30 jours glissants.",
            source="compute_meta_metrics() — définition UNIQUE, remplace l'ancienne divergence store-wide vs par-campagne.",
        ),
        MetricDefinition(
            name="realtime_pct",
            label="Temps réel",
            description="Part des Purchase envoyés en temps réel (vs rattrapés en backfill).",
            formula="realtime_n / (realtime_n + backfill_n) × 100",
            population="Purchase status='success', jointure Order pour la classification temps réel/backfill.",
            period="30 jours glissants.",
            source="classify_capi_log_timing() + compute_meta_metrics()",
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
    ]
}
