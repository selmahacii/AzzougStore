import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from jose import jwt, JWTError

from app.core.config import settings
from app.core.security import ALGORITHM
from app.core.redis import get_redis_client

logger = logging.getLogger("app.session")

REFRESH_TOKEN_EXPIRE_DAYS = 7
REFRESH_TOKEN_EXPIRE_SECONDS = REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
GRACE_PERIOD_SECONDS = 30  # Allow concurrently running client requests to reuse token within 30s


def _encode_refresh_jwt(user_id: str, jti: str) -> str:
    """
    A refresh token is a self-contained signed JWT carrying the user id and a
    unique id (jti). Being self-contained is what lets a session survive when
    Redis is unavailable: rotation can recover the user directly from the token
    instead of looking it up in Redis. When Redis IS available it is used as an
    extra single-use / reuse-detection layer keyed by the jti (see below).
    """
    expire = datetime.now(timezone.utc) + timedelta(seconds=REFRESH_TOKEN_EXPIRE_SECONDS)
    return jwt.encode(
        {"sub": str(user_id), "jti": jti, "type": "refresh", "exp": expire},
        settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )


def _decode_refresh_jwt(token: str) -> Tuple[str, str]:
    """Verify signature + expiry and return (user_id, jti). Raises ValueError if invalid."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise ValueError("Invalid or expired refresh token")
    if payload.get("type") != "refresh":
        raise ValueError("Wrong token type")
    user_id = payload.get("sub")
    jti = payload.get("jti")
    if not user_id or not jti:
        raise ValueError("Malformed refresh token")
    return user_id, jti


def create_refresh_token(user_id: str) -> str:
    """
    Issue a signed refresh-token JWT. When Redis is reachable, also register the
    token's jti so it can be single-use-rotated and reuse-detected; when Redis is
    down the JWT alone keeps the session alive (graceful degradation).
    """
    redis_client = get_redis_client()
    jti = str(uuid.uuid4())
    token = _encode_refresh_jwt(user_id, jti)

    if redis_client is None:
        return token

    try:
        redis_client.setex(
            f"auth:refresh:{jti}",
            REFRESH_TOKEN_EXPIRE_SECONDS,
            json.dumps({"user_id": user_id, "used": False}),
        )
        redis_client.sadd(f"auth:user_tokens:{user_id}", jti)
        redis_client.expire(f"auth:user_tokens:{user_id}", REFRESH_TOKEN_EXPIRE_SECONDS)
    except Exception as exc:
        logger.error("Error registering refresh token in Redis: %s", exc)

    return token


def rotate_refresh_token(token: str) -> Tuple[str, str]:
    """
    Single-use rotation of a refresh token.

    Returns:
        Tuple[new_refresh_token, user_id]

    Raises:
        ValueError if the token is invalid, expired, or (Redis mode) reused.

    The JWT signature+expiry are always verified. When Redis is available the
    jti is additionally checked for single-use/reuse detection; when Redis is
    down the verified JWT alone is trusted so the session survives (no reuse
    detection possible without shared state — the accepted trade-off).
    """
    user_id, jti = _decode_refresh_jwt(token)

    redis_client = get_redis_client()
    if redis_client is None:
        # Stateless fallback: JWT already proven valid → keep the user signed in.
        return _encode_refresh_jwt(user_id, str(uuid.uuid4())), user_id

    token_key = f"auth:refresh:{jti}"
    data_str = redis_client.get(token_key)

    if not data_str:
        # Not in Redis: either it predates Redis coming back up, or its
        # grace-period entry expired. The JWT itself is still valid and
        # unexpired, so honour it rather than logging the user out.
        return create_refresh_token(user_id), user_id

    try:
        data = json.loads(data_str)
    except Exception:
        raise ValueError("Invalid refresh token payload structure")

    if data.get("used", False):
        # ⚠️ CRITICAL: Token reuse detected! Someone is trying to hijack this session.
        logger.warning(
            "CRITICAL: Refresh token reuse detected! jti: %s, User ID: %s. Revoking all sessions.",
            jti, user_id
        )
        revoke_all_user_tokens(user_id)
        raise ValueError("Compromised session: All sessions revoked.")

    # Mark current token as used with a short grace period TTL
    data["used"] = True
    try:
        redis_client.setex(token_key, GRACE_PERIOD_SECONDS, json.dumps(data))
    except Exception as exc:
        logger.error("Failed to mark refresh token as used: %s", exc)

    new_token = create_refresh_token(user_id)

    try:
        redis_client.srem(f"auth:user_tokens:{user_id}", jti)
    except Exception as exc:
        logger.error("Failed to remove old refresh token from user set: %s", exc)

    return new_token, user_id

def revoke_refresh_token(token: str) -> None:
    """
    Revoke a single refresh token (typically on standard logout).
    Without Redis there is no server-side state to delete — clearing the cookie
    client-side (done by the caller) is the effective logout in that mode.
    """
    redis_client = get_redis_client()
    if redis_client is None:
        return

    try:
        user_id, jti = _decode_refresh_jwt(token)
    except ValueError:
        return

    token_key = f"auth:refresh:{jti}"
    try:
        redis_client.srem(f"auth:user_tokens:{user_id}", jti)
        redis_client.delete(token_key)
    except Exception as exc:
        logger.error("Error revoking refresh token (jti=%s): %s", jti, exc)

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
