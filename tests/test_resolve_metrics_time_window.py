"""
Unit tests for app.services.meta_analytics_engine.resolve_metrics_time_window
— the single function every Meta diagnostic endpoint should delegate to for
date-window resolution (Priorité 4 of the 2026-07-20 backend consolidation
request). Pure function, no DB, no network.
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.meta_analytics_engine import resolve_metrics_time_window, MetricsTimeWindow
from app.services.meta_capi import NEW_ENGINE_CUTOVER_DATE


def test_window_after_cutover_is_unchanged():
    since = datetime(2026, 7, 18)
    until = datetime(2026, 7, 20)
    w = resolve_metrics_time_window(since, until)
    assert w.effective_since == since
    assert w.effective_until == until
    assert w.cutover_applied is False
    assert w.requested_since == since


def test_window_before_cutover_is_floored_by_default():
    since = datetime(2026, 1, 1)  # long before the 2026-07-16 cutover
    until = datetime(2026, 7, 20)
    w = resolve_metrics_time_window(since, until)
    assert w.effective_since == NEW_ENGINE_CUTOVER_DATE
    assert w.requested_since == since  # original request preserved, never discarded
    assert w.cutover_applied is True


def test_include_legacy_data_bypasses_the_floor():
    since = datetime(2026, 1, 1)
    until = datetime(2026, 7, 20)
    w = resolve_metrics_time_window(since, until, include_legacy_data=True)
    assert w.effective_since == since
    assert w.cutover_applied is False
    assert w.include_legacy_data is True


def test_label_mentions_exclusion_when_cutover_applied():
    since = datetime(2026, 1, 1)
    until = datetime(2026, 7, 20)
    w = resolve_metrics_time_window(since, until)
    assert "16/07/2026" in w.label
    assert "exclues" in w.label


def test_label_mentions_inclusion_when_legacy_explicitly_requested():
    since = datetime(2026, 1, 1)
    until = datetime(2026, 7, 20)
    w = resolve_metrics_time_window(since, until, include_legacy_data=True)
    assert "avant/après" in w.label or "inclut" in w.label.lower()


def test_label_has_no_legacy_mention_when_window_is_entirely_post_cutover():
    since = datetime(2026, 7, 18)
    until = datetime(2026, 7, 20)
    w = resolve_metrics_time_window(since, until)
    assert "16/07/2026" not in w.label


def test_as_dict_exposes_every_field_a_widget_needs():
    w = resolve_metrics_time_window(datetime(2026, 7, 18), datetime(2026, 7, 20))
    d = w.as_dict()
    assert set(d.keys()) == {
        "requested_since", "requested_until", "effective_since", "effective_until",
        "cutover_applied", "include_legacy_data", "label",
    }


def test_exact_cutover_date_is_not_floored_further():
    # since == the cutover date itself: max(since, cutover) == since, no
    # off-by-one that would exclude 2026-07-16 orders themselves.
    since = NEW_ENGINE_CUTOVER_DATE
    until = datetime(2026, 7, 20)
    w = resolve_metrics_time_window(since, until)
    assert w.effective_since == NEW_ENGINE_CUTOVER_DATE
    assert w.cutover_applied is False
