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
- A custom httpcore transport (_diagnostic_transport) forces IPv4-only DNS
  resolution and clamps TCP_MAXSEG. Root cause of the observed
  "_ssl.c:999: handshake operation timed out": on container platforms
  (including HF Spaces) IPv6 egress is frequently unrouted/black-holed while
  DNS still returns AAAA records, and/or the overlay network's real path MTU
  is smaller than advertised, silently dropping the (large) TLS ClientHello
  packet with no ICMP feedback. Both failure modes present identically: TCP
  "connects" but the handshake hangs until timeout. IPv4-only + MSS clamping
  removes both dead paths without needing infrastructure access to confirm
  which one was active.
- The same transport times DNS/TCP/TLS phases individually (thread-local)
  so failures are logged with a precise failure_category (DNS Resolution
  Failed / TCP Connect Timeout / TLS Handshake Timeout / ...) instead of a
  bare exception name.
- A lightweight circuit breaker: after several consecutive connect/TLS
  failures, immediate attempts are skipped (straight to the persistent
  queue) for a cooldown window, so a real outage doesn't burn background-task
  time re-attempting a dead endpoint on every single event.
- Immediate retries use exponential backoff with jitter; if all immediate
  retries fail, the event is NEVER dropped — it's persisted in
  meta_capi_logs (status='pending_retry', full payload + next_retry_at) and
  picked up later by `retry_pending_events()`, called from the same
  background scheduler as the Noest sync (see services/noest_sync.py).
- Every attempt is called out in a structured log line: event, store, order,
  attempt/total, DNS/TCP/TLS/request/response/total latency, HTTP status,
  failure category, outcome.
- Everything here runs inside a FastAPI BackgroundTasks callback (or the
  scheduler loop) — it NEVER runs on the request/response path, so a slow
  or failing Meta call can never delay order creation or any user action.

Graph API version: v21.0.
"""

from __future__ import annotations

import hashlib
import logging
import os
import random
import re
import socket
import threading
import time
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpcore
import httpx
from httpcore._backends.sync import SyncStream as _BaseSyncStream
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
# Default lowered from 8s: a real handshake to graph.facebook.com completes
# in tens of milliseconds even from a cold connection (verified against the
# live API) — 8s per attempt means 4 immediate attempts can burn 32s of a
# background-task thread during a real outage before the circuit breaker
# even has a chance to react. Configurable via env var for ops tuning
# without a code change/redeploy if production networking genuinely needs
# more headroom than dev/staging.
_CONNECT_TIMEOUT = float(os.getenv("META_CAPI_CONNECT_TIMEOUT", "5.0"))
_READ_TIMEOUT = float(os.getenv("META_CAPI_READ_TIMEOUT", "15.0"))
_TIMEOUT = httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_READ_TIMEOUT, write=10.0, pool=5.0)
_LIMITS = httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=30.0)

# TCP segment size clamp — mitigates PMTU black-holing (see module docstring).
_TCP_MSS_CLAMP = 1400

# Per-thread connection-phase timing, populated by the custom backend/stream
# below and consumed by send_events() right after each attempt.
_timing = threading.local()


def _reset_timing() -> None:
    _timing.dns_ms = None
    _timing.tcp_ms = None
    _timing.tls_ms = None
    _timing.failure_category: Optional[str] = None


class _TimedTlsStream(httpcore.NetworkStream):
    """Wraps the TLS-upgraded stream to accumulate write/read time separately
    (approximating "request" vs "response" duration in the structured logs)."""

    def __init__(self, inner: httpcore.NetworkStream) -> None:
        self._inner = inner

    def read(self, max_bytes: int, timeout: Optional[float] = None) -> bytes:
        t0 = time.monotonic()
        data = self._inner.read(max_bytes, timeout)
        _timing.response_ms = (getattr(_timing, "response_ms", None) or 0) + int((time.monotonic() - t0) * 1000)
        return data

    def write(self, buffer: bytes, timeout: Optional[float] = None) -> None:
        t0 = time.monotonic()
        self._inner.write(buffer, timeout)
        _timing.request_ms = (getattr(_timing, "request_ms", None) or 0) + int((time.monotonic() - t0) * 1000)

    def close(self) -> None:
        self._inner.close()

    def start_tls(self, ssl_context, server_hostname=None, timeout=None):  # pragma: no cover
        return self._inner.start_tls(ssl_context, server_hostname, timeout)

    def get_extra_info(self, info: str) -> Any:
        return self._inner.get_extra_info(info)


class _TimedStream(_BaseSyncStream):
    """Plain TCP stream that times the TLS handshake and tags the precise
    failure category (vs. a bare exception class name) when it fails."""

    def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        t0 = time.monotonic()
        try:
            new_stream = super().start_tls(ssl_context, server_hostname, timeout)
        except Exception as exc:
            _timing.tls_ms = int((time.monotonic() - t0) * 1000)
            if isinstance(exc, httpcore.ConnectTimeout):
                _timing.failure_category = "TLS Handshake Timeout"
            else:
                _timing.failure_category = f"TLS Error ({type(exc).__name__})"
            raise
        _timing.tls_ms = int((time.monotonic() - t0) * 1000)
        return _TimedTlsStream(new_stream)


class _DiagnosticIPv4Backend(httpcore.SyncBackend):
    """
    Root-cause fix for repeated "_ssl.c:999: handshake operation timed out":
    resolves IPv4 (A records) only — never attempts a black-holed IPv6 route
    — and clamps TCP_MAXSEG to sidestep PMTU black-holing on container
    overlay networks. Also times DNS + TCP phases individually for logging.
    """

    def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: Optional[float] = None,
        local_address: Optional[str] = None,
        socket_options=None,
    ) -> httpcore.NetworkStream:
        socket_options = list(socket_options or [])

        t_dns = time.monotonic()
        try:
            infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
        except socket.gaierror as exc:
            _timing.dns_ms = int((time.monotonic() - t_dns) * 1000)
            _timing.failure_category = "DNS Resolution Failed"
            raise httpcore.ConnectError(f"IPv4 DNS resolution failed for {host}: {exc}") from exc
        _timing.dns_ms = int((time.monotonic() - t_dns) * 1000)

        t_tcp = time.monotonic()
        last_exc: Optional[Exception] = None
        for family, socktype, proto, _, sockaddr in infos:
            sock: Optional[socket.socket] = None
            try:
                sock = socket.socket(family, socktype, proto)
                sock.settimeout(timeout)
                sock.connect(sockaddr)
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                try:
                    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_MAXSEG, _TCP_MSS_CLAMP)
                except OSError:
                    pass  # not supported on this platform — non-fatal
                for opt in socket_options:
                    sock.setsockopt(*opt)
                _timing.tcp_ms = int((time.monotonic() - t_tcp) * 1000)
                return _TimedStream(sock)
            except OSError as exc:
                last_exc = exc
                if sock is not None:
                    try:
                        sock.close()
                    except Exception:
                        pass
                continue

        _timing.tcp_ms = int((time.monotonic() - t_tcp) * 1000)
        if isinstance(last_exc, socket.timeout):
            _timing.failure_category = "TCP Connect Timeout"
            raise httpcore.ConnectTimeout(str(last_exc)) from last_exc
        _timing.failure_category = "TCP Connect Failed"
        raise httpcore.ConnectError(f"TCP connect failed for {host}: {last_exc}") from last_exc


# ─── Circuit breaker ────────────────────────────────────────────────────────
# After several consecutive connect/TLS failures, skip immediate attempts
# entirely for a cooldown window — queue straight to the persistent retry
# table instead of burning a background-task thread on a dead endpoint.
_CIRCUIT_FAILURE_THRESHOLD = 5
_CIRCUIT_COOLDOWN_SECONDS = 60
_circuit_lock = threading.Lock()
_circuit_state = {"consecutive_failures": 0, "opened_at": 0.0}

# Prevents two concurrent sweep runs (startup recovery + background loop firing
# at the same time) from picking up the same events and racing on DB writes.
_sweep_lock = threading.Lock()


def _circuit_is_open() -> bool:
    with _circuit_lock:
        if _circuit_state["consecutive_failures"] < _CIRCUIT_FAILURE_THRESHOLD:
            return False
        if time.monotonic() - _circuit_state["opened_at"] >= _CIRCUIT_COOLDOWN_SECONDS:
            # Cooldown elapsed — allow one probe attempt through (half-open).
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
                    "[MetaCAPI] circuit breaker OPEN after %d consecutive connection failures — "
                    "immediate attempts suspended for %ds, events queued directly",
                    _CIRCUIT_FAILURE_THRESHOLD, _CIRCUIT_COOLDOWN_SECONDS,
                )
                # A run of consecutive TLS/connect failures can mean the pooled
                # keep-alive connections are stale (half-open sockets, a peer
                # that silently dropped the connection) rather than the
                # endpoint being genuinely down. Destroy the pool now so the
                # first attempt after cooldown gets a fresh TCP+TLS handshake
                # instead of reusing a socket that's part of the problem.
                _destroy_client()


# One pooled, keep-alive client reused for the lifetime of the process —
# avoids a fresh TCP+TLS handshake on every single event.
_client: Optional[httpx.Client] = None
_client_lock = threading.Lock()


def _destroy_client() -> None:
    """Force the next _get_client() call to build a brand-new pool/client.
    Called when the circuit breaker opens (5 consecutive connect/TLS
    failures) so stale keep-alive sockets can't keep poisoning attempts
    after the network recovers."""
    global _client
    with _client_lock:
        old = _client
        _client = None
    if old is not None:
        try:
            old.close()
        except Exception:
            pass
        logger.warning("[MetaCAPI] pooled HTTP client destroyed after repeated connection failures — will rebuild on next attempt")


def _get_client() -> httpx.Client:
    global _client
    with _client_lock:
        if _client is None or _client.is_closed:
            transport = httpx.HTTPTransport(retries=0)
            # Swap in the diagnostic IPv4-only, MSS-clamped, phase-timed backend.
            # httpx doesn't expose network_backend as a public constructor kwarg,
            # so the pool built by HTTPTransport.__init__ is replaced with an
            # equivalent one carrying our backend — this is the standard pattern
            # for a custom resolver/transport with httpx (its own docs point at
            # swapping httpcore.ConnectionPool this way).
            transport._pool = httpcore.ConnectionPool(
                ssl_context=transport._pool._ssl_context,
                max_connections=_LIMITS.max_connections,
                max_keepalive_connections=_LIMITS.max_keepalive_connections,
                keepalive_expiry=_LIMITS.keepalive_expiry,
                http1=True,
                http2=False,
                retries=0,
                network_backend=_DiagnosticIPv4Backend(),
            )
            _client = httpx.Client(timeout=_TIMEOUT, limits=_LIMITS, http2=False, transport=transport)
        return _client


# ─── Diagnostic helpers (used by /health endpoint) ───────────────────────────

def probe_connectivity(
    host: str = "graph.facebook.com", port: int = 443, timeout: float = 5.0
) -> Dict[str, Any]:
    """Live DNS + TCP + TLS probe — independent of the pooled client."""
    import ssl as _ssl
    result: Dict[str, Any] = {"host": host, "port": port}

    t_dns = time.monotonic()
    try:
        infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
        result["dns_ms"] = int((time.monotonic() - t_dns) * 1000)
        result["dns_status"] = "ok"
        result["resolved_ip"] = infos[0][4][0] if infos else None
    except Exception as exc:
        result["dns_ms"] = int((time.monotonic() - t_dns) * 1000)
        result["dns_status"] = f"error: {exc}"
        result["tcp_status"] = "skipped"
        result["tls_status"] = "skipped"
        return result

    t_tcp = time.monotonic()
    sock: Optional[socket.socket] = None
    try:
        family, socktype, proto, _, sockaddr = infos[0]
        sock = socket.socket(family, socktype, proto)
        sock.settimeout(timeout)
        sock.connect(sockaddr)
        result["tcp_ms"] = int((time.monotonic() - t_tcp) * 1000)
        result["tcp_status"] = "ok"
    except socket.timeout:
        result["tcp_ms"] = int((time.monotonic() - t_tcp) * 1000)
        result["tcp_status"] = "timeout"
        result["tls_status"] = "skipped"
        if sock:
            try:
                sock.close()
            except Exception:
                pass
        return result
    except Exception as exc:
        result["tcp_ms"] = int((time.monotonic() - t_tcp) * 1000)
        result["tcp_status"] = f"error: {type(exc).__name__}"
        result["tls_status"] = "skipped"
        if sock:
            try:
                sock.close()
            except Exception:
                pass
        return result

    t_tls = time.monotonic()
    try:
        ctx = _ssl.create_default_context()
        tls_sock = ctx.wrap_socket(sock, server_hostname=host)
        result["tls_ms"] = int((time.monotonic() - t_tls) * 1000)
        result["tls_status"] = "ok"
        result["tls_version"] = tls_sock.version()
        result["tls_cipher"] = tls_sock.cipher()[0] if tls_sock.cipher() else None
        tls_sock.close()
    except socket.timeout:
        result["tls_ms"] = int((time.monotonic() - t_tls) * 1000)
        result["tls_status"] = "timeout"
        result["tls_version"] = None
        result["tls_cipher"] = None
        try:
            sock.close()
        except Exception:
            pass
    except Exception as exc:
        result["tls_ms"] = int((time.monotonic() - t_tls) * 1000)
        result["tls_status"] = f"error: {type(exc).__name__}"
        result["tls_version"] = None
        result["tls_cipher"] = None
        try:
            sock.close()
        except Exception:
            pass

    return result


def get_circuit_state() -> Dict[str, Any]:
    """Return circuit breaker state for the /health endpoint."""
    with _circuit_lock:
        n = _circuit_state["consecutive_failures"]
        opened = _circuit_state["opened_at"]
    elapsed = time.monotonic() - opened
    is_open = n >= _CIRCUIT_FAILURE_THRESHOLD and elapsed < _CIRCUIT_COOLDOWN_SECONDS
    return {
        "is_open": is_open,
        "consecutive_failures": n,
        "threshold": _CIRCUIT_FAILURE_THRESHOLD,
        "cooldown_seconds": _CIRCUIT_COOLDOWN_SECONDS,
        "seconds_until_reset": max(0, int(_CIRCUIT_COOLDOWN_SECONDS - elapsed)) if is_open else 0,
    }


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
    error_category: Optional[str] = None,
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
            existing.error_category = error_category
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
                error_category=error_category,
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


def _fmt_block(**fields: Any) -> str:
    """Structured multi-line log block matching the requested diagnostic format."""
    return "\n".join(f"{k}: {v}" for k, v in fields.items() if v is not None)


def _coarse_error_category(failure_category: Optional[str]) -> str:
    """Collapse the fine-grained failure_category into the four dashboard
    buckets: network_timeout / network_error / api_4xx / api_5xx / other."""
    if not failure_category:
        return "other"
    if failure_category in ("TLS Handshake Timeout", "TCP Connect Timeout", "Connect Timeout", "Response Timeout"):
        return "network_timeout"
    if failure_category in ("DNS Resolution Failed", "TCP Connect Failed", "Connect Error", "Remote Protocol Error"):
        return "network_error"
    if failure_category == "Non-retryable client error":
        return "api_4xx"
    if failure_category == "Meta server error":
        return "api_5xx"
    if failure_category.startswith("HTTP "):
        try:
            code = int(failure_category.split(" ", 1)[1])
            return "api_4xx" if 400 <= code < 500 else "api_5xx" if code >= 500 else "other"
        except ValueError:
            return "other"
    return "other"


def send_events(
    pixel_id: str,
    access_token: str,
    events: List[Dict[str, Any]],
    *,
    test_event_code: Optional[str] = None,
    store_label: Optional[str] = None,
    order_label: Optional[str] = None,
    queue_retry_count: int = 0,
    queue_max_retries: Optional[int] = None,
) -> Dict[str, Any]:
    """
    POST events to the Graph API using the shared pooled client, with
    exponential-backoff-with-jitter immediate retries and full structured
    per-phase logging (DNS/TCP/TLS/request/response/total, failure category).

    Returns {"success": bool, "events_received": int|None, "error": str|None,
             "fbtrace_id": str|None, "retryable": bool}.
    `retryable=True` means every immediate attempt failed on a transient
    condition (timeout/connection/5xx) and the caller should queue it for
    the persistent retry sweep rather than treat it as a hard failure.
    """
    # When a relay is configured (backend host can't reach Meta directly, e.g.
    # HuggingFace's TLS block), post to the Vercel relay which forwards to Meta
    # from a network that isn't blocked. Otherwise post to Meta directly.
    from app.core.config import settings as _settings
    relay_url = (getattr(_settings, "META_CAPI_RELAY_URL", "") or "").strip()

    if relay_url:
        url = relay_url
        body: Dict[str, Any] = {
            "pixel_id": pixel_id,
            "graph_version": GRAPH_VERSION,
            "data": events,
            "access_token": access_token,
        }
        _post_headers: Optional[Dict[str, str]] = {"x-internal-key": _settings.INTERNAL_API_KEY}
    else:
        url = f"https://graph.facebook.com/{GRAPH_VERSION}/{pixel_id}/events"
        body = {"data": events, "access_token": access_token}
        _post_headers = None
    if test_event_code:
        body["test_event_code"] = test_event_code

    event_names = ",".join(e.get("event_name", "?") for e in events)
    total_attempts = queue_max_retries if queue_max_retries is not None else (1 + _IMMEDIATE_RETRIES)
    attempt_offset = queue_retry_count

    if _circuit_is_open():
        logger.warning(
            "[MetaCAPI] circuit breaker OPEN — skipping immediate attempt for event=%s, queuing directly",
            event_names,
        )
        return {
            "success": False, "events_received": None,
            "error": "circuit breaker open: too many consecutive connection failures",
            "fbtrace_id": None, "retryable": True, "error_category": "network_timeout",
        }

    last_error: Optional[str] = None
    retryable = True
    for attempt in range(1 + _IMMEDIATE_RETRIES):
        # Re-fetch on every attempt rather than once before the loop: if a
        # connection failure earlier in THIS same loop opened the circuit
        # breaker, it destroys the pooled client (see _destroy_client) so a
        # fresh one gets built on the network's recovery — but a client
        # captured once before the loop still points at that now-closed
        # object, and every remaining attempt in the loop fails immediately
        # with "Cannot send a request, as the client has been closed"
        # instead of actually retrying.
        client = _get_client()
        _reset_timing()
        started = time.monotonic()
        exc_type: Optional[str] = None
        failure_category: Optional[str] = None
        try:
            resp = client.post(url, json=body, headers=_post_headers)
            total_ms = int((time.monotonic() - started) * 1000)
            data = resp.json() if resp.content else {}

            if resp.status_code == 200:
                received = data.get("events_received")
                _circuit_record(success=True)
                _is_retry = attempt_offset > 0 or attempt > 0
                logger.info(
                    "[MetaCAPI]\n  Event    : %s\n  Store    : %s\n  Status   : ✓ Success\n  Latency  : %d ms\n  Received : %s\n  Dedup    : Yes\n  Retry    : %s\n  fbtrace  : %s",
                    event_names,
                    store_label or "—",
                    total_ms,
                    received,
                    f"Yes — attempt {attempt + attempt_offset + 1}/{total_attempts}" if _is_retry else "No",
                    data.get("fbtrace_id") or "—",
                )
                logger.debug(_fmt_block(
                    **{
                        "Meta Event": event_names, "Store": store_label, "Order": order_label,
                        "Attempt": f"{attempt + attempt_offset + 1} / {total_attempts}",
                        "DNS": f"{_timing.dns_ms} ms" if _timing.dns_ms is not None else None,
                        "TCP": f"{_timing.tcp_ms} ms" if _timing.tcp_ms is not None else None,
                        "TLS": f"{_timing.tls_ms} ms" if _timing.tls_ms is not None else None,
                        "Request": f"{getattr(_timing, 'request_ms', None)} ms" if getattr(_timing, "request_ms", None) is not None else None,
                        "Response": f"{getattr(_timing, 'response_ms', None)} ms" if getattr(_timing, "response_ms", None) is not None else None,
                        "Total": f"{total_ms} ms",
                        "Result": "Success",
                        "Received": received,
                        "Fbtrace": data.get("fbtrace_id"),
                    }
                ))
                if received is not None and received < len(events):
                    logger.warning(
                        "[MetaCAPI] partial delivery: %s/%s events received (fbtrace=%s)",
                        received, len(events), data.get("fbtrace_id"),
                    )
                return {
                    "success": True, "events_received": received, "error": None,
                    "fbtrace_id": data.get("fbtrace_id"), "retryable": False,
                    "latency_ms": total_ms,
                }

            err = (data.get("error") or {})
            last_error = f"HTTP {resp.status_code}: {err.get('message') or resp.text[:200]}"
            failure_category = f"HTTP {resp.status_code}"
            # 4xx (bad token, malformed payload) will never improve on retry —
            # a network blip won't fix a bad access token.
            timing_fields = {
                "DNS": f"{_timing.dns_ms} ms" if _timing.dns_ms is not None else None,
                "TCP": f"{_timing.tcp_ms} ms" if _timing.tcp_ms is not None else None,
                "TLS": f"{_timing.tls_ms} ms" if _timing.tls_ms is not None else None,
                "Request": f"{getattr(_timing, 'request_ms', None)} ms" if getattr(_timing, "request_ms", None) is not None else None,
                "Response": f"{getattr(_timing, 'response_ms', None)} ms" if getattr(_timing, "response_ms", None) is not None else None,
            }
            if 400 <= resp.status_code < 500:
                retryable = False
                _circuit_record(success=True)  # not a connectivity failure
                logger.warning(_fmt_block(**{
                    "Meta Event": event_names, "Store": store_label, "Order": order_label,
                    "Attempt": f"{attempt + attempt_offset + 1} / {total_attempts}",
                    **timing_fields,
                    "Total": f"{total_ms} ms", "HTTP Status": resp.status_code,
                    "Meta Response": (resp.text or "")[:500],
                    "Failure Category": "Non-retryable client error",
                    "Result": "Failed",
                }))
                break
            _circuit_record(success=True)  # server responded — connectivity is fine
            logger.warning(_fmt_block(**{
                "Meta Event": event_names, "Store": store_label, "Order": order_label,
                "Attempt": f"{attempt + attempt_offset + 1} / {total_attempts}",
                **timing_fields,
                "Total": f"{total_ms} ms", "HTTP Status": resp.status_code,
                "Meta Response": (resp.text or "")[:500],
                "Failure Category": "Meta server error",
                "Result": "Failed (will retry)",
            }))

        except httpx.ConnectTimeout as exc:
            exc_type = "ConnectTimeout"
            failure_category = getattr(_timing, "failure_category", None) or "Connect Timeout"
            last_error = f"{failure_category}: {exc}"
        except httpx.ReadTimeout as exc:
            exc_type = "ReadTimeout"
            failure_category = "Response Timeout"
            last_error = f"{failure_category}: Meta did not respond in time ({exc})"
        except httpx.ConnectError as exc:
            exc_type = "ConnectError"
            failure_category = getattr(_timing, "failure_category", None) or "Connect Error"
            last_error = f"{failure_category}: {exc}"
        except httpx.RemoteProtocolError as exc:
            exc_type = "RemoteProtocolError"
            failure_category = "Remote Protocol Error"
            last_error = f"{failure_category}: {exc}"
        except httpx.HTTPError as exc:
            exc_type = type(exc).__name__
            failure_category = exc_type
            last_error = f"{exc_type}: {exc}"
        except Exception as exc:  # pragma: no cover — defensive catch-all
            exc_type = type(exc).__name__
            failure_category = exc_type
            last_error = f"{exc_type}: {exc}"

        if exc_type:
            total_ms = int((time.monotonic() - started) * 1000)
            is_connectivity_failure = failure_category in (
                "DNS Resolution Failed", "TCP Connect Timeout", "TCP Connect Failed",
                "TLS Handshake Timeout", "Connect Timeout", "Connect Error",
            )
            _circuit_record(success=not is_connectivity_failure)
            logger.warning(_fmt_block(**{
                "Meta Event": event_names, "Store": store_label, "Order": order_label,
                "Attempt": f"{attempt + attempt_offset + 1} / {total_attempts}",
                "DNS": f"{_timing.dns_ms} ms" if _timing.dns_ms is not None else None,
                "TCP": f"{_timing.tcp_ms} ms" if _timing.tcp_ms is not None else None,
                "TLS": f"{_timing.tls_ms} ms" if _timing.tls_ms is not None else None,
                "Total": f"{total_ms} ms",
                "Exception": exc_type,
                "Failure Category": failure_category,
                "Result": "Failed (will retry)" if attempt < _IMMEDIATE_RETRIES else "Failed",
            }))

        if attempt < _IMMEDIATE_RETRIES:
            time.sleep(_backoff_with_jitter(attempt))

    logger.error(
        "[MetaCAPI] send failed after %d immediate attempt(s): event=%s store=%s order=%s "
        "retryable=%s failure_category=%s error=%s",
        1 + _IMMEDIATE_RETRIES, event_names, store_label, order_label, retryable, failure_category, last_error,
    )
    return {
        "success": False, "events_received": None, "error": last_error,
        "fbtrace_id": None, "retryable": retryable,
        "error_category": _coarse_error_category(failure_category),
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
        result = send_events(
            config.pixel_id, config.access_token, [event],
            store_label=order.store.name if order.store else str(order.store_id),
            order_label=f"#{order.order_number}",
        )

        if result["success"]:
            _log_send(
                db,
                store_id=str(order.store_id),
                order_id=str(order.id),
                event_name="Purchase",
                event_id=event["event_id"],
                status="success",
                events_received=result["events_received"],
                latency_ms=result.get("latency_ms"),
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
                error_category=result.get("error_category"),
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
                error_category=result.get("error_category"),
            )
    finally:
        db.close()


_QUEUE_ALERT_THRESHOLD = int(os.getenv("META_CAPI_QUEUE_ALERT_THRESHOLD", "100"))
_QUEUE_ALERT_COOLDOWN_MINUTES = 60


def _check_queue_backlog(db) -> None:
    """
    Fires an in-app notification (admin broadcast) when a store's pending
    retry queue crosses _QUEUE_ALERT_THRESHOLD — a growing backlog usually
    means the immediate-retry path is failing consistently (real outage) and
    someone should look, rather than silently waiting for the next sweep.
    Throttled to one notification per store per cooldown window so a
    sustained outage doesn't spam admins every sweep.
    """
    from sqlalchemy import func
    from app.models.marketing import MetaCapiLog
    from app.models.notification import Notification
    from app.services.notification_service import notify

    counts = (
        db.query(MetaCapiLog.store_id, func.count(MetaCapiLog.id))
        .filter(MetaCapiLog.status == "pending_retry")
        .group_by(MetaCapiLog.store_id)
        .all()
    )
    for store_id, count in counts:
        if count < _QUEUE_ALERT_THRESHOLD:
            continue
        cooldown_start = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=_QUEUE_ALERT_COOLDOWN_MINUTES)
        recent = (
            db.query(Notification)
            .filter(
                Notification.type == "META_CAPI_QUEUE_BACKLOG",
                Notification.store_id == store_id,
                Notification.created_at >= cooldown_start,
            )
            .first()
        )
        if recent:
            continue
        notify(
            db, type="META_CAPI_QUEUE_BACKLOG",
            title="File d'attente Meta CAPI saturée",
            message=(
                f"{count} événement(s) Meta en attente de reprise pour cette boutique "
                f"(seuil: {_QUEUE_ALERT_THRESHOLD}). Vérifiez la connectivité réseau ou "
                "la configuration Meta Ads (jeton d'accès, pixel)."
            ),
            user_id=None, store_id=store_id,
        )
        logger.error(
            "[MetaCAPI] queue backlog alert: store=%s pending=%d (threshold=%d)",
            store_id, count, _QUEUE_ALERT_THRESHOLD,
        )
        db.commit()


def retry_pending_events() -> None:
    """
    Periodic sweep (called from the background scheduler alongside the Noest
    sync loop) — resends every queued meta_capi_logs row whose next_retry_at
    has elapsed. The access token is always looked up fresh from
    MetaAdsConfig by store_id; it is never persisted in the log row.

    The sweep mutex (_sweep_lock) prevents the startup recovery handler and
    the background loop from running two concurrent sweeps that would race on
    the same DB rows and produce duplicate log spam.
    """
    if not _sweep_lock.acquire(blocking=False):
        logger.info("[MetaCAPI] retry sweep: already running — skipped")
        return
    try:
        _retry_pending_events_inner()
    finally:
        _sweep_lock.release()


def _retry_pending_events_inner() -> None:
    from app.db.session import SessionLocal
    from app.models.marketing import MetaAdsConfig, MetaCapiLog

    db = SessionLocal()
    try:
        _check_queue_backlog(db)

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

        # Pre-flight probe: if the circuit isn't open yet (fewer than
        # _CIRCUIT_FAILURE_THRESHOLD consecutive failures recorded so far)
        # but the network is currently down, don't burn a real send attempt
        # (up to _CONNECT_TIMEOUT seconds each) per queued event just to
        # discover that — one cheap DNS+TCP+TLS probe tells us the same thing
        # in a fraction of the time and lets the whole batch defer together.
        if not _circuit_is_open():
            preflight = probe_connectivity()
            if preflight.get("tls_status") not in ("ok",):
                deferred_until = now + timedelta(seconds=_CIRCUIT_COOLDOWN_SECONDS)
                for row in due:
                    row.next_retry_at = deferred_until
                    row.error_message = (
                        f"pre-flight probe failed (dns={preflight.get('dns_status')}, "
                        f"tcp={preflight.get('tcp_status')}, tls={preflight.get('tls_status')}) "
                        "— bulk deferred without burning retry attempts"
                    )
                db.commit()
                logger.warning(
                    "[MetaCAPI] retry sweep: pre-flight connectivity probe failed "
                    "(dns=%s tcp=%s tls=%s) — %d event(s) bulk deferred to %s UTC without "
                    "consuming a retry attempt",
                    preflight.get("dns_status"), preflight.get("tcp_status"),
                    preflight.get("tls_status"), len(due), deferred_until.strftime("%H:%M:%S"),
                )
                return

        # If the circuit is already open before we begin, bulk-defer the entire
        # batch with a single log line instead of emitting one warning per event.
        if _circuit_is_open():
            deferred_until = now + timedelta(seconds=_CIRCUIT_COOLDOWN_SECONDS + 10)
            for row in due:
                row.next_retry_at = deferred_until
                row.error_message = "circuit breaker open: bulk deferred"
            db.commit()
            logger.warning(
                "[MetaCAPI] retry sweep: circuit OPEN — %d event(s) bulk deferred to %s UTC",
                len(due), deferred_until.strftime("%H:%M:%S"),
            )
            return

        deferred_bulk = 0
        for i, row in enumerate(due):
            # If the circuit opened mid-sweep (after the first few TLS failures),
            # bulk-defer all remaining events instead of logging one line each.
            if _circuit_is_open():
                deferred_until = now + timedelta(seconds=_CIRCUIT_COOLDOWN_SECONDS + 10)
                for remaining in due[i:]:
                    remaining.next_retry_at = deferred_until
                    remaining.error_message = "circuit breaker open: bulk deferred"
                deferred_bulk = len(due) - i
                db.commit()
                logger.warning(
                    "[MetaCAPI] circuit opened mid-sweep — %d remaining event(s) bulk deferred to %s UTC",
                    deferred_bulk, deferred_until.strftime("%H:%M:%S"),
                )
                return

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

            result = send_events(
                config.pixel_id, config.access_token, [row.payload],
                store_label=str(row.store_id), order_label=row.order_id,
                queue_retry_count=row.retry_count, queue_max_retries=_MAX_QUEUE_RETRIES,
            )
            if result["success"]:
                row.status = "success"
                row.error_message = None
                row.events_received = result["events_received"]
                row.latency_ms = result.get("latency_ms")
                row.next_retry_at = None
                logger.info(
                    "[MetaCAPI] retry succeeded event=%s order=%s retry_count=%d",
                    row.event_name, row.order_id, row.retry_count,
                )
            else:
                circuit_blocked = "circuit breaker open" in (result.get("error") or "")
                row.error_message = result["error"]
                row.error_category = result.get("error_category")
                if circuit_blocked:
                    # Circuit was detected open inside send_events — no real attempt.
                    # Do NOT burn a retry slot.
                    row.next_retry_at = now + timedelta(seconds=_CIRCUIT_COOLDOWN_SECONDS + 10)
                    logger.warning(
                        "[MetaCAPI] circuit OPEN — retry deferred (no count burn) event=%s order=%s retry_count=%d",
                        row.event_name, row.order_id, row.retry_count,
                    )
                else:
                    row.retry_count += 1
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
