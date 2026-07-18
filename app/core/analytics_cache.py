"""
Short-TTL response cache for the most expensive Meta analytics endpoints
(signal-quality, learning-diagnostics, tracking-quality-v2, conversion
optimization) — these run several grouped/joined queries over
meta_capi_logs + orders per request, and are opened repeatedly within the
same dashboard session (tab switches, date-range tweaks that don't
actually change the query, page refreshes).

Backed by app/core/cache.py's unified L1 (in-process, short-TTL) + L2
(Upstash) cache — the same system every other cached endpoint in the app
uses, rather than a second, separate local-Redis-backed cache. Public API
(get_cached/set_cached/cached_response) is unchanged so no call site needs
touching; only the storage backend moved.
"""
import logging
import time
from typing import Any, Callable, Dict

from app.core.cache import get_json, set_json

logger = logging.getLogger("app.analytics_cache")

_PREFIX = "meta_analytics_cache:"
DEFAULT_TTL_SECONDS = 10 * 60  # 10 minutes — inside the requested 5-15 min window
_L1_TTL_SECONDS = 45  # short in-process layer ahead of the Upstash L2 below

_l1: Dict[str, tuple] = {}  # key -> (value, expires_at_monotonic)


def get_cached(cache_key: str) -> Any:
    """Returns the cached dict for cache_key, or None on a miss/cache being down."""
    now = time.monotonic()
    l1 = _l1.get(cache_key)
    if l1 is not None and l1[1] > now:
        cached_value = l1[0]
        if isinstance(cached_value, dict) and isinstance(cached_value.get("data"), dict):
            cached_value["data"]["_cache"] = {"hit": True}
        return cached_value

    result = get_json(_PREFIX + cache_key)
    if result is None:
        return None
    if isinstance(result, dict) and isinstance(result.get("data"), dict):
        result["data"]["_cache"] = {"hit": True}
    _l1[cache_key] = (result, now + _L1_TTL_SECONDS)
    return result


def set_cached(cache_key: str, result: Dict[str, Any], ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
    """Best-effort write-through — never raises, a cache write failure must never break the response."""
    if isinstance(result, dict) and isinstance(result.get("data"), dict):
        result["data"]["_cache"] = {"hit": False}
    set_json(_PREFIX + cache_key, result, ttl_seconds)
    _l1[cache_key] = (result, time.monotonic() + _L1_TTL_SECONDS)


def cached_response(cache_key: str, ttl_seconds: int, compute: Callable[[], Dict[str, Any]]) -> Dict[str, Any]:
    """Convenience wrapper for callers that CAN cleanly wrap their whole body in a closure."""
    cached = get_cached(cache_key)
    if cached is not None:
        return cached
    result = compute()
    set_cached(cache_key, result, ttl_seconds)
    return result
