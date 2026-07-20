"""
Regression test for the client_ip/user_agent retry-loss fix.

Before: retry_pending_events()'s inner loop called
send_purchase_for_order(order_id, client_ip=None, user_agent=None) — every
retried/backfilled Purchase permanently lost client_ip_address/
client_user_agent, because these values only ever existed on the live
HTTP request of the FIRST synchronous send attempt. This measurably
degrades Event Match Quality for exactly the population that already had
a delivery incident (network hiccup, transient Meta error).

After: Order.client_ip / Order.client_user_agent are captured once at
order creation and resolve_client_context() falls back to them whenever
the live request context is gone.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.meta_capi import resolve_client_context


class _FakeOrder:
    def __init__(self, client_ip=None, client_user_agent=None):
        self.client_ip = client_ip
        self.client_user_agent = client_user_agent


def test_falls_back_to_order_columns_when_no_live_request_context():
    """This is the retry/backfill/sweep scenario — the exact bug fixed."""
    order = _FakeOrder(client_ip="41.200.10.5", client_user_agent="Mozilla/5.0 (iPhone)")
    ip, ua = resolve_client_context(order, client_ip=None, user_agent=None)
    assert ip == "41.200.10.5"
    assert ua == "Mozilla/5.0 (iPhone)"


def test_live_request_values_always_win_over_stored_ones():
    """The synchronous first-attempt path must never be shadowed by a stale stored value."""
    order = _FakeOrder(client_ip="41.200.10.5", client_user_agent="Mozilla/5.0 (iPhone)")
    ip, ua = resolve_client_context(order, client_ip="105.100.2.9", user_agent="Mozilla/5.0 (Android)")
    assert ip == "105.100.2.9"
    assert ua == "Mozilla/5.0 (Android)"


def test_returns_none_when_neither_source_has_a_value():
    """Old orders predating this column, with no live context either -- never fabricated."""
    order = _FakeOrder(client_ip=None, client_user_agent=None)
    ip, ua = resolve_client_context(order, client_ip=None, user_agent=None)
    assert ip is None
    assert ua is None


def test_works_even_if_order_object_lacks_the_columns_entirely():
    """Defensive: an order loaded before this migration ran must not crash getattr()."""
    class _BareOrder:
        pass
    ip, ua = resolve_client_context(_BareOrder(), client_ip=None, user_agent=None)
    assert ip is None
    assert ua is None


def test_measured_emq_impact_of_recovering_ip_and_user_agent_on_retry():
    """
    Concrete before/after: simulate a retried Purchase's user_data with and
    without the two fields this fix recovers, using the SAME
    compute_match_quality() the dashboard itself uses (no separate/duplicated
    scoring here). This quantifies the actual EMQ gain from this fix rather
    than just asserting a formula exists.
    """
    from app.services.meta_capi import compute_match_quality

    full_user_data_missing_ip_ua = {
        # Every field a retry with the OLD bug (client_ip=None, user_agent=None) would
        # still have had, since they came from the order record, not the live request.
        "em": "abc...", "ph": "def...", "fn": "abc...", "ln": "def...",
        "ct": "abc...", "st": "def...", "country": "abc...", "external_id": "def...",
        # client_ip_address / client_user_agent intentionally absent -- the bug.
    }
    before = compute_match_quality(full_user_data_missing_ip_ua)

    after_user_data = {**full_user_data_missing_ip_ua, "client_ip_address": "41.200.10.5", "client_user_agent": "Mozilla/5.0"}
    after = compute_match_quality(after_user_data)

    assert after["score"] > before["score"]
    # Weighted (see _MATCH_QUALITY_WEIGHTS): before = em1+ph3+fn.5+ln.5+ct.5+
    # st.5+country.5+external_id2.5 = 9.0/16.0 = 56.2%; recovering IP(1.5)+
    # user_agent(1.5) adds 3.0 -> after = 12.0/16.0 = 75.0%, a +18.75-point
    # gain — bigger than the old flat +16.7%, because IP/UA are weighted
    # ABOVE the COD-irrelevant fields this event already had. Each score is
    # independently rounded to 1 decimal, so allow +/-0.2 rounding drift.
    assert abs((after["score"] - before["score"]) - (3.0 / 16 * 100)) < 0.2
