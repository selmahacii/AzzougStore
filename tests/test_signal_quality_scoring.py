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

from app.services.meta_capi import (
    compute_match_quality, scan_payload_quality, compute_learning_score,
    diagnose_campaign_learning, evaluate_purchase_signal_quality,
    meta_health_label, estimate_learning_score_gains,
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
        "event_id": "purchase-123", "event_time": 1752000000,
        "event_source_url": "https://x.dz", "action_source": "website",
        "custom_data": {"value": 5000, "currency": "DZD"},
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
