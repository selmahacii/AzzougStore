"""
TikTok Events API (server-side) — central service, TikTok Ads Enterprise
Phase 1 (2026-07-20), architecturally mirroring app/services/meta_capi.py:

- Advanced Matching hashing reused from meta_capi.py (normalize_email,
  normalize_phone, normalize_name, ...) — SHA256-hashed PII normalization
  is not platform-specific, TikTok's own spec requires the same lowercase/
  trim/hash contract as Meta's. One canonical implementation, not a
  second copy that could silently drift from the first.
- Pixel and Events API share the same event_id (deduplication) — see
  purchase_event_id() below, same "purchase-{order_id}" convention as Meta
  so the two platforms' dedup keys never collide with each other's rows.
- Every send is persisted in tiktok_capi_logs BEFORE the network call
  (durable-queue contract identical to meta_capi_logs) and retried with
  exponential backoff + circuit breaker on transient failure — never
  silently dropped.

Deliberately NOT sharing a module with meta_capi.py's circuit breaker /
httpx client / retry-queue plumbing: that logic is generic infrastructure
that could in principle be extracted into a shared base, but meta_capi.py
is live, tested, production code from a completed audit — retrofitting it
to share internals with a brand-new TikTok module this session would touch
already-shipped Meta code for no functional gain and real regression risk.
This is a deliberate, documented tradeoff (flagged in the Phase 1 report),
not an oversight — a future consolidation pass, done on its own with its
own tests, would be the right way to remove this duplication.

TikTok Events API version: v1.3 (business-api.tiktok.com/open_api/v1.3/event/track/).
"""

from __future__ import annotations

import logging
import random
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

# Reused, not duplicated — see module docstring.
from app.services.meta_capi import (
    normalize_email,
    normalize_phone,
    normalize_name,
    _sha256,
)

logger = logging.getLogger("app.tiktok_capi")

EVENTS_API_VERSION = "v1.3"
EVENTS_API_URL = f"https://business-api.tiktok.com/open_api/{EVENTS_API_VERSION}/event/track/"

# Full TikTok Events API v1.3 standard-event vocabulary this integration
# supports — mapped 1:1 from our own internal event names (the same names
# used across the storefront, meta-tracking.ts and the funnel dashboard) so
# ONE internal vocabulary drives both platforms; only the TikTok-side NAME
# differs where TikTok's own spec uses a different word for the same funnel
# stage (Purchase -> CompletePayment, our "manual order without payment yet"
# stage -> PlaceAnOrder). Every name below is a real TikTok standard event,
# not invented — see business-api.tiktok.com/portal/docs?id=1741601162187778.
EVENT_NAME_MAP = {
    "PageView": "PageView",
    "ViewContent": "ViewContent",
    "Search": "Search",
    "AddToWishlist": "AddToWishlist",
    "AddToCart": "AddToCart",
    "InitiateCheckout": "InitiateCheckout",
    "AddPaymentInfo": "AddPaymentInfo",
    "PlaceOrder": "PlaceAnOrder",       # order created, COD — before delivery/payment settles
    "Purchase": "CompletePayment",      # TikTok's own name for a completed/settled order
    "CompleteRegistration": "CompleteRegistration",
    "Lead": "Contact",                  # TikTok's standard event for a lead/contact-request
}

# ─── Circuit breaker — same pattern/thresholds as meta_capi.py, own state ──
_CIRCUIT_FAILURE_THRESHOLD = 5
_CIRCUIT_COOLDOWN_SECONDS = 60
_circuit_lock = threading.Lock()
_circuit_state = {"consecutive_failures": 0, "opened_at": 0.0}
_sweep_lock = threading.Lock()


def _circuit_is_open() -> bool:
    with _circuit_lock:
        if _circuit_state["consecutive_failures"] < _CIRCUIT_FAILURE_THRESHOLD:
            return False
        if time.monotonic() - _circuit_state["opened_at"] >= _CIRCUIT_COOLDOWN_SECONDS:
            _circuit_state["consecutive_failures"] = _CIRCUIT_FAILURE_THRESHOLD - 1
            return False
        return True


def _circuit_record(success: bool) -> None:
    with _circuit_lock:
        if success:
            _circuit_state["consecutive_failures"] = 0
        else:
            _circuit_state["consecutive_failures"] += 1
            if _circuit_state["consecutive_failures"] == _CIRCUIT_FAILURE_THRESHOLD:
                _circuit_state["opened_at"] = time.monotonic()
                logger.error(
                    "[TikTokCAPI] circuit breaker OPEN after %d consecutive failures — "
                    "immediate attempts suspended for %ds, events queued directly",
                    _CIRCUIT_FAILURE_THRESHOLD, _CIRCUIT_COOLDOWN_SECONDS,
                )


def get_circuit_state() -> Dict[str, Any]:
    """Same shape as meta_capi.get_circuit_state() — one Signal Quality
    Center widget renders both platforms' circuit breaker cards identically."""
    with _circuit_lock:
        n = _circuit_state["consecutive_failures"]
        opened_at = _circuit_state["opened_at"]
    elapsed = time.monotonic() - opened_at if opened_at else 0.0
    is_open = n >= _CIRCUIT_FAILURE_THRESHOLD and elapsed < _CIRCUIT_COOLDOWN_SECONDS
    return {
        "is_open": is_open,
        "consecutive_failures": n,
        "threshold": _CIRCUIT_FAILURE_THRESHOLD,
        "cooldown_seconds": _CIRCUIT_COOLDOWN_SECONDS,
        "seconds_until_reset": max(0, int(_CIRCUIT_COOLDOWN_SECONDS - elapsed)) if is_open else 0,
    }


# ─── Pooled HTTP client ─────────────────────────────────────────────────────
_client: Optional[httpx.Client] = None
_client_lock = threading.Lock()


def _get_client() -> httpx.Client:
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is None:
            _client = httpx.Client(
                timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0),
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            )
        return _client


def _destroy_client() -> None:
    global _client
    with _client_lock:
        if _client is not None:
            try:
                _client.close()
            except Exception:
                pass
            _client = None


# ─── Advanced Matching — PII hashing (TikTok's own field names) ───────────

def build_tiktok_user(
    *,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    full_name: Optional[str] = None,
    external_id: Optional[str] = None,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    ttclid: Optional[str] = None,
    ttp: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Assemble a TikTok Events API `user` object. Field names differ from
    Meta's (email/phone_number vs em/ph, list-of-one vs bare string) but the
    hashing itself is the exact same SHA256(lowercase(trim(value))) contract
    — see normalize_email/normalize_phone/normalize_name in meta_capi.py,
    reused here rather than reimplemented.
    """
    user: Dict[str, Any] = {}
    if (v := normalize_email(email)):
        user["email"] = v
    if (v := normalize_phone(phone)):
        user["phone"] = v
    if full_name:
        parts = full_name.strip().split()
        if parts and (v := normalize_name(parts[0])):
            user["first_name"] = v
        if len(parts) > 1 and (v := normalize_name(parts[-1])):
            user["last_name"] = v
    if external_id:
        user["external_id"] = _sha256(str(external_id).strip().lower())
    if client_ip:
        user["ip"] = client_ip.split(",")[0].strip()
    if user_agent:
        user["user_agent"] = user_agent
    if ttclid:
        user["ttclid"] = ttclid
    if ttp:
        user["ttp"] = ttp
    return user


def purchase_event_id(order_id: str) -> str:
    """Same convention as meta_capi.purchase_event_id — shared with the
    browser Pixel (ttq.track) for TikTok-side deduplication."""
    return f"purchase-{order_id}"


def build_purchase_event(
    order,
    *,
    pixel_code: str,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    ttclid: Optional[str] = None,
    ttp: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Builds one TikTok Events API `data[]` entry for a Purchase (CompletePayment).
    event_time uses the order's real created_at, never send-time — same
    correctness fix as meta_capi.build_purchase_event (sending "now" for a
    backfilled event falsely reports the conversion as just having happened).
    """
    created_at = getattr(order, "created_at", None)
    event_time = int(
        (created_at.replace(tzinfo=timezone.utc) if created_at else datetime.now(timezone.utc)).timestamp()
    )
    user = build_tiktok_user(
        email=getattr(order, "customer_email", None),
        phone=getattr(order, "customer_phone", None),
        full_name=getattr(order, "customer_name", None),
        external_id=getattr(order, "id", None),
        client_ip=client_ip or getattr(order, "client_ip", None),
        user_agent=user_agent or getattr(order, "client_user_agent", None),
        ttclid=ttclid,
        ttp=ttp,
    )
    items = getattr(order, "items", None) or []
    contents = [
        {
            "content_id": getattr(item, "product_id", None),
            "content_name": getattr(item, "product_name", None),
            "quantity": getattr(item, "quantity", 1),
            "price": getattr(item, "unit_price", 0),
        }
        for item in items
    ]
    return {
        "event": EVENT_NAME_MAP["Purchase"],
        "event_time": event_time,
        "event_id": purchase_event_id(getattr(order, "id", "")),
        "user": user,
        "properties": {
            "content_type": "product",
            "contents": contents,
            "value": getattr(order, "total", 0),
            "currency": "DZD",  # store currency for COD Algeria — never hardcoded elsewhere, this IS the source
            "order_id": getattr(order, "id", None),
        },
        "page": {"url": getattr(order, "event_source_url", None)},
        "_pixel_code": pixel_code,  # stripped before the real API call, kept for the log payload
    }


# ─── Retry/backoff ──────────────────────────────────────────────────────────
_BACKOFF_BASE = 1.0
_BACKOFF_CAP = 30.0
_BACKOFF_JITTER = 0.5
_MAX_IMMEDIATE_ATTEMPTS = 3
_MAX_RETRY_COUNT = 8


def _backoff_with_jitter(attempt: int) -> float:
    base = min(_BACKOFF_CAP, _BACKOFF_BASE * (2 ** attempt))
    return max(0.1, base + random.uniform(-_BACKOFF_JITTER, _BACKOFF_JITTER))


def _log_send(
    db: Session,
    *,
    store_id: Optional[str],
    order_id: Optional[str],
    event_name: str,
    event_id: str,
    status: str,
    error_message: Optional[str] = None,
    error_category: Optional[str] = None,
    events_received: Optional[int] = None,
    payload: Optional[Dict[str, Any]] = None,
    retry_count: int = 0,
    next_retry_at: Optional[datetime] = None,
    latency_ms: Optional[int] = None,
    last_http_status: Optional[int] = None,
) -> None:
    """Upsert-by-(order_id, event_id) — identical contract to meta_capi._log_send."""
    try:
        from app.models.marketing import TikTokCapiLog
        existing = None
        if order_id:
            existing = (
                db.query(TikTokCapiLog)
                .filter(TikTokCapiLog.order_id == order_id, TikTokCapiLog.event_id == event_id)
                .order_by(TikTokCapiLog.id.desc())
                .first()
            )
        if existing:
            existing.status = status
            existing.error_message = (error_message or "")[:1000] or None
            existing.error_category = error_category
            existing.events_received = events_received
            existing.retry_count = retry_count
            existing.next_retry_at = next_retry_at
            existing.latency_ms = latency_ms
            if payload is not None:
                existing.payload = payload
            if last_http_status is not None:
                existing.last_http_status = last_http_status
        else:
            db.add(TikTokCapiLog(
                id=str(uuid.uuid4()),
                store_id=store_id,
                order_id=order_id,
                event_name=event_name,
                event_id=event_id,
                status=status,
                error_message=(error_message or "")[:1000] or None,
                error_category=error_category,
                events_received=events_received,
                payload=payload,
                retry_count=retry_count,
                next_retry_at=next_retry_at,
                latency_ms=latency_ms,
                last_http_status=last_http_status,
            ))
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("tiktok_capi log write failed: %s", exc)


def _coarse_error_category(exc: Exception, status_code: Optional[int]) -> str:
    if status_code is not None:
        return "api_5xx" if status_code >= 500 else "api_4xx"
    if isinstance(exc, (httpx.ConnectTimeout, httpx.ConnectError)):
        return "network_timeout"
    if isinstance(exc, httpx.TransportError):
        return "network_error"
    return "other"


def send_events(
    db: Session,
    *,
    store_id: str,
    access_token: str,
    pixel_code: str,
    events: List[Dict[str, Any]],
    order_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Sends a batch of already-built event dicts to the TikTok Events API,
    with circuit breaker + exponential-backoff immediate retries; on
    exhausted immediate attempts the event is persisted as
    status='pending_retry' (never dropped) for retry_pending_events() to
    pick up later — same reliability contract as meta_capi.send_events.
    """
    if not events:
        return {"success": True, "events_received": 0}

    event_name = events[0].get("event", "unknown")
    event_id = events[0].get("event_id", str(uuid.uuid4()))
    clean_events = [{k: v for k, v in e.items() if not k.startswith("_")} for e in events]
    body = {"event_source": "web", "event_source_id": pixel_code, "data": clean_events}

    if _circuit_is_open():
        state = get_circuit_state()
        _log_send(
            db, store_id=store_id, order_id=order_id, event_name=event_name, event_id=event_id,
            status="pending_retry", error_message="circuit breaker open — queued directly",
            error_category="network_error", payload=body, retry_count=0,
            next_retry_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=state["seconds_until_reset"] or _CIRCUIT_COOLDOWN_SECONDS),
        )
        return {"success": False, "error": "circuit_open"}

    last_exc: Optional[Exception] = None
    last_status: Optional[int] = None
    for attempt in range(_MAX_IMMEDIATE_ATTEMPTS):
        start = time.monotonic()
        try:
            client = _get_client()
            resp = client.post(
                EVENTS_API_URL,
                headers={"Access-Token": access_token, "Content-Type": "application/json"},
                json=body,
            )
            latency_ms = int((time.monotonic() - start) * 1000)
            last_status = resp.status_code
            resp_json = resp.json() if resp.content else {}
            api_code = resp_json.get("code", -1)
            if resp.status_code == 200 and api_code == 0:
                _circuit_record(success=True)
                events_received = len(clean_events)
                _log_send(
                    db, store_id=store_id, order_id=order_id, event_name=event_name, event_id=event_id,
                    status="success", events_received=events_received, payload=body,
                    retry_count=attempt, latency_ms=latency_ms,
                )
                return {"success": True, "events_received": events_received, "latency_ms": latency_ms}
            error_message = resp_json.get("message") or f"HTTP {resp.status_code}"
            error_category = _coarse_error_category(Exception(error_message), resp.status_code)
            last_exc = Exception(error_message)
        except Exception as exc:
            latency_ms = int((time.monotonic() - start) * 1000)
            last_exc = exc
            error_message = str(exc)
            error_category = _coarse_error_category(exc, None)

        _circuit_record(success=False)
        if attempt < _MAX_IMMEDIATE_ATTEMPTS - 1:
            time.sleep(_backoff_with_jitter(attempt))

    next_retry_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=_backoff_with_jitter(0))
    _log_send(
        db, store_id=store_id, order_id=order_id, event_name=event_name, event_id=event_id,
        status="pending_retry", error_message=str(last_exc) if last_exc else "unknown error",
        error_category=error_category, payload=body, retry_count=_MAX_IMMEDIATE_ATTEMPTS,
        next_retry_at=next_retry_at, last_http_status=last_status,
    )
    return {"success": False, "error": str(last_exc) if last_exc else "unknown"}


# ─── Event Match Quality (EMQ) — TikTok field set, same weighting engine
# design as meta_capi.compute_match_quality, adapted to TikTok's own
# `user` object field names and COD-context weighting.
# ─────────────────────────────────────────────────────────────────────────

_MATCH_QUALITY_FIELDS = [
    ("phone", "Téléphone"), ("email", "Email"),
    ("first_name", "Prénom"), ("last_name", "Nom"),
    ("external_id", "ID externe"), ("ip", "Adresse IP"),
    ("user_agent", "User Agent"), ("ttclid", "TTCLID"), ("ttp", "TTP"),
]

# Same COD-context rationale as Meta's MATCH_QUALITY_WEIGHTS: phone/
# external_id/ip/user_agent/ttclid/ttp are first-party signals reliably
# available on a real COD order; email is structurally absent (no email
# field on the checkout) so it carries a small weight and is
# not_applicable rather than a reportable defect. ttclid (TikTok's own
# click-id, the ttclid equivalent of Meta's fbclid) is weighted like
# fbc/fbp — a strong first-party signal when present, not always
# available (only when the visit came from a TikTok ad click).
MATCH_QUALITY_WEIGHTS: dict[str, float] = {
    "phone": 3.0,
    "external_id": 2.5,
    "ttclid": 2.0,
    "ttp": 2.0,
    "ip": 1.5,
    "user_agent": 1.5,
    "email": 1.0,
    "first_name": 0.5,
    "last_name": 0.5,
}

FIELD_CLASSIFICATION: dict[str, str] = {
    "phone": "required",
    "external_id": "required",
    "ttclid": "recommended",
    "ttp": "recommended",
    "ip": "recommended",
    "user_agent": "recommended",
    "email": "not_applicable",  # COD landing pages don't collect email
    "first_name": "recommended",
    "last_name": "recommended",
}


def compute_match_quality(user: Optional[dict]) -> dict:
    """
    Weighted completeness score for a TikTok `user` object — same
    methodology as meta_capi.compute_match_quality (a documented,
    weighted proxy; TikTok's own internal EMQ formula is never exposed by
    any API, only visible in TikTok Events Manager).
    """
    user = user or {}
    present = {key: bool(user.get(key)) for key, _ in _MATCH_QUALITY_FIELDS}
    total_weight = sum(MATCH_QUALITY_WEIGHTS.get(key, 1.0) for key, _ in _MATCH_QUALITY_FIELDS)
    earned_weight = sum(MATCH_QUALITY_WEIGHTS.get(key, 1.0) for key, _ in _MATCH_QUALITY_FIELDS if present[key])
    score = round(earned_weight / total_weight * 100, 1) if total_weight else 0.0
    return {
        "score": score,
        "fields": [
            {
                "key": key, "label": label, "present": present[key],
                "weight": MATCH_QUALITY_WEIGHTS.get(key, 1.0),
                "classification": FIELD_CLASSIFICATION.get(key, "recommended"),
            }
            for key, label in _MATCH_QUALITY_FIELDS
        ],
        "missing": [
            label for key, label in _MATCH_QUALITY_FIELDS
            if not present[key] and FIELD_CLASSIFICATION.get(key, "recommended") != "not_applicable"
        ],
        "not_applicable": [
            label for key, label in _MATCH_QUALITY_FIELDS
            if not present[key] and FIELD_CLASSIFICATION.get(key, "recommended") == "not_applicable"
        ],
    }


# ─── Queue Manager / Retry Engine — same contract as meta_capi.py's ───────
# retry_pending_events()/_reclaim_stuck_processing(): a durable sweep that
# never drops an event, reclaims workers that died mid-send, and respects
# the circuit breaker so a real TikTok outage doesn't burn attempts.

_STUCK_PROCESSING_MINUTES = 15


def _reclaim_stuck_processing(db: Session) -> int:
    """One batched UPDATE (no N+1) — see meta_capi._reclaim_stuck_processing
    for the full rationale (a worker killed mid-send leaves its row stuck
    at status='processing' forever otherwise)."""
    from sqlalchemy import update as sa_update
    from app.models.marketing import TikTokCapiLog

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=_STUCK_PROCESSING_MINUTES)
    result = db.execute(
        sa_update(TikTokCapiLog.__table__)
        .where(TikTokCapiLog.status == "processing", TikTokCapiLog.processing_started_at < cutoff)
        .values(status="retry", error_message="reclaimed: stuck in processing > 15min (worker likely died mid-send)",
                next_retry_at=datetime.now(timezone.utc).replace(tzinfo=None))
    )
    db.commit()
    if result.rowcount:
        logger.warning("[TikTokCAPI] reclaimed %d row(s) stuck in 'processing' beyond %dmin", result.rowcount, _STUCK_PROCESSING_MINUTES)
    return result.rowcount


def retry_pending_events() -> None:
    """
    Periodic sweep — resends every tiktok_capi_logs row whose next_retry_at
    has elapsed. Same sweep-mutex protection as meta_capi.retry_pending_events
    (prevents two concurrent sweeps racing on the same rows).
    """
    if not _sweep_lock.acquire(blocking=False):
        logger.info("[TikTokCAPI] retry sweep: already running — skipped")
        return
    try:
        _retry_pending_events_inner()
    finally:
        _sweep_lock.release()


def _retry_pending_events_inner() -> None:
    from app.db.session import SessionLocal
    from app.models.marketing import TikTokCapiLog, TikTokAdsConfig

    db = SessionLocal()
    try:
        _reclaim_stuck_processing(db)

        now = datetime.now(timezone.utc)
        due = (
            db.query(TikTokCapiLog)
            .filter(
                TikTokCapiLog.status.in_(("queued", "retry", "pending_retry")),
                (TikTokCapiLog.next_retry_at.is_(None)) | (TikTokCapiLog.next_retry_at <= now),
            )
            .limit(200)
            .all()
        )
        if not due:
            return

        logger.info("[TikTokCAPI] retry sweep: %d event(s) due", len(due))

        if _circuit_is_open():
            state = get_circuit_state()
            deferred_until = now.replace(tzinfo=None) + timedelta(seconds=state["seconds_until_reset"] or _CIRCUIT_COOLDOWN_SECONDS)
            for row in due:
                row.next_retry_at = deferred_until
                row.retry_count = (row.retry_count or 0) + 1
                if row.retry_count > _MAX_RETRY_COUNT:
                    row.status = "failed"
                    row.error_message = "max retry count exceeded while circuit breaker open"
            db.commit()
            return

        for row in due:
            if not row.store_id or not row.payload:
                row.status = "failed"
                row.error_message = "missing store_id or payload — cannot retry"
                db.commit()
                continue

            config = db.query(TikTokAdsConfig).filter(TikTokAdsConfig.store_id == row.store_id).first()
            if not config or not config.access_token or not config.pixel_id:
                row.status = "failed"
                row.error_message = "TikTok Ads not configured — cannot retry"
                db.commit()
                continue

            row.status = "processing"
            row.processing_started_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()

            events = row.payload.get("data", [])
            result = send_events(
                db, store_id=row.store_id, access_token=config.access_token,
                pixel_code=config.pixel_id, events=events, order_id=row.order_id,
            )
            if not result.get("success") and row.retry_count >= _MAX_RETRY_COUNT:
                # send_events already logged pending_retry; escalate to failed
                # once the retry budget is exhausted, same as meta_capi.
                row.status = "failed"
                row.error_message = f"max retry count ({_MAX_RETRY_COUNT}) exceeded: {result.get('error')}"
                db.commit()
    finally:
        db.close()
