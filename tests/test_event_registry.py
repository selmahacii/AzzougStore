"""
Event Registry (Phase 2 of the enterprise Meta attribution audit) — pure
sanity checks on the funnel ordering and event-source classification used
by GET /meta-ads/capi-logs and /meta-ads/capi-logs/volume-by-event.

Purchase MUST stay CAPI-only (Pixel deliberately disabled — checkout-form.tsx
— to eliminate the historical double-count bug); every other currently
implemented event is Pixel + CAPI mirrored. Search and AddPaymentInfo are
deliberately absent from _FUNNEL_STEP_ORDER — not implemented for this COD
funnel (validated 2026-07-21 audit), never fabricated.
"""
from app.api.v1.meta_ads import _FUNNEL_STEP_ORDER, _CAPI_ONLY_EVENTS, _meta_state_label


def test_purchase_is_the_only_capi_only_event():
    assert _CAPI_ONLY_EVENTS == {"Purchase"}


def test_funnel_step_order_is_strictly_increasing_pageview_to_purchase():
    expected_sequence = ["PageView", "ViewContent", "AddToWishlist", "AddToCart", "InitiateCheckout", "Purchase"]
    steps = [_FUNNEL_STEP_ORDER[name] for name in expected_sequence]
    assert steps == sorted(steps)
    assert len(set(steps)) == len(steps)  # no two events share a step


def test_search_and_addpaymentinfo_deliberately_absent():
    assert "Search" not in _FUNNEL_STEP_ORDER
    assert "AddPaymentInfo" not in _FUNNEL_STEP_ORDER


def test_meta_state_label_maps_every_known_status():
    for status in ("success", "error", "failed", "pending_retry", "retry", "queued", "processing", "skipped"):
        label = _meta_state_label(status)
        assert label != status  # every known status gets a real French label


def test_meta_state_label_falls_back_to_raw_value_for_unknown_status():
    assert _meta_state_label("some_future_status") == "some_future_status"
