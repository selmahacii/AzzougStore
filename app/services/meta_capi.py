"""
Meta Conversions API (CAPI) — central service.

Everything Meta-related on the server goes through here so that:
- user_data normalization follows Meta's documentation exactly
  (https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters)
- Pixel and CAPI always share the same event_id (deduplication)
- every send is retried, validated and persisted in `meta_capi_logs`
  for the diagnostics dashboard.

Reliability design (hardened against SSL handshake timeouts / transient
network failures to graph.facebook.com):
- A single module-level httpx.Client is reused across every call, with
  connection pooling and keep-alive — no per-call TCP+TLS handshake.
- Separate connect/read/write/pool timeouts (a slow DNS+TLS handshake and a
  slow Graph API response are different failure modes and are logged as such).
- Immediate retries use exponential backoff with jitter; if all immediate
  retries fail, the event is NEVER dropped — it's persisted in
  meta_capi_logs (status='pending_retry', full payload + next_retry_at) and
  picked up later by `retry_pending_events()`, called from the same
  background scheduler as the Noest sync (see services/noest_sync.py).
- Every attempt is called out in a structured log line: event, attempt,
  latency, http status, exception type, outcome.
- Everything here runs inside a FastAPI BackgroundTasks callback (or the
  scheduler loop) — it NEVER runs on the request/response path, so a slow
  or failing Meta call can never delay order creation or any user action.

Graph API version: v21.0.
"""

from __future__ import annotations

import hashlib
import logging
import random
import re
import time
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

logger = logging.getLogger("app.meta_capi")

GRAPH_VERSION = "v21.0"

# Immediate retries (within the same request, e.g. during order creation's
# background task) — short-lived, for blips that resolve in seconds.
_IMMEDIATE_RETRIES = 3        # total immediate attempts = 1 + this
_BACKOFF_BASE = 1.5           # seconds
_BACKOFF_CAP = 20.0           # seconds
_BACKOFF_JITTER = 0.5         # +/- seconds of random jitter

# Persistent retry queue (survives process restarts) — for failures that
# outlast the immediate-retry window (extended network outage, Meta 5xx).
_MAX_QUEUE_RETRIES = 6
# Backoff schedule by retry_count: 1min, 5min, 20min, 1h, 3h, 8h
_QUEUE_BACKOFF_MINUTES = [1, 5, 20, 60, 180, 480]

_HEX64 = re.compile(r"^[0-9a-f]{64}$")

# Split connect (DNS + TCP + TLS handshake) from read (waiting on Meta's
# response) so a handshake timeout and a slow-response timeout are
# distinguishable in logs instead of both surfacing as a generic timeout.
_TIMEOUT = httpx.Timeout(connect=8.0, read=15.0, write=10.0, pool=5.0)
_LIMITS = httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=30.0)

# One pooled, keep-alive client reused for the lifetime of the process —
# avoids a fresh TCP+TLS handshake (the actual cause of the reported
# "_ssl.c:999: handshake operation timed out") on every single event.
_client: Optional[httpx.Client] = None


def _get_client() -> httpx.Client:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.Client(
            timeout=_TIMEOUT,
            limits=_LIMITS,
            http2=False,  # Graph API needs nothing beyond HTTP/1.1; avoids h2 negotiation overhead
            transport=httpx.HTTPTransport(retries=0),  # we own retry/backoff logic below
        )
    return _client


# ─── Normalization (Meta spec) ────────────────────────────────────────────────

def _strip_accents(value: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", value) if unicodedata.category(c) != "Mn"
    )


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _hash_if_needed(value: str) -> str:
    """Accept pre-hashed values (64 hex chars) as-is, hash otherwise."""
    v = value.strip().lower()
    return v if _HEX64.match(v) else _sha256(v)


def normalize_email(email: Optional[str]) -> Optional[str]:
    if not email or "@" not in email:
        return None
    return _sha256(email.strip().lower())


def normalize_phone(phone: Optional[str]) -> Optional[str]:
    """E.164 without '+' — Algerian numbers get the 213 country code."""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if not digits:
        return None
    if digits.startswith("00213"):
        digits = digits[2:]
    if digits.startswith("213") and len(digits) >= 11:
        pass
    elif digits.startswith("0") and len(digits) == 10:
        digits = "213" + digits[1:]
    elif len(digits) == 9 and digits[0] in ("5", "6", "7"):
        digits = "213" + digits
    return _sha256(digits)


def normalize_name(name: Optional[str]) -> Optional[str]:
    """Lowercase, no accents, letters only (Meta: a-z only, no punctuation)."""
    if not name:
        return None
    cleaned = re.sub(r"[^a-z]", "", _strip_accents(name.strip().lower()))
    return _sha256(cleaned) if cleaned else None


def normalize_city(city: Optional[str]) -> Optional[str]:
    """Lowercase, no accents, no spaces/punctuation."""
    if not city:
        return None
    # Drop arabic/annotated prefixes like "القبة · Kouba"
    if "·" in city:
        city = city.split("·")[-1]
    cleaned = re.sub(r"[^a-z]", "", _strip_accents(city.strip().lower()))
    return _sha256(cleaned) if cleaned else None


def normalize_state(state: Optional[str]) -> Optional[str]:
    """Wilaya → Meta 'st' (lowercase, no accents, no punctuation)."""
    return normalize_city(state)


def normalize_zip(zip_code: Optional[str]) -> Optional[str]:
    if not zip_code:
        return None
    cleaned = re.sub(r"\s", "", str(zip_code).lower())[:5]
    return _sha256(cleaned) if cleaned else None


def normalize_country_dz() -> str:
    """2-letter ISO, lowercase, hashed."""
    return _sha256("dz")


def normalize_external_id(external_id: Optional[str]) -> Optional[str]:
    if not external_id:
        return None
    return _hash_if_needed(str(external_id))


def build_user_data(
    *,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    full_name: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    zip_code: Optional[str] = None,
    external_id: Optional[str] = None,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    fbp: Optional[str] = None,
    fbc: Optional[str] = None,
    fbclid: Optional[str] = None,
) -> Dict[str, Any]:
    """Assemble a fully-normalized Meta user_data dict (max Event Match Quality)."""
    if full_name and not (first_name or last_name):
        parts = full_name.strip().split()
        if parts:
            first_name = parts[0]
            last_name = parts[-1] if len(parts) > 1 else None

    ud: Dict[str, Any] = {}
    if (v := normalize_email(email)):
        ud["em"] = [v]
    if (v := normalize_phone(phone)):
        ud["ph"] = [v]
    if (v := normalize_name(first_name)):
        ud["fn"] = [v]
    if (v := normalize_name(last_name)):
        ud["ln"] = [v]
    if (v := normalize_city(city)):
        ud["ct"] = [v]
    if (v := normalize_state(state)):
        ud["st"] = [v]
    if (v := normalize_zip(zip_code)):
        ud["zp"] = [v]
    ud["country"] = [normalize_country_dz()]
    if (v := normalize_external_id(external_id)):
        ud["external_id"] = [v]
    if client_ip:
        ud["client_ip_address"] = client_ip.split(",")[0].strip()
    if user_agent:
        ud["client_user_agent"] = user_agent
    if fbp:
        ud["fbp"] = fbp
    if fbc:
        ud["fbc"] = fbc
    elif fbclid:
        # Rebuild fbc from a raw fbclid per Meta spec: fb.1.<ms>.<fbclid>
        ud["fbc"] = f"fb.1.{int(time.time() * 1000)}.{fbclid}"
    return ud


# ─── Event helpers ────────────────────────────────────────────────────────────

def purchase_event_id(order_id: str) -> str:
    """Deterministic, shared by the browser Pixel — dedup key at Meta."""
    return f"purchase-{order_id}"


def build_purchase_event(order, *, client_ip: Optional[str], user_agent: Optional[str]) -> Dict[str, Any]:
    """Full Graph-compliant Purchase event from an Order ORM object."""
    items = list(order.items or [])
    contents = [
        {"id": str(i.product_id), "quantity": int(i.quantity or 1),
         "item_price": float(i.unit_price or 0)}
        for i in items
    ]
    event: Dict[str, Any] = {
        "event_name": "Purchase",
        "event_time": int(time.time()),
        "event_id": purchase_event_id(str(order.id)),
        "action_source": "website",
        "user_data": build_user_data(
            phone=order.customer_phone,
            full_name=order.customer_name,
            city=order.customer_commune,
            state=order.customer_wilaya,
            external_id=order.customer_phone or str(order.id),
            client_ip=client_ip,
            user_agent=user_agent,
            fbp=getattr(order, "fbp", None),
            fbc=getattr(order, "fbc", None),
            fbclid=getattr(order, "fbclid", None),
        ),
        "custom_data": {
            "value": float(order.total or 0),
            "currency": "DZD",
            "content_type": "product",
            "content_ids": [str(i.product_id) for i in items],
            "contents": contents,
            "num_items": sum(int(i.quantity or 1) for i in items),
            "order_id": str(order.order_number),
        },
    }
    source_url = getattr(order, "event_source_url", None)
    if source_url:
        event["event_source_url"] = source_url
    return event


# ─── Sending + logging ────────────────────────────────────────────────────────

def _backoff_with_jitter(attempt: int) -> float:
    """Exponential backoff capped at _BACKOFF_CAP, plus symmetric jitter."""
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
    events_received: Optional[int] = None,
    payload: Optional[Dict[str, Any]] = None,
    retry_count: int = 0,
    next_retry_at: Optional[datetime] = None,
    latency_ms: Optional[int] = None,
) -> None:
    """
    Upsert-by-(order_id, event_id) so a retry updates the same row instead of
    spawning a duplicate log line per attempt.
    """
    try:
        from app.models.marketing import MetaCapiLog
        existing = None
        if order_id:
            existing = (
                db.query(MetaCapiLog)
                .filter(MetaCapiLog.order_id == order_id, MetaCapiLog.event_id == event_id)
                .order_by(MetaCapiLog.id.desc())
                .first()
            )
        if existing:
            existing.status = status
            existing.error_message = (error_message or "")[:1000] or None
            existing.events_received = events_received
            existing.retry_count = retry_count
            existing.next_retry_at = next_retry_at
            existing.latency_ms = latency_ms
            if payload is not None:
                existing.payload = payload
        else:
            db.add(MetaCapiLog(
                id=str(uuid.uuid4()),
                store_id=store_id,
                order_id=order_id,
                event_name=event_name,
                event_id=event_id,
                status=status,
                error_message=(error_message or "")[:1000] or None,
                events_received=events_received,
                payload=payload,
                retry_count=retry_count,
                next_retry_at=next_retry_at,
                latency_ms=latency_ms,
            ))
        db.commit()
    except Exception as exc:  # never break business flow for a log line
        db.rollback()
        logger.warning("meta_capi log write failed: %s", exc)


def send_events(
    pixel_id: str,
    access_token: str,
    events: List[Dict[str, Any]],
    *,
    test_event_code: Optional[str] = None,
) -> Dict[str, Any]:
    """
    POST events to the Graph API using the shared pooled client, with
    exponential-backoff-with-jitter immediate retries and full structured
    logging per attempt (status/exception/latency/retry count).

    Returns {"success": bool, "events_received": int|None, "error": str|None,
             "fbtrace_id": str|None, "retryable": bool}.
    `retryable=True` means every immediate attempt failed on a transient
    condition (timeout/connection/5xx) and the caller should queue it for
    the persistent retry sweep rather than treat it as a hard failure.
    """
    url = f"https://graph.facebook.com/{GRAPH_VERSION}/{pixel_id}/events"
    body: Dict[str, Any] = {"data": events, "access_token": access_token}
    if test_event_code:
        body["test_event_code"] = test_event_code

    event_names = ",".join(e.get("event_name", "?") for e in events)
    client = _get_client()

    last_error: Optional[str] = None
    retryable = True
    for attempt in range(1 + _IMMEDIATE_RETRIES):
        started = time.monotonic()
        exc_type: Optional[str] = None
        http_status: Optional[int] = None
        try:
            resp = client.post(url, json=body)
            latency_ms = int((time.monotonic() - started) * 1000)
            http_status = resp.status_code
            data = resp.json() if resp.content else {}

            if resp.status_code == 200:
                received = data.get("events_received")
                logger.info(
                    "[MetaCAPI] sent event=%s attempt=%d/%d status=200 latency_ms=%d "
                    "received=%s fbtrace=%s",
                    event_names, attempt + 1, 1 + _IMMEDIATE_RETRIES, latency_ms,
                    received, data.get("fbtrace_id"),
                )
                if received is not None and received < len(events):
                    logger.warning(
                        "[MetaCAPI] partial delivery: %s/%s events received (fbtrace=%s)",
                        received, len(events), data.get("fbtrace_id"),
                    )
                return {
                    "success": True, "events_received": received, "error": None,
                    "fbtrace_id": data.get("fbtrace_id"), "retryable": False,
                }

            err = (data.get("error") or {})
            last_error = f"HTTP {resp.status_code}: {err.get('message') or resp.text[:200]}"
            # 4xx (bad token, malformed payload) will never improve on retry —
            # a network blip won't fix a bad access token.
            if 400 <= resp.status_code < 500:
                retryable = False
                logger.warning(
                    "[MetaCAPI] non-retryable client error event=%s attempt=%d status=%d "
                    "latency_ms=%d error=%s",
                    event_names, attempt + 1, resp.status_code, latency_ms, last_error,
                )
                break
            logger.warning(
                "[MetaCAPI] server error event=%s attempt=%d/%d status=%d latency_ms=%d error=%s",
                event_names, attempt + 1, 1 + _IMMEDIATE_RETRIES, resp.status_code, latency_ms, last_error,
            )

        except httpx.ConnectTimeout as exc:
            exc_type = "ConnectTimeout"
            last_error = f"{exc_type}: TCP/TLS handshake did not complete in time ({exc})"
        except httpx.ReadTimeout as exc:
            exc_type = "ReadTimeout"
            last_error = f"{exc_type}: Meta did not respond in time ({exc})"
        except httpx.ConnectError as exc:
            exc_type = "ConnectError"
            last_error = f"{exc_type}: DNS resolution or TCP connect failed ({exc})"
        except httpx.RemoteProtocolError as exc:
            exc_type = "RemoteProtocolError"
            last_error = f"{exc_type}: {exc}"
        except httpx.HTTPError as exc:
            exc_type = type(exc).__name__
            last_error = f"{exc_type}: {exc}"
        except Exception as exc:  # pragma: no cover — defensive catch-all
            exc_type = type(exc).__name__
            last_error = f"{exc_type}: {exc}"

        if exc_type:
            latency_ms = int((time.monotonic() - started) * 1000)
            logger.warning(
                "[MetaCAPI] network failure event=%s attempt=%d/%d exception=%s "
                "latency_ms=%d error=%s",
                event_names, attempt + 1, 1 + _IMMEDIATE_RETRIES, exc_type, latency_ms, last_error,
            )

        if attempt < _IMMEDIATE_RETRIES:
            time.sleep(_backoff_with_jitter(attempt))

    logger.error(
        "[MetaCAPI] send failed after %d immediate attempt(s): event=%s retryable=%s error=%s",
        1 + _IMMEDIATE_RETRIES, event_names, retryable, last_error,
    )
    return {
        "success": False, "events_received": None, "error": last_error,
        "fbtrace_id": None, "retryable": retryable,
    }


def send_purchase_for_order(
    order_id: str,
    *,
    client_ip: Optional[str],
    user_agent: Optional[str],
) -> None:
    """
    Background task entry point: loads the order in a fresh session,
    builds a fully-normalized Purchase event and ships it, logging the result.
    """
    from app.db.session import SessionLocal
    from app.models.marketing import MetaAdsConfig
    from app.models.order import Order

    db = SessionLocal()
    try:
        order = db.query(Order).filter(Order.id == order_id).first()
        if not order:
            return
        config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == order.store_id).first()
        if not config or not config.pixel_id or not config.access_token or len(config.access_token) < 15:
            return

        event = build_purchase_event(order, client_ip=client_ip, user_agent=user_agent)
        result = send_events(config.pixel_id, config.access_token, [event])

        if result["success"]:
            _log_send(
                db,
                store_id=str(order.store_id),
                order_id=str(order.id),
                event_name="Purchase",
                event_id=event["event_id"],
                status="success",
                events_received=result["events_received"],
            )
            logger.info(
                "Meta CAPI Purchase sent for %s (event_id=%s, received=%s)",
                order.order_number, event["event_id"], result["events_received"],
            )
        elif result.get("retryable"):
            _log_send(
                db,
                store_id=str(order.store_id),
                order_id=str(order.id),
                event_name="Purchase",
                event_id=event["event_id"],
                status="pending_retry",
                error_message=result["error"],
                payload=event,
                retry_count=0,
                next_retry_at=datetime.now(timezone.utc) + timedelta(minutes=_QUEUE_BACKOFF_MINUTES[0]),
            )
            logger.warning(
                "Meta CAPI Purchase queued for retry for %s (event_id=%s): %s",
                order.order_number, event["event_id"], result["error"],
            )
        else:
            _log_send(
                db,
                store_id=str(order.store_id),
                order_id=str(order.id),
                event_name="Purchase",
                event_id=event["event_id"],
                status="error",
                error_message=result["error"],
            )
    finally:
        db.close()


def retry_pending_events() -> None:
    """
    Periodic sweep (called from the background scheduler alongside the Noest
    sync loop) — resends every queued meta_capi_logs row whose next_retry_at
    has elapsed. The access token is always looked up fresh from
    MetaAdsConfig by store_id; it is never persisted in the log row.
    """
    from app.db.session import SessionLocal
    from app.models.marketing import MetaAdsConfig, MetaCapiLog

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        due = (
            db.query(MetaCapiLog)
            .filter(MetaCapiLog.status == "pending_retry", MetaCapiLog.next_retry_at <= now)
            .limit(200)
            .all()
        )
        if not due:
            return

        logger.info("[MetaCAPI] retry sweep: %d event(s) due", len(due))
        for row in due:
            if not row.payload:
                row.status = "failed"
                row.error_message = "no payload persisted, cannot retry"
                db.commit()
                continue

            config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == row.store_id).first()
            if not config or not config.pixel_id or not config.access_token or len(config.access_token) < 15:
                row.status = "failed"
                row.error_message = "meta ads config no longer available"
                db.commit()
                continue

            result = send_events(config.pixel_id, config.access_token, [row.payload])
            if result["success"]:
                row.status = "success"
                row.error_message = None
                row.events_received = result["events_received"]
                row.next_retry_at = None
                logger.info(
                    "[MetaCAPI] retry succeeded event=%s order=%s retry_count=%d",
                    row.event_name, row.order_id, row.retry_count,
                )
            else:
                row.retry_count += 1
                row.error_message = result["error"]
                if not result.get("retryable") or row.retry_count >= _MAX_QUEUE_RETRIES:
                    row.status = "failed"
                    row.next_retry_at = None
                    logger.error(
                        "[MetaCAPI] retry exhausted event=%s order=%s retry_count=%d error=%s",
                        row.event_name, row.order_id, row.retry_count, result["error"],
                    )
                else:
                    idx = min(row.retry_count, len(_QUEUE_BACKOFF_MINUTES) - 1)
                    row.next_retry_at = now + timedelta(minutes=_QUEUE_BACKOFF_MINUTES[idx])
                    logger.warning(
                        "[MetaCAPI] retry failed again event=%s order=%s retry_count=%d next_retry_at=%s error=%s",
                        row.event_name, row.order_id, row.retry_count, row.next_retry_at, result["error"],
                    )
            db.commit()
    except Exception:
        db.rollback()
        logger.exception("[MetaCAPI] retry sweep crashed")
    finally:
        db.close()
