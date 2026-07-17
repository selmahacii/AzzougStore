"""
Unit tests for the Signal Quality Center scoring helpers reused from
app/services/meta_capi.py (compute_match_quality / _MATCH_QUALITY_FIELDS).

The /meta-ads/signal-quality endpoint itself is an aggregation over
meta_capi_logs and needs a DB, so it's covered by the integration suite;
here we lock down the pure scoring building blocks it depends on, which is
where a silent miscount would actually corrupt the displayed score.

Pure functions, no DB, no network.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from types import SimpleNamespace

from app.services.meta_capi import (
    compute_match_quality, scan_payload_quality, compute_learning_score,
    diagnose_campaign_learning, evaluate_purchase_signal_quality,
    validate_purchase_event_consistency, evaluate_order_attribution,
    meta_health_label, estimate_learning_score_gains, estimate_learning_score_gains_by_field,
    compute_component_scores, analyze_meta_response, detect_metric_regressions,
    evaluate_best_practices_compliance, generate_signal_alerts,
    _latency_to_score, _MATCH_QUALITY_FIELDS, _LEARNING_SCORE_WEIGHTS,
)


def test_field_list_matches_meta_recommended_set():
    keys = {k for k, _ in _MATCH_QUALITY_FIELDS}
    # The 12 fields the Signal Quality Center reports coverage on — locking
    # this prevents a field silently dropping out and inflating the average.
    assert keys == {
        "em", "ph", "fn", "ln", "ct", "st", "country",
        "external_id", "client_ip_address", "client_user_agent", "fbp", "fbc",
    }


def test_score_is_fraction_of_present_fields():
    # Exactly half the fields present -> 50%.
    ud = {"em": ["x"], "ph": ["x"], "fn": ["x"], "ln": ["x"], "ct": ["x"], "st": ["x"]}
    result = compute_match_quality(ud)
    assert result["score"] == 50.0
    assert len(result["missing"]) == 6


def test_missing_list_names_absent_fields():
    ud = {"ph": ["x"], "country": ["x"]}
    result = compute_match_quality(ud)
    assert "Email" in result["missing"]
    assert "FBP" in result["missing"]
    assert "Téléphone" not in result["missing"]
    assert "Pays" not in result["missing"]


def test_empty_falsy_values_count_as_absent():
    # Empty strings / empty lists must NOT count as present — otherwise the
    # coverage bars would over-report and the score would be dishonestly high.
    ud = {"em": "", "ph": [], "fn": None, "ct": ["Alger"]}
    result = compute_match_quality(ud)
    present_keys = {f["key"] for f in result["fields"] if f["present"]}
    assert present_keys == {"ct"}


# ─── scan_payload_quality — section 4 data-quality checks ───────────────────

def test_scan_payload_quality_flags_nothing_on_a_clean_event():
    payload = {"custom_data": {"value": 5000, "currency": "DZD"}, "event_time": 1752000000}
    result = scan_payload_quality(payload)
    assert not any(result.values())


def test_scan_payload_quality_missing_value():
    payload = {"custom_data": {"currency": "DZD"}, "event_time": 1752000000}
    assert scan_payload_quality(payload)["missing_value"] is True

    payload_zero = {"custom_data": {"value": 0, "currency": "DZD"}, "event_time": 1752000000}
    assert scan_payload_quality(payload_zero)["missing_value"] is True


def test_scan_payload_quality_missing_currency():
    payload = {"custom_data": {"value": 5000}, "event_time": 1752000000}
    assert scan_payload_quality(payload)["missing_currency"] is True


def test_scan_payload_quality_dzd_usd_eur_are_not_flagged_as_wrong():
    for currency in ("DZD", "USD", "EUR"):
        payload = {"custom_data": {"value": 100, "currency": currency}, "event_time": 1752000000}
        assert scan_payload_quality(payload)["wrong_currency"] is False


def test_scan_payload_quality_unexpected_currency_flagged():
    payload = {"custom_data": {"value": 100, "currency": "GBP"}, "event_time": 1752000000}
    assert scan_payload_quality(payload)["wrong_currency"] is True


def test_scan_payload_quality_missing_event_time():
    payload = {"custom_data": {"value": 100, "currency": "DZD"}}
    assert scan_payload_quality(payload)["missing_event_time"] is True


def test_scan_payload_quality_handles_none_payload_without_crashing():
    result = scan_payload_quality(None)
    assert result["missing_value"] is True
    assert result["missing_currency"] is True
    assert result["missing_event_time"] is True
    assert result["wrong_currency"] is False


# ─── Learning Score ──────────────────────────────────────────────────────────

def test_latency_to_score_instant_send_is_perfect():
    assert _latency_to_score(500) == 100.0
    assert _latency_to_score(5000) == 100.0
    assert _latency_to_score(None) == 100.0  # pas de donnée != mauvaise latence


def test_latency_to_score_degrades_linearly_then_floors_at_zero():
    assert _latency_to_score(60000) == 0.0
    assert _latency_to_score(120000) == 0.0
    mid = _latency_to_score(32500)  # milieu de la fenêtre 5s -> 60s
    assert 45 < mid < 55


def test_learning_score_perfect_metrics_score_100():
    result = compute_learning_score({
        "realtime_pct": 100.0, "event_match_quality": 100.0, "valid_purchase_pct": 100.0,
        "dedup_pct": 100.0, "value_present_pct": 100.0, "attribution_pct": 100.0,
        "avg_latency_ms": 1000,
    })
    assert result["score"] == 100.0


def test_learning_score_missing_metrics_count_as_zero_not_ignored():
    # Une clé absente ne doit jamais faire disparaître son poids du calcul —
    # sinon un signal manquant gonflerait artificiellement la moyenne. Seule
    # latency_score échappe à cette règle (absence de latence != mauvaise
    # latence, voir _latency_to_score), donc le score attendu est exactement
    # son poids (10%) et rien d'autre.
    result = compute_learning_score({})
    assert result["score"] == 10.0
    assert result["components"]["latency_score"] == 100.0
    assert result["components"]["event_match_quality"] == 0.0


def test_learning_score_matches_documented_weights():
    weights = compute_learning_score({})["weights"]
    assert abs(sum(weights.values()) - 1.0) < 1e-9


# ─── Per-campaign diagnostic engine ─────────────────────────────────────────

def test_diagnose_campaign_learning_no_rules_triggered_on_healthy_metrics():
    reasons = diagnose_campaign_learning({
        "weekly_rate": 80, "backfill_pct": 5, "event_match_quality": 95,
        "missing_value_pct": 0, "missing_currency_pct": 0, "retry_pct": 1,
        "rejected_pct": 0, "avg_latency_ms": 1000, "no_utm_pct": 5,
        "frequency": 1.5, "ctr": 3.0, "impressions": 5000,
        "cost_per_purchase": 500, "aov": 5000,
    })
    assert reasons == []


def test_diagnose_campaign_learning_low_volume_flagged():
    reasons = diagnose_campaign_learning({"weekly_rate": 10})
    types = {r["type"] for r in reasons}
    assert "VOLUME_FAIBLE" in types


def test_diagnose_campaign_learning_missing_keys_never_trigger_rules():
    # Une métrique absente ne doit jamais déclencher sa règle — sinon un
    # calcul non encore disponible (ex: pas de payload échantillon) friserait
    # de fausses alertes plutôt que de rester silencieux sur le sujet.
    assert diagnose_campaign_learning({}) == []


def test_diagnose_campaign_learning_sorted_by_severity():
    reasons = diagnose_campaign_learning({
        "no_utm_pct": 50,       # low
        "retry_pct": 20,        # medium
        "missing_value_pct": 10,  # high
    })
    severities = [r["severity"] for r in reasons]
    assert severities == sorted(severities, key=lambda s: {"high": 0, "medium": 1, "low": 2}[s])


def test_diagnose_campaign_learning_each_reason_has_required_fields():
    reasons = diagnose_campaign_learning({"rejected_pct": 20})
    assert reasons
    for r in reasons:
        assert {"type", "severity", "impact", "explanation", "recommendation", "title"} <= r.keys()


def test_diagnose_campaign_learning_cpa_uses_aov_ratio_not_absolute_value():
    # Un CPA élevé en valeur absolue mais petit par rapport au panier moyen
    # ne doit pas être signalé — sinon une boutique à gros panier serait
    # pénalisée pour un CPA parfaitement rentable.
    reasons = diagnose_campaign_learning({"cost_per_purchase": 1000, "aov": 10000})
    assert not any(r["type"] == "CPA_ELEVE" for r in reasons)
    reasons_bad = diagnose_campaign_learning({"cost_per_purchase": 6000, "aov": 10000})
    assert any(r["type"] == "CPA_ELEVE" for r in reasons_bad)


# ─── Meta Optimization Engine — pre-send evaluator ──────────────────────────

def test_evaluate_purchase_signal_quality_all_fields_present_scores_100():
    event = {
        "event_name": "Purchase", "event_id": "purchase-123", "event_time": 1752000000,
        "event_source_url": "https://x.dz", "action_source": "website",
        "custom_data": {
            "value": 5000, "currency": "DZD", "order_id": "ORD-123",
            "content_type": "product", "content_ids": ["p1"],
            "contents": [{"id": "p1", "quantity": 1}], "num_items": 1,
        },
        "user_data": {
            "em": ["h"], "ph": ["h"], "fn": ["h"], "ln": ["h"], "ct": ["h"], "st": ["h"],
            "country": ["h"], "zp": ["h"], "external_id": ["h"],
            "client_ip_address": "1.2.3.4", "client_user_agent": "UA/1",
            "fbp": "fb.1.1.1", "fbc": "fb.1.1.1",
        },
    }
    result = evaluate_purchase_signal_quality(event)
    assert result["completeness_pct"] == 100.0
    assert result["missing_fields"] == []
    assert result["match_score"] == 100.0


def test_evaluate_purchase_signal_quality_handles_none_without_crashing():
    result = evaluate_purchase_signal_quality(None)
    assert result["completeness_pct"] == 0.0
    assert "event_id" in result["missing_fields"]


def test_evaluate_purchase_signal_quality_missing_fields_carry_explanation_not_fabricated_data():
    event = {"event_id": "purchase-123", "custom_data": {}, "user_data": {}}
    result = evaluate_purchase_signal_quality(event)
    value_check = next(c for c in result["checks"] if c["field"] == "value")
    assert value_check["present"] is False
    assert value_check["why_if_missing"]  # une explication réelle, jamais une valeur inventée
    assert value_check["fix"]
    present_check = next(c for c in result["checks"] if c["field"] == "event_id")
    assert present_check["present"] is True
    assert present_check["why_if_missing"] is None  # jamais d'explication sur un champ présent
    assert present_check["fix"] is None


def test_evaluate_purchase_signal_quality_match_score_equals_compute_match_quality():
    # Le "Match Score" ne doit jamais être un second calcul divergent de l'EMQ
    # déjà affiché ailleurs — même entrée, même sortie, une seule vérité.
    ud = {"em": ["h"], "ph": ["h"]}
    event = {"user_data": ud, "custom_data": {}}
    assert evaluate_purchase_signal_quality(event)["match_score"] == compute_match_quality(ud)["score"]


# ─── Meta Health label ───────────────────────────────────────────────────────

def test_meta_health_label_bands():
    assert meta_health_label(None) == "Non disponible"
    assert meta_health_label(95) == "Excellent"
    assert meta_health_label(80) == "Bon"
    assert meta_health_label(60) == "Moyen"
    assert meta_health_label(40) == "Faible"
    assert meta_health_label(10) == "Critique"


# ─── Estimated Learning Score gains — real recomputation, not invented ──────

def test_estimate_learning_score_gains_perfect_metrics_yield_no_gains():
    perfect = {
        "realtime_pct": 100.0, "event_match_quality": 100.0, "valid_purchase_pct": 100.0,
        "dedup_pct": 100.0, "value_present_pct": 100.0, "attribution_pct": 100.0,
        "avg_latency_ms": 0,
    }
    assert estimate_learning_score_gains(perfect) == []


def test_estimate_learning_score_gains_matches_documented_weight():
    # Porter event_match_quality de 0 à 100 doit gagner EXACTEMENT son poids
    # (20%) multiplié par 100 points — recalcul réel, pas une estimation.
    gains = estimate_learning_score_gains({"event_match_quality": 0.0})
    emq_gain = next(g for g in gains if g["component"] == "event_match_quality")
    assert emq_gain["gain_points"] == round(_LEARNING_SCORE_WEIGHTS["event_match_quality"] * 100, 1)


def test_estimate_learning_score_gains_sorted_descending():
    gains = estimate_learning_score_gains({})
    values = [g["gain_points"] for g in gains]
    assert values == sorted(values, reverse=True)


# ─── evaluate_purchase_signal_quality — extended field list ────────────────

def test_evaluate_purchase_signal_quality_checks_content_fields_too():
    event = {
        "event_name": "Purchase", "event_id": "purchase-1", "event_time": 1,
        "action_source": "website",
        "custom_data": {"value": 100, "currency": "DZD", "order_id": "ORD-1",
                         "content_type": "product", "content_ids": ["p1"],
                         "contents": [{"id": "p1", "quantity": 1}], "num_items": 1},
        "user_data": {},
    }
    result = evaluate_purchase_signal_quality(event)
    checked_fields = {c["field"] for c in result["checks"]}
    assert {"event_name", "order_id", "content_type", "content_ids", "contents", "num_items"} <= checked_fields
    for f in ("event_name", "order_id", "content_type", "content_ids", "contents", "num_items"):
        assert next(c for c in result["checks"] if c["field"] == f)["present"] is True


def test_evaluate_purchase_signal_quality_includes_consistency_results():
    event = {"custom_data": {"value": -5, "currency": "DZD"}, "event_time": 1}
    result = evaluate_purchase_signal_quality(event)
    assert any(e["field"] == "value" for e in result["blocking_errors"])


# ─── validate_purchase_event_consistency — value/currency/time sanity ──────

def test_validate_purchase_event_consistency_clean_event_has_no_issues():
    event = {"event_time": 1000, "custom_data": {"value": 100, "currency": "DZD", "content_ids": ["p1"]}}
    result = validate_purchase_event_consistency(event, now=1000 + 3600)
    assert result["blocking_errors"] == []
    assert result["warnings"] == []


def test_validate_purchase_event_consistency_negative_value_is_blocking():
    event = {"custom_data": {"value": -100, "currency": "DZD"}}
    result = validate_purchase_event_consistency(event)
    assert any(e["field"] == "value" for e in result["blocking_errors"])


def test_validate_purchase_event_consistency_bad_currency_format_is_blocking():
    event = {"custom_data": {"value": 100, "currency": "dzd"}}  # minuscule = invalide
    result = validate_purchase_event_consistency(event)
    assert any(e["field"] == "currency" for e in result["blocking_errors"])


def test_validate_purchase_event_consistency_unknown_but_valid_currency_is_warning_only():
    event = {"custom_data": {"value": 100, "currency": "JPY"}}
    result = validate_purchase_event_consistency(event)
    assert result["blocking_errors"] == []
    assert any(w["field"] == "currency" for w in result["warnings"])


def test_validate_purchase_event_consistency_future_event_time_is_blocking():
    now = 1_000_000
    result = validate_purchase_event_consistency({"event_time": now + 3600, "custom_data": {}}, now=now)
    assert any(e["field"] == "event_time" and e["issue"] == "dans le futur" for e in result["blocking_errors"])


def test_validate_purchase_event_consistency_stale_event_time_is_blocking():
    now = 1_000_000
    eight_days_ago = now - 8 * 86400
    result = validate_purchase_event_consistency({"event_time": eight_days_ago, "custom_data": {}}, now=now)
    assert any(e["field"] == "event_time" and "fenêtre" in e["issue"] for e in result["blocking_errors"])


def test_validate_purchase_event_consistency_empty_content_id_is_warning():
    event = {"custom_data": {"value": 100, "currency": "DZD", "content_ids": ["p1", ""]}}
    result = validate_purchase_event_consistency(event)
    assert any(w["field"] == "content_ids" for w in result["warnings"])


def test_validate_purchase_event_consistency_handles_none_without_crashing():
    result = validate_purchase_event_consistency(None)
    assert result == {"blocking_errors": [], "warnings": []}


# ─── estimate_learning_score_gains_by_field — exact per-field math ─────────

def test_estimate_learning_score_gains_by_field_exact_math():
    components = {"event_match_quality": 50.0}
    # fbp à 0% de couverture -> le porter à 100% relève l'EMQ moyen
    # exactement de (100-0)/12 points de pourcentage.
    coverage = {"fbp": 0.0}
    gains = estimate_learning_score_gains_by_field(components, coverage)
    assert len(gains) == 1
    expected_new_emq = 50.0 + (100.0 / 12)
    expected_score = compute_learning_score({**components, "event_match_quality": expected_new_emq})["score"]
    base_score = compute_learning_score(components)["score"]
    assert gains[0]["gain_points"] == round(expected_score - base_score, 1)


def test_estimate_learning_score_gains_by_field_skips_fields_already_at_100():
    gains = estimate_learning_score_gains_by_field({"event_match_quality": 90.0}, {"fbp": 100.0})
    assert gains == []


def test_estimate_learning_score_gains_by_field_sorted_descending():
    gains = estimate_learning_score_gains_by_field(
        {"event_match_quality": 30.0}, {"fbp": 0.0, "fbc": 50.0, "em": 90.0}
    )
    values = [g["gain_points"] for g in gains]
    assert values == sorted(values, reverse=True)


# ─── meta_health_label already covered above; evaluate_order_attribution ───

def test_evaluate_order_attribution_full_signal_present():
    order = SimpleNamespace(
        campaign_id="c1", adset_id="a1", ad_id="ad1",
        utm_source="facebook", utm_medium="cpc", utm_campaign="promo",
        utm_content="v1", utm_term="shoes", event_source_url="https://x.dz/lp",
    )
    result = evaluate_order_attribution(order)
    assert result["attribution_completeness_pct"] == 100.0
    assert result["likely_organic"] is False
    assert all(c["why_if_missing"] is None for c in result["checks"])


def test_evaluate_order_attribution_fully_organic_order_is_not_flagged_as_anomaly():
    order = SimpleNamespace(
        campaign_id=None, adset_id=None, ad_id=None,
        utm_source=None, utm_medium=None, utm_campaign=None,
        utm_content=None, utm_term=None, event_source_url=None,
    )
    result = evaluate_order_attribution(order)
    assert result["likely_organic"] is True
    assert all("normale" in c["why_if_missing"] for c in result["checks"])


def test_evaluate_order_attribution_partial_signal_flagged_differently_than_organic():
    order = SimpleNamespace(
        campaign_id="c1", adset_id=None, ad_id=None,
        utm_source="facebook", utm_medium="cpc", utm_campaign="promo",
        utm_content=None, utm_term=None, event_source_url="https://x.dz/lp",
    )
    result = evaluate_order_attribution(order)
    assert result["likely_organic"] is False
    adset_check = next(c for c in result["checks"] if c["field"] == "adset_id")
    assert "normale" not in adset_check["why_if_missing"]


# ─── compute_component_scores — no duplication between named sub-scores ────

def test_compute_component_scores_meta_acceptance_merges_tracking():
    # Tracking et Meta Acceptance ont été volontairement fusionnés (même
    # ratio success/total_sent) — un seul champ "meta_acceptance", jamais
    # deux clés portant le même nombre sous des noms différents.
    scores = compute_component_scores({"total_sent": 100, "success": 80})
    assert scores["meta_acceptance"] == 80.0
    assert set(scores.keys()) == {"meta_acceptance", "matching", "attribution", "delivery", "queue", "event_quality"}


def test_compute_component_scores_delivery_isolates_network_failures():
    scores = compute_component_scores({"total_sent": 100, "success": 70, "network_failed": 10})
    assert scores["delivery"] == 90.0  # 10% d'échecs réseau, indépendant du taux d'acceptation Meta


def test_compute_component_scores_missing_metrics_default_honestly():
    scores = compute_component_scores({})
    assert scores["meta_acceptance"] == 0.0
    assert scores["delivery"] == 100.0  # aucun envoi = aucun échec réseau constaté, pas une pénalité


# ─── Meta Response Analyzer ─────────────────────────────────────────────────

def test_analyze_meta_response_no_error_returns_no_diagnosis():
    result = analyze_meta_response(None)
    assert result["category"] == "unknown"
    assert result["confidence"] is None


def test_analyze_meta_response_detects_token_error():
    result = analyze_meta_response("OAuthException: Error validating access token")
    assert result["category"] == "token_expire"


def test_analyze_meta_response_detects_duplicate_event():
    result = analyze_meta_response("This event_id has already been received (duplicate)")
    assert result["category"] == "duplicate_event"


def test_analyze_meta_response_network_category_wins_when_no_text_match():
    result = analyze_meta_response("connection reset", error_category="network_error")
    assert result["category"] == "network_issue"


def test_analyze_meta_response_unrecognized_error_is_honest_not_guessed():
    result = analyze_meta_response("some completely novel error text nobody has seen before")
    assert result["category"] == "unknown_error"
    assert result["confidence"] is None


# ─── detect_metric_regressions — unified drift/regression/anomaly engine ───

def test_detect_metric_regressions_no_change_no_regressions():
    snapshot = {"learning_score": 90, "event_match_quality": 90}
    assert detect_metric_regressions(snapshot, dict(snapshot)) == []


def test_detect_metric_regressions_emq_drop_flagged_with_threshold():
    regressions = detect_metric_regressions({"event_match_quality": 92}, {"event_match_quality": 76})
    assert any(r["metric"] == "event_match_quality" for r in regressions)
    r = next(r for r in regressions if r["metric"] == "event_match_quality")
    assert r["delta"] == -16.0
    assert "baissé" in r["message"]


def test_detect_metric_regressions_small_change_not_flagged():
    # En dessous du seuil documenté (5 points pour l'EMQ) — pas un faux positif.
    regressions = detect_metric_regressions({"event_match_quality": 92}, {"event_match_quality": 89})
    assert regressions == []


def test_detect_metric_regressions_backfill_rise_flagged():
    regressions = detect_metric_regressions({"backfill_pct": 2}, {"backfill_pct": 15})
    assert any(r["metric"] == "backfill_pct" and r["direction"] == "rise" for r in regressions)


def test_detect_metric_regressions_missing_metric_in_either_snapshot_is_skipped():
    # Jamais traité comme 0 — une métrique absente d'un instantané n'a rien
    # à comparer, donc ignorée plutôt que fabriquée en régression.
    assert detect_metric_regressions({}, {"event_match_quality": 10}) == []
    assert detect_metric_regressions({"event_match_quality": 90}, {}) == []


def test_detect_metric_regressions_identifies_biggest_field_coverage_drop():
    regressions = detect_metric_regressions(
        {"event_match_quality": 92}, {"event_match_quality": 76},
        field_coverage_previous={"fbp": 90, "fbc": 90, "em": 100},
        field_coverage_current={"fbp": 10, "fbc": 85, "em": 100},
    )
    r = next(r for r in regressions if r["metric"] == "event_match_quality")
    assert "FBP" in r["likely_cause"]


def test_detect_metric_regressions_sorted_by_severity():
    regressions = detect_metric_regressions(
        {"backfill_pct": 2, "rejected_pct": 0, "learning_score": 90},
        {"backfill_pct": 20, "rejected_pct": 10, "learning_score": 60},
    )
    severities = [r["severity"] for r in regressions]
    assert severities == sorted(severities, key=lambda s: {"high": 0, "medium": 1, "low": 2}[s])


# ─── Meta Best Practices Validator ──────────────────────────────────────────

def test_evaluate_best_practices_compliance_conforme():
    signal_eval = {"blocking_errors": [], "warnings": [], "completeness_pct": 95.0, "match_score": 90.0}
    assert evaluate_best_practices_compliance(signal_eval)["verdict"] == "Conforme"


def test_evaluate_best_practices_compliance_non_conforme_on_blocking_error():
    signal_eval = {"blocking_errors": [{"field": "value", "issue": "négative"}], "warnings": [], "completeness_pct": 100.0, "match_score": 100.0}
    assert evaluate_best_practices_compliance(signal_eval)["verdict"] == "Non conforme"


def test_evaluate_best_practices_compliance_partiellement_conforme():
    signal_eval = {"blocking_errors": [], "warnings": [{"field": "fbc"}], "completeness_pct": 70.0, "match_score": 60.0}
    assert evaluate_best_practices_compliance(signal_eval)["verdict"] == "Partiellement conforme"


# ─── Alertes intelligentes — exact thresholds ───────────────────────────────

def test_generate_signal_alerts_all_thresholds():
    alerts = generate_signal_alerts({
        "event_match_quality": 70, "tracking_coverage": 90, "learning_score": 75,
        "backfill_pct": 15, "retry_pct": 5, "rejected_pct": 3, "avg_latency_ms": 6000,
    })
    metrics_alerted = {a["metric"] for a in alerts}
    assert metrics_alerted == {
        "event_match_quality", "tracking_coverage", "learning_score",
        "backfill_pct", "retry_pct", "rejected_pct", "avg_latency_ms",
    }


def test_generate_signal_alerts_healthy_metrics_yield_nothing():
    alerts = generate_signal_alerts({
        "event_match_quality": 95, "tracking_coverage": 99, "learning_score": 95,
        "backfill_pct": 2, "retry_pct": 0.5, "rejected_pct": 0.1, "avg_latency_ms": 1000,
    })
    assert alerts == []


def test_generate_signal_alerts_critical_before_warning():
    alerts = generate_signal_alerts({"learning_score": 70, "rejected_pct": 5})
    assert alerts[0]["level"] == "critical"


def test_generate_signal_alerts_missing_metric_not_treated_as_zero():
    # event_match_quality absent (pas mesuré) ne doit jamais déclencher
    # l'alerte "EMQ < 80%" comme si elle valait 0.
    alerts = generate_signal_alerts({})
    assert alerts == []
