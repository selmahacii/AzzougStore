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
    try:
        resp = client.get(f"/get/{key}")
        resp.raise_for_status()
        result = resp.json().get("result")
        if result is None:
            return None
        return json.loads(result)
    except Exception as exc:
        logger.debug("[Cache] get_json(%s) miss/error: %s", key, exc)
        return None


def set_json(key: str, value: Any, ttl_seconds: int) -> None:
    _assert_no_secrets(value)
    client = _get_client()
    if client is None:
        return
    try:
        client.post("/", json=["SET", key, json.dumps(value), "EX", str(ttl_seconds)])
    except Exception as exc:
        logger.debug("[Cache] set_json(%s) failed: %s", key, exc)


def delete(*keys: str) -> None:
    client = _get_client()
    if client is None or not keys:
        return
    try:
        client.post("/", json=["DEL", *keys])
    except Exception as exc:
        logger.debug("[Cache] delete(%s) failed: %s", keys, exc)


# ─── Unified L1 (in-process, short-TTL) + L2 (Upstash) + Postgres fallback ──
# One caching system, not two: every cached endpoint in the app should go
# through get_or_set() rather than hand-rolling its own in-process dict or
# reaching for the separate local-Redis analytics_cache module. L1 absorbs
# the burst of identical requests within the same worker process (dashboard
# tab switches, retries) without even paying Upstash's network hop; L2
# survives redeploys and is shared across workers; Postgres is the fallback
# of last resort, exactly once per L2 miss.
_l1_store: dict = {}  # key -> (value, expires_at_monotonic)
_stats: dict = {"l1_hits": 0, "l2_hits": 0, "misses": 0}


def get_or_set(key: str, compute: Callable[[], Any], l1_ttl: int = 45, l2_ttl: int = 1800) -> Any:
    now = time.monotonic()
    l1 = _l1_store.get(key)
    if l1 is not None and l1[1] > now:
        _stats["l1_hits"] += 1
        return l1[0]

    l2_value = get_json(key)
    if l2_value is not None:
        _stats["l2_hits"] += 1
        _l1_store[key] = (l2_value, now + l1_ttl)
        return l2_value

    _stats["misses"] += 1
    value = compute()
    set_json(key, value, l2_ttl)
    _l1_store[key] = (value, now + l1_ttl)
    return value


def invalidate(*keys: str) -> None:
    for k in keys:
        _l1_store.pop(k, None)
    delete(*keys)


def get_stats() -> dict:
    total = sum(_stats.values())
    return {
        **_stats,
        "total": total,
        "hit_ratio": round((_stats["l1_hits"] + _stats["l2_hits"]) / total, 3) if total else None,
    }
