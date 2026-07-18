import logging
import time
import redis
from typing import Optional
from app.core.config import settings

logger = logging.getLogger("app.redis")

_redis_client: Optional[redis.Redis] = None
# Failed-connection cache, mirroring app/core/rate_limit.py's _get_redis():
# without this, every caller with no Redis available (e.g. this HF Space has
# none reachable at REDIS_HOST) re-attempted a full connect+ping on every
# single request that touches session/refresh-token storage — logged
# repeatedly as "Failed to connect to Redis: Error 111 connecting to
# localhost:6379" and adding real, unnecessary latency to every hit
# (POST /api/v1/auth/refresh in particular, which calls this on every call).
_unavailable_until: float = 0.0
_RETRY_INTERVAL_SECONDS = 60.0  # re-probe periodically in case Redis comes up


def get_redis_client() -> Optional[redis.Redis]:
    """Return a shared Redis client instance (connected to db=2), or None if unreachable."""
    global _redis_client, _unavailable_until
    if _redis_client is not None:
        return _redis_client
    now = time.monotonic()
    if now < _unavailable_until:
        return None
    try:
        client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=2,  # Dedicated DB for session and rate limit
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry_on_timeout=False,
        )
        client.ping()
        _redis_client = client
        logger.info("Connected to Redis at %s:%d/db2", settings.REDIS_HOST, settings.REDIS_PORT)
        return client
    except Exception as exc:
        logger.error("Failed to connect to Redis: %s", exc)
        _unavailable_until = now + _RETRY_INTERVAL_SECONDS
        return None
