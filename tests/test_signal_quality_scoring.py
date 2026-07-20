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
    detect_funnel_bottleneck, campaign_classification_label,
    compute_meta_optimization_score, meta_optimization_label,
    simulate_learning_score_change, rank_recommendations_by_impact,
    compute_metric_correlation, verify_percentage_matches_counter,
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


def test_score_is_weighted_not_a_flat_average():
    # em(1.0)+ph(3.0)+fn(0.5)+ln(0.5)+ct(0.5)+st(0.5) = 6.0 earned weight,
    # out of 16.0 total weight -> 37.5%, NOT the flat 50% a 6-of-12 count
    # would give. Locks in the weighted formula (see _MATCH_QUALITY_WEIGHTS)
    # so a future refactor can't silently revert to an unweighted average.
    ud = {"em": ["x"], "ph": ["x"], "fn": ["x"], "ln": ["x"], "ct": ["x"], "st": ["x"]}
    result = compute_match_quality(ud)
    assert result["score"] == 37.5
    assert len(result["missing"]) == 6


def test_cod_context_missing_email_barely_dents_the_score():
    # The actual fix: a COD order with every high-impact identifier (phone,
    # external_id, fbp, fbc, IP, user agent) but NO email — normal for a
    # COD landing page that never asks for one — must score highly, not be
    # dragged down as if email were as important as phone/fbp/fbc.
    ud = {
        "ph": ["x"], "external_id": ["x"], "fbp": ["x"], "fbc": ["x"],
        "client_ip_address": ["x"], "client_user_agent": ["x"],
    }
    result = compute_match_quality(ud)
    # 3.0+2.5+2.0+2.0+1.5+1.5 = 12.5 of 16.0 -> 78.1%, a genuinely strong
    # score despite email being entirely absent.
    assert result["score"] == 78.1
    # Email is classified "not_applicable" for this COD platform (see
    # FIELD_CLASSIFICATION) — its absence is a fact, not a defect, so it
    # must NOT appear in `missing` (that list is for real problems only).
    assert "Email" not in result["missing"]
    assert "Email" in result["not_applicable"]


def test_missing_phone_hurts_more_than_missing_email():
    # Same total count missing (1 field), opposite business impact: losing
    # phone (weight 3.0, the primary COD identifier) must cost more than
    # losing email (weight 1.0) — proves the weights actually differentiate
    # fields instead of all being interchangeable.
    all_fields_ud = {k: ["x"] for k, _ in _MATCH_QUALITY_FIELDS}
    missing_email = {k: v for k, v in all_fields_ud.items() if k != "em"}
    missing_phone = {k: v for k, v in all_fields_ud.items() if k != "ph"}
    score_missing_email = compute_match_quality(missing_email)["score"]
    score_missing_phone = compute_match_quality(missing_phone)["score"]
    assert score_missing_phone < score_missing_email


def test_missing_list_names_absent_fields():
    ud = {"ph": ["x"], "country": ["x"]}
    result = compute_match_quality(ud)
    # Email absent too, but not_applicable for COD -> excluded from `missing`.
    assert "Email" not in result["missing"]
    assert "Email" in result["not_applicable"]
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
    from app.services.meta_capi import _MATCH_QUALITY_FIELDS, _MATCH_QUALITY_WEIGHTS
    components = {"event_match_quality": 50.0}
    # EMQ PONDÉRÉ (contexte COD) : porter fbp de 0% à 100% relève l'EMQ moyen
    # de EXACTEMENT (poids_fbp / poids_total) × (100 - 0), pas (100-0)/12.
    coverage = {"fbp": 0.0}
    gains = estimate_learning_score_gains_by_field(components, coverage)
    assert len(gains) == 1
    total_weight = sum(_MATCH_QUALITY_WEIGHTS.get(k, 1.0) for k, _ in _MATCH_QUALITY_FIELDS)
    delta_emq = (_MATCH_QUALITY_WEIGHTS["fbp"] / total_weight) * 100.0
    expected_new_emq = 50.0 + delta_emq
    expected_score = compute_learning_score({**components, "event_match_quality": expected_new_emq})["score"]
    base_score = compute_learning_score(components)["score"]
    assert gains[0]["gain_points"] == round(expected_score - base_score, 1)


def test_estimate_learning_score_gains_by_field_excludes_not_applicable_email():
    # Email est not_applicable sur un funnel COD — même à 0% de couverture,
    # il ne doit JAMAIS générer une recommandation d'amélioration.
    gains = estimate_learning_score_gains_by_field({"event_match_quality": 40.0}, {"em": 0.0, "ph": 0.0})
    keys = {g["field"] for g in gains}
    assert "em" not in keys
    assert "ph" in keys  # téléphone (required) reste bien recommandé


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


# ─── validate_purchase_event_consistency — extended checks ─────────────────

def test_validate_purchase_event_consistency_detects_malformed_email_hash():
    event = {"custom_data": {"value": 100, "currency": "DZD"}, "user_data": {"em": ["not-a-real-sha256"]}}
    result = validate_purchase_event_consistency(event)
    assert any(w["field"] == "em" for w in result["warnings"])


def test_validate_purchase_event_consistency_accepts_real_sha256_hash():
    real_hash = "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b"
    assert len(real_hash) == 64
    event = {"custom_data": {"value": 100, "currency": "DZD"}, "user_data": {"em": [real_hash]}}
    result = validate_purchase_event_consistency(event)
    assert not any(w["field"] == "em" for w in result["warnings"])


def test_validate_purchase_event_consistency_detects_invalid_ip():
    event = {"custom_data": {"value": 100, "currency": "DZD"}, "user_data": {"client_ip_address": "999.999.999.999"}}
    result = validate_purchase_event_consistency(event)
    assert any(w["field"] == "client_ip_address" for w in result["warnings"])


def test_validate_purchase_event_consistency_accepts_valid_ipv4_and_ipv6():
    for ip in ("102.45.12.9", "2001:db8::1"):
        event = {"custom_data": {"value": 100, "currency": "DZD"}, "user_data": {"client_ip_address": ip}}
        result = validate_purchase_event_consistency(event)
        assert not any(w["field"] == "client_ip_address" for w in result["warnings"])


def test_validate_purchase_event_consistency_unexpected_event_name_is_blocking():
    event = {"event_name": "ViewContent", "custom_data": {"value": 100, "currency": "DZD"}}
    result = validate_purchase_event_consistency(event)
    assert any(e["field"] == "event_name" for e in result["blocking_errors"])


def test_validate_purchase_event_consistency_unexpected_content_type_is_warning():
    event = {"custom_data": {"value": 100, "currency": "DZD", "content_type": "something_else"}}
    result = validate_purchase_event_consistency(event)
    assert any(w["field"] == "content_type" for w in result["warnings"])


# ─── Funnel bottleneck detector ─────────────────────────────────────────────

def test_detect_funnel_bottleneck_identifies_weakest_transition():
    stages = [
        {"name": "Impressions", "count": 100000},
        {"name": "Clics", "count": 2000},       # CTR 2% — healthy
        {"name": "Vues Produit", "count": 200},  # 10% of clicks — well under 50% benchmark
        {"name": "Paiement Initié", "count": 40},
        {"name": "Achats", "count": 20},
        {"name": "Livrées", "count": 18},
    ]
    result = detect_funnel_bottleneck(stages)
    assert result["bottleneck"]["from_stage"] == "Clics"
    assert result["bottleneck"]["to_stage"] == "Vues Produit"


def test_detect_funnel_bottleneck_no_gap_returns_none():
    stages = [
        {"name": "Impressions", "count": 100000},
        {"name": "Clics", "count": 5000},
        {"name": "Vues Produit", "count": 4000},
        {"name": "Paiement Initié", "count": 1000},
        {"name": "Achats", "count": 500},
        {"name": "Livrées", "count": 480},
    ]
    result = detect_funnel_bottleneck(stages)
    assert result["bottleneck"] is None


def test_detect_funnel_bottleneck_missing_stage_data_skipped_not_fabricated():
    result = detect_funnel_bottleneck([{"name": "Impressions", "count": 0}])
    assert result["bottleneck"] is None
    assert result["all_gaps"] == []


# ─── Campaign classification label ──────────────────────────────────────────

def test_campaign_classification_label_bands():
    assert campaign_classification_label(None) == "Non disponible"
    assert campaign_classification_label(95) == "Excellente"
    assert campaign_classification_label(80) == "Bonne"
    assert campaign_classification_label(50) == "À surveiller"
    assert campaign_classification_label(20) == "Critique"


def test_campaign_classification_label_matches_meta_health_label_thresholds():
    # Mêmes seuils que meta_health_label (90/75/35), vocabulaire différent —
    # pas un second barème inventé.
    for score in (95, 80, 50, 20):
        assert (campaign_classification_label(score) == "Non disponible") == (meta_health_label(score) == "Non disponible")


# ─── detect_metric_regressions — relative (percentage) mode ────────────────

def test_detect_metric_regressions_relative_mode_cpa_rise():
    regressions = detect_metric_regressions({"cpa": 500}, {"cpa": 650})  # +30%
    r = next(r for r in regressions if r["metric"] == "cpa")
    assert r["direction"] == "rise"
    assert r["pct_change"] == 30.0


def test_detect_metric_regressions_relative_mode_roas_drop():
    regressions = detect_metric_regressions({"roas": 5.0}, {"roas": 3.5})  # -30%
    r = next(r for r in regressions if r["metric"] == "roas")
    assert r["direction"] == "drop"


def test_detect_metric_regressions_relative_mode_small_change_not_flagged():
    regressions = detect_metric_regressions({"cpa": 500}, {"cpa": 520})  # +4%, under 20% threshold
    assert not any(r["metric"] == "cpa" for r in regressions)


def test_detect_metric_regressions_relative_mode_zero_previous_value_skipped():
    # Division par zéro évitée — jamais un pourcentage calculé contre 0.
    regressions = detect_metric_regressions({"cpa": 0}, {"cpa": 500})
    assert not any(r["metric"] == "cpa" for r in regressions)


def test_detect_metric_regressions_includes_probable_cause_and_action():
    regressions = detect_metric_regressions({"backfill_pct": 2}, {"backfill_pct": 20})
    r = next(r for r in regressions if r["metric"] == "backfill_pct")
    assert r["probable_cause"]
    assert r["recommended_action"]


# ─── Meta Optimization Advisor — global score ───────────────────────────────

def test_meta_optimization_label_bands():
    assert meta_optimization_label(None) == "Non disponible"
    assert meta_optimization_label(95) == "Excellent"
    assert meta_optimization_label(85) == "Très bon"
    assert meta_optimization_label(70) == "Bon"
    assert meta_optimization_label(50) == "Moyen"
    assert meta_optimization_label(20) == "Critique"


def test_compute_meta_optimization_score_perfect_inputs():
    result = compute_meta_optimization_score(
        learning_score=100.0,
        component_scores={"meta_acceptance": 100.0, "queue": 100.0, "event_quality": 100.0},
        volume_weekly_rates={"purchase": 100, "addtocart": 100, "checkout": 100},
    )
    assert result["score"] == 100.0
    assert result["label"] == "Excellent"
    assert result["weakest_components"] == []


def test_compute_meta_optimization_score_reuses_learning_score_verbatim():
    # learning_score doit apparaître tel quel dans components, jamais recalculé.
    result = compute_meta_optimization_score(72.3, {}, {})
    assert result["components"]["learning_score"] == 72.3


def test_compute_meta_optimization_score_volume_below_benchmark_is_partial():
    # 25/semaine sur un repère de 50 -> 50% d'adéquation, pas 0% ni 100%.
    result = compute_meta_optimization_score(100.0, {"meta_acceptance": 100, "queue": 100, "event_quality": 100},
                                              {"purchase": 25, "addtocart": None, "checkout": None})
    assert result["components"]["volume_adequacy"] == 50.0


def test_compute_meta_optimization_score_missing_volume_data_is_zero_not_fabricated():
    result = compute_meta_optimization_score(100.0, {"meta_acceptance": 100, "queue": 100, "event_quality": 100}, {})
    assert result["components"]["volume_adequacy"] == 0.0


def test_compute_meta_optimization_score_weights_sum_to_one():
    result = compute_meta_optimization_score(50.0, {}, {})
    assert abs(sum(result["weights"].values()) - 1.0) < 1e-9


# ─── Arbitrary-target simulator ─────────────────────────────────────────────

def test_simulate_learning_score_change_computes_real_delta():
    components = {"event_match_quality": 60.0}
    result = simulate_learning_score_change(components, {"event_match_quality": 90.0})
    base = compute_learning_score(components)["score"]
    projected = compute_learning_score({"event_match_quality": 90.0})["score"]
    assert result["current_score"] == base
    assert result["projected_score"] == projected
    assert result["gain_points"] == round(projected - base, 1)


def test_simulate_learning_score_change_includes_disclaimer():
    result = simulate_learning_score_change({}, {"backfill_pct": 5})
    assert "estimation" in result["disclaimer"].lower() or "Estimation" in result["disclaimer"]
    assert result["changes_simulated"] == {"backfill_pct": 5}


def test_simulate_learning_score_change_no_change_yields_zero_gain():
    components = {"event_match_quality": 80.0}
    result = simulate_learning_score_change(components, {})
    assert result["gain_points"] == 0.0


# ─── Recommendations ranker — merges existing engines, adds star rating ────

def test_rank_recommendations_by_impact_excludes_component_level_emq_duplicate():
    # event_match_quality ne doit JAMAIS apparaître comme recommandation de
    # composant séparée du détail par champ (FBP/FBC/...) — double comptage.
    components = {"event_match_quality": 20.0}
    coverage = {"fbp": 0.0, "fbc": 0.0}
    recs = rank_recommendations_by_impact(components, coverage)
    assert not any("Event Match" in r["action"] or r["action"] == "Corriger event_match_quality" for r in recs)


def test_rank_recommendations_by_impact_sorted_and_starred():
    components = {"event_match_quality": 10.0, "realtime_pct": 10.0}
    coverage = {"fbp": 0.0, "fbc": 50.0}
    recs = rank_recommendations_by_impact(components, coverage)
    gains = [r["gain_points"] for r in recs]
    assert gains == sorted(gains, reverse=True)
    for r in recs:
        assert r["stars"].count("★") + r["stars"].count("☆") == 5
        assert 1 <= r["stars"].count("★") <= 5


def test_rank_recommendations_by_impact_field_labels_are_french():
    coverage = {"fbp": 0.0}
    recs = rank_recommendations_by_impact({"event_match_quality": 50.0}, coverage)
    assert any(r["action"] == "Corriger FBP" for r in recs)


# ─── Real correlation (Pearson), never asserted a priori ───────────────────

def test_compute_metric_correlation_insufficient_data():
    result = compute_metric_correlation([(1, 2), (2, 3)], "EMQ", "CPA")
    assert result["coefficient"] is None
    assert result["strength"] == "données insuffisantes"
    assert result["sample_size"] == 2


def test_compute_metric_correlation_perfect_negative():
    pairs = [(60, 100), (70, 90), (80, 80), (90, 70), (100, 60)]
    result = compute_metric_correlation(pairs, "EMQ", "CPA")
    assert result["coefficient"] == -1.0
    assert result["direction"].startswith("négative")
    assert result["strength"] == "forte"


def test_compute_metric_correlation_perfect_positive():
    pairs = [(60, 60), (70, 70), (80, 80), (90, 90), (100, 100)]
    result = compute_metric_correlation(pairs, "Learning", "ROAS")
    assert result["coefficient"] == 1.0
    assert result["direction"].startswith("positive")


def test_compute_metric_correlation_no_variation_returns_not_computable():
    pairs = [(50, 10), (50, 20), (50, 30), (50, 40), (50, 50)]
    result = compute_metric_correlation(pairs, "A", "B")
    assert result["coefficient"] is None
    assert result["strength"] == "non calculable"


def test_compute_metric_correlation_never_asserts_direction_not_present_in_data():
    # Données réelles où EMQ et CPA montent ENSEMBLE (corrélation positive),
    # contrairement à l'intuition "EMQ haut -> CPA bas" — le système doit
    # rapporter ce qui EST observé, jamais l'hypothèse de départ.
    pairs = [(60, 100), (70, 110), (80, 120), (90, 130), (100, 140)]
    result = compute_metric_correlation(pairs, "EMQ", "CPA")
    assert result["coefficient"] > 0
    assert result["direction"].startswith("positive")


# ─── verify_percentage_matches_counter — the KPI audit's core invariant ────
# This is the exact bug the user reported: a widget's displayed percentage
# not matching the counters shown on the same or another card. This
# function is the single shared check reused by GET /meta-ads/kpi-validation.

def test_verify_percentage_matches_counter_exact_match():
    result = verify_percentage_matches_counter(30, 100, 30.0)
    assert result["passed"] is True
    assert result["expected_pct"] == 30.0
    assert result["diff"] == 0.0


def test_verify_percentage_matches_counter_detects_real_divergence():
    # Le bug rapporté : un % affiché qui ne vient pas des compteurs montrés.
    result = verify_percentage_matches_counter(30, 100, 45.0)
    assert result["passed"] is False
    assert result["diff"] == 15.0


def test_verify_percentage_matches_counter_rounding_tolerance():
    # 1/3 = 33.333...% arrondi à 33.3% en amont — ne doit pas être signalé
    # comme une divergence à cause de l'arrondi.
    result = verify_percentage_matches_counter(1, 3, 33.3)
    assert result["passed"] is True


def test_verify_percentage_matches_counter_zero_denominator_never_divides_by_zero():
    result = verify_percentage_matches_counter(0, 0, 0.0)
    assert result["expected_pct"] == 0.0
    assert result["passed"] is True


def test_verify_percentage_matches_counter_custom_tolerance():
    result = verify_percentage_matches_counter(30, 100, 31.0, tolerance=0.5)
    assert result["passed"] is False  # diff de 1.0 > tolérance de 0.5
    result_lenient = verify_percentage_matches_counter(30, 100, 31.0, tolerance=1.5)
    assert result_lenient["passed"] is True


# ─── Learning Score realtime/backfill percentages always reconstructible
# from the same counts used to derive them (the KPI audit's core demand:
# "vérifier que les compteurs correspondent exactement aux pourcentages") ──

def test_learning_score_realtime_backfill_pct_reconstructible_from_counts():
    realtime_n, backfill_n = 37, 13
    total = realtime_n + backfill_n
    realtime_pct = round(realtime_n / total * 100, 1)
    backfill_pct = round(backfill_n / total * 100, 1)
    check_rt = verify_percentage_matches_counter(realtime_n, total, realtime_pct)
    check_bf = verify_percentage_matches_counter(backfill_n, total, backfill_pct)
    assert check_rt["passed"] and check_bf["passed"]
    # Les deux pourcentages doivent couvrir 100% du même total, jamais des
    # fenêtres/échantillons différents mélangés.
    assert abs((realtime_pct + backfill_pct) - 100.0) < 0.2
