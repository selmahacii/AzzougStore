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

    # 2. Allow bypass for internal Next.js proxy calls via API key without user ID
    if not user and internal_key_matches:
        system_user = db.query(User).filter(User.role == "SUPER_ADMIN").first()
        if not system_user:
            system_user = db.query(User).first()
        if system_user:
            user = system_user
        else:
            raise HTTPException(status_code=401, detail="Internal bypass failed: No users in database")

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
