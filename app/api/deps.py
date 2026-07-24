from datetime import datetime, timedelta
from typing import Generator, Optional
from fastapi import Depends, HTTPException, status, Header, Request
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.db.session import SessionLocal, get_db
from app.models.user import User
from app.schemas.token import TokenPayload

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token",
    auto_error=False
)

def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    token: Optional[str] = Depends(reusable_oauth2),
    x_internal_key: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None)
) -> User:
    import time as _time_mod
    from app.core import timing as _timing
    _auth_t0 = _time_mod.perf_counter()
    try:
        return _get_current_user_impl(request, db, token, x_internal_key, x_user_id, authorization)
    finally:
        _timing.record("auth", (_time_mod.perf_counter() - _auth_t0) * 1000)


def _get_current_user_impl(
    request: Request,
    db: Session,
    token: Optional[str],
    x_internal_key: Optional[str],
    x_user_id: Optional[str],
    authorization: Optional[str],
) -> User:
    raw_auth = authorization or ""
    bearer_val = raw_auth.replace("Bearer ", "").strip() if raw_auth.startswith("Bearer ") else ""
    internal_key_matches = (
        (x_internal_key == settings.INTERNAL_API_KEY and x_internal_key is not None) or
        (bearer_val == settings.INTERNAL_API_KEY and bearer_val != "")
    )

    user = None

    # 1. Trust x-user-id injected by Next.js ONLY if the internal key matches
    if x_user_id:
        if not internal_key_matches:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Direct API access with forged X-User-Id is forbidden.",
            )
        user = db.query(User).filter(User.id == x_user_id).first()

    # 2. [REMOVED — CRITICAL AUTH BYPASS] This used to default to the first
    # SUPER_ADMIN in the database whenever x-internal-key matched but no
    # x-user-id was present. The Next.js proxy (src/app/api/[...path]/route.ts)
    # attaches x-internal-key to EVERY proxied request unconditionally —
    # authenticated or not — so ANY anonymous request through the public
    # frontend domain (no session cookie at all) was silently authenticated
    # as a real SUPER_ADMIN with full privileges. Confirmed exploitable live:
    # an unauthenticated curl to a SUPER_ADMIN-only endpoint returned 200
    # with real data. No legitimate internal caller was found relying on
    # this (checked: meta_ads.py's internal-key usages all target the
    # external Next.js relay, not this backend's own endpoints; orders.py's
    # guest-checkout actor resolution already wraps this in try/except and
    # correctly degrades to an anonymous order when unauthenticated).

    # 3. Check for JWT token in cookie if not found in Authorization header
    if not user:
        if not token:
            token = request.cookies.get("__session")

        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
            )

        try:
            payload = jwt.decode(
                token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
            )
            token_data = TokenPayload(**payload)
        except (JWTError, ValidationError):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Could not validate credentials",
            )
        user = db.query(User).filter(User.id == token_data.sub).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
    # Presence tracking — throttled to one write per user per 2 minutes so
    # this doesn't turn into an UPDATE on every single API call on a
    # free-tier DB. Best-effort: a failure here must never break auth.
    if user:
        try:
            now = datetime.utcnow()
            if not user.last_seen_at or (now - user.last_seen_at) > timedelta(minutes=2):
                user.last_seen_at = now
                db.commit()
        except Exception:
            db.rollback()

    # Super admins and admins bypass tenant isolation to view and manage all stores
    if user and user.role in ("SUPER_ADMIN", "ADMIN"):
        from app.core.tenant import tenant_store_id
        tenant_store_id.set("SUPER_ADMIN_MODE")
        db.info["skip_tenant_isolation"] = True
        import logging
        logging.getLogger("app.deps").debug(f"[Deps] SUPER_ADMIN/ADMIN: tenant isolation bypassed for user={user.email!r}")
        
    return user

def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

def get_current_user_optional(
    request: Request,
    db: Session = Depends(get_db),
    token: Optional[str] = Depends(reusable_oauth2),
    x_internal_key: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None)
) -> Optional[User]:
    try:
        return get_current_user(request, db, token, x_internal_key, x_user_id, authorization)
    except HTTPException:
        return None

def get_current_active_superuser(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(
            status_code=403, detail="Privilèges insuffisants. Super Administrateur requis."
        )
    return current_user
