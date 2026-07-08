# ═══════════════════════════════════════════════════════════════
# AzzougShop — Auth Router (Refactored)
# Single source of truth for authentication.
# Brute-force protected via distributed Redis rate limiting.
# ═══════════════════════════════════════════════════════════════

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

import uuid
from fastapi import APIRouter, Depends, Request, Response, Body, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api import deps
from app.core import security
from app.core.config import settings
from app.core.exceptions import (
    AuthenticationError,
    BruteForceDetectedError,
    InvalidCredentialsError,
    ValidationError,
)
from app.core.rate_limit import check_auth_brute_force, clear_auth_rate_limit, check_rate_limit
from app.core.session import (
    create_refresh_token,
    rotate_refresh_token,
    revoke_refresh_token,
    revoke_all_user_tokens,
)
from app.models.user import User
from app.models.customer import Customer
from app.core.tenant import tenant_store_id
from app.schemas.token import Token
from app.schemas.user import User as UserSchema
from app.services.user_service import user_service
from fastapi import HTTPException

router = APIRouter()
logger = logging.getLogger("app.auth")

_COOKIE_NAME = "__session"
_REFRESH_COOKIE_NAME = "__refresh"
_SAME_SITE = "lax"


def _set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    access_max_age: int,
    refresh_max_age: int,
) -> None:
    response.set_cookie(
        key=_COOKIE_NAME,
        value=access_token,
        httponly=True,
        max_age=access_max_age,
        expires=access_max_age,
        samesite=_SAME_SITE,
        secure=(settings.ENVIRONMENT == "production"),
        path="/",
    )
    response.set_cookie(
        key=_REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        max_age=refresh_max_age,
        expires=refresh_max_age,
        samesite=_SAME_SITE,
        secure=(settings.ENVIRONMENT == "production"),
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(key=_COOKIE_NAME, path="/", samesite=_SAME_SITE)
    response.delete_cookie(key=_REFRESH_COOKIE_NAME, path="/", samesite=_SAME_SITE)


def _build_user_payload(user: User) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "avatar": user.avatar,
        "phone": user.phone,
        "is_active": user.is_active,
        "employee_store_id": str(user.employee_store_id) if user.employee_store_id else None,
        "assigned_store_scope": getattr(user, "assigned_store_scope", "ALL"),
        "assigned_store_ids": [str(s) for s in (getattr(user, "assigned_store_ids", None) or [])],
        "daily_target": user.daily_target,
    }


def _extract_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    return forwarded.split(",")[0].strip() or request.headers.get("X-Real-Ip", "127.0.0.1")


# ─── POST /auth/register ──────────────────────────────────────────────────────

@router.post("/register", response_model=Any, status_code=201)
def register(
    request: Request,
    response: Response,
    db: Session = Depends(deps.get_db),
    body: dict = Body(...),
):
    """
    Public self-registration (CUSTOMER role).
    Creates account, sets httpOnly session cookie.
    """
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    name = (body.get("name") or "").strip()

    if not email or not password or not name:
        raise ValidationError(message="Nom, email et mot de passe sont requis.")
    if len(password) < 8:
        raise ValidationError(message="Mot de passe trop court (minimum 8 caractères).")

    if user_service.get_by_email(db, email):
        from app.core.exceptions import DuplicateResourceError
        raise DuplicateResourceError(message="Un compte avec cet email existe déjà.")

    user = User(
        id=str(uuid.uuid4()),
        email=email,
        name=name,
        hashed_password=security.get_password_hash(password),
        role="CUSTOMER",
        phone=body.get("phone"),
        is_active=True,
    )
    db.add(user)
    db.flush()

    # Create a linked Customer record so this account appears in the customers list
    store_id = tenant_store_id.get()
    if store_id and store_id != "SUPER_ADMIN_MODE":
        phone = (body.get("phone") or "").strip()
        existing_customer = None
        if phone:
            existing_customer = db.query(Customer).filter(
                Customer.store_id == store_id,
                Customer.phone == phone,
            ).first()
        if existing_customer:
            existing_customer.source = "ACCOUNT"  # type: ignore[assignment]
            existing_customer.is_guest = False  # type: ignore[assignment]
            existing_customer.email = email  # type: ignore[assignment]
            existing_customer.name = name  # type: ignore[assignment]
        else:
            db.add(Customer(
                id=str(uuid.uuid4()),
                store_id=store_id,
                phone=phone or email,
                name=name,
                email=email,
                is_guest=False,
                source="ACCOUNT",
                tier="BRONZE",
            ))

    db.commit()
    db.refresh(user)

    expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = security.create_access_token(
        user.id,
        expires_delta=expires,
        extra_data={"role": user.role, "email": user.email, "storeId": None},
    )
    refresh_token = create_refresh_token(user.id)
    _set_auth_cookies(
        response,
        token,
        refresh_token,
        int(expires.total_seconds()),
        7 * 24 * 60 * 60,
    )

    logger.info("New customer registered: %s (id=%s)", email, user.id)
    return {"success": True, "data": {"user": _build_user_payload(user)}}


# ─── POST /auth/ — JSON login ─────────────────────────────────────────────────

@router.post("/", response_model=Any)
def login_json(
    request: Request,
    response: Response,
    db: Session = Depends(deps.get_db),
    body: dict = Body(...),
):
    """
    JSON-based login for Next.js frontend.
    Protected by Redis-backed brute-force rate limiting.
    Sets httpOnly __session cookie on success.
    """
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    if not email or not password:
        raise ValidationError(message="Email et mot de passe sont requis.")

    ip = _extract_ip(request)

    # ── Brute-force check (Disabled) ─────────────────────────────
    # rate = check_auth_brute_force(ip, email)
    # if not rate.allowed:
    #     logger.warning("Brute-force detected: ip=%s email=%s", ip, email)
    #     raise BruteForceDetectedError(
    #         retry_after=rate.retry_after,
    #         context={"retry_after": rate.retry_after},
    #     )

    # ── Authenticate ─────────────────────────────────────────────
    user = user_service.authenticate(db, email=email, password=password)
    if not user:
        logger.warning("Failed login attempt: ip=%s email=%s", ip, email)
        raise InvalidCredentialsError()
    if not user.is_active:
        raise AuthenticationError(
            message="Compte inactif. Contactez votre administrateur.",
            error_code="ACCOUNT_DISABLED",
        )

    # ── Issue token ───────────────────────────────────────────────
    expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = security.create_access_token(
        user.id,
        expires_delta=expires,
        extra_data={
            "role": user.role,
            "email": user.email,
            "storeId": str(user.employee_store_id) if user.employee_store_id else None,
        },
    )
    refresh_token = create_refresh_token(user.id)
    _set_auth_cookies(
        response,
        token,
        refresh_token,
        int(expires.total_seconds()),
        7 * 24 * 60 * 60,
    )

    # Clear brute-force counters (Disabled)
    # clear_auth_rate_limit(ip, email)

    logger.info("Successful login: email=%s role=%s ip=%s", email, user.role, ip)
    return {"success": True, "data": {"user": _build_user_payload(user)}}


# ─── POST /auth/login/access-token — OAuth2 Bearer ───────────────────────────

@router.post("/login/access-token", response_model=Token)
def login_oauth2(
    request: Request,
    response: Response,
    db: Session = Depends(deps.get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    """
    OAuth2 form-based login — returns JWT Bearer token.
    Used by Swagger UI and machine-to-machine clients.
    """
    ip = _extract_ip(request)
    # rate = check_auth_brute_force(ip, form_data.username)
    # if not rate.allowed:
    #     raise BruteForceDetectedError(retry_after=rate.retry_after)

    user = user_service.authenticate(db, email=form_data.username, password=form_data.password)
    if not user or not user.is_active:
        raise InvalidCredentialsError()

    clear_auth_rate_limit(ip, form_data.username)
    expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = security.create_access_token(
        user.id,
        expires_delta=expires,
        extra_data={
            "role": user.role,
            "email": user.email,
            "storeId": str(user.employee_store_id) if user.employee_store_id else None,
        },
    )
    refresh_token = create_refresh_token(user.id)
    _set_auth_cookies(
        response,
        token,
        refresh_token,
        int(expires.total_seconds()),
        7 * 24 * 60 * 60,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "refresh_token": refresh_token,
    }


# ─── GET /auth/me ─────────────────────────────────────────────────────────────

@router.get("/me", response_model=UserSchema)
def get_me(current_user: User = Depends(deps.get_current_active_user)):
    """Return the currently authenticated user's profile."""
    return current_user


# ─── POST /auth/refresh ───────────────────────────────────────────────────────

@router.post("/refresh", response_model=Any)
def refresh_session(
    request: Request,
    response: Response,
    db: Session = Depends(deps.get_db),
):
    """
    Rotate refresh token and issue a fresh access JWT cookie.
    Brute-force protected via Redis sliding window.
    """
    ip = _extract_ip(request)
    
    # ── Rate limit check on refresh endpoint ─────────────────
    rate = check_rate_limit(key=f"rl:refresh:ip:{ip}", limit=10, window_seconds=60)
    if not rate.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trop de demandes de rafraîchissement. Réessayez plus tard.",
        )

    refresh_token = request.cookies.get("__refresh")
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expirée ou refresh token manquant.",
        )

    try:
        new_refresh_token, user_id = rotate_refresh_token(refresh_token)
    except ValueError as exc:
        _clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc)
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        _clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Utilisateur inactif ou introuvable."
        )

    expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = security.create_access_token(
        user.id,
        expires_delta=expires,
        extra_data={
            "role": user.role,
            "email": user.email,
            "storeId": str(user.employee_store_id) if user.employee_store_id else None,
        },
    )
    _set_auth_cookies(
        response,
        token,
        new_refresh_token,
        int(expires.total_seconds()),
        7 * 24 * 60 * 60,
    )
    return {"success": True, "message": "Session rafraîchie avec succès."}


# ─── DELETE /auth/ — Logout ───────────────────────────────────────────────────

@router.delete("/", response_model=Any)
def logout(request: Request, response: Response):
    """Clear session cookies and revoke current refresh token in Redis."""
    refresh_token = request.cookies.get("__refresh")
    if refresh_token:
        revoke_refresh_token(refresh_token)
    _clear_auth_cookies(response)
    return {"success": True, "message": "Déconnecté avec succès."}


# ─── POST /auth/logout-all — Global Logout ────────────────────────────────────

@router.post("/logout-all", response_model=Any)
def logout_all(
    response: Response,
    current_user: User = Depends(deps.get_current_active_user)
):
    """Revoke ALL sessions/refresh tokens for the current user."""
    revoke_all_user_tokens(current_user.id)
    _clear_auth_cookies(response)
    return {"success": True, "message": "Toutes les sessions ont été déconnectées."}
