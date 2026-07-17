"""
Short-TTL response cache for the most expensive Meta analytics endpoints
(signal-quality, learning-diagnostics, tracking-quality-v2) — these run
several grouped/joined queries over meta_capi_logs + orders per request,
and are opened repeatedly within the same dashboard session (tab switches,
date-range tweaks that don't actually change the query, page refreshes).

Reuses the existing Redis client (app/core/redis.py, already used for rate
limiting) under a distinct key prefix — no new infrastructure. Falls back
to "always compute" transparently if Redis is unreachable (mirrors
get_redis_client()'s own fallback), so this NEVER makes the endpoint less
reliable, only sometimes not faster.
"""
import json
import logging
from typing import Any, Callable, Dict

from app.core.redis import get_redis_client

logger = logging.getLogger("app.analytics_cache")

_PREFIX = "meta_analytics_cache:"
DEFAULT_TTL_SECONDS = 10 * 60  # 10 minutes — inside the requested 5-15 min window


def get_cached(cache_key: str) -> Any:
    """Returns the cached dict for cache_key, or None on a miss/Redis being down."""
    client = get_redis_client()
    if client is None:
        return None
    try:
        raw = client.get(_PREFIX + cache_key)
        if not raw:
            return None
        result = json.loads(raw)
        if isinstance(result, dict) and isinstance(result.get("data"), dict):
            result["data"]["_cache"] = {"hit": True}
        return result
    except Exception as exc:
        logger.warning("analytics cache read failed for %s: %s", cache_key, exc)
        return None


def set_cached(cache_key: str, result: Dict[str, Any], ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
    """Best-effort write-through — never raises, a cache write failure must never break the response."""
    client = get_redis_client()
    if client is None:
        return
    if isinstance(result, dict) and isinstance(result.get("data"), dict):
        result["data"]["_cache"] = {"hit": False}
    try:
        client.setex(_PREFIX + cache_key, ttl_seconds, json.dumps(result, default=str))
    except Exception as exc:
        logger.warning("analytics cache write failed for %s: %s", cache_key, exc)


def cached_response(cache_key: str, ttl_seconds: int, compute: Callable[[], Dict[str, Any]]) -> Dict[str, Any]:
    """Convenience wrapper for callers that CAN cleanly wrap their whole body in a closure."""
    cached = get_cached(cache_key)
    if cached is not None:
        return cached
    result = compute()
    set_cached(cache_key, result, ttl_seconds)
    return result
