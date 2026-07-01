import logging
import redis
from typing import Optional
from app.core.config import settings

logger = logging.getLogger("app.redis")

_redis_client: Optional[redis.Redis] = None

def get_redis_client() -> Optional[redis.Redis]:
    """Return a shared Redis client instance (connected to db=2)."""
    global _redis_client
    if _redis_client is not None:
        return _redis_client
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
        return None
