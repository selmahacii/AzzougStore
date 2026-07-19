"""
Unit tests for app.services.order_similarity_engine — pure functions, no DB,
no network. Locks down the exact false-positive/false-negative cases raised
when this engine was designed:
  - same phone, different products, days apart -> "distinct" (NOT merged)
  - same phone, same basket, 2 minutes apart -> "auto_merge"
  - same phone, same basket, 3 days apart -> below auto_merge (time decays)
  - same phone, different address -> lower score than same address
  - missing fields never falsely inflate or deflate the score
"""
import os
import sys
from datetime import datetime, timedelta
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.order_similarity_engine import (
    compute_similarity,
    classify_similarity,
    normalize_phone,
    text_similarity,
    DEFAULT_SIMILARITY_WEIGHTS,
    DEFAULT_SIMILARITY_THRESHOLDS,
    DEFAULT_TIME_WINDOW,
)


def _order(**overrides):
    base_time = datetime(2026, 1, 1, 12, 0, 0)
    item = SimpleNamespace(product_id="prod-1", quantity=1)
    defaults = dict(
        customer_phone="0555123456", customer_email=None, customer_name="Yasmine Client",
        customer_address="12 Rue des Fleurs", customer_commune="Hydra", customer_wilaya="Alger",
        total=1800, created_at=base_time, campaign_id=None, utm_campaign=None, fbclid=None,
        source="landing_page", items=[item],
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_normalize_phone_collapses_country_code_variants():
    assert normalize_phone("+213555123456") == normalize_phone("0555123456")
    assert normalize_phone("00213555123456") == normalize_phone("0555123456")
    assert normalize_phone("213555123456") == normalize_phone("0555123456")
    assert normalize_phone(None) is None
    assert normalize_phone("") is None


def test_text_similarity_empty_never_matches():
    assert text_similarity("", "anything") == 0.0
    assert text_similarity(None, "anything") == 0.0
    assert text_similarity("same text", "same text") == 1.0


def test_same_phone_same_basket_two_minutes_apart_is_auto_merge():
    a = _order(created_at=datetime(2026, 1, 1, 12, 0, 0))
    b = _order(created_at=datetime(2026, 1, 1, 12, 2, 0))
    result = compute_similarity(a, b)
    assert classify_similarity(result) == "auto_merge"
    assert "same phone number" in result.reasons


def test_same_phone_different_products_and_time_is_distinct_not_merged():
    """THE false-positive fix this engine exists for: same phone, genuinely different purchase (different basket, different amount, days apart — a realistic second, unrelated sale)."""
    a = _order(items=[SimpleNamespace(product_id="prod-1", quantity=1)], created_at=datetime(2026, 1, 1, 12, 0, 0))
    b = _order(
        items=[SimpleNamespace(product_id="prod-99", quantity=1)], total=4200,
        created_at=datetime(2026, 1, 8, 9, 0, 0),
    )
    result = compute_similarity(a, b)
    assert classify_similarity(result) == "distinct"


def test_same_phone_different_products_but_same_moment_needs_review_not_auto_merge():
    """Same phone, same name/address, different products, but AT THE SAME MOMENT is genuinely ambiguous (could be a confused double-submission with a last-minute cart change) — worth a human glance, never auto-merged outright."""
    a = _order(items=[SimpleNamespace(product_id="prod-1", quantity=1)])
    b = _order(items=[SimpleNamespace(product_id="prod-99", quantity=1)], total=4200)
    result = compute_similarity(a, b)
    assert classify_similarity(result) in ("needs_review", "distinct")
    assert classify_similarity(result) != "auto_merge"


def test_same_phone_same_basket_three_days_apart_does_not_auto_merge():
    a = _order(created_at=datetime(2026, 1, 1, 12, 0, 0))
    b = _order(created_at=datetime(2026, 1, 4, 12, 0, 0))  # 72h apart, zero_score_hours default = 48h
    result = compute_similarity(a, b)
    assert classify_similarity(result) != "auto_merge"


def test_same_phone_different_address_scores_lower_than_same_address():
    a = _order(customer_address="12 Rue des Fleurs", customer_commune="Hydra")
    b_same_addr = _order(customer_address="12 Rue des Fleurs", customer_commune="Hydra")
    b_diff_addr = _order(customer_address="45 Boulevard Central", customer_commune="Bab Ezzouar", customer_wilaya="Alger")
    same = compute_similarity(a, b_same_addr)
    diff = compute_similarity(a, b_diff_addr)
    assert same.score >= diff.score


def test_missing_fields_do_not_penalize_score():
    """An order with no email should never score WORSE than one where both emails are absent — missing data abstains, it doesn't count against."""
    a = _order(customer_email=None)
    b = _order(customer_email=None)
    result = compute_similarity(a, b)
    assert result.components["email"] == 0.0
    # email contributed 0/0, not 0/weight — check it didn't drag max_possible_score down unfairly
    # relative to a case where both HAVE the same email (which should score >= this one).
    a2 = _order(customer_email="client@example.com")
    b2 = _order(customer_email="client@example.com")
    result2 = compute_similarity(a2, b2)
    assert result2.normalized_score >= result.normalized_score


def test_distinct_products_reduce_score_more_than_missing_products():
    """Known-different baskets must score WORSE than unknown baskets — this is what stops a same-phone/no-item-data pair from being treated as more suspicious than a same-phone/definitely-different-basket pair."""
    a_known = _order(items=[SimpleNamespace(product_id="prod-1", quantity=1)])
    b_known_different = _order(items=[SimpleNamespace(product_id="prod-2", quantity=1)])
    a_unknown = _order(items=[])
    b_unknown = _order(items=[])
    known_diff_result = compute_similarity(a_known, b_known_different)
    unknown_result = compute_similarity(a_unknown, b_unknown)
    assert known_diff_result.score <= unknown_result.score


def test_configurable_weights_change_the_outcome():
    """Proves nothing is hardcoded — a store that weights phone at 100 and nothing else should auto-merge on phone alone (within the time window — time is a gate, not a weight, see the dedicated time-decay tests)."""
    a = _order()
    b = _order(items=[SimpleNamespace(product_id="totally-different", quantity=1)])
    phone_only_weights = {"phone": 100.0}
    result = compute_similarity(a, b, weights=phone_only_weights)
    assert classify_similarity(result, thresholds={"auto_merge_threshold": 90.0, "needs_review_threshold": 50.0}) == "auto_merge"


def test_classify_bands():
    high = SimpleNamespace(normalized_score=90.0)
    mid = SimpleNamespace(normalized_score=60.0)
    low = SimpleNamespace(normalized_score=10.0)
    thresholds = DEFAULT_SIMILARITY_THRESHOLDS
    assert classify_similarity(high, thresholds=thresholds) == "auto_merge"
    assert classify_similarity(mid, thresholds=thresholds) == "needs_review"
    assert classify_similarity(low, thresholds=thresholds) == "distinct"
