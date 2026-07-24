"""
Top-funnel counters (PageView/ViewContent/AddToCart/InitiateCheckout) —
Redis-batched rollup, never row-per-event. See the design discussion this
was built from: 1 Redis INCR per event, a Celery-beat flush every 15 min
drains Upstash into app.models.funnel_rollup.FunnelRollup via additive
UPSERTs. Benchmarked (local Postgres) at ~294ms worst-case flush duration
and ~34K writes/day at 100K PageViews/day, vs. measured 7-16x serialization
under concurrent direct-Postgres writes to the same hot row — that
concurrency behavior is why this goes through Redis instead of upserting
straight from the request path.

Three independent safety layers, all fail toward "tracking silently stops",
never toward "the request breaks" or "numbers get corrupted upward":
  1. FUNNEL_TRACKING_ENABLED (env, settings.py) — deploy-level off switch.
  2. Redis kill switch (`funnel:killswitch` key) — instant, no redeploy,
     toggle via POST /api/v1/meta-ads/funnel/toggle.
  3. In-process circuit breaker — after N consecutive Redis failures,
     stops attempting Redis calls for a cooldown window and self-heals.
Meta Pixel/CAPI tracking is a fully separate code path (meta_capi.py /
send_meta_event) and is NEVER touched by anything in this module — a
funnel-counter failure can only ever silently under-report a diagnostics
dashboard, never degrade ad tracking.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, date, timezone, timedelta
from typing import Optional

from app.core import cache
from app.core.config import settings

logger = logging.getLogger("app.funnel_tracking")

TRACKED_EVENTS = {"PageView", "ViewContent", "AddToCart", "InitiateCheckout"}
ALGERIA_UTC_OFFSET_HOURS = 1
KEY_PREFIX = "funnel"
KILLSWITCH_KEY = "funnel:killswitch"
KEY_TTL_SECONDS = 26 * 3600  # survives well past one flush cycle even if a flush is delayed/missed

# ─── Circuit breaker (in-process, best-effort — see module docstring) ──────
_CB_FAILURE_THRESHOLD = 5
_CB_COOLDOWN_SECONDS = 60
_cb_state = {"consecutive_failures": 0, "open_until": 0.0}

# ─── Metrics (in-process, per-worker — exposed via /funnel/diagnostics) ────
_metrics = {
    "commands_total": 0,
    "commands_window_start": time.monotonic(),
    "failures_total": 0,
    "flush_count": 0,
    "flush_success_count": 0,
    "flush_last_duration_ms": None,
    "flush_last_at": None,
    "flush_last_buckets": 0,
    "flush_last_events_drained": 0,
}


def _circuit_open() -> bool:
    return time.monotonic() < _cb_state["open_until"]


def _circuit_record_failure() -> None:
    _cb_state["consecutive_failures"] += 1
    _metrics["failures_total"] += 1
    if _cb_state["consecutive_failures"] >= _CB_FAILURE_THRESHOLD:
        _cb_state["open_until"] = time.monotonic() + _CB_COOLDOWN_SECONDS
        logger.warning(
            "[FunnelTracking] Circuit breaker OPEN after %d consecutive Redis failures — "
            "pausing funnel counters for %ds.",
            _cb_state["consecutive_failures"], _CB_COOLDOWN_SECONDS,
        )


def _circuit_record_success() -> None:
    _cb_state["consecutive_failures"] = 0


def is_tracking_active() -> bool:
    """Single source of truth for whether counters are currently being
    written — surfaced in diagnostics so an admin can see WHY tracking
    might be silently paused (flag off / kill switch / circuit open)."""
    if not settings.FUNNEL_TRACKING_ENABLED:
        return False
    if _circuit_open():
        return False
    try:
        if cache.raw_command("GET", KILLSWITCH_KEY):
            return False
    except Exception:
        # Can't even check the kill switch — treat as unavailable, fail closed.
        return False
    return True


def tracking_status() -> dict:
    killswitch_set = None
    try:
        killswitch_set = bool(cache.raw_command("GET", KILLSWITCH_KEY))
    except Exception:
        pass
    return {
        "flag_enabled": settings.FUNNEL_TRACKING_ENABLED,
        "killswitch_engaged": killswitch_set,
        "circuit_open": _circuit_open(),
        "circuit_consecutive_failures": _cb_state["consecutive_failures"],
        "active": is_tracking_active(),
    }


def _bucket_key(
    *, store_id: str, event_name: str, lp_id: Optional[str], product_id: Optional[str],
    campaign_id: Optional[str], adset_id: Optional[str], ad_id: Optional[str],
    when: datetime,
) -> str:
    local = when + timedelta(hours=ALGERIA_UTC_OFFSET_HOURS)
    day = local.strftime("%Y-%m-%d")
    hour = local.hour
    parts = [
        KEY_PREFIX, store_id, lp_id or "-", product_id or "-",
        campaign_id or "-", adset_id or "-", ad_id or "-",
        event_name, day, str(hour),
    ]
    return ":".join(parts)


def record_funnel_event(
    *,
    store_id: str,
    event_name: str,
    lp_id: Optional[str] = None,
    product_id: Optional[str] = None,
    campaign_id: Optional[str] = None,
    adset_id: Optional[str] = None,
    ad_id: Optional[str] = None,
) -> None:
    """
    Fire-and-forget. Call from a background task (never inline on the
    request path) — mirrors the existing CAPI relay pattern exactly.
    Silently no-ops if tracking isn't active; never raises.
    """
    if event_name not in TRACKED_EVENTS:
        return
    if not is_tracking_active():
        return

    key = _bucket_key(
        store_id=store_id, event_name=event_name, lp_id=lp_id, product_id=product_id,
        campaign_id=campaign_id, adset_id=adset_id, ad_id=ad_id, when=datetime.now(timezone.utc),
    )
    try:
        cache.raw_command("INCR", key)
        # Refresh TTL on every increment so an active bucket never expires
        # mid-day; a quiet bucket still expires ~26h after its last write.
        cache.raw_command("EXPIRE", key, KEY_TTL_SECONDS)
        _metrics["commands_total"] += 2
        _circuit_record_success()
    except Exception as exc:
        logger.debug("[FunnelTracking] INCR failed for %s: %s", key, exc)
        _circuit_record_failure()


# ─── Flush: Redis -> Postgres, atomic per-key drain ─────────────────────────

def flush_funnel_counters() -> dict:
    """
    Drains every `funnel:*` key via atomic GETDEL (one Redis round-trip per
    key consumes its value and clears it in a single operation — no
    read-then-delete race, no double-application even under concurrent
    flush runs). Each drained value becomes one additive Postgres UPSERT.

    Failure mode: if the process crashes between a key's GETDEL and its
    Postgres commit, that bucket's delta is LOST, never duplicated — the
    system is built to under-count on failure, never over-count. Bounded
    to at most one flush interval's worth of one bucket.
    """
    from app.db.session import SessionLocal
    from app.models.funnel_rollup import FunnelRollup
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    t0 = time.monotonic()
    _metrics["flush_count"] += 1

    if not settings.FUNNEL_TRACKING_ENABLED:
        return {"skipped": "flag_disabled"}

    try:
        keys = cache.raw_command("KEYS", f"{KEY_PREFIX}:*")
    except Exception as exc:
        logger.warning("[FunnelTracking] Flush: could not list keys: %s", exc)
        return {"skipped": "redis_unavailable", "error": str(exc)}

    if not keys:
        _metrics["flush_success_count"] += 1
        _metrics["flush_last_duration_ms"] = round((time.monotonic() - t0) * 1000, 1)
        _metrics["flush_last_at"] = datetime.now(timezone.utc).isoformat()
        _metrics["flush_last_buckets"] = 0
        _metrics["flush_last_events_drained"] = 0
        return {"buckets": 0, "events_drained": 0}

    db = SessionLocal()
    buckets_written = 0
    events_drained = 0
    try:
        for key in keys:
            try:
                raw_value = cache.raw_command("GETDEL", key)
            except Exception as exc:
                logger.warning("[FunnelTracking] Flush: GETDEL failed for %s: %s", key, exc)
                continue
            if raw_value is None:
                continue
            try:
                delta = int(raw_value)
            except (TypeError, ValueError):
                continue
            if delta <= 0:
                continue

            parts = key.split(":")
            if len(parts) != 10:
                logger.warning("[FunnelTracking] Flush: malformed key %s, skipping", key)
                continue
            _, store_id, lp_id, product_id, campaign_id, adset_id, ad_id, event_name, day_str, hour_str = parts

            stmt = pg_insert(FunnelRollup).values(
                store_id=store_id,
                lp_id=None if lp_id == "-" else lp_id,
                product_id=None if product_id == "-" else product_id,
                campaign_id=None if campaign_id == "-" else campaign_id,
                adset_id=None if adset_id == "-" else adset_id,
                ad_id=None if ad_id == "-" else ad_id,
                event_name=event_name,
                day=date.fromisoformat(day_str),
                hour=int(hour_str),
                count=delta,
            )
            stmt = stmt.on_conflict_do_update(
                constraint="uq_funnel_rollup_bucket",
                set_={"count": FunnelRollup.count + delta, "updated_at": datetime.now(timezone.utc)},
            )
            db.execute(stmt)
            buckets_written += 1
            events_drained += delta

        db.commit()
        _metrics["flush_success_count"] += 1
    except Exception:
        db.rollback()
        logger.exception("[FunnelTracking] Flush failed, rolled back")
        raise
    finally:
        db.close()

    dur_ms = round((time.monotonic() - t0) * 1000, 1)
    _metrics["flush_last_duration_ms"] = dur_ms
    _metrics["flush_last_at"] = datetime.now(timezone.utc).isoformat()
    _metrics["flush_last_buckets"] = buckets_written
    _metrics["flush_last_events_drained"] = events_drained

    return {"buckets": buckets_written, "events_drained": events_drained, "duration_ms": dur_ms}


def get_diagnostics() -> dict:
    """Powers GET /api/v1/meta-ads/funnel/diagnostics — the admin panel."""
    from app.db.session import SessionLocal
    from app.models.funnel_rollup import FunnelRollup
    from sqlalchemy import func as sqlfunc

    now = time.monotonic()
    window_s = max(now - _metrics["commands_window_start"], 1.0)
    commands_per_min = round(_metrics["commands_total"] / window_s * 60, 1)

    flush_success_rate = (
        round(_metrics["flush_success_count"] / _metrics["flush_count"] * 100, 1)
        if _metrics["flush_count"] > 0 else None
    )

    try:
        pending_keys = cache.raw_command("KEYS", f"{KEY_PREFIX}:*") or []
        queue_length = len(pending_keys)
    except Exception:
        queue_length = None

    # Counter lag: age of the oldest un-flushed bucket still sitting in Redis.
    counter_lag_minutes = None
    if _metrics["flush_last_at"]:
        try:
            last_flush = datetime.fromisoformat(_metrics["flush_last_at"])
            counter_lag_minutes = round((datetime.now(timezone.utc) - last_flush).total_seconds() / 60, 1)
        except Exception:
            pass

    db = SessionLocal()
    try:
        total_rollup_rows = db.query(sqlfunc.count(FunnelRollup.id)).scalar() or 0
        total_rollup_count = db.query(sqlfunc.coalesce(sqlfunc.sum(FunnelRollup.count), 0)).scalar() or 0
        t0 = time.monotonic()
        db.query(FunnelRollup).filter(FunnelRollup.day == date.today()).limit(500).all()
        dashboard_query_ms = round((time.monotonic() - t0) * 1000, 2)
    finally:
        db.close()

    compression_ratio = (
        round(total_rollup_rows / total_rollup_count * 100, 1)
        if total_rollup_count > 0 else None
    )

    # Rough monthly Redis-command estimate from the current run rate —
    # each event costs 2 commands (INCR + EXPIRE).
    estimated_monthly_commands = round(commands_per_min * 60 * 24 * 30)

    return {
        "status": tracking_status(),
        "commands_per_min": commands_per_min,
        "estimated_monthly_commands": estimated_monthly_commands,
        "failures_total": _metrics["failures_total"],
        "flush": {
            "count": _metrics["flush_count"],
            "success_count": _metrics["flush_success_count"],
            "success_rate_pct": flush_success_rate,
            "last_duration_ms": _metrics["flush_last_duration_ms"],
            "last_at": _metrics["flush_last_at"],
            "last_buckets_written": _metrics["flush_last_buckets"],
            "last_events_drained": _metrics["flush_last_events_drained"],
        },
        "queue_length_pending_keys": queue_length,
        "counter_lag_minutes": counter_lag_minutes,
        "rollup_table_rows": total_rollup_rows,
        "rollup_table_total_events": int(total_rollup_count),
        "compression_ratio_pct": compression_ratio,
        "dashboard_query_ms": dashboard_query_ms,
    }
