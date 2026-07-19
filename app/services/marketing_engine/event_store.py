"""
event_store.py — the repository for marketing_events / marketing_event_attempts.

All persistence for the Marketing Event Engine goes through
MarketingEventStore; no other module should issue raw queries against
these two tables (engine.py, dispatcher.py, and the future admin API and
worker are the only intended callers).

claim_batch() is the durable-queue heart of the engine, reusing the exact
pattern app.services.meta_capi / meta_capi_logs already proved correct in
production: SELECT ... FOR UPDATE SKIP LOCKED so N concurrent Vercel Cron
invocations (or N uvicorn workers under the existing flock leader-lock)
never process the same row twice — pure PostgreSQL, no Redis/Kafka/SQS.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.marketing_event import MarketingEvent, MarketingEventAttempt

# Same shape as meta_capi.py's _QUEUE_BACKOFF_MINUTES — proven in
# production, reused rather than reinvented. Index i = delay before
# attempt i+2 (attempt 1 already happened when this is consulted).
BACKOFF_MINUTES = [1, 5, 15, 60, 360, 1440]
MAX_ATTEMPTS = len(BACKOFF_MINUTES)


def _now() -> datetime:
    # Naive UTC — matches the convention used throughout this codebase
    # (func.now() on a UTC DB session; see order.py's field_serializer
    # comment on why naive-but-UTC is the deliberate choice here).
    return datetime.now(timezone.utc).replace(tzinfo=None)


class MarketingEventStore:
    """Repository wrapping a single SQLAlchemy Session. Stateless beyond that — safe to instantiate per-request or per-worker-tick."""

    def __init__(self, db: Session):
        self.db = db

    # ── Create ──────────────────────────────────────────────────────────

    def create(
        self,
        *,
        event_id: str,
        business_event: str,
        provider: str,
        provider_event: str,
        order_id: str,
        store_id: str,
        canonical_payload: dict[str, Any],
        raw_payload: dict[str, Any],
        dedup_hash: str,
        signal_quality_score: Optional[float] = None,
        signal_quality_detail: Optional[dict[str, Any]] = None,
        session_id: Optional[str] = None,
        customer_id: Optional[str] = None,
        payload_version: int = 1,
        shadow: bool = True,
    ) -> Optional[MarketingEvent]:
        """
        Idempotent create: returns None (no-op, not an error) if event_id
        already exists, so callers never need a try/except for the common
        "this event was already emitted" case — the real guarantee is the
        DB UNIQUE constraint on event_id, this check is just the fast path.
        """
        existing = self.get_by_event_id(event_id)
        if existing is not None:
            return None

        row = MarketingEvent(
            id=str(uuid.uuid4()),
            event_id=event_id,
            business_event=business_event,
            provider=provider,
            provider_event=provider_event,
            order_id=order_id,
            customer_id=customer_id,
            session_id=session_id,
            store_id=store_id,
            raw_payload=raw_payload,
            canonical_payload=canonical_payload,
            payload_version=payload_version,
            dedup_hash=dedup_hash,
            signal_quality_score=signal_quality_score,
            signal_quality_detail=signal_quality_detail,
            status="pending",
            shadow=shadow,
        )
        self.db.add(row)
        try:
            self.db.commit()
        except IntegrityError:
            # Race: a concurrent transaction inserted the same event_id
            # between our existence check and this commit. The UNIQUE
            # constraint is the actual guarantee — this except just makes
            # the race harmless instead of propagating a 500.
            self.db.rollback()
            return self.get_by_event_id(event_id)
        self.db.refresh(row)
        return row

    def set_provider_payload(
        self,
        event: MarketingEvent,
        provider_payload: dict[str, Any],
        *,
        provider_config_snapshot: Optional[dict[str, Any]] = None,
        provider_version: Optional[str] = None,
        api_version: Optional[str] = None,
    ) -> None:
        event.provider_payload = provider_payload
        if provider_config_snapshot is not None:
            event.provider_config_snapshot = provider_config_snapshot
        if provider_version is not None:
            event.provider_version = provider_version
        if api_version is not None:
            event.api_version = api_version
        self.db.commit()

    # ── Read ────────────────────────────────────────────────────────────

    def get_by_id(self, id_: str) -> Optional[MarketingEvent]:
        return self.db.query(MarketingEvent).filter(MarketingEvent.id == id_).first()

    def get_by_event_id(self, event_id: str) -> Optional[MarketingEvent]:
        return self.db.query(MarketingEvent).filter(MarketingEvent.event_id == event_id).first()

    def list_attempts(self, event_id: str) -> list[MarketingEventAttempt]:
        return (
            self.db.query(MarketingEventAttempt)
            .filter(MarketingEventAttempt.marketing_event_id == event_id)
            .order_by(MarketingEventAttempt.attempt_number.asc())
            .all()
        )

    def search(
        self,
        *,
        store_id: Optional[str] = None,
        provider: Optional[str] = None,
        business_event: Optional[str] = None,
        order_id: Optional[str] = None,
        status: Optional[str] = None,
        shadow: Optional[bool] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[MarketingEvent], int]:
        """Admin-dashboard search — filter by any combination, paginated. Ordered newest-first."""
        q = self.db.query(MarketingEvent)
        if store_id:
            q = q.filter(MarketingEvent.store_id == store_id)
        if provider:
            q = q.filter(MarketingEvent.provider == provider)
        if business_event:
            q = q.filter(MarketingEvent.business_event == business_event)
        if order_id:
            q = q.filter(MarketingEvent.order_id == order_id)
        if status:
            q = q.filter(MarketingEvent.status == status)
        if shadow is not None:
            q = q.filter(MarketingEvent.shadow == shadow)
        total = q.count()
        page = max(1, page)
        page_size = max(1, min(page_size, 500))
        items = (
            q.order_by(MarketingEvent.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total

    # ── Claim (worker) ─────────────────────────────────────────────────

    def claim_batch(
        self,
        *,
        worker_id: str,
        limit: int = 50,
        provider: Optional[str] = None,
        store_id: Optional[str] = None,
        shadow: Optional[bool] = None,
    ) -> list[MarketingEvent]:
        """
        Atomically claims up to `limit` due events (pending, or retry whose
        retry_at has passed) via SELECT ... FOR UPDATE SKIP LOCKED — the
        Postgres-only equivalent of a distributed lock: any other concurrent
        caller (another cron invocation, another worker) skips rows already
        locked by this call instead of blocking or double-claiming them.
        """
        now = _now()
        q = self.db.query(MarketingEvent).filter(
            MarketingEvent.status.in_(["pending", "retry"]),
            or_(MarketingEvent.retry_at.is_(None), MarketingEvent.retry_at <= now),
        )
        if provider:
            q = q.filter(MarketingEvent.provider == provider)
        if store_id:
            q = q.filter(MarketingEvent.store_id == store_id)
        if shadow is not None:
            q = q.filter(MarketingEvent.shadow == shadow)

        rows = (
            q.order_by(MarketingEvent.created_at.asc())
            .with_for_update(skip_locked=True)
            .limit(limit)
            .all()
        )
        for row in rows:
            row.status = "processing"
            row.processing_worker = worker_id
            row.processing_started_at = now
        self.db.commit()
        return rows

    def reclaim_stuck(self, *, stuck_after_minutes: int = 15) -> int:
        """
        A row stuck in 'processing' for longer than stuck_after_minutes
        means the worker that claimed it died mid-send (process killed,
        function timeout). Same 15-minute window meta_capi_logs already
        uses in production — reused, not re-derived.
        """
        cutoff = _now() - timedelta(minutes=stuck_after_minutes)
        rows = (
            self.db.query(MarketingEvent)
            .filter(MarketingEvent.status == "processing", MarketingEvent.processing_started_at < cutoff)
            .with_for_update(skip_locked=True)
            .all()
        )
        for row in rows:
            row.status = "retry"
            row.retry_at = _now()
            row.error_message = "reclaimed: stuck in processing (worker likely died mid-send)"
        self.db.commit()
        return len(rows)

    # ── Attempt lifecycle ───────────────────────────────────────────────

    def record_attempt_start(self, event: MarketingEvent) -> MarketingEventAttempt:
        attempt = MarketingEventAttempt(
            id=str(uuid.uuid4()),
            marketing_event_id=event.id,
            attempt_number=event.attempt_count + 1,
            started_at=_now(),
            processing_worker=event.processing_worker,
        )
        self.db.add(attempt)
        self.db.commit()
        self.db.refresh(attempt)
        return attempt

    def record_attempt_finish(
        self,
        attempt: MarketingEventAttempt,
        *,
        http_status: Optional[int] = None,
        api_response: Optional[dict[str, Any]] = None,
        error_message: Optional[str] = None,
        error_category: Optional[str] = None,
        latency_ms: Optional[int] = None,
    ) -> None:
        attempt.finished_at = _now()
        attempt.http_status = http_status
        attempt.api_response = api_response
        attempt.error_message = error_message
        attempt.error_category = error_category
        attempt.latency_ms = latency_ms
        self.db.commit()

    def mark_sent(self, event: MarketingEvent, *, api_response: Optional[dict[str, Any]] = None) -> None:
        event.status = "sent"
        event.attempt_count += 1
        event.processed_at = _now()
        event.api_response = api_response
        event.processing_worker = None
        event.processing_started_at = None
        self.db.commit()

    def mark_failed_or_retry(
        self,
        event: MarketingEvent,
        *,
        error_message: str,
        error_category: Optional[str] = None,
        retryable: bool = False,
    ) -> None:
        """Exponential backoff while under MAX_ATTEMPTS and the failure is retryable; otherwise a terminal 'failed' — dead-letter, never silently dropped, always queryable."""
        event.attempt_count += 1
        event.error_message = error_message
        now = _now()
        if retryable and event.attempt_count < MAX_ATTEMPTS:
            idx = min(event.attempt_count - 1, len(BACKOFF_MINUTES) - 1)
            event.status = "retry"
            event.retry_at = now + timedelta(minutes=BACKOFF_MINUTES[idx])
        else:
            event.status = "failed"
            event.failed_at = now
        event.processing_worker = None
        event.processing_started_at = None
        self.db.commit()

    # ── Cancellation (ORDER_MERGED) ───────────────────────────────────────

    def cancel_for_order(self, order_id: str, *, reason: str = "") -> int:
        """
        The actual fix for the bug that started this project: an order that
        gets merged as a duplicate must never let a still-pending event
        reach a provider. Only touches pending/retry rows — a row already
        'sent' or 'processing' is left alone and surfaces as a rare,
        loggable race rather than being silently rewritten.
        """
        rows = (
            self.db.query(MarketingEvent)
            .filter(MarketingEvent.order_id == order_id, MarketingEvent.status.in_(["pending", "retry"]))
            .with_for_update(skip_locked=True)
            .all()
        )
        for row in rows:
            row.status = "cancelled"
            row.error_message = reason or "cancelled"
        self.db.commit()
        return len(rows)

    # ── Replay ──────────────────────────────────────────────────────────

    def replay(self, original: MarketingEvent, *, suffix: Optional[str] = None) -> MarketingEvent:
        """
        Creates a brand-new row referencing `original` via replayed_from —
        NEVER mutates or re-marks the original, never touches orders/
        order_events. Reuses the original's frozen payloads and config
        snapshot so a replay years later reproduces exactly what would have
        been sent then, not what today's config/logic would produce.
        """
        token = suffix or str(uuid.uuid4())[:8]
        row = MarketingEvent(
            id=str(uuid.uuid4()),
            event_id=f"{original.event_id}-replay-{token}",
            business_event=original.business_event,
            provider=original.provider,
            provider_event=original.provider_event,
            order_id=original.order_id,
            customer_id=original.customer_id,
            session_id=original.session_id,
            store_id=original.store_id,
            raw_payload=original.raw_payload,
            canonical_payload=original.canonical_payload,
            provider_payload=original.provider_payload,
            payload_version=original.payload_version,
            provider_version=original.provider_version,
            api_version=original.api_version,
            schema_version=original.schema_version,
            provider_config_snapshot=original.provider_config_snapshot,
            dedup_hash=original.dedup_hash,
            signal_quality_score=original.signal_quality_score,
            signal_quality_detail=original.signal_quality_detail,
            status="pending",
            replayed_from=original.id,
            shadow=original.shadow,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def replay_many(self, originals: list[MarketingEvent]) -> list[MarketingEvent]:
        """Bulk replay — backs replay_order/replay_day/replay_provider/replay_store, all of which reduce to 'find the events, replay each one'."""
        return [self.replay(o) for o in originals]
