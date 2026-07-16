"""
Unit tests for classify_capi_log_timing / classify_capi_log
(app/services/meta_capi.py) — the temps réel vs backfill classification
requested for the Meta CAPI tracking-quality feature.

These are pure-function tests (no DB, no app boot) — classify_capi_log_timing
takes two datetimes and returns a string, nothing more. Written to run under
plain pytest without the async Postgres fixtures the rest of this suite uses.
"""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.meta_capi import classify_capi_log_timing, classify_capi_log, REALTIME_WINDOW_HOURS


def test_realtime_within_window():
    order_created = datetime(2026, 7, 1, 10, 0, 0)
    capi_sent = order_created + timedelta(minutes=5)
    assert classify_capi_log_timing(capi_sent, order_created) == "realtime"


def test_realtime_at_exact_window_boundary():
    order_created = datetime(2026, 7, 1, 10, 0, 0)
    capi_sent = order_created + timedelta(hours=REALTIME_WINDOW_HOURS)
    assert classify_capi_log_timing(capi_sent, order_created) == "realtime"


def test_backfill_just_past_window():
    order_created = datetime(2026, 7, 1, 10, 0, 0)
    capi_sent = order_created + timedelta(hours=REALTIME_WINDOW_HOURS, minutes=1)
    assert classify_capi_log_timing(capi_sent, order_created) == "backfill"


def test_backfill_weeks_later():
    order_created = datetime(2026, 7, 1, 10, 0, 0)
    capi_sent = order_created + timedelta(days=14)
    assert classify_capi_log_timing(capi_sent, order_created) == "backfill"


def test_missing_timestamps_default_to_backfill_never_realtime():
    # Missing data must never silently count as a positive "realtime"
    # signal — the whole point of the feature is to make the ERP/Meta gap
    # honest, so an unknown case defaults to the more conservative label.
    assert classify_capi_log_timing(None, datetime(2026, 7, 1)) == "backfill"
    assert classify_capi_log_timing(datetime(2026, 7, 1), None) == "backfill"
    assert classify_capi_log_timing(None, None) == "backfill"


class _FakeLog:
    def __init__(self, status, created_at=None, error_message=None, retry_count=0):
        self.status = status
        self.created_at = created_at
        self.error_message = error_message
        self.retry_count = retry_count


def test_classify_capi_log_pending_states():
    ref = datetime(2026, 7, 1)
    for status in ("queued", "processing", "retry"):
        result = classify_capi_log(_FakeLog(status), ref)
        assert result["type"] == "pending"


def test_classify_capi_log_no_row_is_pending_not_realtime():
    # A NULL/missing MetaCapiLog row must classify as "pending" (never
    # attempted), not silently drop out of every bucket.
    result = classify_capi_log(None, datetime(2026, 7, 1))
    assert result["type"] == "pending"


def test_classify_capi_log_failed():
    ref = datetime(2026, 7, 1)
    result = classify_capi_log(_FakeLog("failed", error_message="token expired", retry_count=5), ref)
    assert result["type"] == "failed"
    assert result["error_message"] == "token expired"
    assert result["retry_count"] == 5


def test_classify_capi_log_success_realtime_vs_backfill():
    ref = datetime(2026, 7, 1, 10, 0, 0)
    realtime_log = _FakeLog("success", created_at=ref + timedelta(minutes=30))
    backfill_log = _FakeLog("success", created_at=ref + timedelta(days=10))

    r1 = classify_capi_log(realtime_log, ref)
    assert r1["type"] == "realtime"
    assert r1["delay_hours"] == 0.5

    r2 = classify_capi_log(backfill_log, ref)
    assert r2["type"] == "backfill"
    assert r2["delay_hours"] == 240.0  # 10 days
