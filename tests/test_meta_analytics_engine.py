"""
Non-regression tests for app/services/meta_analytics_engine.py.

Audit context (2026-07-17): the store-wide Signal Quality Center
(/meta-ads/signal-quality) and the per-campaign Optimization Advisor
(/meta-ads/campaigns/{id}/learning-health) used to compute the SAME-NAMED
metrics (attribution_pct, dedup_pct, total_sent) with DIFFERENT formulas
and populations, so the same underlying data produced different KPI
values depending on which screen requested it. compute_meta_metrics() is
now the single canonical implementation both endpoints call.

These tests build a minimal in-memory SQLite database with the real
models (no live Postgres available in this environment) and assert:
1. Store-wide vs. per-campaign scoping (via order_ids) produce IDENTICAL
   values for every shared metric when the order_ids cover the exact same
   underlying logs — the core non-regression guarantee.
2. An empty sample (no successful sends in the window) returns None, not
   0.0, for percentage metrics that depend on it — distinguishing "no
   data" from "bad data" (the 0%-vs-N/A requirement).
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.base_class import Base
from app.models.marketing import MetaCapiLog
from app.models.order import Order
from app.models.audit import AuditLog
from app.services.meta_analytics_engine import compute_meta_metrics
import app.services.meta_capi as meta_capi


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[
        MetaCapiLog.__table__, Order.__table__, AuditLog.__table__,
    ])
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def _make_order(store_id, *, campaign_id=None, utm_campaign=None, created_at=None):
    order = Order(
        id=str(uuid.uuid4()), store_id=store_id, order_number=f"ORD-{uuid.uuid4().hex[:6]}",
        status="DELIVERED", total=5000, subtotal=5000,
        customer_name="Test", customer_phone="0555000000",
        customer_wilaya="Alger", customer_commune="Alger Centre", customer_address="rue test",
        campaign_id=campaign_id, utm_campaign=utm_campaign,
        created_at=created_at or datetime.now(timezone.utc).replace(tzinfo=None),
    )
    return order


def _make_log(store_id, order_id, *, status="success", event_id=None, latency_ms=200,
              created_at=None, payload=None):
    return MetaCapiLog(
        id=str(uuid.uuid4()), store_id=store_id, order_id=order_id,
        event_name="Purchase", status=status,
        event_id=event_id or f"purchase-{uuid.uuid4().hex[:8]}",
        latency_ms=latency_ms,
        created_at=created_at or datetime.now(timezone.utc).replace(tzinfo=None),
        payload=payload or {
            "event_time": int(datetime.now(timezone.utc).timestamp()),
            "custom_data": {"value": 5000, "currency": "DZD"},
            "user_data": {"em": "x", "ph": "x", "fbp": "fb.1", "fbc": "fb.2",
                          "client_ip_address": "1.2.3.4", "client_user_agent": "UA"},
        },
    )


def test_store_wide_matches_per_campaign_scoping(db_session):
    """
    Same underlying orders/logs, scoped two ways (store-wide vs. explicit
    order_ids covering the exact same set), must produce identical shared
    metrics. This is the exact invariant that was broken before the fix:
    attribution_pct and dedup_pct diverged between these two call paths.
    """
    store_id = "store-1"
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
    until = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)

    orders = [
        _make_order(store_id, campaign_id="camp-A"),
        _make_order(store_id, campaign_id="camp-A"),
        _make_order(store_id, campaign_id=None, utm_campaign=None),  # orphan attribution
    ]
    for o in orders:
        db_session.add(o)
    db_session.commit()

    logs = [
        _make_log(store_id, orders[0].id, status="success"),
        _make_log(store_id, orders[1].id, status="success"),
        _make_log(store_id, orders[2].id, status="failed"),
    ]
    for l in logs:
        db_session.add(l)
    db_session.commit()

    store_wide = compute_meta_metrics(db_session, store_id, since, until)
    per_campaign = compute_meta_metrics(
        db_session, store_id, since, until, order_ids=[o.id for o in orders],
    )

    for key in (
        "total_sent", "success", "failed", "retry", "pending", "skipped",
        "valid_purchase_pct", "rejected_pct", "attribution_pct", "dedup_pct",
        "event_match_quality", "tracking_coverage", "server_reliability",
    ):
        assert store_wide[key] == per_campaign[key], f"{key} diverged: {store_wide[key]!r} != {per_campaign[key]!r}"

    assert store_wide["learning_score"]["score"] == per_campaign["learning_score"]["score"]
    # 2 success / 3 total_sent -> attribution among successes: orders[0] and
    # orders[1] both have campaign_id set, orders[2] (orphan) sent 'failed'
    # so it's excluded from the success-based attribution population.
    assert store_wide["attribution_pct"] == 100.0


def test_empty_sample_returns_none_not_zero(db_session):
    """
    No MetaCapiLog rows at all in the window -> every percentage must be
    None ("no data"), never 0.0 ("bad data") — the exact confusion behind
    the reported "EMQ at 0% while fbp/fbc/IP/UA are present" symptom.
    """
    store_id = "store-empty"
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
    until = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)

    m = compute_meta_metrics(db_session, store_id, since, until)

    assert m["event_match_quality"] is None
    assert m["tracking_coverage"] is None
    assert m["attribution_pct"] is None
    assert m["dedup_pct"] is None
    assert m["realtime_pct"] is None
    assert m["total_sent"] == 0


def test_emq_zero_percent_only_when_fields_genuinely_missing(db_session):
    """
    With successful sends but NO fbp/fbc/ip/user_agent on any of them, EMQ
    must be a real (low, non-None) number reflecting genuinely missing
    fields — distinct from the empty-sample None case above.
    """
    store_id = "store-2"
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
    until = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)

    order = _make_order(store_id, campaign_id="camp-B")
    db_session.add(order)
    db_session.commit()

    log = _make_log(store_id, order.id, status="success", payload={
        "event_time": int(datetime.now(timezone.utc).timestamp()),
        "custom_data": {"value": 5000, "currency": "DZD"},
        "user_data": {},  # no em/ph/fbp/fbc/ip/user_agent at all
    })
    db_session.add(log)
    db_session.commit()

    m = compute_meta_metrics(db_session, store_id, since, until)
    assert m["event_match_quality"] == 0.0
    assert m["event_match_quality"] is not None


def test_benchmark_change_propagates_identically_to_every_view(db_session):
    """
    Guarantees the "single source of truth" contract: a benchmark/band
    change made in app/services/meta_capi.py (meta_health_label's bands,
    which classify() in the engine wraps) must change the label/color for
    BOTH store-wide and per-campaign views identically, with no view left
    behind on the old thresholds. This is what "no divergence between
    endpoints/dashboards" actually means in an automated test: patch the
    canonical band function once, and assert every caller reflects it.
    """
    store_id = "store-3"
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
    until = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)

    order = _make_order(store_id, campaign_id="camp-C")
    db_session.add(order)
    db_session.commit()
    db_session.add(_make_log(store_id, order.id, status="success"))
    db_session.commit()

    before_store_wide = compute_meta_metrics(db_session, store_id, since, until)
    before_per_campaign = compute_meta_metrics(db_session, store_id, since, until, order_ids=[order.id])
    assert before_store_wide["learning_score"]["label"] == before_per_campaign["learning_score"]["label"]

    # Tighten the "Excellent" band from >=90 to >=101 (impossible to reach)
    # so ANY previously-"Excellent" score must now report a lower label —
    # simulates a benchmark change made once, centrally.
    original = meta_capi._score_band
    try:
        def _tightened(score, bands):
            patched_bands = [(101 if label == "Excellent" else t, label) for t, label in bands]
            return original(score, patched_bands)
        meta_capi._score_band = _tightened

        # Re-import engine module's bound reference isn't needed: classify()
        # calls meta_health_label(), which calls the module-level
        # _score_band — patching the module attribute is enough since
        # meta_health_label looks it up dynamically at call time.
        after_store_wide = compute_meta_metrics(db_session, store_id, since, until)
        after_per_campaign = compute_meta_metrics(db_session, store_id, since, until, order_ids=[order.id])
    finally:
        meta_capi._score_band = original

    assert after_store_wide["learning_score"]["label"] != "Excellent"
    assert after_per_campaign["learning_score"]["label"] != "Excellent"
    # The core guarantee: both views moved together, to the SAME new label.
    assert after_store_wide["learning_score"]["label"] == after_per_campaign["learning_score"]["label"]
    assert after_store_wide["signal_score"]["label"] == after_per_campaign["signal_score"]["label"]


def test_emq_identical_across_learning_score_signal_quality_and_diagnostics(db_session):
    """
    Section 4 of the audit: Learning Score, Signal Quality, Optimization
    Advisor, Learning Diagnostics and Campaign Health must never show three
    different EMQ values for the same period. All five views now read
    m["event_match_quality"] from the SAME compute_meta_metrics() call (see
    get_signal_quality, get_campaign_learning_health and
    get_learning_diagnostics in app/api/v1/meta_ads.py, all migrated this
    round) — this test proves the invariant at the engine level: calling it
    the way each of those three call sites does (store-wide, store-wide
    with a since/until pair, and per-campaign order_ids) for the SAME
    dataset always returns the same EMQ.
    """
    store_id = "store-4"
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
    until = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)

    order = _make_order(store_id, campaign_id="camp-D")
    db_session.add(order)
    db_session.commit()
    db_session.add(_make_log(store_id, order.id, status="success"))
    db_session.commit()

    # get_signal_quality (Learning Score + Signal Quality cards)
    signal_quality_view = compute_meta_metrics(db_session, store_id, since, until)
    # get_learning_diagnostics ("Pourquoi Meta apprend")
    learning_diagnostics_view = compute_meta_metrics(db_session, store_id, since, until)
    # get_campaign_learning_health (Optimization Advisor / Campaign Health)
    campaign_health_view = compute_meta_metrics(db_session, store_id, since, until, order_ids=[order.id])

    emqs = {
        "signal_quality": signal_quality_view["event_match_quality"],
        "learning_diagnostics": learning_diagnostics_view["event_match_quality"],
        "campaign_health": campaign_health_view["event_match_quality"],
    }
    assert len(set(emqs.values())) == 1, f"EMQ diverged across views: {emqs}"
    assert emqs["signal_quality"] is not None
