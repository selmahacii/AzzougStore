"""
Regression test for the fbc-fallback timestamp bug found during the
Meta Ads Manager attribution audit (2026-07-20): "Purchase accepted by
Conversions API (HTTP 200, events_received=1, good EMQ) but Ads Manager
attributes zero purchases to the ad" — for orders recovered from an
abandoned cart hours/days after the original ad click.

build_user_data() rebuilds fbc from a raw fbclid per Meta's spec
(fb.1.<ms>.<fbclid>) whenever the stored `fbc` cookie value itself is
missing. It used to stamp this with int(time.time() * 1000) — the
moment THIS FUNCTION RUNS, not the moment of the actual ad click. For a
same-session checkout that's a few seconds of drift, harmless. For a
confirmatrice confirming an abandoned cart days later, it fabricated a
click time days after the real one — Meta's own click record for that
fbclid still has the true time, and a fbc claiming otherwise can
silently fall outside the ad set's attribution window even though
Events Manager (which never validates this timestamp) still shows the
event as received.

Fixed by threading a `fbc_reference_time` (order.created_at, the
closest real anchor to the actual click) through to build_user_data,
so the fallback fbc always reflects when the order/click actually
happened — never "whenever this Purchase happens to be sent".
"""
from app.services.meta_capi import build_user_data, is_well_formed_fbc


def test_fbc_fallback_anchors_to_reference_time_not_now():
    reference_time = 1_752_000_000.0  # an arbitrary fixed instant, far from "now"

    ud = build_user_data(
        phone="0555123456",
        fbclid="raw-click-id-abc123",
        fbc_reference_time=reference_time,
    )

    assert ud["fbc"] == f"fb.1.{int(reference_time * 1000)}.raw-click-id-abc123"


def test_fbc_fallback_without_reference_time_still_produces_a_value():
    # Backward-compatible: omitting fbc_reference_time must not crash or
    # silently drop fbc — it just falls back to "now", the old behavior.
    ud = build_user_data(phone="0555123456", fbclid="raw-click-id-xyz789")
    assert ud["fbc"].startswith("fb.1.")
    assert ud["fbc"].endswith(".raw-click-id-xyz789")


def test_stored_fbc_always_wins_over_any_fallback():
    ud = build_user_data(
        phone="0555123456",
        fbc="fb.1.1700000000000.already-stored",
        fbclid="raw-click-id-abc123",
        fbc_reference_time=1_752_000_000.0,
    )
    assert ud["fbc"] == "fb.1.1700000000000.already-stored"


def test_is_well_formed_fbc_accepts_valid_format():
    assert is_well_formed_fbc("fb.1.1700000000000.abc123fbclid") is True


def test_is_well_formed_fbc_rejects_malformed_values():
    assert is_well_formed_fbc(None) is False
    assert is_well_formed_fbc("") is False
    assert is_well_formed_fbc("not-a-real-fbc") is False
    assert is_well_formed_fbc("fb.1.abc123fbclid") is False  # missing timestamp segment
    assert is_well_formed_fbc("fb..1700000000000.abc123fbclid") is False  # empty subdomain index


def test_attribution_readiness_full_signals_scores_100():
    from app.services.meta_capi import compute_attribution_readiness
    result = compute_attribution_readiness(
        fbc="fb.1.1700000000000.abc123",
        fbp="fb.1.1700000000000.xyz789",
        phone="0555123456",
        external_id="0555123456",
        client_ip="1.2.3.4",
        user_agent="Mozilla/5.0",
        event_time=1700000000,
        value=1500.0,
        currency="DZD",
        event_id="purchase-ORD-1",
    )
    assert result["score"] == 100.0
    assert result["missing"] == []


def test_attribution_readiness_missing_fbc_drops_score_most():
    from app.services.meta_capi import compute_attribution_readiness
    with_fbc = compute_attribution_readiness(fbc="fb.1.1700000000000.abc123", phone="0555123456")
    without_fbc = compute_attribution_readiness(fbc=None, phone="0555123456")
    assert with_fbc["score"] > without_fbc["score"]
    assert "fbc_valid" in without_fbc["missing"]


def test_attribution_readiness_no_signals_scores_zero():
    from app.services.meta_capi import compute_attribution_readiness
    result = compute_attribution_readiness()
    assert result["score"] == 0.0
    assert len(result["missing"]) == 10
