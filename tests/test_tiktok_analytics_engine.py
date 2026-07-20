"""
Non-regression tests for app/services/tiktok_analytics_engine.py — the
TikTok twin of tests/test_meta_analytics_engine.py. In-memory SQLite,
real models, no network.
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
from app.models.marketing import TikTokCapiLog
from app.services.tiktok_analytics_engine import compute_tiktok_metrics, compute_tiktok_funnel, TIKTOK_ENGINE_LAUNCH_DATE


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[TikTokCapiLog.__table__])
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def _make_log(store_id, *, status="success", event_id=None, created_at=None, payload=None):
    return TikTokCapiLog(
        id=str(uuid.uuid4()), store_id=store_id, order_id=str(uuid.uuid4()),
        event_name="CompletePayment", status=status,
        event_id=event_id or f"purchase-{uuid.uuid4().hex[:8]}",
        created_at=created_at or datetime.now(timezone.utc).replace(tzinfo=None),
        payload=payload or {
            "data": [{
                "user": {
                    "phone": "hash", "external_id": "hash", "ip": "1.2.3.4",
                    "user_agent": "ua", "ttclid": "abc", "ttp": "xyz",
                },
                "properties": {"value": 5000, "currency": "DZD"},
            }],
        },
    )


def test_empty_sample_returns_none_not_zero(db_session):
    store_id = "store-empty"
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    until = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)

    m = compute_tiktok_metrics(db_session, store_id, since, until)
    assert m["event_match_quality"] is None
    assert m["dedup_pct"] is None
    assert m["total_sent"] == 0


def test_full_signal_scores_high_emq(db_session):
    store_id = "store-1"
    db_session.add(_make_log(store_id))
    db_session.commit()

    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    until = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)
    m = compute_tiktok_metrics(db_session, store_id, since, until)

    assert m["total_sent"] == 1
    assert m["success"] == 1
    # phone(3)+external_id(2.5)+ip(1.5)+ua(1.5)+ttclid(2)+ttp(2) = 12.5 of
    # 14.5 total weight (missing only email 1 + first/last name 0.5+0.5,
    # none collected on a COD checkout) -> 86.2%.
    assert m["event_match_quality"] == 86.2
    assert m["learning_score"]["score"] is not None


def test_missing_email_barely_dents_emq_cod_context(db_session):
    """
    Same COD-context invariant as Meta's EMQ: a real order missing only
    email (never collected at COD checkout) must score high, not
    penalized as if email were a required field.
    """
    store_id = "store-2"
    db_session.add(_make_log(store_id))  # payload has no "email" key at all
    db_session.commit()

    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    until = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)
    m = compute_tiktok_metrics(db_session, store_id, since, until)
    assert m["event_match_quality"] == 86.2


def test_duplicate_event_id_lowers_dedup_pct(db_session):
    store_id = "store-3"
    db_session.add(_make_log(store_id, event_id="purchase-order-1", status="success"))
    db_session.add(_make_log(store_id, event_id="purchase-order-1", status="success"))  # duplicate send
    db_session.add(_make_log(store_id, event_id="purchase-order-2", status="success"))
    db_session.commit()

    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    until = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)
    m = compute_tiktok_metrics(db_session, store_id, since, until)

    assert m["duplicate_event_ids"] == 1
    assert m["dedup_pct"] < 100.0


def test_pre_launch_data_excluded_by_default_included_with_legacy_flag(db_session):
    store_id = "store-4"
    pre_launch = TIKTOK_ENGINE_LAUNCH_DATE - timedelta(days=5)
    db_session.add(_make_log(store_id, created_at=pre_launch))
    db_session.commit()

    since = datetime(2026, 1, 1)
    until = datetime(2026, 7, 25)

    floored = compute_tiktok_metrics(db_session, store_id, since, until, include_legacy_data=False)
    assert floored["total_sent"] == 0
    assert floored["cutover_applied"] is True

    with_legacy = compute_tiktok_metrics(db_session, store_id, since, until, include_legacy_data=True)
    assert with_legacy["total_sent"] == 1
    assert with_legacy["cutover_applied"] is False


def test_time_window_uses_tiktok_launch_date_not_meta_cutover(db_session):
    """
    resolve_metrics_time_window() is shared with Meta but must use
    TIKTOK_ENGINE_LAUNCH_DATE (2026-07-20), not Meta's NEW_ENGINE_CUTOVER_DATE
    (2026-07-16) — proves the cutover_date parametrization actually reaches
    this call site and doesn't silently fall back to Meta's default.
    """
    from app.services.meta_capi import NEW_ENGINE_CUTOVER_DATE
    assert TIKTOK_ENGINE_LAUNCH_DATE != NEW_ENGINE_CUTOVER_DATE

    store_id = "store-5"
    since = datetime(2026, 7, 17)  # after Meta's cutover but before TikTok's
    until = datetime(2026, 7, 25)
    m = compute_tiktok_metrics(store_id=store_id, db=db_session, since=since, until=until)
    assert m["since"] == TIKTOK_ENGINE_LAUNCH_DATE
    assert m["cutover_applied"] is True


def _make_funnel_log(store_id, event_name, event_id=None):
    return TikTokCapiLog(
        id=str(uuid.uuid4()), store_id=store_id, event_name=event_name,
        status="success", event_id=event_id or str(uuid.uuid4()),
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )


def test_funnel_uses_tiktok_event_names_and_picks_worst_stage(db_session):
    store_id = "store-funnel"
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
    # 100 PageView -> 80 ViewContent -> 10 AddToCart (huge drop) -> 8 InitiateCheckout -> 7 CompletePayment
    counts = {
        "PageView": 100, "ViewContent": 80, "AddToCart": 10,
        "InitiateCheckout": 8, "CompletePayment": 7,
    }
    for tiktok_event_name, n in counts.items():
        for _ in range(n):
            db_session.add(_make_funnel_log(store_id, tiktok_event_name))
    db_session.commit()
    # Captured AFTER inserting — every row's created_at (set at insert time)
    # must fall at or before the "until" bound passed to compute_tiktok_funnel.
    until = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=1)

    funnel = compute_tiktok_funnel(db_session, store_id, since, until)
    stage_by_name = {s["stage"]: s for s in funnel["stages"]}
    assert stage_by_name["AddToCart"]["volume"] == 10
    assert stage_by_name["AddToCart"]["tiktok_event"] == "AddToCart"
    assert stage_by_name["Purchase"]["tiktok_event"] == "CompletePayment"  # TikTok's own event name surfaced
    assert funnel["primary_bottleneck"]["stage"] == "AddToCart"


def test_funnel_empty_data_returns_zero_not_fabricated(db_session):
    funnel = compute_tiktok_funnel(
        db_session, "store-empty-funnel",
        datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7),
        datetime.now(timezone.utc).replace(tzinfo=None),
    )
    assert all(s["volume"] == 0 for s in funnel["stages"])
    assert funnel["primary_bottleneck"]["stage"] is None
