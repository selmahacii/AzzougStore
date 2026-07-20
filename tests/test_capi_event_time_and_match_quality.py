"""
Unit tests for:
1. build_purchase_event's event_time fix — must use the order's real
   created_at, never the send-time (int(time.time())). This was the
   highest-severity correctness bug found this session: sending "now" as
   event_time for a backfilled Purchase falsely reports the conversion as
   having just happened, which both violates Meta's own Conversions API
   guidance and is exactly the "artificially inflating performance" outcome
   the user explicitly said must never happen.
2. compute_match_quality (app/services/meta_capi.py) — Event Match Quality
   completeness scoring.

Pure-function / lightweight-object tests, no DB, no app boot, no network.
"""
import os
import sys
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.meta_capi import build_purchase_event, compute_match_quality


def _fake_order(created_at, **overrides):
    defaults = dict(
        id="order-1", order_number="ORD-0001", total=5000, items=[],
        customer_phone="0770000000", customer_name="Test Client",
        customer_commune="Alger Centre", customer_wilaya="Alger",
        customer_email=None, fbp=None, fbc=None, fbclid=None,
        event_source_url=None, created_at=created_at,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_event_time_uses_order_created_at_not_now():
    old_created_at = datetime(2026, 6, 1, 12, 0, 0)  # weeks before "now" in any real run
    order = _fake_order(old_created_at)
    event = build_purchase_event(order, client_ip="1.2.3.4", user_agent="ua")

    expected_ts = int(old_created_at.replace(tzinfo=timezone.utc).timestamp())
    assert event["event_time"] == expected_ts

    # The whole point of the bug: event_time must NOT be close to "now".
    now_ts = int(datetime.now(timezone.utc).timestamp())
    assert now_ts - event["event_time"] > 3600 * 24 * 20  # >20 days gap, proves it's not "now"


def test_event_time_falls_back_to_now_only_if_created_at_missing():
    order = _fake_order(created_at=None)
    event = build_purchase_event(order, client_ip=None, user_agent=None)
    now_ts = int(datetime.now(timezone.utc).timestamp())
    # Fallback path only — must still produce SOME sane recent timestamp,
    # not crash. Real orders always have created_at; this only guards
    # against a malformed/test object.
    assert abs(event["event_time"] - now_ts) < 60


def test_event_id_still_keyed_by_order_number():
    order = _fake_order(datetime(2026, 7, 1))
    event = build_purchase_event(order, client_ip=None, user_agent=None)
    assert event["event_id"] == "purchase-ORD-0001"


def test_match_quality_full_data_scores_100():
    user_data = {
        "em": ["hash"], "ph": ["hash"], "fn": ["hash"], "ln": ["hash"],
        "ct": ["hash"], "st": ["hash"], "country": ["hash"],
        "external_id": ["hash"], "client_ip_address": "1.2.3.4",
        "client_user_agent": "ua", "fbp": "fb.1.x", "fbc": "fb.1.y",
    }
    result = compute_match_quality(user_data)
    assert result["score"] == 100.0
    assert result["missing"] == []


def test_match_quality_partial_data():
    # Typical AzzougShop order: no email collected at checkout, no fbc.
    user_data = {
        "ph": ["hash"], "fn": ["hash"], "ln": ["hash"], "ct": ["hash"],
        "st": ["hash"], "country": ["hash"], "external_id": ["hash"],
        "client_ip_address": "1.2.3.4", "client_user_agent": "ua", "fbp": "fb.1.x",
    }
    result = compute_match_quality(user_data)
    # Weighted (see _MATCH_QUALITY_WEIGHTS): present weight
    # ph3+fn.5+ln.5+ct.5+st.5+country.5+external_id2.5+ip1.5+ua1.5+fbp2 = 13.0
    # of 16.0 total -> 81.2%. Missing only em(1.0)+fbc(2.0) — a COD order
    # missing just email costs far less than the old flat 2/12=16.7%.
    assert result["score"] == 81.2
    # Email not_applicable for COD -> excluded from `missing` (see
    # FIELD_CLASSIFICATION); FBC has no such exemption, still a real gap.
    assert "Email" not in result["missing"]
    assert "Email" in result["not_applicable"]
    assert "FBC" in result["missing"]


def test_match_quality_empty_data_never_crashes():
    result = compute_match_quality(None)
    assert result["score"] == 0.0
    # 11 real gaps + email counted separately in not_applicable (COD context).
    assert len(result["missing"]) == 11
    assert result["not_applicable"] == ["Email"]
