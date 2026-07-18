"""
Upstash Redis (REST) read-through cache for non-sensitive, low-volatility
app data — dashboard analytics, public config reads, quasi-static lookups.

Deliberately NOT for secrets: enforced by a denylist check in set_json()
that refuses to cache any dict containing a key that looks like a secret
(access_token, password, jwt, refresh_token, etc.) — raises rather than
silently caching. JWTs, refresh tokens, passwords, and the decrypted Meta
access_token must never reach this cache; the access_token stays in the
in-process-only cache in app/services/meta_capi.py instead.

Fails open: any Upstash error (timeout, misconfiguration, outage) is
swallowed and treated as a cache miss — a cache failure must never break
a request that would otherwise succeed by reading straight from Postgres.

Metrics tracked here are per-process (this worker only, since Vitals are
in-memory) — see GET /api/v1/internal/cache-metrics for the exposed view.
"""

import json
import logging
import time
from typing import Any, Callable, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger("app.cache")

_FORBIDDEN_KEY_SUBSTRINGS = (
    "access_token", "password", "jwt", "refresh_token", "secret",
    "api_key", "client_secret", "private_key", "token",
)

_client: Optional[httpx.Client] = None

_metrics: dict = {
    "l1_hits": 0,
    "l2_hits": 0,
    "misses": 0,  # == postgres_fallbacks: every miss falls through to compute()
    "redis_failures": 0,
    "invalidations": 0,
    "lookup_latency_total_ms": 0.0,   # full get_or_set() calls, all tiers
    "lookup_latency_count": 0,
    "redis_latency_total_ms": 0.0,    # get_json/set_json HTTP round-trips only
    "redis_latency_count": 0,
}


def _get_client() -> Optional[httpx.Client]:
    global _client
    if not settings.UPSTASH_REDIS_REST_URL or not settings.UPSTASH_REDIS_REST_TOKEN:
        return None
    if _client is None:
        _client = httpx.Client(
            base_url=settings.UPSTASH_REDIS_REST_URL,
            headers={"Authorization": f"Bearer {settings.UPSTASH_REDIS_REST_TOKEN}"},
            timeout=2.0,
        )
    return _client


def _assert_no_secrets(value: Any) -> None:
    if isinstance(value, dict):
        for k in value.keys():
            lk = str(k).lower()
            if any(bad in lk for bad in _FORBIDDEN_KEY_SUBSTRINGS):
                raise ValueError(
                    f"Refusing to cache field '{k}' — looks like a secret. "
                    "Strip it from the dict before calling set_json()."
                )


def get_json(key: str) -> Optional[Any]:
    client = _get_client()
    if client is None:
        return None
    t0 = time.monotonic()
    try:
        resp = client.get(f"/get/{key}")
        resp.raise_for_status()
        result = resp.json().get("result")
        if result is None:
            return None
        return json.loads(result)
    except Exception as exc:
        _metrics["redis_failures"] += 1
        logger.debug("[Cache] get_json(%s) miss/error: %s", key, exc)
        return None
    finally:
        _dt = (time.monotonic() - t0) * 1000
        _metrics["redis_latency_total_ms"] += _dt
        _metrics["redis_latency_count"] += 1
        from app.core import timing as _timing
        _timing.record("redis", _dt)


def set_json(key: str, value: Any, ttl_seconds: int) -> None:
    _assert_no_secrets(value)
    client = _get_client()
    if client is None:
        return
    t0 = time.monotonic()
    try:
        client.post("/", json=["SET", key, json.dumps(value), "EX", str(ttl_seconds)])
    except Exception as exc:
        _metrics["redis_failures"] += 1
        logger.debug("[Cache] set_json(%s) failed: %s", key, exc)
    finally:
        _dt = (time.monotonic() - t0) * 1000
        _metrics["redis_latency_total_ms"] += _dt
        _metrics["redis_latency_count"] += 1
        from app.core import timing as _timing
        _timing.record("redis", _dt)


def delete(*keys: str) -> None:
    client = _get_client()
    if client is None or not keys:
        return
    t0 = time.monotonic()
    try:
        client.post("/", json=["DEL", *keys])
    except Exception as exc:
        _metrics["redis_failures"] += 1
        logger.debug("[Cache] delete(%s) failed: %s", keys, exc)
    finally:
        _dt = (time.monotonic() - t0) * 1000
        _metrics["redis_latency_total_ms"] += _dt
        _metrics["redis_latency_count"] += 1
        from app.core import timing as _timing
        _timing.record("redis", _dt)


# ─── Unified L1 (in-process, short-TTL) + L2 (Upstash) + Postgres fallback ──
# One caching system, not two: every cached endpoint in the app should go
# through get_or_set() rather than hand-rolling its own in-process dict or
# reaching for the separate local-Redis analytics_cache module. L1 absorbs
# the burst of identical requests within the same worker process (dashboard
# tab switches, retries) without even paying Upstash's network hop; L2
# survives redeploys and is shared across workers; Postgres is the fallback
# of last resort, exactly once per L2 miss.
_l1_store: dict = {}  # key -> (value, expires_at_monotonic)


def get_or_set(key: str, compute: Callable[[], Any], l1_ttl: int = 45, l2_ttl: int = 1800) -> Any:
    t_start = time.monotonic()
    try:
        now = t_start
        l1 = _l1_store.get(key)
        if l1 is not None and l1[1] > now:
            _metrics["l1_hits"] += 1
            return l1[0]

        l2_value = get_json(key)
        if l2_value is not None:
            _metrics["l2_hits"] += 1
            _l1_store[key] = (l2_value, now + l1_ttl)
            return l2_value

        _metrics["misses"] += 1
        value = compute()
        set_json(key, value, l2_ttl)
        _l1_store[key] = (value, now + l1_ttl)
        return value
    finally:
        _metrics["lookup_latency_total_ms"] += (time.monotonic() - t_start) * 1000
        _metrics["lookup_latency_count"] += 1


def invalidate(*keys: str) -> None:
    _metrics["invalidations"] += len(keys)
    for k in keys:
        _l1_store.pop(k, None)
    delete(*keys)


def get_metrics() -> dict:
    """
    Full observability snapshot — see GET /api/v1/internal/cache-metrics.
    Per-process only: each HF worker/replica tracks its own counters, there
    is no cross-worker aggregation. hit_ratio counts L1+L2 hits over all
    lookups; postgres_queries_avoided_estimate == l1_hits + l2_hits, since
    every one of those is a get_or_set() call that did NOT run compute().
    """
    m = _metrics
    total_lookups = m["l1_hits"] + m["l2_hits"] + m["misses"]
    hits = m["l1_hits"] + m["l2_hits"]
    return {
        "l1_hits": m["l1_hits"],
        "l2_hits": m["l2_hits"],
        "misses": m["misses"],
        "postgres_fallbacks": m["misses"],
        "postgres_queries_avoided_estimate": hits,
        "total_lookups": total_lookups,
        "hit_ratio": round(hits / total_lookups, 4) if total_lookups else None,
        "avg_lookup_latency_ms": round(m["lookup_latency_total_ms"] / m["lookup_latency_count"], 2) if m["lookup_latency_count"] else None,
        "avg_redis_latency_ms": round(m["redis_latency_total_ms"] / m["redis_latency_count"], 2) if m["redis_latency_count"] else None,
        "redis_failures": m["redis_failures"],
        "cache_invalidations": m["invalidations"],
        "l1_entries_current": len(_l1_store),
        "upstash_configured": _get_client() is not None,
    }
