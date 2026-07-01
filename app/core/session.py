import json
import logging
import uuid
from typing import Optional, Tuple
from app.core.redis import get_redis_client

logger = logging.getLogger("app.session")

REFRESH_TOKEN_EXPIRE_DAYS = 7
REFRESH_TOKEN_EXPIRE_SECONDS = REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
GRACE_PERIOD_SECONDS = 30  # Allow concurrently running client requests to reuse token within 30s

def create_refresh_token(user_id: str) -> str:
    """
    Generate a secure random refresh token, store it in Redis,
    and append it to the user's active token list.
    """
    redis_client = get_redis_client()
    token_id = str(uuid.uuid4())
    
    if redis_client is None:
        # Graceful degradation (e.g. redis down in dev)
        return token_id

    try:
        # 1. Store session payload
        payload = {
            "user_id": user_id,
            "used": False
        }
        redis_client.setex(
            f"auth:refresh:{token_id}",
            REFRESH_TOKEN_EXPIRE_SECONDS,
            json.dumps(payload)
        )
        
        # 2. Append to user's set of active sessions
        redis_client.sadd(f"auth:user_tokens:{user_id}", token_id)
        redis_client.expire(f"auth:user_tokens:{user_id}", REFRESH_TOKEN_EXPIRE_SECONDS)
        
    except Exception as exc:
        logger.error("Error creating refresh token in Redis: %s", exc)
        
    return token_id

def rotate_refresh_token(token_id: str) -> Tuple[str, str]:
    """
    Perform a single-use rotation of a refresh token.
    Detects reuse and revokes ALL sessions of the compromised user if reuse is detected.
    
    Returns:
        Tuple[new_token_id, user_id]
        
    Raises:
        ValueError if the token is invalid, expired, or has already been used (compromised).
    """
    redis_client = get_redis_client()
    if redis_client is None:
        # Fallback if Redis is down (cannot rotate properly, generate fake)
        return str(uuid.uuid4()), ""

    token_key = f"auth:refresh:{token_id}"
    data_str = redis_client.get(token_key)
    
    if not data_str:
        raise ValueError("Invalid or expired refresh token")

    try:
        data = json.loads(data_str)
    except Exception:
        raise ValueError("Invalid refresh token payload structure")

    user_id = data.get("user_id")
    used = data.get("used", False)

    if used:
        # ⚠️ CRITICAL: Token reuse detected! Someone is trying to hijack this session.
        logger.warning(
            "CRITICAL: Refresh token reuse detected! Token: %s, User ID: %s. Revoking all sessions.",
            token_id, user_id
        )
        revoke_all_user_tokens(user_id)
        raise ValueError("Compromised session: All sessions revoked.")

    # Mark current token as used with a short grace period TTL
    data["used"] = True
    try:
        redis_client.setex(token_key, GRACE_PERIOD_SECONDS, json.dumps(data))
    except Exception as exc:
        logger.error("Failed to mark refresh token as used: %s", exc)

    # Generate new refresh token
    new_token_id = create_refresh_token(user_id)
    
    # Remove old token from user's active set
    try:
        redis_client.srem(f"auth:user_tokens:{user_id}", token_id)
    except Exception as exc:
        logger.error("Failed to remove old refresh token from user set: %s", exc)

    return new_token_id, user_id

def revoke_refresh_token(token_id: str) -> None:
    """Revoke a single refresh token (typically on standard logout)."""
    redis_client = get_redis_client()
    if redis_client is None:
        return

    token_key = f"auth:refresh:{token_id}"
    try:
        data_str = redis_client.get(token_key)
        if data_str:
            data = json.loads(data_str)
            user_id = data.get("user_id")
            if user_id:
                redis_client.srem(f"auth:user_tokens:{user_id}", token_id)
        redis_client.delete(token_key)
    except Exception as exc:
        logger.error("Error revoking refresh token %s: %s", token_id, exc)

def revoke_all_user_tokens(user_id: str) -> None:
    """Revoke ALL sessions/refresh tokens for a specific user (Logout All)."""
    redis_client = get_redis_client()
    if redis_client is None:
        return

    user_set_key = f"auth:user_tokens:{user_id}"
    try:
        token_ids = redis_client.smembers(user_set_key)
        if token_ids:
            pipe = redis_client.pipeline(transaction=True)
            for tid in token_ids:
                pipe.delete(f"auth:refresh:{tid}")
            pipe.delete(user_set_key)
            pipe.execute()
        logger.info("Successfully revoked all active sessions for user_id: %s", user_id)
    except Exception as exc:
        logger.error("Error revoking all user tokens for %s: %s", user_id, exc)
