# ═══════════════════════════════════════════════════════════════
# AzzougShop — Centralized Error Handlers
# Registers exception handlers on the FastAPI app instance.
# Produces structured, standardised JSON error responses.
# ═══════════════════════════════════════════════════════════════

import logging
import traceback
import uuid
from typing import Union

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.exceptions import (
    AppException,
    InsufficientStockError,
    RateLimitError,
)
from app.core.config import settings

logger = logging.getLogger("app.errors")


# ─── Helper: build standard error envelope ───────────────────────────────────

def _error_response(
    *,
    status_code: int,
    error_code: str,
    message: str,
    request_id: str,
    detail: Union[list, dict, None] = None,
    retry_after: int = 0,
) -> JSONResponse:
    body = {
        "success": False,
        "error_code": error_code,
        "message": message,
        "request_id": request_id,
    }
    if detail is not None:
        body["detail"] = detail

    headers = {}
    if retry_after:
        headers["Retry-After"] = str(retry_after)
    if status_code == 429:
        headers["X-RateLimit-Remaining"] = "0"

    return JSONResponse(status_code=status_code, content=body, headers=headers)


def _get_request_id(request: Request) -> str:
    """Extract or generate a correlation/trace ID for this request."""
    return (
        request.headers.get("X-Request-Id")
        or request.headers.get("X-Correlation-Id")
        or str(uuid.uuid4())
    )


# ─── Handler: Our custom AppException hierarchy ───────────────────────────────

async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    request_id = _get_request_id(request)

    # Log at appropriate level
    if exc.status_code >= 500:
        logger.error(
            "AppException[%s] %s %s → %s: %s | ctx=%s",
            request_id, request.method, request.url.path,
            exc.error_code, exc.message, exc.context,
            exc_info=exc.cause,
        )
    elif exc.status_code >= 400:
        logger.warning(
            "AppException[%s] %s %s → %s: %s",
            request_id, request.method, request.url.path,
            exc.error_code, exc.message,
        )

    # Report 5xx to Sentry if available
    if exc.status_code >= 500:
        try:
            import sentry_sdk
            sentry_sdk.capture_exception(exc)
        except ImportError:
            pass

    retry_after = getattr(exc, "retry_after", 0)
    return _error_response(
        status_code=exc.status_code,
        error_code=exc.error_code,
        message=exc.message,
        request_id=request_id,
        detail=exc.context if exc.context else None,
        retry_after=retry_after,
    )


# ─── Handler: Pydantic / FastAPI validation errors ────────────────────────────

async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    request_id = _get_request_id(request)
    logger.warning(
        "ValidationError[%s] %s %s: %s",
        request_id, request.method, request.url.path, exc.errors(),
    )

    # Flatten Pydantic v2 error format to human-readable list
    errors = [
        {
            "field": ".".join(str(loc) for loc in err["loc"]),
            "message": err["msg"],
            "type": err["type"],
        }
        for err in exc.errors()
    ]

    return _error_response(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        error_code="VALIDATION_ERROR",
        message="Données de requête invalides.",
        request_id=request_id,
        detail=errors,
    )


# ─── Handler: Standard Starlette/FastAPI HTTPException ───────────────────────

async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    request_id = _get_request_id(request)

    # Map common HTTP status codes to machine-readable error codes
    CODE_MAP = {
        400: "BAD_REQUEST",
        401: "AUTH_REQUIRED",
        403: "PERMISSION_DENIED",
        404: "NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
        409: "CONFLICT",
        422: "UNPROCESSABLE_ENTITY",
        429: "RATE_LIMITED",
        500: "INTERNAL_ERROR",
        502: "BAD_GATEWAY",
        503: "SERVICE_UNAVAILABLE",
    }
    error_code = CODE_MAP.get(exc.status_code, f"HTTP_{exc.status_code}")

    if exc.status_code >= 500:
        logger.error(
            "HTTPException[%s] %s %s → %d: %s",
            request_id, request.method, request.url.path,
            exc.status_code, exc.detail,
        )
    elif exc.status_code not in (404, 405):
        logger.warning(
            "HTTPException[%s] %s %s → %d: %s",
            request_id, request.method, request.url.path,
            exc.status_code, exc.detail,
        )

    detail = exc.detail if not isinstance(exc.detail, str) else None
    message = exc.detail if isinstance(exc.detail, str) else str(exc.status_code)

    return _error_response(
        status_code=exc.status_code,
        error_code=error_code,
        message=message,
        request_id=request_id,
        detail=detail,
    )


# ─── Handler: SQLAlchemy IntegrityError (unique constraint, FK, etc.) ─────────

async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    request_id = _get_request_id(request)
    logger.error(
        "IntegrityError[%s] %s %s: %s",
        request_id, request.method, request.url.path, str(exc.orig),
    )
    try:
        import sentry_sdk
        sentry_sdk.capture_exception(exc)
    except ImportError:
        pass

    # Detect duplicate key vs FK violation
    orig_msg = str(exc.orig).lower()
    if "unique" in orig_msg or "duplicate" in orig_msg:
        return _error_response(
            status_code=409,
            error_code="DUPLICATE_RESOURCE",
            message="Cette ressource existe déjà.",
            request_id=request_id,
        )
    if "foreign key" in orig_msg or "fk" in orig_msg:
        return _error_response(
            status_code=422,
            error_code="REFERENTIAL_INTEGRITY_ERROR",
            message="Référence invalide vers une ressource inexistante.",
            request_id=request_id,
        )
    return _error_response(
        status_code=500,
        error_code="DATABASE_ERROR",
        message="Erreur d'intégrité base de données.",
        request_id=request_id,
    )


# ─── Handler: SQLAlchemy OperationalError (connection, timeout) ───────────────

async def operational_error_handler(request: Request, exc: OperationalError) -> JSONResponse:
    request_id = _get_request_id(request)
    logger.critical(
        "OperationalError[%s] %s %s: %s",
        request_id, request.method, request.url.path, str(exc.orig),
    )
    try:
        import sentry_sdk
        sentry_sdk.capture_exception(exc)
    except ImportError:
        pass

    return _error_response(
        status_code=503,
        error_code="DATABASE_UNAVAILABLE",
        message="Base de données temporairement indisponible. Réessayez.",
        request_id=request_id,
    )


# ─── Handler: Catch-all unhandled exceptions ─────────────────────────────────

async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = _get_request_id(request)

    # Always log full traceback for unhandled errors
    logger.critical(
        "UnhandledException[%s] %s %s:\n%s",
        request_id, request.method, request.url.path,
        traceback.format_exc(),
    )
    try:
        import sentry_sdk
        sentry_sdk.capture_exception(exc)
    except ImportError:
        pass

    # In production: never leak internal details
    if settings.ENVIRONMENT == "production":
        message = "Une erreur interne est survenue. Notre équipe a été notifiée."
    else:
        # In development: expose exception class + message for faster debugging
        message = f"[DEV] {type(exc).__name__}: {exc}"

    return _error_response(
        status_code=500,
        error_code="INTERNAL_ERROR",
        message=message,
        request_id=request_id,
    )


# ─── Registration ─────────────────────────────────────────────────────────────

def register_error_handlers(app: FastAPI) -> None:
    """Register all exception handlers on the FastAPI application."""
    # Our custom exception hierarchy (must come before generic Exception)
    app.add_exception_handler(AppException, app_exception_handler)  # type: ignore[arg-type]

    # FastAPI/Starlette built-ins
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]

    # SQLAlchemy
    app.add_exception_handler(IntegrityError, integrity_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(OperationalError, operational_error_handler)  # type: ignore[arg-type]

    # Catch-all — must be registered last
    app.add_exception_handler(Exception, unhandled_exception_handler)  # type: ignore[arg-type]
