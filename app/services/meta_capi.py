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
import ipaddress
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
from app.core.config import settings as _settings

logger = logging.getLogger("app.meta_capi")

GRAPH_VERSION = "v21.0"

# The durable-queue rework (BackgroundTasks -> queued/processing/retry rows
# written BEFORE the network call, dedup constraint, EMQ fixes) went live
# 2026-07-16. Every Purchase sent before this date can carry defects the
# rework fixed (missing IP/UA on retries, double-sends, no currency on
# relay-authored payloads, event_time bugs) — none of that reflects the
# CURRENT engine's quality. Diagnostics/scores computed over a window that
# silently includes pre-cutover rows understate today's real numbers and
# raise false positives (e.g. "Purchase sans devise" from a legacy relay
# payload the current code path can no longer produce).
# compute_meta_metrics() floors `since` to this date by default (see its
# own docstring) so every metric that goes through it treats 2026-07-16 as
# day one, without needing per-endpoint changes. Never used to hide or
# discard historical data — the raw MetaCapiLog rows are untouched; this
# only changes what the LIVE diagnostics choose to measure by default.
NEW_ENGINE_CUTOVER_DATE = datetime(2026, 7, 16)

# ─── In-process, per-worker MetaAdsConfig cache ───────────────────────────
# Purpose: avoid a DB round-trip (measured ~100ms, network/pooler latency —
# decryption of the encrypted access_token itself is negligible, <0.001ms)
# on every Purchase CAPI send. Deliberately NOT Redis: access_token is
# encrypted at rest (EncryptedString) and must never exist decrypted in a
# shared cache — this keeps the plaintext confined to this process's memory,
# same trust boundary as holding it in a local variable. Short TTL (60s)
# bounds staleness after a config update; no cross-process invalidation
# needed since a 60s-stale token/pixel is an acceptable, self-healing delay
# for this send path (it just retries on the next queue pass).
_META_CONFIG_CACHE: Dict[str, tuple] = {}
_META_CONFIG_CACHE_TTL = 60


def _get_meta_config_cached(db: Session, store_id: str) -> Optional[Dict[str, Any]]:
    from app.models.marketing import MetaAdsConfig

    cached = _META_CONFIG_CACHE.get(store_id)
    if cached and cached[1] > time.monotonic():
        return cached[0]

    config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == store_id).first()
    if not config or not config.pixel_id or not config.access_token:
        from app.models.store import Store
        store = db.query(Store).filter(Store.id == store_id).first()
        m_cfg = (store.marketing_config or {}) if store else {}
        pix = m_cfg.get("meta_pixel_id") or m_cfg.get("pixel_id")
        tok = m_cfg.get("meta_access_token") or m_cfg.get("access_token") or m_cfg.get("fb_access_token")
        if pix and tok:
            snapshot = {
                "pixel_id": str(pix),
                "access_token": str(tok),
                "currency": m_cfg.get("account_currency") or m_cfg.get("currency") or "DZD",
                "exchange_rate": float(m_cfg.get("exchange_rate") or 1.0),
            }
            _META_CONFIG_CACHE[store_id] = (snapshot, time.monotonic() + _META_CONFIG_CACHE_TTL)
            return snapshot
        if not config:
            _META_CONFIG_CACHE[store_id] = (None, time.monotonic() + _META_CONFIG_CACHE_TTL)
            return None

    snapshot = {
        "pixel_id": config.pixel_id,
        "access_token": config.access_token,
        "currency": config.currency,
        "exchange_rate": config.exchange_rate,
    }
    _META_CONFIG_CACHE[store_id] = (snapshot, time.monotonic() + _META_CONFIG_CACHE_TTL)
    return snapshot

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
            # follow_redirects=True: the Vercel relay's apex domain can 308
            # to its www/canonical host at the platform/DNS level (outside
            # this codebase entirely — confirmed live: POSTing the apex
            # always 308s regardless of path). httpx does NOT follow
            # redirects by default, so every relay call silently got back a
            # redirect's HTML body instead of Meta's JSON response —
            # every single event failed with JSONDecodeError and endless
            # retries, never actually reaching Meta. Following it here
            # means a domain redirect degrades to one extra hop instead of
            # a hard, permanent failure.
            _client = httpx.Client(timeout=_TIMEOUT, limits=_LIMITS, http2=False, transport=transport, follow_redirects=True)
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
    """
    Lowercase, whitespace/punctuation stripped, hashed — per Meta's Advanced
    Matching spec (developers.facebook.com/docs/marketing-api/conversions-api/
    parameters/customer-information-parameters), which hashes the UTF-8 bytes
    and does NOT require Latin script.

    BUG FIXED (confirmed against real production data, order ABN-20260715-
    A4C468, customer_name="عصنون صالح"): the previous `re.sub(r"[^a-z]", ...)`
    kept ONLY ASCII a-z, so every Arabic-script name — extremely common for
    Algerian customers — was reduced to an empty string and silently sent as
    fn=None/ln=None. `_strip_accents` (NFD decomposition) is a no-op on
    Arabic (it has no composed accent marks to strip), so this wasn't a
    partial degradation, it was a complete wipe. `\\w` with re.UNICODE keeps
    any Unicode letter/digit (Arabic, Latin, accented, etc.) while still
    dropping spaces/punctuation — matching Meta's actual requirement.
    """
    if not name:
        return None
    cleaned = re.sub(r"[^\w]", "", _strip_accents(name.strip().lower()), flags=re.UNICODE)
    return _sha256(cleaned) if cleaned else None


def normalize_city(city: Optional[str]) -> Optional[str]:
    """Lowercase, no accents/whitespace/punctuation — same Unicode-letter fix as normalize_name."""
    if not city:
        return None
    # Drop arabic/annotated prefixes like "القبة · Kouba"
    if "·" in city:
        city = city.split("·")[-1]
    cleaned = re.sub(r"[^\w]", "", _strip_accents(city.strip().lower()), flags=re.UNICODE)
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


_FBC_FORMAT_RE = re.compile(r"^fb\.\d+\.\d+\..+$")


def is_well_formed_fbc(fbc: Optional[str]) -> bool:
    """
    Structural check of Meta's documented fbc format: fb.<subdomainIndex>.
    <creationTime>.<fbclid> (developers.facebook.com/docs/marketing-api/
    conversions-api/parameters/fbp-and-fbc). A malformed fbc (truncated,
    wrong separators, missing fbclid segment) is silently unusable for
    Meta's click matching — Events Manager still accepts and shows the
    Purchase (this field isn't validated at ingestion), but Ads Manager has
    nothing valid to match against, producing exactly "reçu mais jamais
    attribué" with zero visible error anywhere. Used to audit historical
    orders and flag ones that structurally can never be attributed, instead
    of leaving that gap unexplained.
    """
    return bool(fbc) and bool(_FBC_FORMAT_RE.match(fbc))


# Poids d'un score PRÉDICTIF calculable AVANT l'envoi — distinct de l'EMQ
# (qui est un score que MEta calcule après coup sur ce qu'il a déjà reçu).
# Ici, fbc valide pèse le plus lourd car c'est le SEUL signal qui permet à
# Meta de relier l'achat à un clic publicitaire précis (voir
# is_well_formed_fbc ci-dessus) — sans lui, aucun autre champ ne peut
# produire une attribution publicitaire, quelle que soit sa qualité.
ATTRIBUTION_READINESS_WEIGHTS: Dict[str, float] = {
    "fbc_valid": 30.0,     # seul lien vers un clic pub précis — poids dominant
    "fbp": 15.0,           # renforce le matching navigateur/session
    "phone": 15.0,         # identifiant déterministe le plus fiable après fbc
    "external_id": 10.0,
    "client_ip": 8.0,
    "user_agent": 8.0,
    "event_time": 6.0,     # doit être présent ET cohérent (proche du clic)
    "value": 3.0,
    "currency": 3.0,
    "event_id": 2.0,       # dédup Pixel/CAPI — n'aide pas l'attribution en soi, mais évite qu'un doublon la fausse
}
_ATTRIBUTION_READINESS_TOTAL_WEIGHT = sum(ATTRIBUTION_READINESS_WEIGHTS.values())


def compute_attribution_readiness(
    *,
    fbc: Optional[str] = None,
    fbp: Optional[str] = None,
    phone: Optional[str] = None,
    external_id: Optional[str] = None,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    event_time: Optional[int] = None,
    value: Optional[float] = None,
    currency: Optional[str] = None,
    event_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Score PRÉDICTIF (0-100) — calculable AVANT d'envoyer l'événement, pas
    après coup comme l'EMQ. Répond directement à "Meta aura-t-il de bonnes
    chances d'attribuer ce Purchase ?", ce que l'EMQ ne dit jamais (l'EMQ
    mesure le matching UTILISATEUR, pas la matching PUBLICITAIRE — voir
    is_well_formed_fbc). Retourne le score + le détail par signal, pour
    afficher exactement ce qui manque plutôt qu'un pourcentage opaque.
    """
    signals = {
        "fbc_valid": is_well_formed_fbc(fbc),
        "fbp": bool(fbp),
        "phone": bool(phone),
        "external_id": bool(external_id),
        "client_ip": bool(client_ip),
        "user_agent": bool(user_agent),
        "event_time": bool(event_time),
        "value": value is not None and value > 0,
        "currency": bool(currency),
        "event_id": bool(event_id),
    }
    earned = sum(ATTRIBUTION_READINESS_WEIGHTS[k] for k, present in signals.items() if present)
    score = round(earned / _ATTRIBUTION_READINESS_TOTAL_WEIGHT * 100, 1)
    missing = [k for k, present in signals.items() if not present]
    return {"score": score, "signals": signals, "missing": missing}


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
    fbc_reference_time: Optional[float] = None,
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
        # Rebuild fbc from a raw fbclid per Meta spec: fb.1.<ms>.<fbclid>.
        # The timestamp MUST anchor the real click moment, not "now" — this
        # used to be int(time.time()*1000), i.e. whenever THIS send happens.
        # For a same-session checkout that's a few seconds of drift, harmless.
        # For an abandoned cart recovered by a confirmatrice hours/days
        # later, it fabricated a click time days after the real click —
        # Meta's own click record for that fbclid still has the true time,
        # and a fbc claiming otherwise can silently fall outside the ad
        # set's attribution window: Events Manager still accepts the event
        # (it never validates this timestamp), but Ads Manager quietly
        # refuses to attribute it to the ad. fbc_reference_time (pass
        # order.created_at) keeps this anchored to the real click regardless
        # of how long the order sat before its Purchase was actually sent.
        reference_ms = int((fbc_reference_time if fbc_reference_time is not None else time.time()) * 1000)
        ud["fbc"] = f"fb.1.{reference_ms}.{fbclid}"
    return ud


# ─── Event helpers ────────────────────────────────────────────────────────────

def purchase_event_id(order_id: str) -> str:
    """Deterministic, shared by the browser Pixel — dedup key at Meta."""
    return f"purchase-{order_id}"


def resolve_client_context(order, client_ip: Optional[str], user_agent: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """
    Repli sur les valeurs capturées à la création de la commande
    (order.client_ip / order.client_user_agent) quand l'appelant n'a plus
    de requête HTTP vivante pour les fournir — retry_pending_events, le
    sweep de rattrapage nocturne, une récupération de panier abandonné.
    Avant que ces deux colonnes existent, un retry perdait ces champs pour
    toujours, dégradant l'Event Match Quality précisément pour les Purchase
    qui avaient déjà eu un incident d'envoi. Jamais l'inverse : une valeur
    "live" passée explicitement prime toujours sur celle stockée.
    """
    return (
        client_ip or getattr(order, "client_ip", None),
        user_agent or getattr(order, "client_user_agent", None),
    )


def build_purchase_event(
    order, *, client_ip: Optional[str], user_agent: Optional[str],
    ad_currency: str = "DZD", exchange_rate: float = 1.0,
) -> Dict[str, Any]:
    """
    Full Graph-compliant Purchase event from an Order ORM object.

    ad_currency/exchange_rate: the store's OWN meta_ads_configs.currency and
    exchange_rate (DZD per 1 unit of that currency, same convention as
    get_conversion_rate in meta_ads.py). order.total is always stored in
    DZD — sending "DZD" unconditionally to an ad account actually configured
    in USD/EUR (verified: azconfort's ad account currency is USD) is a real
    mismatch, and matches the exact pixel/account (456734346750846) where
    Meta Pixel logged "Parameter 'currency' is invalid for event 'Purchase'"
    in a live test. Converting to the account's own currency, the same way
    campaign spend is already converted elsewhere in this codebase, sends
    Meta a currency it actually expects for that account.
    """
    items = list(order.items or [])
    contents = [
        {"id": str(i.product_id), "quantity": int(i.quantity or 1),
         "item_price": float(i.unit_price or 0)}
        for i in items
    ]
    # event_time DOIT être le moment réel de l'achat, jamais l'heure d'envoi
    # — c'était int(time.time()) avant ce correctif, ce qui rapportait à Meta
    # "cette conversion vient d'avoir lieu" même pour un backfill vieux de
    # plusieurs semaines. Contraire à la doc officielle Conversions API
    # (Meta accepte event_time jusqu'à 7 jours dans le passé et attend
    # explicitement l'heure réelle de la conversion, pas l'heure d'envoi —
    # https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event
    # : "event_time... This is important to help Facebook determine the
    # optimal conversion window for your event"). Un envoi hors de cette
    # fenêtre de 7 jours sera rejeté par Meta — c'est le comportement voulu
    # (voir _handle_claimed_row : erreur non-retryable classée "failed",
    # jamais masquée en réutilisant l'heure actuelle).
    reference_dt = getattr(order, "created_at", None)
    event_time = int(reference_dt.replace(tzinfo=timezone.utc).timestamp()) if reference_dt else int(time.time())
    event: Dict[str, Any] = {
        "event_name": "Purchase",
        "event_time": event_time,
        # MUST be keyed by order_number, not order.id: the browser Pixel
        # fires `purchase-${order_number}` (checkout-form.tsx — orderNum is
        # json.order_number), so keying this on the UUID produced two
        # DIFFERENT event_ids for the same purchase and Meta's dedup never
        # matched — every web order was counted twice (Pixel + this CAPI),
        # the root cause of "Meta affiche 12, l'ERP affiche 9".
        "event_id": purchase_event_id(str(order.order_number or order.id)),
        "action_source": "website",
        "user_data": build_user_data(
            email=getattr(order, "customer_email", None),
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
            # Same reference instant as event_time above — the real click is
            # never later than the order's own creation, so this is always a
            # closer anchor to the true click than "whenever this send runs".
            fbc_reference_time=(reference_dt.replace(tzinfo=timezone.utc).timestamp() if reference_dt else None),
        ),
        "custom_data": {
            "value": round(float(order.total or 0) / (exchange_rate or 1.0), 2),
            "currency": (ad_currency or "DZD").upper(),
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
    relay_url = (getattr(_settings, "META_CAPI_RELAY_URL", "") or "").strip()
    if relay_url.startswith("https://azghub.com/"):
        relay_url = relay_url.replace("https://azghub.com/", "https://www.azghub.com/", 1)

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
    last_status_code: Optional[int] = None
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
                if order:
                    from app.core.logging import log_order_event
                    log_order_event("ENVOI_META_CAPI_SUCCESS", order, f"Événement CAPI transmis avec succès à Meta (fbtrace: {data.get('fbtrace_id')})")
                return {
                    "success": True, "events_received": received, "error": None,
                    "fbtrace_id": data.get("fbtrace_id"), "retryable": False,
                    "latency_ms": total_ms, "http_status": resp.status_code,
                }

            last_status_code = resp.status_code
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
        "http_status": last_status_code,
    }


def _worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


# ─── Classification temps réel / backfill ───────────────────────────────────
# Pas de nouvelle colonne : `uq_meta_capi_purchase_per_order` (index unique
# partiel sur order_id WHERE event_name='Purchase', migration
# c3d4e5f6a7b8_meta_capi_purchase_dedup_index.py) garantit qu'il n'existe
# JAMAIS plus d'une ligne Purchase par commande — donc son `created_at` est,
# de façon fiable et non ambiguë, le moment exact de la PREMIÈRE mise en
# file, que ce soit en temps réel ou via un backfill des mois plus tard.
# Classification par écart de temps, pas une estimation floue : un envoi
# temps réel se produit dans les secondes/minutes qui suivent la commande
# (ou sa confirmation téléphonique) ; un backfill se produit typiquement
# des jours voire des semaines après. Le seuil de 6h absorbe les délais de
# file/retry légitimes sans jamais confondre les deux cas dans la pratique.
REALTIME_WINDOW_HOURS = 6


def classify_capi_log_timing(log_created_at, reference_time) -> str:
    """
    'realtime' | 'backfill' — seule la ligne de statut='success' (ou en
    file/échec, voir classify_capi_log ci-dessous) a un sens à classifier
    ainsi. reference_time doit être le moment où l'envoi AURAIT dû se
    déclencher (création de commande, ou transition ABANDONED -> vente
    réelle pour un panier récupéré par téléphone).
    """
    if not log_created_at or not reference_time:
        return "backfill"  # donnée manquante — ne jamais compter comme temps réel par défaut
    delta = (log_created_at - reference_time).total_seconds() / 3600
    return "realtime" if delta <= REALTIME_WINDOW_HOURS else "backfill"


def classify_capi_log(log, reference_time, explicit_backfill: bool = False) -> dict:
    """
    Classification complète d'une ligne MetaCapiLog (Purchase) pour
    l'affichage : type d'envoi, délai, cause du retard si connue.

    explicit_backfill : True si un AuditLog(action='capi_marked_backfill')
    existe pour cette commande — écrit AU MOMENT du rattrapage par
    backfill_missing_capi (orders.py), pas déduit après coup. Prioritaire
    sur l'heuristique de délai ci-dessous, qui ne sert plus que pour les
    lignes envoyées avant que ce marquage explicite n'existe.
    """
    if log is None:
        return {"type": "pending", "label": "Jamais mis en file", "delay_hours": None}
    if log.status in ("queued", "processing", "retry"):
        return {"type": "pending", "label": "En attente", "delay_hours": None}
    if log.status == "failed":
        return {"type": "failed", "label": "Échec définitif", "delay_hours": None,
                "error_message": log.error_message, "retry_count": log.retry_count}
    # status == 'success'
    timing = "backfill" if explicit_backfill else classify_capi_log_timing(log.created_at, reference_time)
    delay_hours = None
    if log.created_at and reference_time:
        delay_hours = round((log.created_at - reference_time).total_seconds() / 3600, 1)
    return {
        "type": "realtime" if timing == "realtime" else "backfill",
        "label": "Temps réel" if timing == "realtime" else "Rattrapage historique (Backfill)",
        "delay_hours": delay_hours,
        "retry_count": log.retry_count,
    }


# ─── Event Match Quality ─────────────────────────────────────────────────────
# Champs recommandés par Meta pour l'Event Match Quality (Conversions API) :
# https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
_MATCH_QUALITY_FIELDS = [
    ("em", "Email"), ("ph", "Téléphone"), ("fn", "Prénom"), ("ln", "Nom"),
    ("ct", "Ville"), ("st", "Wilaya"), ("country", "Pays"),
    ("external_id", "ID externe"), ("client_ip_address", "Adresse IP"),
    ("client_user_agent", "User Agent"), ("fbp", "FBP"), ("fbc", "FBC"),
]

# Poids EMQ — reflète le contexte COD de cette plateforme, pas une
# opinion générique. Les landing pages COD ne demandent quasiment jamais
# d'email (le paiement se fait à la livraison, aucun formulaire de
# paiement ne le requiert) : avec le poids égal précédent (1/12 chacun),
# l'absence STRUCTURELLE d'email pénalisait chaque commande exactement
# autant que l'absence de téléphone ou de fbp/fbc — des signaux réellement
# disponibles et à fort impact ici. Le score reflète maintenant "la
# qualité du signal réellement envoyable dans ce contexte métier", pas un
# manque artificiel sur un champ qu'aucune commande COD ne fournira
# jamais. Rien n'est envoyé différemment à Meta — seul ce score de
# diagnostic change. Poids documentés, jamais ajustés à l'aveugle :
#   - téléphone / external_id / fbp / fbc / IP / user-agent : signaux
#     first-party à haute fiabilité, systématiquement disponibles pour
#     une commande COD réelle (formulaire de commande + navigateur) —
#     poids forts, comme demandé explicitement.
#   - email / prénom / nom / ville / wilaya / pays : utiles quand présents
#     (l'email, notamment, reste un fort signal Meta s'il existe) mais
#     structurellement absents ou secondaires sur ce type de funnel —
#     poids réduits pour ne plus dominer artificiellement le score.
# ── Configurable weight surface ──────────────────────────────────────────
# THIS is the dict to edit to retune EMQ weighting — human-readable keys,
# no knowledge of Meta's internal field codes (ph/em/fn/...) required.
# Everything below derives from it; nothing else in this module needs to
# change when weights are retuned.
MATCH_QUALITY_WEIGHTS: dict[str, float] = {
    "phone": 3.0,
    "external_id": 2.5,
    "fbp": 2.0,
    "fbc": 2.0,
    "ip": 1.5,
    "user_agent": 1.5,
    "email": 1.0,
    "first_name": 0.5,
    "last_name": 0.5,
    "city": 0.5,
    "state": 0.5,
    "country": 0.5,
}

# Field classification — drives whether a missing field is reported as a
# real defect or silently excluded from "missing" entirely. "not_applicable"
# means: this platform's COD checkout structurally never collects this
# field, so its absence is not a diagnostic finding, just an expected fact.
# "required"/"recommended" fields still show up in `missing` exactly as
# before. Distinct from the WEIGHT above (a not_applicable field can still
# carry a small weight if a store happens to have it — e.g. email — see
# MATCH_QUALITY_WEIGHTS; classification only controls what counts as a
# reportable problem, not the score itself).
FIELD_CLASSIFICATION: dict[str, str] = {
    "phone": "required",           # primary identifier for a COD order
    "external_id": "required",     # deterministic, always derivable server-side
    "fbp": "recommended",
    "fbc": "recommended",
    "ip": "recommended",
    "user_agent": "recommended",
    "email": "not_applicable",     # COD landing pages don't have an email field
    "first_name": "recommended",
    "last_name": "recommended",
    "city": "recommended",
    "state": "recommended",
    "country": "recommended",
}

# Human-readable key -> Meta's own Conversions API field code. Internal
# lookup only — compute_match_quality still keys off _MATCH_QUALITY_FIELDS
# (the actual payload shape sent to Meta), this dict just translates the
# editable config above onto it.
_HUMAN_TO_META_FIELD: dict[str, str] = {
    "phone": "ph", "external_id": "external_id", "fbp": "fbp", "fbc": "fbc",
    "ip": "client_ip_address", "user_agent": "client_user_agent",
    "email": "em", "first_name": "fn", "last_name": "ln",
    "city": "ct", "state": "st", "country": "country",
}

_MATCH_QUALITY_WEIGHTS: dict[str, float] = {
    _HUMAN_TO_META_FIELD[human_key]: weight for human_key, weight in MATCH_QUALITY_WEIGHTS.items()
}
_META_FIELD_CLASSIFICATION: dict[str, str] = {
    _HUMAN_TO_META_FIELD[human_key]: level for human_key, level in FIELD_CLASSIFICATION.items()
}


def compute_match_quality(user_data: Optional[dict]) -> dict:
    """
    Score de complétude PONDÉRÉ des paramètres envoyés à Meta pour cet
    événement — un proxy honnête de l'Event Match Quality (le score EXACT
    que Meta calcule en interne n'est jamais exposé par aucune API,
    seulement visible dans Events Manager). Pondéré selon
    MATCH_QUALITY_WEIGHTS (configurable — voir sa docstring pour la
    justification COD), jamais une moyenne simple qui traiterait un champ
    structurellement absent (email) comme équivalent à un champ à fort
    impact absent (téléphone, fbp/fbc) — jamais un chiffre inventé : les
    poids sont documentés et appliqués identiquement à chaque événement.

    `missing` ne liste que les champs "required"/"recommended" (voir
    FIELD_CLASSIFICATION) — un champ "not_applicable" (email, sur ce
    funnel COD) absent n'est PAS un défaut à signaler, donc n'apparaît
    plus dans `missing`, mais reste visible dans `fields` avec son statut
    exact pour audit complet.
    """
    user_data = user_data or {}
    present = {key: bool(user_data.get(key)) for key, _ in _MATCH_QUALITY_FIELDS}
    total_weight = sum(_MATCH_QUALITY_WEIGHTS.get(key, 1.0) for key, _ in _MATCH_QUALITY_FIELDS)
    earned_weight = sum(_MATCH_QUALITY_WEIGHTS.get(key, 1.0) for key, _ in _MATCH_QUALITY_FIELDS if present[key])
    score = round(earned_weight / total_weight * 100, 1) if total_weight else 0.0
    return {
        "score": score,
        "fields": [
            {
                "key": key, "label": label, "present": present[key],
                "weight": _MATCH_QUALITY_WEIGHTS.get(key, 1.0),
                "classification": _META_FIELD_CLASSIFICATION.get(key, "recommended"),
            }
            for key, label in _MATCH_QUALITY_FIELDS
        ],
        "missing": [
            label for key, label in _MATCH_QUALITY_FIELDS
            if not present[key] and _META_FIELD_CLASSIFICATION.get(key, "recommended") != "not_applicable"
        ],
        "not_applicable": [
            label for key, label in _MATCH_QUALITY_FIELDS
            if not present[key] and _META_FIELD_CLASSIFICATION.get(key, "recommended") == "not_applicable"
        ],
    }


def scan_payload_quality(payload: Optional[dict]) -> dict:
    """
    Vérifie un event Purchase déjà construit (le dict complet stocké dans
    MetaCapiLog.payload) pour les défauts structurels que Meta rejette ou
    mal-interprète : value/currency/event_time manquants, devise inattendue.
    Fonction pure, réutilisée par le Signal Quality Center (meta_ads.py)
    pour rester testable sans dépendre de la base.
    """
    p = payload or {}
    # Robustesse structurelle : un payload peut avoir été stocké soit comme
    # l'événement seul (build_purchase_event / durable queue — event_time en
    # haut niveau, custom_data.currency imbriqué), soit, historiquement, comme
    # le wrapper complet envoyé à Meta {"data": [event], ...}. Sans ce
    # déballage, un payload au format wrapper faisait remonter event_time ET
    # currency comme "absents" à tort — la source exacte des faux positifs
    # "Purchase sans event_time / sans devise" signalés sur le dashboard alors
    # que ces champs SONT bien envoyés depuis le cutover du 16/07. On ne
    # change rien à ce qui est envoyé à Meta : on lit juste le champ au bon
    # endroit quel que soit le format de stockage.
    data = p.get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        p = data[0]
    cd = p.get("custom_data") or {}
    currency = cd.get("currency")
    return {
        "missing_value": cd.get("value") in (None, "", 0),
        "missing_currency": not currency,
        # DZD = devise native ERP ; USD/EUR = conversion volontaire vers la
        # devise du compte pub (voir build_purchase_event). Toute autre
        # valeur non-vide est une anomalie réelle, pas une fausse alerte.
        "wrong_currency": bool(currency) and currency not in ("DZD", "USD", "EUR"),
        "missing_event_time": not p.get("event_time"),
    }


# Poids du Learning Score — documentés ici pour que le calcul reste auditable
# (jamais une note ajustée à la main pour "faire joli"). Chaque composant est
# un pourcentage réel déjà mesuré ailleurs dans le Signal Quality Center :
# aucune de ces valeurs n'est déduite indirectement ou estimée.
_LEARNING_SCORE_WEIGHTS = {
    "realtime_pct": 0.20,      # Meta apprend surtout des signaux temps réel
    "event_match_quality": 0.20,
    "valid_purchase_pct": 0.20,
    "dedup_pct": 0.10,
    "value_present_pct": 0.10,
    "attribution_pct": 0.10,
    "latency_score": 0.10,
}


def _latency_to_score(avg_latency_ms: Optional[float]) -> float:
    """
    100 si l'envoi est quasi instantané (<=5s, le cas normal d'un envoi
    synchrone au moment de la commande), dégradé linéairement jusqu'à 0 à
    partir d'1 minute de latence moyenne (signe d'une file qui traîne).
    """
    if avg_latency_ms is None:
        return 100.0
    if avg_latency_ms <= 5000:
        return 100.0
    if avg_latency_ms >= 60000:
        return 0.0
    return round(100 - (avg_latency_ms - 5000) / (60000 - 5000) * 100, 1)


def compute_learning_score(metrics: dict) -> dict:
    """
    Learning Score — le KPI unique qui répond à "Meta reçoit-il des signaux
    assez bons pour bien apprendre et optimiser la diffusion ?". Moyenne
    pondérée de composants déjà mesurés honnêtement ailleurs (jamais une
    note distincte recalculée en secret) : realtime_pct, event_match_quality
    (avg EMQ), valid_purchase_pct, dedup_pct, value_present_pct,
    attribution_pct, et avg_latency_ms (converti en score via
    _latency_to_score). Toute clé manquante dans `metrics` est traitée comme
    0 plutôt que d'ignorer la pondération, pour ne jamais gonfler la note en
    silence sur une donnée absente.
    """
    latency_score = _latency_to_score(metrics.get("avg_latency_ms"))
    components = {
        "realtime_pct": metrics.get("realtime_pct") or 0.0,
        "event_match_quality": metrics.get("event_match_quality") or 0.0,
        "valid_purchase_pct": metrics.get("valid_purchase_pct") or 0.0,
        "dedup_pct": metrics.get("dedup_pct") or 0.0,
        "value_present_pct": metrics.get("value_present_pct") or 0.0,
        "attribution_pct": metrics.get("attribution_pct") or 0.0,
        "latency_score": latency_score,
    }
    score = round(sum(components[k] * w for k, w in _LEARNING_SCORE_WEIGHTS.items()), 1)
    return {"score": score, "components": components, "weights": _LEARNING_SCORE_WEIGHTS}


def diagnose_campaign_learning(metrics: dict) -> list:
    """
    "Pourquoi CETTE campagne n'apprend-elle pas ?" — moteur de diagnostic
    pur (aucune requête ici, appelé par meta_ads.py avec des métriques déjà
    agrégées en SQL) partagé par la carte "Campaign Learning Health" et la
    vue dédiée. Chaque règle ne se déclenche que si le seuil documenté à
    côté est dépassé — jamais une liste statique de conseils génériques.
    Chaque raison inclut severity/impact/explication/recommandation, dans
    l'ordre attendu par le front (grave -> faible).

    metrics attendues (toutes optionnelles, une clé absente ne déclenche
    simplement pas la règle correspondante) : purchase_count, weekly_rate,
    backfill_pct, event_match_quality, missing_value_pct, missing_currency_pct,
    retry_pct, rejected_pct, avg_latency_ms, no_utm_pct, frequency, ctr,
    cost_per_purchase.
    """
    reasons = []

    weekly_rate = metrics.get("weekly_rate")
    if weekly_rate is not None and weekly_rate < 50:
        reasons.append({
            "type": "VOLUME_FAIBLE", "severity": "high",
            "title": "Peu de Purchase",
            "impact": "high",
            "explanation": f"~{round(weekly_rate, 1)} Purchase/semaine sur cette campagne — sous le seuil de ~50/semaine que Meta recommande pour sortir de la phase d'apprentissage.",
            "recommendation": "Regrouper des ad sets trop fragmentés ou élargir ciblage/budget pour accumuler plus de conversions.",
        })

    backfill_pct = metrics.get("backfill_pct")
    if backfill_pct is not None and backfill_pct > 20:
        reasons.append({
            "type": "BACKFILL_ELEVE", "severity": "high",
            "title": "Beaucoup de backfill",
            "impact": "high",
            "explanation": f"{backfill_pct}% des Purchase de cette campagne sont du rattrapage — Meta apprend sur des signaux reçus trop tard.",
            "recommendation": "Fiabiliser l'envoi temps réel (file CAPI, connectivité) pour réduire la dépendance au rattrapage.",
        })

    emq = metrics.get("event_match_quality")
    if emq is not None and emq < 60:
        reasons.append({
            "type": "EMQ_FAIBLE", "severity": "high",
            "title": "Event Match faible",
            "impact": "high",
            "explanation": f"EMQ moyen de {emq}% sur cette campagne — Meta ne parvient à rapprocher qu'une minorité des événements d'un profil réel.",
            "recommendation": "Vérifier email/téléphone/ville/wilaya/IP/user-agent/fbp/fbc transmis pour les commandes de cette campagne.",
        })

    missing_value_pct = metrics.get("missing_value_pct")
    if missing_value_pct is not None and missing_value_pct > 0:
        reasons.append({
            "type": "VALEUR_ABSENTE", "severity": "high",
            "title": "Valeur absente",
            "impact": "high",
            "explanation": f"{missing_value_pct}% des Purchase de cette campagne sans valeur monétaire — Meta ne peut pas optimiser sur la valeur.",
            "recommendation": "Vérifier order.total sur les commandes concernées.",
        })

    missing_currency_pct = metrics.get("missing_currency_pct")
    if missing_currency_pct is not None and missing_currency_pct > 0:
        reasons.append({
            "type": "CURRENCY_ABSENTE", "severity": "high",
            "title": "Currency absente",
            "impact": "medium",
            "explanation": f"{missing_currency_pct}% des Purchase sans devise déclarée.",
            "recommendation": "Vérifier la configuration currency/exchange_rate du compte pub.",
        })

    retry_pct = metrics.get("retry_pct")
    if retry_pct is not None and retry_pct > 10:
        reasons.append({
            "type": "RETRY_ELEVE", "severity": "medium",
            "title": "Beaucoup de retry",
            "impact": "medium",
            "explanation": f"{retry_pct}% des Purchase ont nécessité au moins une nouvelle tentative d'envoi.",
            "recommendation": "Vérifier les erreurs de la file CAPI (réseau, token) pour les commandes de cette campagne.",
        })

    rejected_pct = metrics.get("rejected_pct")
    if rejected_pct is not None and rejected_pct > 5:
        reasons.append({
            "type": "REJETS_ELEVES", "severity": "high",
            "title": "Trop de Purchase rejetés",
            "impact": "high",
            "explanation": f"{rejected_pct}% des Purchase de cette campagne ont échoué définitivement.",
            "recommendation": "Vérifier la Santé du Pixel (token/scopes) puis relancer via Bons d'Achat.",
        })

    avg_latency_ms = metrics.get("avg_latency_ms")
    if avg_latency_ms is not None and avg_latency_ms > 30000:
        reasons.append({
            "type": "LATENCE_ELEVEE", "severity": "medium",
            "title": "Latence élevée",
            "impact": "medium",
            "explanation": f"Délai moyen d'envoi de {round(avg_latency_ms / 1000, 1)}s pour cette campagne.",
            "recommendation": "Vérifier la connectivité sortante du serveur et la charge de la file CAPI.",
        })

    no_utm_pct = metrics.get("no_utm_pct")
    if no_utm_pct is not None and no_utm_pct > 30:
        reasons.append({
            "type": "SANS_UTM", "severity": "low",
            "title": "Beaucoup de commandes sans UTM",
            "impact": "low",
            "explanation": f"{no_utm_pct}% des commandes rattachées à cette campagne n'ont pas d'UTM (rattachées par produit) — invisibles dans les rapports UTM natifs de Meta.",
            "recommendation": "Vérifier le tracking UTM sur les liens publicitaires de cette campagne.",
        })

    frequency = metrics.get("frequency")
    if frequency is not None and frequency > 3:
        reasons.append({
            "type": "FREQUENCE_ELEVEE", "severity": "low",
            "title": "Fréquence trop élevée",
            "impact": "low",
            "explanation": f"Fréquence de {frequency} (impressions/reach) — la même audience revoit trop souvent la publicité.",
            "recommendation": "Élargir l'audience, renouveler les créas, ou plafonner la fréquence.",
        })

    ctr = metrics.get("ctr")
    if ctr is not None and metrics.get("impressions", 0) > 200 and ctr < 1.0:
        reasons.append({
            "type": "CTR_FAIBLE", "severity": "low",
            "title": "CTR faible",
            "impact": "medium",
            "explanation": f"CTR de {ctr}% (> 200 impressions) — le créa ou le ciblage n'accroche pas assez.",
            "recommendation": "Tester d'autres visuels/accroches ou revoir le ciblage.",
        })

    cost_per_purchase = metrics.get("cost_per_purchase")
    aov = metrics.get("aov")
    if cost_per_purchase is not None and aov and cost_per_purchase > aov * 0.5:
        reasons.append({
            "type": "CPA_ELEVE", "severity": "medium",
            "title": "Coût par achat élevé",
            "impact": "high",
            "explanation": f"Coût par achat de {cost_per_purchase} pour un panier moyen de {aov} — marge dégradée.",
            "recommendation": "Revoir enchère/ciblage/budget de cette campagne ou mettre en pause si la tendance persiste.",
        })

    severity_order = {"high": 0, "medium": 1, "low": 2}
    reasons.sort(key=lambda r: severity_order.get(r["severity"], 3))
    return reasons


# ─── Meta Optimization Engine ─────────────────────────────────────────────────
# Explication par champ — pourquoi il peut manquer sur UN event Purchase
# réel, son impact, et la correction possible. Source de vérité UNIQUE,
# partagée par le contrôle avant envoi (_handle_claimed_row) ET par tout
# scan a posteriori — jamais deux explications différentes pour le même
# champ. Aucune de ces valeurs n'est une donnée : ce sont des explications
# fixes, jamais substituées à un champ manquant.
_SIGNAL_FIELD_GUIDE: Dict[str, Dict[str, str]] = {
    "event_name": {
        "impact": "critique — sans lui Meta ne sait pas quel type de conversion a eu lieu.",
        "why_missing": "ne devrait jamais manquer : toujours 'Purchase' en dur.",
        "fix": "vérifier build_purchase_event.",
    },
    "order_id": {
        "impact": "faible — champ interne (custom_data.order_id), pas un paramètre standard Meta, utile seulement pour notre propre traçabilité.",
        "why_missing": "ne devrait jamais manquer : dérivé de order.order_number.",
        "fix": "vérifier build_purchase_event.",
    },
    "content_type": {
        "impact": "moyen — recommandé par Meta pour le e-commerce (aide au catalogue produit/Advantage+).",
        "why_missing": "ne devrait jamais manquer : toujours 'product' en dur.",
        "fix": "vérifier build_purchase_event.",
    },
    "content_ids": {
        "impact": "élevé — sans IDs produit, Meta ne peut pas faire de retargeting catalogue ni de recommandations dynamiques.",
        "why_missing": "la commande n'a aucun article (order.items vide) — ne devrait pas arriver pour une commande valide.",
        "fix": "vérifier que order.items est bien chargé/non vide pour cette commande.",
    },
    "contents": {
        "impact": "élevé — quantités/prix par article, utilisés par Meta pour le catalogue dynamique.",
        "why_missing": "la commande n'a aucun article (order.items vide).",
        "fix": "vérifier que order.items est bien chargé/non vide pour cette commande.",
    },
    "num_items": {
        "impact": "moyen — utilisé par Meta pour distinguer un panier d'un article unique.",
        "why_missing": "la commande n'a aucun article ou une quantité totale de 0.",
        "fix": "vérifier order.items[].quantity pour cette commande.",
    },
    "event_id": {
        "impact": "critique — sans lui Meta ne peut pas dédupliquer Pixel/CAPI, risque de double comptage.",
        "why_missing": "ne devrait jamais manquer : généré de façon déterministe depuis order_number.",
        "fix": "vérifier purchase_event_id() et order.order_number.",
    },
    "event_time": {
        "impact": "élevé — Meta ne peut pas situer la conversion dans sa fenêtre d'attribution.",
        "why_missing": "ne devrait jamais manquer : dérivé de order.created_at (toujours renseigné).",
        "fix": "vérifier build_purchase_event / order.created_at.",
    },
    "value": {
        "impact": "élevé — Meta ne peut pas optimiser sur la valeur des conversions.",
        "why_missing": "order.total est à 0 ou absent (commande gratuite, remise à 100%, item sans prix).",
        "fix": "vérifier order.total sur cette commande.",
    },
    "currency": {
        "impact": "élevé — une valeur sans devise valide peut faire rejeter l'événement par Meta.",
        "why_missing": "MetaAdsConfig.currency non configuré pour cette boutique.",
        "fix": "renseigner la devise du compte pub dans la configuration Meta Ads.",
    },
    "event_source_url": {
        "impact": "faible — contexte de navigation, n'entre ni dans l'attribution ni le matching.",
        "why_missing": "commande créée hors navigateur (téléphone, admin) ou URL non transmise au checkout.",
        "fix": "vérifier que attributionPayload() est bien envoyé au moment du checkout.",
    },
    "action_source": {
        "impact": "élevé — Meta a besoin de savoir où l'action a eu lieu.",
        "why_missing": "ne devrait jamais manquer : toujours 'website' en dur.",
        "fix": "vérifier build_purchase_event.",
    },
    "client_ip_address": {
        "impact": "moyen — dégrade l'Event Match Quality.",
        "why_missing": "commande créée sans requête HTTP directe (rattrapage, admin) ou IP non transmise par le proxy.",
        "fix": "vérifier x-forwarded-for côté proxy/CDN pour les commandes concernées.",
    },
    "client_user_agent": {
        "impact": "moyen — dégrade l'Event Match Quality.",
        "why_missing": "commande créée sans en-tête User-Agent (rattrapage, admin, vente téléphonique).",
        "fix": "vérifier que le checkout transmet bien le User-Agent au moment de la commande.",
    },
    "fbp": {
        "impact": "moyen — dégrade l'Event Match Quality (identifiant navigateur Meta).",
        "why_missing": "cookie _fbp absent (bloqueur de cookies, Pixel pas encore chargé, commande hors navigateur).",
        "fix": "vérifier le chargement du Pixel avant la soumission du formulaire de commande.",
    },
    "fbc": {
        "impact": "moyen — dégrade l'Event Match Quality (identifiant de clic publicitaire).",
        "why_missing": "trafic non-Meta (organique/direct) ou fbclid non capturé sur la page d'atterrissage.",
        "fix": "normal pour du trafic non-Meta ; sinon vérifier la capture de fbclid dans l'URL d'atterrissage.",
    },
    "em": {
        "impact": "élevé — l'email est le signal de matching le plus fiable pour Meta.",
        "why_missing": "order.customer_email vide (commande sans email collecté).",
        "fix": "rendre l'email obligatoire ou incitatif au checkout.",
    },
    "ph": {
        "impact": "élevé — signal de matching très fiable, quasi toujours disponible (vente par téléphone).",
        "why_missing": "order.customer_phone vide — généralement une anomalie de saisie.",
        "fix": "vérifier la validation du champ téléphone au checkout.",
    },
    "external_id": {
        "impact": "moyen — signal de matching additionnel.",
        "why_missing": "ne devrait jamais manquer : dérivé de customer_phone ou order.id.",
        "fix": "vérifier build_purchase_event.",
    },
    "fn": {
        "impact": "faible — signal de matching secondaire.",
        "why_missing": "order.customer_name vide ou ne contient qu'un seul mot.",
        "fix": "encourager la saisie prénom + nom séparément au checkout.",
    },
    "ln": {
        "impact": "faible — signal de matching secondaire.",
        "why_missing": "order.customer_name ne contient qu'un seul mot (pas de nom de famille distinct).",
        "fix": "encourager la saisie prénom + nom séparément au checkout.",
    },
    "ct": {
        "impact": "faible — signal de matching secondaire.",
        "why_missing": "order.customer_commune vide.",
        "fix": "rendre la commune obligatoire au checkout.",
    },
    "st": {
        "impact": "faible — signal de matching secondaire.",
        "why_missing": "order.customer_wilaya vide.",
        "fix": "rendre la wilaya obligatoire au checkout (déjà quasi toujours présente).",
    },
    "country": {
        "impact": "faible — signal de matching secondaire.",
        "why_missing": "ne devrait jamais manquer : fixé à 'DZ' (boutique Algérie uniquement).",
        "fix": "aucune action nécessaire.",
    },
    "zp": {
        "impact": "faible — le moins utile des champs de matching Meta.",
        "why_missing": "structurel : aucune colonne code postal sur la commande — jamais collecté au checkout.",
        "fix": "ajouter un champ code postal au formulaire de commande (décision produit, pas un correctif de code).",
    },
}


def evaluate_purchase_signal_quality(event: Optional[dict]) -> dict:
    """
    Évaluateur exécuté sur un event Purchase déjà construit
    (build_purchase_event ou un payload historique) — sert à la fois de
    contrôle avant envoi (_handle_claimed_row, juste avant send_events) et
    de scan a posteriori (Signal Quality Center / Campaign Learning
    Health), UNE seule fonction pour ne jamais afficher deux scores
    différents pour le même événement.

    Ne bloque JAMAIS l'envoi — le retour ne contient aucun signal
    "annuler" : seulement un diagnostic honnête (champ par champ) de ce
    qui manque, pourquoi, l'impact réel, et comment le corriger. Aucune
    donnée n'est jamais complétée ici avec une valeur fictive — un champ
    absent reste `None`, expliqué, jamais remplacé.

    match_score = le score Event Match Quality déjà calculé par
    compute_match_quality — même calcul, même nombre, réutilisé sous un
    nom plus parlant plutôt que dupliqué sous un autre score.
    """
    event = event or {}
    ud = event.get("user_data") or {}
    cd = event.get("custom_data") or {}
    root_fields = {
        "event_name": bool(event.get("event_name")),
        "event_id": bool(event.get("event_id")),
        "event_time": bool(event.get("event_time")),
        "event_source_url": bool(event.get("event_source_url")),
        "action_source": bool(event.get("action_source")),
        "value": cd.get("value") not in (None, "", 0),
        "currency": bool(cd.get("currency")),
        "order_id": bool(cd.get("order_id")),
        "content_type": bool(cd.get("content_type")),
        "content_ids": bool(cd.get("content_ids")),
        "contents": bool(cd.get("contents")),
        "num_items": bool(cd.get("num_items")),
    }
    user_data_fields = {
        key: bool(ud.get(key)) for key in
        ("em", "ph", "fn", "ln", "ct", "st", "country", "zp", "external_id",
         "client_ip_address", "client_user_agent", "fbp", "fbc")
    }
    all_fields = {**root_fields, **user_data_fields}

    checks = []
    for key, present in all_fields.items():
        guide = _SIGNAL_FIELD_GUIDE.get(key, {})
        checks.append({
            "field": key,
            "present": present,
            "impact": guide.get("impact", "non documenté"),
            "why_if_missing": None if present else guide.get("why_missing", "cause non identifiée"),
            "fix": None if present else guide.get("fix", "vérifier la source de cette donnée"),
        })

    match_quality = compute_match_quality(ud)
    n_present = sum(1 for c in checks if c["present"])
    completeness_pct = round(n_present / len(checks) * 100, 1) if checks else 0.0
    consistency = validate_purchase_event_consistency(event)

    return {
        "match_score": match_quality["score"],
        "completeness_pct": completeness_pct,
        "checks": checks,
        "missing_fields": [c["field"] for c in checks if not c["present"]],
        "blocking_errors": consistency["blocking_errors"],
        "warnings": consistency["warnings"],
    }


# Fenêtre d'acceptation event_time de Meta — même valeur que
# META_CAPI_EVENT_TIME_WINDOW_DAYS (app/api/v1/orders.py), dupliquée ici en
# constante plutôt qu'importée pour éviter un import circulaire
# (orders.py importe déjà depuis meta_capi.py). Documentée pour rester en
# phase si l'une des deux change un jour.
_EVENT_TIME_MAX_AGE_DAYS = 7
# Devises couramment vues dans ce système (DZD natif ERP, USD/EUR comptes
# pub) — une devise hors de cette liste n'est pas forcément invalide pour
# Meta, mais mérite une vérification manuelle plutôt qu'un envoi silencieux.
_KNOWN_CURRENCIES = {"DZD", "USD", "EUR", "GBP", "CAD", "AUD", "CHF", "AED", "SAR", "TND", "MAD"}


def validate_purchase_event_consistency(event: Optional[dict], *, now: Optional[float] = None) -> dict:
    """
    Vérifie la COHÉRENCE des valeurs d'un event Purchase déjà construit —
    pas seulement leur présence (voir evaluate_purchase_signal_quality,
    qui appelle cette fonction et fusionne son résultat). Sépare erreurs
    bloquantes (Meta rejettera très probablement l'événement) des
    avertissements (accepté mais dégradé).

    `now` en secondes epoch, injectable pour les tests ; par défaut
    l'heure réelle. Ne modifie jamais l'event reçu.
    """
    import time as _time
    event = event or {}
    cd = event.get("custom_data") or {}
    now = now if now is not None else _time.time()

    blocking_errors = []
    warnings = []

    value = cd.get("value")
    if isinstance(value, (int, float)) and value < 0:
        blocking_errors.append({
            "field": "value", "issue": "valeur négative",
            "detail": f"value={value} — Meta rejette les valeurs négatives pour un Purchase.",
        })

    currency = cd.get("currency")
    if currency:
        if not (isinstance(currency, str) and len(currency) == 3 and currency.isalpha() and currency.isupper()):
            blocking_errors.append({
                "field": "currency", "issue": "format invalide",
                "detail": f"currency={currency!r} — doit être un code ISO 4217 à 3 lettres majuscules.",
            })
        elif currency not in _KNOWN_CURRENCIES:
            warnings.append({
                "field": "currency", "issue": "devise inhabituelle",
                "detail": f"currency={currency} n'est pas dans la liste des devises couramment utilisées par ce système — à vérifier manuellement, pas forcément une erreur.",
            })

    event_time = event.get("event_time")
    if isinstance(event_time, (int, float)):
        if event_time > now + 300:  # 5 min de marge pour l'horloge serveur
            blocking_errors.append({
                "field": "event_time", "issue": "dans le futur",
                "detail": f"event_time={int(event_time)} est postérieur à l'heure actuelle — jamais valide pour une conversion déjà survenue.",
            })
        elif event_time < now - (_EVENT_TIME_MAX_AGE_DAYS * 86400):
            blocking_errors.append({
                "field": "event_time", "issue": "hors fenêtre d'acceptation Meta",
                "detail": f"event_time vieux de plus de {_EVENT_TIME_MAX_AGE_DAYS} jours — Meta rejette ces événements (voir META_CAPI_EVENT_TIME_WINDOW_DAYS).",
            })

    content_ids = cd.get("content_ids")
    if isinstance(content_ids, list) and any(not cid for cid in content_ids):
        warnings.append({
            "field": "content_ids", "issue": "ID produit vide dans la liste",
            "detail": "au moins un content_id est vide — dégrade le retargeting catalogue pour cet article.",
        })

    content_type = cd.get("content_type")
    if content_type and content_type != "product":
        warnings.append({
            "field": "content_type", "issue": "valeur inattendue",
            "detail": f"content_type={content_type!r} — build_purchase_event force toujours 'product' ; une autre valeur signale un payload reconstruit ailleurs.",
        })

    event_name = event.get("event_name")
    if event_name and event_name != "Purchase":
        blocking_errors.append({
            "field": "event_name", "issue": "valeur inattendue pour ce pipeline",
            "detail": f"event_name={event_name!r} — cette validation est faite pour des événements Purchase ; un autre nom signale un mélange de payloads.",
        })

    # Hash SHA-256 attendu par Meta pour em/ph : exactement 64 caractères
    # hexadécimaux MINUSCULES (normalize_email/normalize_phone hashent déjà
    # ainsi — un hash mal formé signale un appel externe qui contourne
    # build_user_data, pas une commande réelle sans email/téléphone).
    ud = event.get("user_data") or {}
    _sha256_re = re.compile(r"^[0-9a-f]{64}$")
    for key, label in (("em", "email"), ("ph", "téléphone")):
        values = ud.get(key)
        if not values:
            continue
        for v in (values if isinstance(values, list) else [values]):
            if not _sha256_re.match(str(v)):
                warnings.append({
                    "field": key, "issue": f"hash {label} mal formé",
                    "detail": f"'{key}' présent mais ne ressemble pas à un SHA-256 (64 hex minuscules) — Meta l'ignorera silencieusement, dégradant l'EMQ sans lever d'erreur explicite.",
                })
                break

    ip = ud.get("client_ip_address")
    if ip:
        try:
            ipaddress.ip_address(ip)
        except ValueError:
            warnings.append({
                "field": "client_ip_address", "issue": "format IP invalide",
                "detail": f"'{ip}' n'est pas une adresse IPv4/IPv6 valide — probablement un en-tête x-forwarded-for mal parsé (liste de plusieurs IP, valeur vide après split).",
            })

    return {"blocking_errors": blocking_errors, "warnings": warnings}


# Explication par champ d'attribution — QUAND il aurait dû être capturé
# (utile pour distinguer "jamais capturable" de "capturable mais perdu").
# "landing_page" n'a pas de colonne dédiée sur Order — event_source_url
# (l'URL de la page au moment du checkout) en est le proxy honnête, jamais
# présenté comme un champ distinct qui n'existe pas.
_ATTRIBUTION_FIELD_GUIDE: Dict[str, str] = {
    "campaign_id": "au clic sur la publicité (paramètre d'URL), transmis au checkout par attributionPayload().",
    "adset_id": "au clic sur la publicité (paramètre d'URL), transmis au checkout par attributionPayload().",
    "ad_id": "au clic sur la publicité (paramètre d'URL), transmis au checkout par attributionPayload().",
    "utm_source": "dans l'URL de la publicité, capturé à la première page vue et transmis au checkout.",
    "utm_medium": "dans l'URL de la publicité, capturé à la première page vue et transmis au checkout.",
    "utm_campaign": "dans l'URL de la publicité, capturé à la première page vue et transmis au checkout.",
    "utm_content": "dans l'URL de la publicité, capturé à la première page vue et transmis au checkout.",
    "utm_term": "dans l'URL de la publicité, capturé à la première page vue et transmis au checkout.",
    "event_source_url": "au chargement de la page de checkout (window.location.href) — sert de landing_page, aucune colonne dédiée.",
}


def evaluate_order_attribution(order) -> dict:
    """
    Complétude de l'attribution publicitaire d'UNE commande —
    campaign_id/adset_id/ad_id/utm_*/event_source_url (proxy landing_page).
    L'absence de ces champs n'est PAS une anomalie en soi : une commande
    organique/directe n'a normalement AUCUN signal publicitaire — c'est le
    comportement attendu, jamais présenté comme un défaut de tracking.
    Aucune valeur n'est jamais déduite : un champ absent reste `None`.
    """
    fields = {
        "campaign_id": getattr(order, "campaign_id", None),
        "adset_id": getattr(order, "adset_id", None),
        "ad_id": getattr(order, "ad_id", None),
        "utm_source": getattr(order, "utm_source", None),
        "utm_medium": getattr(order, "utm_medium", None),
        "utm_campaign": getattr(order, "utm_campaign", None),
        "utm_content": getattr(order, "utm_content", None),
        "utm_term": getattr(order, "utm_term", None),
        "event_source_url": getattr(order, "event_source_url", None),
    }
    has_any_ad_signal = any(fields[k] for k in ("campaign_id", "adset_id", "ad_id", "utm_campaign"))

    checks = []
    for key, value in fields.items():
        present = bool(value)
        why_if_missing = None
        if not present:
            why_if_missing = (
                "aucun signal publicitaire détecté sur cette commande (probablement trafic organique/direct) — absence normale, pas une anomalie."
                if not has_any_ad_signal
                else "signal publicitaire partiellement capturé pour cette commande (certains champs présents, celui-ci non) — vérifier les paramètres d'URL de cette publicité spécifique."
            )
        checks.append({
            "field": key,
            "present": present,
            "when_should_be_captured": _ATTRIBUTION_FIELD_GUIDE.get(key, "au checkout"),
            "why_if_missing": why_if_missing,
        })

    return {
        "checks": checks,
        "likely_organic": not has_any_ad_signal,
        "attribution_completeness_pct": round(sum(1 for c in checks if c["present"]) / len(checks) * 100, 1) if checks else 0.0,
    }


def _score_band(score: Optional[float], bands: list) -> str:
    """
    Une seule logique de bandes catégorielles, réutilisée par tous les
    contextes qui ont besoin d'un vocabulaire différent pour le MÊME score
    /100 déjà calculé ailleurs — jamais une note recalculée, jamais un
    second barème de seuils inventé par contexte. `bands` = [(seuil_min,
    label), ...] triés du plus haut au plus bas ; le dernier est le
    label plancher (utilisé si aucun seuil n'est atteint).
    """
    if score is None:
        return "Non disponible"
    for threshold, label in bands:
        if score >= threshold:
            return label
    return bands[-1][1]


def meta_health_label(score: Optional[float]) -> str:
    """Bandes Excellent/Bon/Moyen/Faible/Critique — Signal Quality Center / Campaign Learning Health."""
    return _score_band(score, [(90, "Excellent"), (75, "Bon"), (55, "Moyen"), (35, "Faible"), (0, "Critique")])


def campaign_classification_label(score: Optional[float]) -> str:
    """
    Bandes "Excellente / Bonne / À surveiller / Critique" — MÊMES seuils que
    meta_health_label (90/75/35), vocabulaire différent pour le classement
    des campagnes. Pas un second barème inventé : Excellent+Bon ->
    Excellente/Bonne, Moyen+Faible -> À surveiller, Critique -> Critique.
    """
    return _score_band(score, [(90, "Excellente"), (75, "Bonne"), (35, "À surveiller"), (0, "Critique")])


def meta_optimization_label(score: Optional[float]) -> str:
    """Bandes Excellent/Très bon/Bon/Moyen/Critique — Meta Optimization Advisor (score global)."""
    return _score_band(score, [(90, "Excellent"), (80, "Très bon"), (65, "Bon"), (45, "Moyen"), (0, "Critique")])


def estimate_learning_score_gains(components: dict) -> list:
    """
    Pour chaque composant du Learning Score qui n'est pas déjà à 100,
    calcule le gain de points RÉEL : recalcul complet de
    compute_learning_score avec CE SEUL composant porté à 100 (ou latence
    ramenée à 0ms), tous les autres inchangés — jamais un gain estimé à la
    main. Trié par gain décroissant ; les composants déjà parfaits ou sans
    gain possible n'apparaissent pas.

    `components` prend les mêmes clés que compute_learning_score :
    realtime_pct, event_match_quality, valid_purchase_pct, dedup_pct,
    value_present_pct, attribution_pct, avg_latency_ms.
    """
    base = compute_learning_score(components)
    base_score = base["score"]
    gains = []
    for key in _LEARNING_SCORE_WEIGHTS:
        current = base["components"].get(key, 0.0)
        if current >= 100:
            continue
        hypothetical = dict(components)
        if key == "latency_score":
            hypothetical["avg_latency_ms"] = 0
        else:
            hypothetical[key] = 100.0
        new_score = compute_learning_score(hypothetical)["score"]
        gain = round(new_score - base_score, 1)
        if gain > 0:
            gains.append({"component": key, "current": round(current, 1), "gain_points": gain})
    gains.sort(key=lambda g: g["gain_points"], reverse=True)
    return gains


def estimate_learning_score_gains_by_field(components: dict, field_coverage_pct: dict) -> list:
    """
    Gain de Learning Score si UN champ EMQ précis (FBP, FBC, email, ...)
    passait à 100% de couverture — pas juste "si l'EMQ moyen passait à
    100%" comme estimate_learning_score_gains. Calcul EXACT, pas une
    approximation : compute_match_quality fait une moyenne NON PONDÉRÉE
    sur les 12 champs _MATCH_QUALITY_FIELDS, donc porter UN champ de X% à
    100% de couverture relève l'EMQ moyen de EXACTEMENT (100 - X) / 12
    points de pourcentage (chaque champ pèse 1/12 dans ce score, par
    construction de compute_match_quality) — pas une estimation arbitraire.

    field_coverage_pct : dict {clé EMQ: pourcentage de présence 0-100},
    typiquement `field_coverage` du Signal Quality Center ou
    field_completeness d'une campagne, restreint aux 12 clés EMQ.

    NB : depuis la pondération COD de l'EMQ (MATCH_QUALITY_WEIGHTS), porter
    un champ K de X% à 100% relève l'EMQ moyen de EXACTEMENT
    (poids_K / poids_total) × (100 - X) — plus la vieille formule (100-X)/12
    non pondérée. Les champs classés "not_applicable" (email sur ce funnel
    COD) sont EXCLUS : recommander de « corriger l'email » sur un tunnel qui
    ne le collecte jamais serait un conseil impossible à suivre — d'où la
    demande explicite qu'il n'apparaisse plus dans les recommandations.
    """
    base_emq = components.get("event_match_quality", 0.0) or 0.0
    base = compute_learning_score(components)
    base_score = base["score"]
    total_weight = sum(_MATCH_QUALITY_WEIGHTS.get(key, 1.0) for key, _ in _MATCH_QUALITY_FIELDS) or 1.0

    gains = []
    for key, _label in _MATCH_QUALITY_FIELDS:
        # Un champ structurellement absent de ce funnel (email en COD) ne
        # doit jamais générer une recommandation d'amélioration.
        if _META_FIELD_CLASSIFICATION.get(key, "recommended") == "not_applicable":
            continue
        coverage = field_coverage_pct.get(key)
        if coverage is None or coverage >= 100:
            continue
        weight = _MATCH_QUALITY_WEIGHTS.get(key, 1.0)
        delta_emq = (weight / total_weight) * (100 - coverage)
        hypothetical_emq = min(100.0, base_emq + delta_emq)
        hypothetical = dict(components)
        hypothetical["event_match_quality"] = hypothetical_emq
        new_score = compute_learning_score(hypothetical)["score"]
        gain = round(new_score - base_score, 1)
        if gain > 0:
            gains.append({"field": key, "current_coverage_pct": round(coverage, 1), "gain_points": gain})
    gains.sort(key=lambda g: g["gain_points"], reverse=True)
    return gains


def simulate_learning_score_change(components: dict, changes: dict) -> dict:
    """
    Simulateur "si X passe de A à B, quel gain ?" à valeur cible LIBRE —
    généralisation d'estimate_learning_score_gains (qui suppose toujours
    "porté à 100%") à n'importe quelle cible réaliste (ex: EMQ 60 -> 90,
    Backfill -> 5%). MÊME moteur de calcul (compute_learning_score),
    recalcul réel, jamais une estimation arbitraire.

    `changes` : {clé de compute_learning_score: nouvelle_valeur}, ex.
    {"event_match_quality": 90} ou {"avg_latency_ms": 2000}. Présenté
    explicitement comme une estimation théorique (toutes choses égales par
    ailleurs), jamais une garantie — voir `disclaimer` dans le retour.
    """
    base = compute_learning_score(components)
    hypothetical = {**components, **changes}
    projected = compute_learning_score(hypothetical)
    gain = round(projected["score"] - base["score"], 1)
    return {
        "current_score": base["score"],
        "projected_score": projected["score"],
        "gain_points": gain,
        "changes_simulated": changes,
        "disclaimer": "Estimation théorique basée sur le moteur de scoring actuel, toutes choses égales par ailleurs — pas une garantie de résultat réel, Meta peut réagir différemment selon d'autres facteurs (audience, créa, budget, concurrence).",
    }


# Libellés FR pour les composants du Learning Score (hors event_match_quality,
# volontairement exclu ici — voir rank_recommendations_by_impact).
_COMPONENT_LABELS = {
    "realtime_pct": "Envoi en temps réel", "valid_purchase_pct": "Purchase valides",
    "dedup_pct": "Déduplication", "value_present_pct": "Valeur monétaire (value)",
    "attribution_pct": "Attribution campagne", "latency_score": "Latence d'envoi",
}


def rank_recommendations_by_impact(components: dict, field_coverage_pct: dict) -> list:
    """
    Centre de recommandations — fusionne estimate_learning_score_gains_by_field
    (détail par champ EMQ : FBP, FBC, email, ...) et estimate_learning_score_gains
    (autres composants : temps réel, dédup, valeur, attribution, latence) en
    UNE liste triée par gain réel décroissant, avec une note ★ 1-5. Aucun
    nouveau calcul de gain — uniquement une fusion + présentation des deux
    moteurs déjà existants.

    event_match_quality est explicitement EXCLU des gains par composant ici :
    le détail par champ (FBP/FBC/email/...) EST la version actionnable de ce
    même signal — l'inclure aussi au niveau composant compterait la même
    amélioration deux fois sous deux libellés différents.
    """
    field_gains = estimate_learning_score_gains_by_field(components, field_coverage_pct)
    component_gains = [
        g for g in estimate_learning_score_gains(components) if g["component"] != "event_match_quality"
    ]

    recommendations = []
    for g in field_gains:
        label = dict(_MATCH_QUALITY_FIELDS).get(g["field"], g["field"])
        recommendations.append({
            "action": f"Corriger {label}", "gain_points": g["gain_points"],
            "current": g["current_coverage_pct"], "category": "event_match_quality_field",
        })
    for g in component_gains:
        label = _COMPONENT_LABELS.get(g["component"], g["component"])
        recommendations.append({
            "action": f"Corriger {label}", "gain_points": g["gain_points"],
            "current": g["current"], "category": "learning_score_component",
        })

    recommendations.sort(key=lambda r: r["gain_points"], reverse=True)
    for r in recommendations:
        gp = r["gain_points"]
        stars = 5 if gp >= 8 else 4 if gp >= 5 else 3 if gp >= 3 else 2 if gp >= 1 else 1
        r["stars"] = "★" * stars + "☆" * (5 - stars)
    return recommendations


_MIN_CORRELATION_SAMPLE = 5


def compute_metric_correlation(pairs: list, label_a: str = "A", label_b: str = "B") -> dict:
    """
    Corrélation RÉELLEMENT calculée (coefficient de Pearson, aucune
    bibliothèque externe) entre deux séries de valeurs réelles appariées —
    ex. EMQ quotidien vs CPA quotidien sur le même historique. Ne présuppose
    JAMAIS la direction (EMQ↑→CPA↓ n'est qu'un exemple d'intuition
    courante, pas un fait injecté ici) : le coefficient calculé peut être
    positif, négatif, ou trop faible pour rien affirmer — c'est exactement
    ce que ce module doit refléter honnêtement.

    `pairs` : liste de (valeur_a, valeur_b) déjà réelles (ex. un couple par
    jour d'historique). Sous _MIN_CORRELATION_SAMPLE points, retourne
    "insufficient_data" plutôt qu'un coefficient peu fiable présenté comme
    solide.
    """
    clean = [(a, b) for a, b in pairs if a is not None and b is not None]
    n = len(clean)
    if n < _MIN_CORRELATION_SAMPLE:
        return {
            "coefficient": None, "sample_size": n, "strength": "données insuffisantes",
            "note": f"Seulement {n} point(s) de données comparables — au moins {_MIN_CORRELATION_SAMPLE} nécessaires pour évaluer une corrélation de façon fiable.",
        }

    xs, ys = [p[0] for p in clean], [p[1] for p in clean]
    mean_x, mean_y = sum(xs) / n, sum(ys) / n
    cov = sum((x - mean_x) * (y - mean_y) for x, y in clean)
    var_x = sum((x - mean_x) ** 2 for x in xs)
    var_y = sum((y - mean_y) ** 2 for y in ys)
    if var_x == 0 or var_y == 0:
        return {
            "coefficient": None, "sample_size": n, "strength": "non calculable",
            "note": f"{label_a} ou {label_b} est constant sur la période — aucune variation à corréler.",
        }
    r = round(cov / (var_x ** 0.5 * var_y ** 0.5), 3)

    abs_r = abs(r)
    strength = "forte" if abs_r >= 0.7 else "modérée" if abs_r >= 0.4 else "faible" if abs_r >= 0.2 else "négligeable"
    direction = "positive (évoluent ensemble)" if r > 0 else "négative (évoluent en sens inverse)" if r < 0 else "aucune"

    return {
        "coefficient": r, "sample_size": n, "strength": strength, "direction": direction,
        "note": f"Corrélation {strength} ({direction}) entre {label_a} et {label_b} sur {n} points de données réelles — observation statistique, pas une preuve de causalité.",
    }


def verify_percentage_matches_counter(numerator: int, denominator: int, displayed_pct: float, tolerance: float = 0.15) -> dict:
    """
    Invariant KPI le plus fondamental de tout ce module : un pourcentage
    affiché DOIT toujours être recalculable depuis le compteur/total
    affiché à côté, à un arrondi près. Réutilisé par GET
    /meta-ads/kpi-validation et par les tests — une seule implémentation
    de cette vérification, jamais une par carte du dashboard.

    tolerance en points de pourcentage (0.15 par défaut, absorbe les
    arrondis à 1 décimale déjà appliqués avant stockage/affichage).
    """
    expected_pct = round(numerator / denominator * 100, 1) if denominator else 0.0
    diff = abs(expected_pct - displayed_pct)
    return {
        "expected_pct": expected_pct, "displayed_pct": displayed_pct,
        "numerator": numerator, "denominator": denominator,
        "diff": round(diff, 2), "passed": diff <= tolerance,
    }


# ─── Component scores — decomposition of the Learning Score ─────────────────
# Chaque score ci-dessous réutilise un nombre DÉJÀ calculé ailleurs (voir la
# docstring de compute_component_scores) — jamais un second calcul du même
# signal sous un nom différent. "Tracking" et "Meta Acceptance" mesurent le
# MÊME ratio (success/total_sent) : plutôt que les dupliquer sous deux noms,
# ils sont fusionnés ici en un seul "Meta Acceptance Score" — noté
# explicitement pour ne pas prétendre qu'il s'agit de deux mesures
# distinctes quand elles ne le sont pas dans les données disponibles.
def compute_component_scores(metrics: dict) -> dict:
    """
    Décompose la qualité du pipeline en 6 sous-scores nommés, chacun
    réutilisant un chiffre déjà calculé par une autre fonction de ce
    module — jamais recalculé indépendamment :
      - meta_acceptance : success / total_sent (= "Tracking"/"Meta
        Acceptance" fusionnés — même ratio, un seul nom).
      - matching : event_match_quality (compute_match_quality, déjà EMQ).
      - attribution : attribution_pct (déjà utilisé par compute_learning_score).
      - delivery : 1 - (échecs réseau / total envoyé) — isole la fiabilité
        de NOTRE infrastructure (DNS/TCP/TLS/timeout), distincte de
        l'acceptation applicative par Meta (un échec réseau n'est pas un
        rejet Meta).
      - queue : santé de la file (moins il y a de retry/pending en attente,
        plus haut) — nouveau, pas encore mesuré ailleurs.
      - event_quality : complétude moyenne du payload (les 18 champs de
        evaluate_purchase_signal_quality, un ensemble plus large que les 12
        champs EMQ) — nouveau, distinct de `matching`.

    `metrics` attend : total_sent, success, network_failed,
    retry_pct, pending_pct, event_match_quality, attribution_pct,
    avg_completeness_pct (toutes optionnelles ; absente = 0, jamais ignorée).
    """
    total_sent = metrics.get("total_sent") or 0
    success = metrics.get("success") or 0
    network_failed = metrics.get("network_failed") or 0

    meta_acceptance = round(success / total_sent * 100, 1) if total_sent else 0.0
    delivery = round(max(0.0, 100 - (network_failed / total_sent * 100)), 1) if total_sent else 100.0
    retry_pct = metrics.get("retry_pct") or 0.0
    pending_pct = metrics.get("pending_pct") or 0.0
    queue = round(max(0.0, 100 - (retry_pct * 2 + pending_pct)), 1)

    return {
        "meta_acceptance": meta_acceptance,
        "matching": round(metrics.get("event_match_quality") or 0.0, 1),
        "attribution": round(metrics.get("attribution_pct") or 0.0, 1),
        "delivery": delivery,
        "queue": queue,
        "event_quality": round(metrics.get("avg_completeness_pct") or 0.0, 1),
    }


# Volume hebdomadaire de référence pour juger un volume d'événements
# "suffisant" — même repère que VOLUME_INSUFFISANT dans
# get_learning_diagnostics (~50 conversions/semaine, indicatif Meta pour
# sortir de la phase d'apprentissage), pas un second seuil inventé.
_VOLUME_ADEQUACY_WEEKLY_BENCHMARK = 50.0


def _volume_adequacy_score(weekly_rate: Optional[float]) -> float:
    """0-100 : weekly_rate atteint ou dépasse le repère -> 100, sinon proportionnel. None -> 0 (donnée non mesurée, jamais gonflée)."""
    if not weekly_rate:
        return 0.0
    return round(min(100.0, weekly_rate / _VOLUME_ADEQUACY_WEEKLY_BENCHMARK * 100), 1)


_META_OPTIMIZATION_WEIGHTS = {
    # learning_score encapsule DÉJÀ EMQ/temps réel/backfill(inverse)/dedup/
    # valeur/attribution/latence (voir compute_learning_score) — repris ici
    # tel quel plutôt que re-pondérer ses composants un par un, ce qui les
    # compterait deux fois.
    "learning_score": 0.40,
    "meta_acceptance": 0.20,   # component_scores — taux d'acceptation Meta
    "queue": 0.15,             # component_scores — santé retry/pending
    "event_quality": 0.15,     # component_scores — complétude payload (18 champs, pas seulement les 12 EMQ)
    "volume_adequacy": 0.10,   # NOUVEAU — moyenne Purchase/AddToCart/Checkout vs repère hebdomadaire
}


def compute_meta_optimization_score(learning_score: float, component_scores: dict, volume_weekly_rates: dict) -> dict:
    """
    Meta Optimization Advisor — score global /100, réutilisant TOUJOURS des
    nombres déjà calculés ailleurs (learning_score de compute_learning_score,
    component_scores de compute_component_scores) plutôt que de re-dériver
    EMQ/temps réel/backfill/attribution une seconde fois sous ce nouveau
    nom. La seule vraie nouveauté ici est volume_adequacy (Purchase/
    AddToCart/Checkout par semaine vs le repère ~50/semaine déjà utilisé
    par get_learning_diagnostics).

    volume_weekly_rates attend les clés "purchase", "addtocart", "checkout"
    (taux hebdomadaire réel, ou None si non mesuré — jamais fabriqué).
    """
    volume_scores = [
        _volume_adequacy_score(volume_weekly_rates.get(k))
        for k in ("purchase", "addtocart", "checkout")
        if volume_weekly_rates.get(k) is not None
    ]
    volume_adequacy = round(sum(volume_scores) / len(volume_scores), 1) if volume_scores else 0.0

    components = {
        "learning_score": learning_score,
        "meta_acceptance": component_scores.get("meta_acceptance", 0.0),
        "queue": component_scores.get("queue", 0.0),
        "event_quality": component_scores.get("event_quality", 0.0),
        "volume_adequacy": volume_adequacy,
    }
    score = round(sum(components[k] * w for k, w in _META_OPTIMIZATION_WEIGHTS.items()), 1)

    # Explication détaillée — les composants les plus faibles, dans l'ordre,
    # jamais une liste de conseils génériques.
    ranked = sorted(components.items(), key=lambda kv: kv[1])
    weakest = [{"component": k, "value": v, "weight": _META_OPTIMIZATION_WEIGHTS[k]} for k, v in ranked if v < 80]

    return {
        "score": score,
        "label": meta_optimization_label(score),
        "components": components,
        "weights": _META_OPTIMIZATION_WEIGHTS,
        "weakest_components": weakest,
    }


# ─── Meta Response Analyzer ──────────────────────────────────────────────────
# Motifs texte tirés des messages d'erreur RÉELLEMENT documentés par l'API
# Graph de Meta (OAuthException = token, "Object does not exist" = pixel/
# dataset invalide, "duplicate" = event déjà reçu, "Invalid parameter" =
# paramètre manquant/malformé). Classification heuristique par
# correspondance de texte — jamais garantie à 100%, présentée comme telle
# (`confidence`), jamais comme un diagnostic certain.
_META_ERROR_PATTERNS = [
    ("token_expire", ["oauthexception", "access token", "session has expired", "token expired", "invalid access token"],
     "Token expiré ou invalide", "Régénérer un token d'accès système avec la permission ads_management."),
    ("pixel_not_found", ["does not exist", "unknown pixel", "invalid pixel"],
     "Pixel ou dataset introuvable", "Vérifier le Pixel ID dans la configuration Meta Ads — il a peut-être été supprimé ou appartient à un autre compte."),
    ("duplicate_event", ["duplicate", "already received", "already processed"],
     "Événement déjà reçu par Meta (déduplication)", "Normal si un retry a réussi après un timeout apparent côté serveur — vérifier qu'aucun double comptage n'en résulte."),
    ("missing_param", ["missing", "required parameter", "param is required"],
     "Paramètre obligatoire manquant", "Vérifier le payload envoyé (voir evaluate_purchase_signal_quality pour ce Purchase)."),
    ("bad_currency", ["currency", "invalid for event"],
     "Devise invalide pour ce compte publicitaire", "Vérifier MetaAdsConfig.currency — doit correspondre à la devise réelle du compte pub Meta."),
    ("invalid_value", ["invalid value", "value must be"],
     "Valeur invalide (value/quantité)", "Vérifier order.total et les quantités d'articles de cette commande."),
    ("rate_limit", ["rate limit", "too many calls"],
     "Limite de débit Meta atteinte", "Réduire la fréquence d'envoi ou espacer les tentatives — géré par le circuit breaker existant."),
]


def analyze_meta_response(error_message: Optional[str], error_category: Optional[str] = None, http_status: Optional[int] = None) -> dict:
    """
    Classifie un échec CAPI à partir du message d'erreur RÉELLEMENT reçu de
    Meta (jamais inventé) — la Meta Response Analyzer demandée. Retourne
    `unknown_error` avec confidence=None plutôt que de forcer une
    correspondance quand rien ne matche : mieux vaut "cause inconnue,
    vérifier manuellement" qu'un faux diagnostic.
    """
    if not error_message:
        if http_status and 500 <= http_status < 600:
            return {"category": "temporary_meta_error", "label": "Erreur temporaire côté Meta",
                    "fix": "Aucune action requise — le circuit de retry existant reprendra automatiquement.", "confidence": "high"}
        return {"category": "unknown", "label": "Aucune erreur — envoi réussi ou statut non déterminé", "fix": None, "confidence": None}

    text = error_message.lower()
    for category, needles, label, fix in _META_ERROR_PATTERNS:
        if any(needle in text for needle in needles):
            return {"category": category, "label": label, "fix": fix, "confidence": "medium"}

    if error_category == "network_timeout" or error_category == "network_error":
        return {"category": "network_issue", "label": "Problème réseau (pas une erreur Meta applicative)",
                "fix": "Vérifier la connectivité sortante du serveur (Santé du Pixel).", "confidence": "high"}
    if http_status and 500 <= http_status < 600:
        return {"category": "temporary_meta_error", "label": "Erreur temporaire côté Meta",
                "fix": "Aucune action requise — le circuit de retry existant reprendra automatiquement.", "confidence": "high"}

    return {"category": "unknown_error", "label": "Cause non reconnue automatiquement",
            "fix": "Consulter le message d'erreur brut dans les logs CAPI pour un diagnostic manuel.", "confidence": None}


# ─── Drift / regression / anomaly detection ──────────────────────────────────
# UNE seule fonction pour les 3 demandes "Signal Drift", "Learning Score
# Regression" et "Détection d'anomalies" — ce sont la MÊME opération
# (comparer deux instantanés du même ensemble de métriques et signaler les
# écarts significatifs), jamais 3 fonctions quasi identiques.
_REGRESSION_THRESHOLDS = {
    "learning_score": {"drop": 5, "label": "Learning Score", "severity": "high",
                        "cause": "Baisse combinée d'un ou plusieurs composants (EMQ, temps réel, dédup, valeur, attribution, latence).",
                        "action": "Consulter les gains estimés par champ/composant (Centre de recommandations) pour identifier la cause exacte."},
    "event_match_quality": {"drop": 5, "label": "Event Match Quality (EMQ)", "severity": "high",
                             "cause": "Un ou plusieurs champs de matching (email/téléphone/FBP/FBC/IP/UA/...) manquent désormais plus souvent qu'avant.",
                             "action": "Voir likely_cause ci-dessous (champ EMQ ayant le plus chuté) et le Centre de recommandations pour le corriger en priorité."},
    "valid_purchase_pct": {"drop": 5, "label": "Purchase valides", "severity": "high",
                            "cause": "Davantage d'échecs/rejets définitifs sur les envois CAPI récents.",
                            "action": "Vérifier la Santé du Pixel (token/scopes) et les derniers messages d'erreur via le Meta Response Analyzer."},
    "realtime_pct": {"drop": 10, "label": "Temps réel", "severity": "medium",
                      "cause": "Plus d'envois basculent en rattrapage (backfill) qu'avant — file d'attente ou connectivité dégradée.",
                      "action": "Vérifier la file CAPI (retries, latence) et la connectivité sortante du serveur."},
    "backfill_pct": {"rise": 10, "label": "Backfill", "severity": "medium",
                      "cause": "L'envoi temps réel échoue plus souvent, forçant un rattrapage a posteriori.",
                      "action": "Fiabiliser l'envoi temps réel (voir file CAPI et connectivité) pour réduire la dépendance au rattrapage."},
    "retry_pct": {"rise": 5, "label": "Retry", "severity": "medium",
                  "cause": "Erreurs transitoires (réseau ou 5xx Meta) plus fréquentes sur les envois récents.",
                  "action": "Consulter le Meta Response Analyzer sur les dernières erreurs pour distinguer panne réseau vs erreur Meta."},
    "rejected_pct": {"rise": 2, "label": "Purchase rejetés", "severity": "high",
                      "cause": "Erreurs non-retryables (4xx) en hausse — souvent un token/scope invalide ou un payload malformé.",
                      "action": "Vérifier la Santé du Pixel (token/scopes) puis relancer via Bons d'Achat."},
    "avg_latency_ms": {"rise": 5000, "label": "Latence moyenne", "severity": "medium",
                        "cause": "La file CAPI met plus de temps à traiter chaque événement (charge, connectivité, ou volume).",
                        "action": "Vérifier la charge de la file CAPI et la connectivité sortante du serveur."},
    "dedup_pct": {"drop": 5, "label": "Déduplication", "severity": "medium",
                  "cause": "Des event_id apparaissent en double plus souvent — signal anormal si la contrainte d'unicité est respectée.",
                  "action": "Investiguer manuellement via Bons d'Achat > Meta Queue > CAPI Logs pour ces event_id."},
    # Métriques de performance campagne — mode "relative" (pourcentage de
    # variation) plutôt qu'un delta absolu : un CPA/ROAS/fréquence n'a pas
    # la même échelle qu'un score /100, un seuil absolu serait arbitraire
    # d'une boutique à l'autre. 20% est un repère indicatif (documenté
    # comme tel dans detect_metric_regressions), pas un seuil Meta officiel.
    "cpa": {"rise_pct": 20, "label": "CPA (coût par achat)", "severity": "high", "mode": "relative",
            "cause": "Coût par acquisition en hausse — dépense stable/en hausse pour moins d'achats, ou enchères plus chères.",
            "action": "Vérifier fréquence (fatigue créative), CTR (créa), et la qualité des signaux envoyés (EMQ/Learning Score)."},
    "roas": {"drop_pct": 20, "label": "ROAS", "severity": "high", "mode": "relative",
             "cause": "Le retour sur dépense publicitaire baisse — moins de valeur générée pour le même budget.",
             "action": "Croiser avec le CPA et la fréquence pour identifier si c'est un problème de coût, de conversion, ou de fatigue créative."},
    "frequency": {"rise_pct": 20, "label": "Fréquence publicitaire", "severity": "medium", "mode": "relative",
                  "cause": "La même audience revoit la publicité plus souvent — signe de fatigue créative ou d'audience trop restreinte.",
                  "action": "Élargir l'audience, renouveler les créas, ou plafonner la fréquence."},
    "impressions": {"drop_pct": 30, "label": "Impressions", "severity": "medium", "mode": "relative",
                     "cause": "Meta diffuse moins — budget épuisé, enchères non compétitives, ou audience saturée.",
                     "action": "Vérifier le budget restant, l'état de diffusion et la fréquence dans Meta Ads Manager."},
    "ctr": {"drop_pct": 20, "label": "CTR", "severity": "medium", "mode": "relative",
            "cause": "Le créa ou le ciblage accroche moins qu'avant.",
            "action": "Tester d'autres visuels/accroches ou revoir le ciblage."},
}


def detect_metric_regressions(previous: dict, current: dict, field_coverage_previous: Optional[dict] = None,
                                field_coverage_current: Optional[dict] = None) -> list:
    """
    Compare deux instantanés du même jeu de métriques (ex : hier vs
    aujourd'hui, ou toute paire de fenêtres) et signale chaque écart au-delà
    du seuil documenté dans _REGRESSION_THRESHOLDS — jamais un seuil choisi
    au hasard, chacun est une baisse/hausse déjà jugée significative
    ailleurs dans ce module. Si `field_coverage_previous/current` (les 12
    champs EMQ) sont fournis ET que event_match_quality a baissé, identifie
    en plus la cause probable (quel champ a le plus chuté) — répond
    directement à "identifier la cause : perte des FBP, etc." sans dupliquer
    field_coverage lui-même.

    Ne fabrique jamais un chiffre : si une métrique est absente d'un des
    deux instantanés, elle est simplement ignorée plutôt que traitée comme 0
    (jamais un delta relatif calculé contre zéro non plus).

    mode="relative" (cpa/roas/frequency/impressions/ctr) compare un
    pourcentage de VARIATION (rise_pct/drop_pct) plutôt qu'un delta de
    points absolu — nécessaire car ces métriques n'ont pas d'échelle fixe
    0-100 comparable d'une boutique à l'autre.
    """
    regressions = []
    for key, rule in _REGRESSION_THRESHOLDS.items():
        prev_val = previous.get(key)
        cur_val = current.get(key)
        if prev_val is None or cur_val is None:
            continue
        if rule.get("mode") == "relative":
            if not prev_val:
                continue
            pct_change = round((cur_val - prev_val) / prev_val * 100, 1)
            if "rise_pct" in rule and pct_change >= rule["rise_pct"]:
                regressions.append({
                    "metric": key, "label": rule["label"], "direction": "rise",
                    "previous": prev_val, "current": cur_val, "pct_change": pct_change,
                    "severity": rule["severity"],
                    "message": f"{rule['label']} a augmenté de {pct_change}% ({prev_val} → {cur_val}).",
                    "probable_cause": rule.get("cause"), "recommended_action": rule.get("action"),
                })
            elif "drop_pct" in rule and pct_change <= -rule["drop_pct"]:
                regressions.append({
                    "metric": key, "label": rule["label"], "direction": "drop",
                    "previous": prev_val, "current": cur_val, "pct_change": pct_change,
                    "severity": rule["severity"],
                    "message": f"{rule['label']} a baissé de {abs(pct_change)}% ({prev_val} → {cur_val}).",
                    "probable_cause": rule.get("cause"), "recommended_action": rule.get("action"),
                })
            continue
        delta = cur_val - prev_val
        if "drop" in rule and delta <= -rule["drop"]:
            entry = {
                "metric": key, "label": rule["label"], "direction": "drop",
                "previous": prev_val, "current": cur_val, "delta": round(delta, 1),
                "severity": rule["severity"],
                "message": f"{rule['label']} a baissé de {abs(round(delta, 1))} ({prev_val} → {cur_val}).",
                "probable_cause": rule.get("cause"), "recommended_action": rule.get("action"),
            }
            if key == "event_match_quality" and field_coverage_previous and field_coverage_current:
                entry["likely_cause"] = _biggest_field_coverage_drop(field_coverage_previous, field_coverage_current)
            regressions.append(entry)
        elif "rise" in rule and delta >= rule["rise"]:
            regressions.append({
                "metric": key, "label": rule["label"], "direction": "rise",
                "previous": prev_val, "current": cur_val, "delta": round(delta, 1),
                "severity": rule["severity"],
                "message": f"{rule['label']} a augmenté de {round(delta, 1)} ({prev_val} → {cur_val}).",
                "probable_cause": rule.get("cause"), "recommended_action": rule.get("action"),
            })
    severity_order = {"high": 0, "medium": 1, "low": 2}
    regressions.sort(key=lambda r: severity_order.get(r["severity"], 3))
    return regressions


def _biggest_field_coverage_drop(previous: dict, current: dict) -> Optional[str]:
    """Le champ EMQ (fbp/fbc/email/...) dont la couverture a le plus chuté entre deux instantanés, ou None si aucun n'a baissé."""
    worst_key, worst_drop = None, 0.0
    for key, label in _MATCH_QUALITY_FIELDS:
        prev_cov = previous.get(key)
        cur_cov = current.get(key)
        if prev_cov is None or cur_cov is None:
            continue
        drop = prev_cov - cur_cov
        if drop > worst_drop:
            worst_drop, worst_key = drop, label
    return f"{worst_key} (-{round(worst_drop, 1)} points)" if worst_key else None


# ─── Meta Best Practices Validator ───────────────────────────────────────────
def evaluate_best_practices_compliance(signal_eval: dict) -> dict:
    """
    Verdict de conformité (Conforme / Partiellement conforme / Non
    conforme) à partir du résultat DÉJÀ produit par
    evaluate_purchase_signal_quality — ne re-vérifie rien depuis zéro,
    seulement une lecture de synthèse de ce diagnostic existant.
    """
    if signal_eval.get("blocking_errors"):
        return {"verdict": "Non conforme", "reason": "au moins une erreur bloquante (valeur négative, devise invalide, event_time hors fenêtre...)."}
    completeness = signal_eval.get("completeness_pct", 0.0)
    match_score = signal_eval.get("match_score", 0.0)
    if completeness >= 90 and match_score >= 80 and not signal_eval.get("warnings"):
        return {"verdict": "Conforme", "reason": f"complétude {completeness}%, Event Match Quality {match_score}%, aucun avertissement."}
    return {"verdict": "Partiellement conforme",
            "reason": f"complétude {completeness}%, Event Match Quality {match_score}%" +
                      (f", {len(signal_eval.get('warnings', []))} avertissement(s)" if signal_eval.get("warnings") else ".")}


# ─── Alertes intelligentes ───────────────────────────────────────────────────
_ALERT_RULES = [
    ("event_match_quality", "lt", 80, "critical", "EMQ sous 80% — dégrade sévèrement l'optimisation Meta."),
    ("tracking_coverage", "lt", 95, "warning", "Couverture de tracking sous 95%."),
    ("learning_score", "lt", 80, "warning", "Learning Score sous 80."),
    ("backfill_pct", "gt", 10, "warning", "Plus de 10% des envois sont du rattrapage (backfill)."),
    ("retry_pct", "gt", 2, "warning", "Plus de 2% des envois nécessitent un retry."),
    ("rejected_pct", "gt", 1, "critical", "Plus de 1% des Purchase sont rejetés définitivement."),
    ("avg_latency_ms", "gt", 5000, "warning", "Latence moyenne supérieure à 5 secondes."),
]
_ALERT_LEVEL_LABELS = {"info": "Information", "warning": "Attention", "critical": "Critique"}


def generate_signal_alerts(metrics: dict) -> list:
    """
    Alertes à seuils fixes (exactement ceux demandés : EMQ<80, Tracking<95,
    Learning<80, Backfill>10%, Retry>2%, Failed>1%, Latence>5s) sur des
    métriques déjà calculées ailleurs — ne recalcule rien, ne fabrique
    aucun chiffre. Une métrique absente ne déclenche simplement pas sa
    règle plutôt que d'être traitée comme 0.
    """
    alerts = []
    for key, op, threshold, level, message in _ALERT_RULES:
        value = metrics.get(key)
        if value is None:
            continue
        triggered = value < threshold if op == "lt" else value > threshold
        if triggered:
            alerts.append({
                "metric": key, "level": level, "level_label": _ALERT_LEVEL_LABELS[level],
                "value": value, "threshold": threshold, "message": message,
            })
    severity_order = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: severity_order.get(a["level"], 3))
    return alerts


# ─── Funnel bottleneck detector ──────────────────────────────────────────────
# Repères indicatifs (pas des seuils officiels Meta) pour interpréter un
# funnel déjà mesuré avec des données 100% réelles (GET /meta-ads/funnel) —
# cette fonction ne calcule AUCUN chiffre elle-même, elle ne fait
# qu'interpréter des ratios déjà réels. AddToCart n'est pas un événement
# distinct dans ce système (funnel va de ViewContent à InitiateCheckout
# directement) — jamais présenté comme mesuré s'il ne l'est pas.
_FUNNEL_TRANSITIONS = [
    ("Impressions", "Clics", 1.0, "Créatif ou ciblage publicitaire", "Le clic n'accroche pas assez — tester d'autres visuels/accroches ou revoir le ciblage."),
    ("Clics", "Vues Produit", 50.0, "Landing page / temps de chargement", "Beaucoup de clics n'aboutissent jamais à une vue produit — vérifier la vitesse de chargement et la cohérence pub → page."),
    ("Vues Produit", "Paiement Initié", 10.0, "Fiche produit", "Peu de visiteurs déclenchent un paiement — vérifier prix, avis, photos, argumentaire de la fiche produit."),
    ("Paiement Initié", "Achats", 30.0, "Tunnel de checkout", "Beaucoup de paiements initiés n'aboutissent pas — vérifier frais de livraison visibles tôt, simplicité du formulaire, rapidité de confirmation téléphonique."),
    ("Achats", "Livrées", 80.0, "Livraison / confirmation", "Trop de commandes ne sont jamais livrées — vérifier le transporteur et le taux de rejet à la livraison."),
]


def detect_funnel_bottleneck(stages: list) -> dict:
    """
    Identifie l'étape du funnel où le taux de passage réel est le plus en
    dessous de son repère indicatif — "le" goulot d'étranglement, pas une
    liste de tous les écarts. `stages` = la liste EXACTE déjà renvoyée par
    GET /meta-ads/funnel ([{name, count}, ...]) — aucune donnée recalculée
    depuis zéro, seulement les ratios entre étapes consécutives déjà comptées.
    """
    counts = {s["name"]: s["count"] for s in (stages or [])}
    candidates = []
    for from_stage, to_stage, threshold_pct, cause, fix in _FUNNEL_TRANSITIONS:
        from_count = counts.get(from_stage)
        to_count = counts.get(to_stage)
        if not from_count:
            continue
        rate_pct = round((to_count or 0) / from_count * 100, 2)
        gap = threshold_pct - rate_pct
        if gap > 0:
            candidates.append({
                "from_stage": from_stage, "to_stage": to_stage,
                "rate_pct": rate_pct, "benchmark_pct": threshold_pct,
                "gap_points": round(gap, 2), "likely_cause": cause, "fix": fix,
            })
    if not candidates:
        return {"bottleneck": None, "message": "Aucune étape du funnel n'est en dessous de son repère indicatif sur la période.", "all_gaps": []}
    candidates.sort(key=lambda c: c["gap_points"], reverse=True)
    worst = candidates[0]
    return {
        "bottleneck": worst,
        "message": f"Goulot d'étranglement : {worst['from_stage']} → {worst['to_stage']} ({worst['rate_pct']}%, repère indicatif {worst['benchmark_pct']}%) — {worst['likely_cause']}.",
        "all_gaps": candidates,
    }


def enqueue_purchase_for_order(db: Session, order) -> Optional[str]:
    """
    Durable-queue entry point — call this from the SAME db session/
    transaction as the order's own commit, BEFORE background_tasks.add_task
    is scheduled. Writes a status='queued' meta_capi_logs row that survives
    a process crash between "order committed" and "background task ran":
    on restart, app.main.resume_pending_queues picks up any row still
    'queued' and replays it. Does NOT commit — the caller commits together
    with the order so both succeed or both roll back atomically.

    Returns the new log row id, or None if a Purchase row already exists
    for this order (idempotent no-op; also enforced at the DB level by
    uq_meta_capi_purchase_per_order), or if the order is a MERGED duplicate
    (a merged child is never the real sale — Meta must count the active
    parent, which already carries the absorbed value; queueing a Purchase
    for the child here is exactly the historical bug that inflated Meta's
    count above the ERP's real order count. Centralized here so every call
    site is protected, not just the ones that remembered to check).
    """
    from app.models.marketing import MetaCapiLog

    if str(getattr(order, "status", "")) == "MERGED":
        logger.info("[MetaCAPI] skip enqueue: order=%s is MERGED (duplicate) — parent already carries the value", order.id)
        return None

    existing = (
        db.query(MetaCapiLog.id)
        .filter(MetaCapiLog.order_id == str(order.id), MetaCapiLog.event_name == "Purchase")
        .first()
    )
    if existing:
        return None

    log_id = str(uuid.uuid4())
    db.add(MetaCapiLog(
        id=log_id,
        store_id=str(order.store_id),
        order_id=str(order.id),
        event_name="Purchase",
        event_id=purchase_event_id(str(order.order_number or order.id)),
        status="queued",
        retry_count=0,
    ))
    return log_id


def _claim_queue_row(db: Session, order_id: str) -> "Optional[Any]":
    """
    Atomically claims the Purchase row for this order: queued/retry ->
    processing, in a single UPDATE ... WHERE status IN (...) statement.
    Returns the claimed row (already committed as 'processing') if THIS
    call won the claim, or None if it's already being handled (by another
    worker, another concurrent trigger, or already finished) — the caller
    must then skip sending, which is what makes concurrent triggers/workers
    safe without relying on the Meta-side dedup alone.
    """
    from sqlalchemy import update as sa_update
    from app.models.marketing import MetaCapiLog

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    result = db.execute(
        sa_update(MetaCapiLog.__table__)
        .where(MetaCapiLog.order_id == order_id, MetaCapiLog.event_name == "Purchase",
               MetaCapiLog.status.in_(("queued", "retry")))
        .values(status="processing", processing_started_at=now, processing_worker=_worker_id())
    )
    db.commit()
    if result.rowcount != 1:
        return None
    return db.query(MetaCapiLog).filter(
        MetaCapiLog.order_id == order_id, MetaCapiLog.event_name == "Purchase",
    ).first()


def send_purchase_for_order(
    order_id: str,
    *,
    client_ip: Optional[str],
    user_agent: Optional[str],
) -> None:
    """
    Worker entry point (called from BackgroundTasks OR from the startup/
    periodic recovery sweep — same function either way, so behavior is
    identical regardless of who triggers it).

    queued/retry -> processing -> success | retry | failed | skipped

    Every branch is logged BEFORE any Meta network call, so a crash mid-send
    still leaves a 'processing' row on disk (reclaimed as stuck after 15min
    by the sweep) rather than nothing at all.
    """
    from app.db.session import SessionLocal
    from app.models.marketing import MetaAdsConfig
    from app.models.order import Order

    db = SessionLocal()
    try:
        logger.info("[MetaCAPI] queue: claim attempt order=%s worker=%s", order_id, _worker_id())
        row = _claim_queue_row(db, order_id)
        if row is None:
            logger.info("[MetaCAPI] queue: order=%s not claimable (already processing/finished elsewhere) — skipped", order_id)
            return

        logger.info("[MetaCAPI] queue: processing order=%s log_id=%s", order_id, row.id)
        _handle_claimed_row(db, row, order_id, client_ip=client_ip, user_agent=user_agent)
    finally:
        db.close()


def _handle_claimed_row(db: Session, row, order_id: str, *, client_ip: Optional[str], user_agent: Optional[str]) -> None:
    """
    Split out from send_purchase_for_order so unexpected exceptions here
    (bad order data, a lazy-load failure, a bug in build_purchase_event —
    anything past the claim) are caught and turned into a 'failed' row
    instead of propagating. Uncaught here, this would blow past the
    sweep's per-row loop and abort the WHOLE batch mid-iteration — every
    other order still due in that sweep run would silently wait an extra
    interval for no reason related to their own send. The claim itself
    already succeeded (row is 'processing'), so on ANY exception here the
    row is explicitly finalized rather than left for the 15-minute stuck-
    processing reclaim to eventually notice.
    """
    from app.models.marketing import MetaAdsConfig
    from app.models.order import Order

    try:
        order = db.query(Order).filter(Order.id == order_id).first()
        if not order:
            row.status = "failed"
            row.error_message = "order not found"
            row.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
            logger.warning("[MetaCAPI] queue: order=%s failed — order row missing", order_id)
            return

        # Never report a Purchase Meta shouldn't count:
        # - MANUAL/POS: created by an agent/admin, no ad click, no Pixel ever
        #   fired — sending CAPI made Meta count sales the LP module
        #   deliberately excludes from conversion, widening the Meta-vs-ERP gap.
        # - MERGED: duplicate submission absorbed into its parent (the parent
        #   already sent its own Purchase).
        if (order.source or "").upper() in ("MANUAL", "POS") or str(order.status) == "MERGED":
            row.status = "skipped"
            row.error_message = f"source={order.source} status={order.status}"
            row.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
            logger.info("[MetaCAPI] queue: order=%s skipped (source=%s status=%s)", order_id, order.source, order.status)
            return

        config = _get_meta_config_cached(db, order.store_id)
        if not config or not config["pixel_id"] or not config["access_token"] or len(config["access_token"]) < 15:
            row.status = "skipped"
            row.error_message = "no valid meta config"
            row.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
            logger.warning("[MetaCAPI] queue: order=%s skipped — no valid Meta config", order_id)
            return

        effective_client_ip, effective_user_agent = resolve_client_context(order, client_ip, user_agent)

        event = build_purchase_event(
            order, client_ip=effective_client_ip, user_agent=effective_user_agent,
            ad_currency=config["currency"] or "DZD",
            exchange_rate=config["exchange_rate"] if config["exchange_rate"] else 1.0,
        )

        # Contrôle avant envoi — jamais un blocage (aucune donnée n'est
        # jamais inventée ou complétée par une valeur fictive ici ; tout ce
        # qui peut réellement être récupéré l'est déjà dans
        # build_purchase_event/build_user_data ci-dessus, depuis order/
        # config, la seule "optimisation automatique" honnête possible).
        # Seul un signal faible est journalisé, pour que la cause soit
        # visible dans les logs au moment même de l'envoi plutôt que
        # découverte seulement lors d'un scan a posteriori.
        # event_id ne peut PAS être vérifié "unique" par une requête ici sans
        # ajouter un scan non indexé par envoi (event_id n'a aucun index —
        # contraire à la contrainte "aucune augmentation importante des
        # requêtes SQL / index optimisés"). La garantie vient de la
        # CONSTRUCTION, plus forte qu'une vérification runtime : event_id
        # est dérivé déterministiquement d'order_number (unique en base), et
        # uq_meta_capi_purchase_per_order empêche la même commande d'avoir
        # deux lignes Purchase. Les doublons RÉELS (payload corrompu, ligne
        # pré-contrainte) restent détectés par le scan groupé déjà existant
        # (Signal Quality Center, anomalie EVENT_ID_DUPLIQUE).
        _signal_eval = evaluate_purchase_signal_quality(event)
        if _signal_eval["blocking_errors"]:
            logger.error(
                "[MetaCAPI] order=%s erreurs bloquantes avant envoi — %s",
                order_id, _signal_eval["blocking_errors"],
            )
        if _signal_eval["match_score"] < 50 or _signal_eval["completeness_pct"] < 70:
            logger.warning(
                "[MetaCAPI] order=%s faible qualité de signal avant envoi — match_score=%.1f completeness=%.1f%% champs manquants=%s warnings=%s",
                order_id, _signal_eval["match_score"], _signal_eval["completeness_pct"],
                _signal_eval["missing_fields"], _signal_eval["warnings"],
            )

        result = send_events(
            config["pixel_id"], config["access_token"], [event],
            store_label=order.store.name if order.store else str(order.store_id),
            order_label=f"#{order.order_number}",
        )

        # Réponse Meta persistée dans le JSON payload déjà existant (clé
        # _meta_response) plutôt que dans de nouvelles colonnes — pas de
        # migration nécessaire pour conserver http_status/fbtrace_id/erreur
        # même sur un envoi réussi (avant : fbtrace_id n'était JAMAIS stocké,
        # seulement loggé en texte, perdu après rotation des logs).
        _meta_response_meta = {
            "http_status": result.get("http_status"),
            "fbtrace_id": result.get("fbtrace_id"),
            "events_received": result.get("events_received"),
            "error": result.get("error"),
            "error_category": result.get("error_category"),
        }
        event_with_response = {**event, "_meta_response": _meta_response_meta}

        if result["success"]:
            row.status = "success"
            row.events_received = result["events_received"]
            row.latency_ms = result.get("latency_ms")
            row.last_http_status = result.get("http_status")
            row.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
            row.error_message = None
            # Stocké aussi en succès (avant : seulement sur échec/retry) — sans
            # ça, l'Event Match Quality est incalculable après coup pour
            # n'importe quel envoi réussi, la grande majorité des lignes.
            row.payload = event_with_response
            db.commit()
            logger.info(
                "[MetaCAPI] queue: order=%s SUCCESS event_id=%s received=%s fbtrace=%s",
                order.order_number, event["event_id"], result["events_received"], result.get("fbtrace_id"),
            )
        elif result.get("retryable"):
            row.error_message = result["error"]
            row.error_category = result.get("error_category")
            row.last_http_status = result.get("http_status")
            row.payload = event_with_response
            row.retry_count = (row.retry_count or 0) + 1
            _diagnosis = analyze_meta_response(result.get("error"), result.get("error_category"), result.get("http_status"))
            if row.retry_count >= _MAX_QUEUE_RETRIES:
                row.status = "failed"
                row.next_retry_at = None
                row.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
                db.commit()
                logger.error(
                    "[MetaCAPI] queue: order=%s retry budget exhausted (%d attempts) — FAILED event_id=%s: %s (diagnostic: %s)",
                    order.order_number, row.retry_count, event["event_id"], result["error"], _diagnosis["label"],
                )
            else:
                row.status = "retry"
                idx = min(row.retry_count - 1, len(_QUEUE_BACKOFF_MINUTES) - 1)
                row.next_retry_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=_QUEUE_BACKOFF_MINUTES[idx])
                db.commit()
                logger.warning(
                    "[MetaCAPI] queue: order=%s RETRY (%d/%d) event_id=%s next_retry_at=%s: %s (diagnostic: %s)",
                    order.order_number, row.retry_count, _MAX_QUEUE_RETRIES, event["event_id"], row.next_retry_at, result["error"], _diagnosis["label"],
                )
        else:
            row.status = "failed"
            row.error_message = result["error"]
            row.error_category = result.get("error_category")
            row.last_http_status = result.get("http_status")
            row.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
            # Avant : payload jamais stocké sur un échec immédiat (4xx non
            # retryable) — impossible de reconstruire ensuite ce qui avait
            # réellement été envoyé pour ce Purchase précis.
            row.payload = event_with_response
            _diagnosis = analyze_meta_response(result.get("error"), result.get("error_category"), result.get("http_status"))
            db.commit()
            logger.error(
                "[MetaCAPI] queue: order=%s FAILED event_id=%s: %s (diagnostic: %s — %s)",
                order.order_number, event["event_id"], result["error"], _diagnosis["label"], _diagnosis["fix"],
            )
    except Exception as exc:
        db.rollback()
        try:
            row.status = "failed"
            row.error_message = f"unexpected exception: {exc}"[:1000]
            row.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
        except Exception:
            db.rollback()
        logger.exception("[MetaCAPI] queue: order=%s unexpected exception while processing claimed row", order_id)


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
        .filter(MetaCapiLog.status.in_(("pending_retry", "retry")))
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


_STUCK_PROCESSING_MINUTES = 15


def _reclaim_stuck_processing(db: "Session") -> int:
    """
    A worker that dies mid-send (container killed by a redeploy) leaves its
    row stuck at status='processing' forever — nothing else would ever pick
    it back up, since the claim query only matches 'queued'/'retry'. One
    batched UPDATE (no N+1: not one row fetched then one UPDATE per row)
    puts every row stuck beyond _STUCK_PROCESSING_MINUTES back into 'retry'
    so the normal sweep picks it up next.
    """
    from sqlalchemy import update as sa_update
    from app.models.marketing import MetaCapiLog

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=_STUCK_PROCESSING_MINUTES)
    result = db.execute(
        sa_update(MetaCapiLog.__table__)
        .where(MetaCapiLog.status == "processing", MetaCapiLog.processing_started_at < cutoff)
        .values(status="retry", error_message="reclaimed: stuck in processing > 15min (worker likely died mid-send)",
                next_retry_at=datetime.now(timezone.utc).replace(tzinfo=None))
    )
    db.commit()
    if result.rowcount:
        logger.warning("[MetaCAPI] reclaimed %d row(s) stuck in 'processing' beyond %dmin", result.rowcount, _STUCK_PROCESSING_MINUTES)
    return result.rowcount


def _retry_pending_events_inner() -> None:
    from app.db.session import SessionLocal
    from app.models.marketing import MetaCapiLog

    db = SessionLocal()
    try:
        _check_queue_backlog(db)
        _reclaim_stuck_processing(db)

        now = datetime.now(timezone.utc)
        # 'queued'/'retry' are the durable-queue statuses this sweep now
        # owns end-to-end; 'pending_retry' is kept for backward
        # compatibility with rows written by the pre-durable-queue pipeline
        # (never backfilled — see the migration docstring) so they still
        # get drained instead of sitting orphaned forever.
        due = (
            db.query(MetaCapiLog)
            .filter(
                MetaCapiLog.status.in_(("queued", "retry", "pending_retry")),
                (MetaCapiLog.next_retry_at.is_(None)) | (MetaCapiLog.next_retry_at <= now),
            )
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
            # Probe the host events are ACTUALLY sent to: the relay when one is
            # configured. Probing graph.facebook.com directly on HuggingFace
            # always fails (TLS block) and bulk-deferred the whole queue forever
            # even while the relay itself was perfectly reachable.
            from app.core.config import settings as _settings_pf
            _relay_pf = (getattr(_settings_pf, "META_CAPI_RELAY_URL", "") or "").strip()
            _probe_host = "graph.facebook.com"
            if _relay_pf:
                from urllib.parse import urlparse as _urlparse_pf
                _probe_host = _urlparse_pf(_relay_pf).hostname or _probe_host
            preflight = probe_connectivity(host=_probe_host)
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

        # Every due row is replayed through send_purchase_for_order — the
        # SAME claim/build/send/log path the live creation trigger uses.
        # This is deliberate: a frozen row.payload can go stale (order total
        # edited, Meta config's currency changed) between the original
        # attempt and a retry hours later, and having two independent send
        # implementations is exactly how the claim/idempotency guarantee
        # could silently drift out of sync between them. One code path,
        # always rebuilt fresh from the order at send time.
        order_ids = [row.order_id for row in due if row.order_id]
        deferred_bulk = 0
        for i, order_id in enumerate(order_ids):
            if _circuit_is_open():
                deferred_until = now + timedelta(seconds=_CIRCUIT_COOLDOWN_SECONDS + 10)
                from sqlalchemy import update as sa_update
                db.execute(
                    sa_update(MetaCapiLog.__table__)
                    .where(MetaCapiLog.order_id.in_(order_ids[i:]),
                           MetaCapiLog.status.in_(("queued", "retry", "pending_retry")))
                    .values(next_retry_at=deferred_until, error_message="circuit breaker open: bulk deferred")
                )
                deferred_bulk = len(order_ids) - i
                db.commit()
                logger.warning(
                    "[MetaCAPI] circuit opened mid-sweep — %d remaining event(s) bulk deferred to %s UTC",
                    deferred_bulk, deferred_until.strftime("%H:%M:%S"),
                )
                return
            try:
                send_purchase_for_order(order_id, client_ip=None, user_agent=None)
            except Exception:
                # One order's claim/send blowing up (e.g. a transient DB
                # connectivity error on the claim UPDATE itself, before
                # send_purchase_for_order's own internal try/except around
                # the claimed-row handling even starts) must never abort the
                # rest of this sweep batch — every other due order_id still
                # deserves its attempt this round.
                logger.exception("[MetaCAPI] sweep: order=%s raised unexpectedly — continuing with next due order", order_id)
    except Exception:
        db.rollback()
        logger.exception("[MetaCAPI] retry sweep crashed")
    finally:
        db.close()


# ─── Admin dashboard + cleanup ────────────────────────────────────────────────

def get_queue_stats(db: "Session") -> Dict[str, Any]:
    """
    Powers the 'Meta Queue' admin page. Deliberately built as ONE grouped
    aggregate query plus a handful of scalar aggregates — no per-row fetch,
    no N+1 — to stay cheap on Supabase Free even if the table grows to
    thousands of rows.
    """
    from sqlalchemy import func as _f
    from app.models.marketing import MetaCapiLog

    by_status = dict(
        db.query(MetaCapiLog.status, _f.count(MetaCapiLog.id))
        .filter(MetaCapiLog.event_name == "Purchase")
        .group_by(MetaCapiLog.status)
        .all()
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    thirty_days_ago = now - timedelta(days=30)

    success_today = db.query(_f.count(MetaCapiLog.id)).filter(
        MetaCapiLog.event_name == "Purchase", MetaCapiLog.status == "success",
        MetaCapiLog.completed_at >= today_start,
    ).scalar() or 0
    success_30d = db.query(_f.count(MetaCapiLog.id)).filter(
        MetaCapiLog.event_name == "Purchase", MetaCapiLog.status == "success",
        MetaCapiLog.completed_at >= thirty_days_ago,
    ).scalar() or 0
    failed_30d = db.query(_f.count(MetaCapiLog.id)).filter(
        MetaCapiLog.event_name == "Purchase", MetaCapiLog.status == "failed",
        MetaCapiLog.completed_at >= thirty_days_ago,
    ).scalar() or 0
    avg_latency_ms, max_latency_ms, min_latency_ms, avg_attempts = db.query(
        _f.avg(MetaCapiLog.latency_ms), _f.max(MetaCapiLog.latency_ms),
        _f.min(MetaCapiLog.latency_ms), _f.avg(MetaCapiLog.retry_count),
    ).filter(
        MetaCapiLog.event_name == "Purchase", MetaCapiLog.status == "success",
        MetaCapiLog.completed_at >= thirty_days_ago,
    ).first() or (None, None, None, None)

    # Average age of everything still in flight (queued/retry/processing) —
    # a single EXTRACT(EPOCH ...) aggregate, not a per-row Python loop.
    avg_queue_age_seconds = db.query(
        _f.avg(_f.extract("epoch", now - MetaCapiLog.created_at))
    ).filter(
        MetaCapiLog.event_name == "Purchase",
        MetaCapiLog.status.in_(("queued", "retry", "processing", "pending_retry")),
    ).scalar()

    last_success = db.query(_f.max(MetaCapiLog.completed_at)).filter(
        MetaCapiLog.event_name == "Purchase", MetaCapiLog.status == "success",
    ).scalar()
    last_error_row = (
        db.query(MetaCapiLog.error_message, MetaCapiLog.completed_at)
        .filter(MetaCapiLog.event_name == "Purchase", MetaCapiLog.status.in_(("failed", "retry")))
        .order_by(_f.coalesce(MetaCapiLog.completed_at, MetaCapiLog.created_at).desc())
        .first()
    )

    total_30d = success_30d + failed_30d
    success_rate = round(success_30d / total_30d * 100, 1) if total_30d else None
    failure_rate = round(failed_30d / total_30d * 100, 1) if total_30d else None
    in_flight = by_status.get("queued", 0) + by_status.get("processing", 0) + by_status.get("retry", 0) + by_status.get("pending_retry", 0)

    return {
        "queued": by_status.get("queued", 0),
        "processing": by_status.get("processing", 0),
        "retry": by_status.get("retry", 0) + by_status.get("pending_retry", 0),
        "failed": by_status.get("failed", 0),
        "skipped": by_status.get("skipped", 0),
        "success_today": success_today,
        "success_30d": success_30d,
        "failed_30d": failed_30d,
        "success_rate_30d": success_rate,
        "failure_rate_30d": failure_rate,
        "avg_latency_ms": round(avg_latency_ms, 0) if avg_latency_ms else None,
        "max_latency_ms": max_latency_ms,
        "min_latency_ms": min_latency_ms,
        "avg_attempts": round(avg_attempts, 2) if avg_attempts else None,
        "queue_size": in_flight,
        "avg_queue_age_seconds": round(avg_queue_age_seconds, 0) if avg_queue_age_seconds else None,
        "last_success_at": last_success.isoformat() if last_success else None,
        "last_error": last_error_row[0] if last_error_row else None,
        "last_error_at": (last_error_row[1].isoformat() if last_error_row and last_error_row[1] else None),
    }


_CLEANUP_RETENTION_DAYS = int(os.getenv("META_CAPI_CLEANUP_RETENTION_DAYS", "90"))


def cleanup_old_capi_logs(db: "Session") -> int:
    """
    Deletes 'success' rows older than _CLEANUP_RETENTION_DAYS in one batched
    DELETE — never touches 'failed'/'retry' (kept indefinitely, they're the
    only rows worth investigating later). Called from the same background
    scheduler loop as the Noest sync, at most once/day (see noest_sync.py).
    """
    from sqlalchemy import delete as sa_delete
    from app.models.marketing import MetaCapiLog

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=_CLEANUP_RETENTION_DAYS)
    result = db.execute(
        sa_delete(MetaCapiLog.__table__)
        .where(MetaCapiLog.status == "success", MetaCapiLog.completed_at < cutoff)
    )
    db.commit()
    if result.rowcount:
        logger.info("[MetaCAPI] cleanup: deleted %d success row(s) older than %dd", result.rowcount, _CLEANUP_RETENTION_DAYS)
    return result.rowcount


# ─── Audit permanent (nightly) ───────────────────────────────────────────────
def run_meta_nightly_audit(db: "Session", store_id: str) -> dict:
    """
    Audit permanent horodaté — appelé depuis le scheduler DÉJÀ EXISTANT
    (background_loop, noest_sync.py), pas un nouveau cron. Persiste son
    rapport dans audit_logs (action='meta_nightly_audit') — la table
    d'audit générique déjà utilisée pour capi_marked_backfill, PAS une
    nouvelle table dédiée.

    Vérifie uniquement des faits structurels/statistiques (présence
    pixel/token, taux de rejet/retry des dernières 24h, campagnes sans
    achat Meta déclaré, commandes récentes sans UTM/campagne) — AUCUN appel
    Graph API (la validation live du token existe déjà, à la demande, via
    GET /health ; l'appeler chaque nuit pour chaque boutique ajouterait un
    appel Meta périodique que rien ne justifie ici).
    """
    from app.models.marketing import MetaCapiLog, MetaAdsCampaign
    from app.models.order import Order
    from app.models.audit import AuditLog
    from sqlalchemy import func
    import uuid as _uuid

    findings = []
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)

    config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == store_id).first()
    if not config or not config.pixel_id:
        findings.append({"check": "pixel", "status": "problem", "detail": "Aucun Pixel ID configuré pour cette boutique."})
    elif not config.access_token or len(config.access_token) < 15:
        findings.append({"check": "token", "status": "problem", "detail": "Access token absent ou trop court."})
    else:
        findings.append({"check": "pixel_token", "status": "ok",
                          "detail": "Pixel et token présents (validité live non vérifiée ici — voir Santé du Pixel pour un contrôle à la demande)."})

    status_rows = (
        db.query(MetaCapiLog.status, func.count(MetaCapiLog.id))
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.event_name == "Purchase", MetaCapiLog.created_at >= since)
        .group_by(MetaCapiLog.status)
        .all()
    )
    by_status = {s: c for s, c in status_rows}
    total_24h = sum(by_status.values())
    failed_24h = by_status.get("failed", 0)
    retry_24h = by_status.get("retry", 0) + by_status.get("pending_retry", 0)
    if total_24h and failed_24h / total_24h > 0.01:
        findings.append({"check": "rejected", "status": "problem",
                          "detail": f"{failed_24h}/{total_24h} Purchase rejetés sur les dernières 24h (> 1%)."})
    if total_24h and retry_24h / total_24h > 0.02:
        findings.append({"check": "retry", "status": "problem",
                          "detail": f"{retry_24h}/{total_24h} Purchase en retry sur les dernières 24h (> 2%)."})

    campaigns = (
        db.query(MetaAdsCampaign)
        .filter(MetaAdsCampaign.store_id == store_id, MetaAdsCampaign.spend > 0)
        .all()
    )
    no_purchase = [c.campaign_name for c in campaigns if (c.meta_purchases or 0) == 0]
    if no_purchase:
        findings.append({"check": "campaigns_without_purchase", "status": "problem",
                          "detail": f"{len(no_purchase)} campagne(s) avec dépenses mais aucun achat Meta déclaré.",
                          "campaigns": no_purchase[:20]})

    orders_24h = (
        db.query(Order)
        .filter(Order.store_id == store_id, Order.created_at >= since, Order.is_deleted == False)
        .all()
    )
    if orders_24h:
        no_attribution = sum(1 for o in orders_24h if not o.utm_campaign and not o.campaign_id)
        if no_attribution / len(orders_24h) > 0.5:
            findings.append({"check": "orders_without_attribution", "status": "problem",
                              "detail": f"{no_attribution}/{len(orders_24h)} commandes des dernières 24h sans UTM ni campaign_id (normal si majoritairement organique/direct)."})

    problems = [f for f in findings if f["status"] == "problem"]
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "store_id": store_id,
        "findings": findings,
        "problem_count": len(problems),
        "healthy": len(problems) == 0,
    }

    db.add(AuditLog(
        id=str(_uuid.uuid4()), store_id=store_id, entity="store", entity_id=store_id,
        action="meta_nightly_audit", diff=report,
    ))
    db.commit()
    return report
