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

from app.services.meta_capi import compute_match_quality, scan_payload_quality, _MATCH_QUALITY_FIELDS


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
