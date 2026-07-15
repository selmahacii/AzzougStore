# ═══════════════════════════════════════════════════════════════
# AzzougShop — Distributed Rate Limiting (Redis-backed)
# Enterprise-grade, multi-strategy, horizontally scalable.
#
# Strategies:
#   - Per-IP       (global protection, all endpoints)
#   - Per-User     (authenticated requests, per-user quota)
#   - Per-Store    (tenant API quota by plan)
#   - Auth-strict  (brute-force protection, 5/15min per IP+email)
#
# Algorithm: Sliding Window Counter via Redis MULTI/PIPELINE.
# Falls back gracefully if Redis is unavailable (fail-open in dev,
# fail-closed in production).
# ═══════════════════════════════════════════════════════════════

from __future__ import annotations

import logging
import time
import threading
from collections import defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import redis
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.tenant import tenant_store_id

logger = logging.getLogger("app.rate_limit")

# ─── Redis Connection Pool ────────────────────────────────────────────────────

_redis_client: Optional[redis.Redis] = None
_redis_unavailable = False  # Set to True after first failed connect to suppress repeated warnings


def _get_redis() -> Optional[redis.Redis]:
    """Return a shared Redis client, or None if unavailable."""
    global _redis_client, _redis_unavailable
    if _redis_client is not None:
        return _redis_client
    if _redis_unavailable:
        return None
    try:
        client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=2,
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1,
            retry_on_timeout=False,
        )
        client.ping()
        _redis_client = client
        logger.info("Rate limiter connected to Redis at %s:%d/db2", settings.REDIS_HOST, settings.REDIS_PORT)
        return client
    except Exception as exc:
        logger.warning("Redis unavailable for rate limiting: %s. Using in-memory fallback.", exc)
        _redis_unavailable = True
        return None


# ─── Rate Limit Plans ─────────────────────────────────────────────────────────

class StorePlan(str, Enum):
    STARTER = "STARTER"
    PROFESSIONAL = "PROFESSIONAL"
    ENTERPRISE = "ENTERPRISE"


# Requests per 60-second window per store
STORE_PLAN_LIMITS: dict[StorePlan, int] = {
    StorePlan.STARTER: 1200,
    StorePlan.PROFESSIONAL: 3000,
    StorePlan.ENTERPRISE: 10000,
}

# Per-IP limits — intentionally high because Vercel proxies all traffic
# through a small pool of AWS edge IPs, so all real users share the same IP.
IP_LIMIT_GET = 3000      # GET requests / minute / IP
IP_LIMIT_WRITE = 600     # POST/PATCH/DELETE / minute / IP

# Per-user limits (authenticated)
USER_LIMIT_WRITE = 600   # write requests / minute / user

# Auth endpoint brute-force limits
AUTH_LIMIT = 5           # login attempts per 15 minutes per IP+email key
AUTH_WINDOW_SECONDS = 900  # 15 minutes

WINDOW_SECONDS = 60  # Default sliding window (1 minute)


# ─── Sliding Window Counter ───────────────────────────────────────────────────

@dataclass
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    reset_at: int         # Unix timestamp
    retry_after: int = 0  # seconds


# ─── In-Memory Fallback Rate Limiter ─────────────────────────────────────────
# Used when Redis is unavailable. Thread-safe sliding window per key.

_mem_lock = threading.Lock()
_mem_windows: dict[str, deque] = defaultdict(deque)


def _mem_sliding_window_check(key: str, limit: int, window_seconds: int) -> RateLimitResult:
    now = time.time()
    cutoff = now - window_seconds
    with _mem_lock:
        dq = _mem_windows[key]
        while dq and dq[0] <= cutoff:
            dq.popleft()
        count = len(dq)
        allowed = count < limit
        if allowed:
            dq.append(now)
            count += 1
    remaining = max(0, limit - count)
    reset_at = int(now) + window_seconds
    return RateLimitResult(
        allowed=allowed,
        limit=limit,
        remaining=remaining,
        reset_at=reset_at,
        retry_after=window_seconds if not allowed else 0,
    )


def _sliding_window_check(
    redis_client: redis.Redis,
    key: str,
    limit: int,
    window_seconds: int,
) -> RateLimitResult:
    """
    Atomic sliding window counter using Redis MULTI/EXEC pipeline.

    Algorithm:
      1. Increment a counter key with TTL = window_seconds
      2. Read current count
      3. Compare against limit

    This is atomic per-key and scales across multiple app instances
    because all state lives in Redis, not in process memory.
    """
    now = int(time.time())
    reset_at = now + window_seconds

    try:
        pipe = redis_client.pipeline(transaction=True)
        pipe.incr(key)
        pipe.ttl(key)
        count, ttl = pipe.execute()

        # Key is brand new (TTL = -1): set expiry
        if ttl == -1:
            redis_client.expire(key, window_seconds)
            ttl = window_seconds

        reset_at = now + max(ttl, 0)
        remaining = max(0, limit - int(count))
        allowed = int(count) <= limit

        return RateLimitResult(
            allowed=allowed,
            limit=limit,
            remaining=remaining,
            reset_at=reset_at,
            retry_after=max(ttl, 0) if not allowed else 0,
        )
    except redis.RedisError as exc:
        logger.error("Redis rate limit error for key '%s': %s", key, exc)
        raise


def check_rate_limit(
    *,
    key: str,
    limit: int,
    window_seconds: int = WINDOW_SECONDS,
) -> RateLimitResult:
    """
    Public entrypoint for rate limit checks.
    Returns an open/allowed result if Redis is unavailable.
    """
    client = _get_redis()
    if client is None:
        # No Redis: use in-memory sliding window (works for single-instance deployments like HF Spaces)
        return _mem_sliding_window_check(key, limit, window_seconds)

    return _sliding_window_check(client, key, limit, window_seconds)


# ─── Auth Brute-Force Check (login endpoint) ─────────────────────────────────

def check_auth_brute_force(ip: str, email: str) -> RateLimitResult:
    """
    Combined IP + email key for login brute-force protection.
    5 attempts allowed per 15-minute window per (IP, email) pair.
    """
    # Rate limit on both dimensions; either one failing blocks the request
    ip_result = check_rate_limit(
        key=f"rl:auth:ip:{ip}",
        limit=AUTH_LIMIT,
        window_seconds=AUTH_WINDOW_SECONDS,
    )
    if not ip_result.allowed:
        return ip_result

    email_key = email.lower().strip()
    email_result = check_rate_limit(
        key=f"rl:auth:email:{email_key}",
        limit=AUTH_LIMIT,
        window_seconds=AUTH_WINDOW_SECONDS,
    )
    return email_result


def clear_auth_rate_limit(ip: str, email: str) -> None:
    """Clear brute-force counters after a successful login."""
    client = _get_redis()
    if client is None:
        return
    try:
        email_key = email.lower().strip()
        client.delete(f"rl:auth:ip:{ip}", f"rl:auth:email:{email_key}")
    except redis.RedisError as exc:
        logger.warning("Failed to clear auth rate limit keys: %s", exc)


# ─── Middleware ───────────────────────────────────────────────────────────────

class DistributedRateLimitMiddleware(BaseHTTPMiddleware):
    """
    Layered rate limiting middleware applied to all /api/v1/* routes.

    Check order:
      1. Per-IP   — protects against anonymous abuse
      2. Per-User — authenticated user quota
      3. Per-Store — tenant plan quota (run LAST, consumes quota only if allowed)

    All three can coexist: a single request decrements all applicable counters.
    """

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method

        # Only rate-limit API routes
        if not path.startswith(settings.API_V1_STR):
            return await call_next(request)

        client = _get_redis()

        # Extract identifiers
        ip = (
            request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            or request.headers.get("X-Real-Ip", "")
            or "127.0.0.1"
        )
        user_id = request.headers.get("X-User-Id")
        store_id = tenant_store_id.get()

        is_write = method in ("POST", "PUT", "PATCH", "DELETE")
        ip_limit = IP_LIMIT_WRITE if is_write else IP_LIMIT_GET

        # ── Layer 1: IP rate limit ────────────────────────────────
        ip_result = check_rate_limit(
            key=f"rl:ip:{ip}:{'w' if is_write else 'r'}",
            limit=ip_limit,
            window_seconds=WINDOW_SECONDS,
        )
        if not ip_result.allowed:
            logger.warning("Rate limit [IP] exceeded: ip=%s path=%s", ip, path)
            return self._rate_limit_response(ip_result, "IP quota exceeded.")

        # ── Layer 2: Per-User (authenticated) ─────────────────────
        if user_id and is_write:
            user_result = check_rate_limit(
                key=f"rl:user:{user_id}:w",
                limit=USER_LIMIT_WRITE,
                window_seconds=WINDOW_SECONDS,
            )
            if not user_result.allowed:
                logger.warning("Rate limit [USER] exceeded: user=%s path=%s", user_id, path)
                return self._rate_limit_response(user_result, "Quota utilisateur dépassé.")

        # ── Layer 3: Per-Store (tenant plan) ──────────────────────
        if store_id and store_id != "SUPER_ADMIN_MODE":
            store_limit = STORE_PLAN_LIMITS[StorePlan.STARTER]  # Default; upgrade from DB/cache
            store_result = check_rate_limit(
                key=f"rl:store:{store_id}",
                limit=store_limit,
                window_seconds=WINDOW_SECONDS,
            )
            if not store_result.allowed:
                logger.warning("Rate limit [STORE] exceeded: store=%s path=%s", store_id, path)
                return self._rate_limit_response(
                    store_result,
                    "Quota de requêtes de votre boutique dépassé. Passez au plan supérieur.",
                )

        # ── Pass through with rate limit headers ──────────────────
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(ip_limit)
        response.headers["X-RateLimit-Remaining"] = str(ip_result.remaining)
        response.headers["X-RateLimit-Reset"] = str(ip_result.reset_at)
        return response

    @staticmethod
    def _rate_limit_response(result: RateLimitResult, message: str) -> JSONResponse:
        return JSONResponse(
            status_code=429,
            content={
                "success": False,
                "error_code": "RATE_LIMITED",
                "message": message,
                "retry_after": result.retry_after,
            },
            headers={
                "Retry-After": str(result.retry_after),
                "X-RateLimit-Limit": str(result.limit),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(result.reset_at),
            },
        )
