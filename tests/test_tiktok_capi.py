"""
Unit tests for app/services/tiktok_capi.py — TikTok Ads Enterprise Phase 1
(2026-07-20). Pure-function tests, no DB, no network — mirrors the test
shape of tests/test_capi_event_time_and_match_quality.py for Meta.
"""
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.tiktok_capi import (
    build_tiktok_user,
    build_purchase_event,
    purchase_event_id,
    compute_match_quality,
    get_circuit_state,
    _circuit_record,
    _circuit_is_open,
    _CIRCUIT_FAILURE_THRESHOLD,
    EVENT_NAME_MAP,
)


def _fake_order(created_at, **overrides):
    defaults = dict(
        id="order-1", total=5000, items=[],
        customer_phone="0770000000", customer_name="Test Client",
        customer_email=None, client_ip=None, client_user_agent=None,
        event_source_url=None, created_at=created_at,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_purchase_event_id_matches_pixel_dedup_convention():
    # Same "purchase-{order_id}" convention as meta_capi.purchase_event_id
    # (see that module) so Pixel + Events API dedup on the TikTok side too.
    assert purchase_event_id("order-42") == "purchase-order-42"


def test_event_name_map_purchase_is_completepayment():
    # TikTok's own name for a completed order — not "Purchase" like Meta.
    assert EVENT_NAME_MAP["Purchase"] == "CompletePayment"


def test_event_name_map_covers_the_full_requested_vocabulary():
    required = {
        "PageView", "ViewContent", "Search", "AddToWishlist", "AddToCart",
        "InitiateCheckout", "AddPaymentInfo", "PlaceOrder", "Purchase",
        "CompleteRegistration", "Lead",
    }
    assert required.issubset(EVENT_NAME_MAP.keys())


def test_build_purchase_event_includes_order_id_in_properties():
    order = _fake_order(datetime(2026, 7, 1), id="order-99")
    event = build_purchase_event(order, pixel_code="PIXEL123")
    assert event["properties"]["order_id"] == "order-99"
    assert event["properties"]["value"] == 5000
    assert event["properties"]["currency"] == "DZD"


def test_build_purchase_event_uses_order_created_at_not_now():
    old_created_at = datetime(2026, 6, 1, 12, 0, 0)
    order = _fake_order(old_created_at)
    event = build_purchase_event(order, pixel_code="PIXEL123", client_ip="1.2.3.4", user_agent="ua")

    expected_ts = int(old_created_at.replace(tzinfo=timezone.utc).timestamp())
    assert event["event_time"] == expected_ts
    now_ts = int(datetime.now(timezone.utc).timestamp())
    assert now_ts - event["event_time"] > 3600 * 24 * 20


def test_build_purchase_event_falls_back_to_now_only_if_created_at_missing():
    order = _fake_order(created_at=None)
    event = build_purchase_event(order, pixel_code="PIXEL123")
    now_ts = int(datetime.now(timezone.utc).timestamp())
    assert abs(event["event_time"] - now_ts) < 60


def test_build_purchase_event_id_keyed_by_order_id():
    order = _fake_order(datetime(2026, 7, 1))
    event = build_purchase_event(order, pixel_code="PIXEL123")
    assert event["event_id"] == "purchase-order-1"
    assert event["event"] == "CompletePayment"


def test_build_tiktok_user_hashes_phone_and_email():
    user = build_tiktok_user(email="test@example.com", phone="0555123456")
    # Hashed (64 hex chars), never plaintext.
    assert user["email"] != "test@example.com"
    assert len(user["email"]) == 64
    assert user["phone"] != "0555123456"
    assert len(user["phone"]) == 64


def test_build_tiktok_user_splits_full_name_into_first_last():
    user = build_tiktok_user(full_name="Ahmed Benali")
    assert "first_name" in user
    assert "last_name" in user
    assert len(user["first_name"]) == 64  # hashed


def test_build_tiktok_user_never_sends_plaintext_ip_or_ua_unhashed_fields_as_pii():
    # ip/user_agent are NOT hashed per TikTok spec (only direct PII is) —
    # confirm they pass through verbatim, unlike email/phone/name.
    user = build_tiktok_user(client_ip="41.200.1.1", user_agent="Mozilla/5.0")
    assert user["ip"] == "41.200.1.1"
    assert user["user_agent"] == "Mozilla/5.0"


def test_match_quality_full_data_scores_100():
    user = {
        "phone": "hash", "email": "hash", "first_name": "hash", "last_name": "hash",
        "external_id": "hash", "ip": "1.2.3.4", "user_agent": "ua",
        "ttclid": "abc", "ttp": "xyz",
    }
    result = compute_match_quality(user)
    assert result["score"] == 100.0
    assert result["missing"] == []


def test_match_quality_cod_context_missing_email_barely_dents_score():
    # Typical COD order: no email field on checkout, has everything else.
    user = {
        "phone": "hash", "first_name": "hash", "last_name": "hash",
        "external_id": "hash", "ip": "1.2.3.4", "user_agent": "ua",
        "ttclid": "abc", "ttp": "xyz",
    }
    result = compute_match_quality(user)
    assert "Email" not in result["missing"]
    assert "Email" in result["not_applicable"]
    assert result["score"] > 90.0  # missing only the lowest-weighted field


def test_match_quality_missing_phone_hurts_more_than_missing_email():
    without_phone = compute_match_quality({
        "email": "hash", "first_name": "hash", "last_name": "hash",
        "external_id": "hash", "ip": "1.2.3.4", "user_agent": "ua", "ttclid": "abc", "ttp": "xyz",
    })
    without_email = compute_match_quality({
        "phone": "hash", "first_name": "hash", "last_name": "hash",
        "external_id": "hash", "ip": "1.2.3.4", "user_agent": "ua", "ttclid": "abc", "ttp": "xyz",
    })
    assert without_phone["score"] < without_email["score"]


def test_match_quality_empty_data_never_crashes():
    result = compute_match_quality(None)
    assert result["score"] == 0.0
    assert "Email" in result["not_applicable"]
    assert "Email" not in result["missing"]


def test_circuit_breaker_opens_after_threshold_failures():
    # Reset to a known state first (module-level singleton state).
    _circuit_record(success=True)
    assert _circuit_is_open() is False

    for _ in range(_CIRCUIT_FAILURE_THRESHOLD):
        _circuit_record(success=False)
    assert _circuit_is_open() is True

    state = get_circuit_state()
    assert state["is_open"] is True
    assert state["consecutive_failures"] == _CIRCUIT_FAILURE_THRESHOLD

    # Reset for other tests in the same process.
    _circuit_record(success=True)


def test_circuit_breaker_state_shape_matches_meta_for_shared_dashboard_widget():
    from app.services.meta_capi import get_circuit_state as meta_get_circuit_state
    meta_state = meta_get_circuit_state()
    tiktok_state = get_circuit_state()
    assert set(meta_state.keys()) == set(tiktok_state.keys())
