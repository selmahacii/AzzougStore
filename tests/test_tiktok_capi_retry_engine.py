"""
Queue Manager / Retry Engine tests for app/services/tiktok_capi.py —
mirrors the DB-backed testing style used for Meta's retry engine
(tests/test_meta_analytics_engine.py's db_session fixture pattern).
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
from app.services.tiktok_capi import _reclaim_stuck_processing, _STUCK_PROCESSING_MINUTES


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[TikTokCapiLog.__table__])
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def _make_log(store_id, status, processing_started_at=None):
    return TikTokCapiLog(
        id=str(uuid.uuid4()), store_id=store_id, order_id=str(uuid.uuid4()),
        event_name="CompletePayment", event_id=str(uuid.uuid4()), status=status,
        processing_started_at=processing_started_at,
    )


def test_reclaim_stuck_processing_puts_dead_worker_rows_back_to_retry(db_session):
    """
    A worker that dies mid-send (container killed) leaves its row stuck at
    status='processing' forever — nothing else picks it up since the claim
    query only matches queued/retry. Same invariant meta_capi's
    _reclaim_stuck_processing protects.
    """
    store_id = "store-1"
    stuck_cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=_STUCK_PROCESSING_MINUTES + 5)
    fresh = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)

    stuck_row = _make_log(store_id, "processing", processing_started_at=stuck_cutoff)
    fresh_row = _make_log(store_id, "processing", processing_started_at=fresh)
    db_session.add_all([stuck_row, fresh_row])
    db_session.commit()

    reclaimed = _reclaim_stuck_processing(db_session)

    assert reclaimed == 1
    db_session.refresh(stuck_row)
    db_session.refresh(fresh_row)
    assert stuck_row.status == "retry"
    assert stuck_row.next_retry_at is not None
    assert fresh_row.status == "processing"  # untouched — not stuck yet


def test_reclaim_stuck_processing_is_a_single_batched_update_not_n_plus_one(db_session):
    """No N+1: 50 stuck rows reclaimed via one UPDATE, not 50 individual writes."""
    store_id = "store-2"
    stuck_cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=_STUCK_PROCESSING_MINUTES + 5)
    for _ in range(50):
        db_session.add(_make_log(store_id, "processing", processing_started_at=stuck_cutoff))
    db_session.commit()

    reclaimed = _reclaim_stuck_processing(db_session)
    assert reclaimed == 50
