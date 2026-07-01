# ═══════════════════════════════════════════════════════════════
# AzzougShop — Centralized Exception Architecture
# Enterprise-grade error taxonomy with machine-readable codes.
# ═══════════════════════════════════════════════════════════════

from typing import Any, Dict, Optional
from http import HTTPStatus


# ─── Base Exception ──────────────────────────────────────────────────────────

class AppException(Exception):
    """
    Root exception for all application-level errors.
    Carries a machine-readable code, HTTP status, and optional context payload.
    """
    status_code: int = 500
    error_code: str = "INTERNAL_ERROR"
    message: str = "Une erreur interne est survenue."

    def __init__(
        self,
        message: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
        cause: Optional[Exception] = None,
    ):
        self.message = message or self.__class__.message
        self.context = context or {}
        self.cause = cause
        super().__init__(self.message)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": False,
            "error_code": self.error_code,
            "message": self.message,
            "status": self.status_code,
        }


# ─── 400 — Validation & Business Logic ──────────────────────────────────────

class ValidationError(AppException):
    """Request payload failed schema or business validation."""
    status_code = 400
    error_code = "VALIDATION_ERROR"
    message = "Données de requête invalides."


class BusinessRuleError(AppException):
    """An operation violated a domain business rule."""
    status_code = 422
    error_code = "BUSINESS_RULE_VIOLATION"
    message = "Opération refusée par les règles métier."


class InvalidStateTransitionError(BusinessRuleError):
    """Order/workflow state machine rejected the transition."""
    error_code = "INVALID_STATE_TRANSITION"
    message = "Transition de statut invalide."


class DuplicateResourceError(AppException):
    """Resource already exists (unique constraint violation)."""
    status_code = 409
    error_code = "DUPLICATE_RESOURCE"
    message = "Cette ressource existe déjà."


# ─── 401/403 — Auth & Permissions ────────────────────────────────────────────

class AuthenticationError(AppException):
    """Invalid credentials or missing authentication."""
    status_code = 401
    error_code = "AUTH_REQUIRED"
    message = "Authentification requise."


class InvalidCredentialsError(AuthenticationError):
    """Login failed: wrong email or password."""
    error_code = "INVALID_CREDENTIALS"
    message = "Email ou mot de passe incorrect."


class TokenExpiredError(AuthenticationError):
    """JWT token has expired."""
    error_code = "TOKEN_EXPIRED"
    message = "Session expirée. Veuillez vous reconnecter."


class PermissionError(AppException):  # noqa: A001
    """Authenticated user lacks required permissions."""
    status_code = 403
    error_code = "PERMISSION_DENIED"
    message = "Accès refusé."


class StoreAccessDeniedError(PermissionError):
    """User does not have access to the requested store."""
    error_code = "STORE_ACCESS_DENIED"
    message = "Vous n'avez pas accès à cette boutique."


# ─── 404 — Not Found ─────────────────────────────────────────────────────────

class NotFoundError(AppException):
    """Requested resource does not exist."""
    status_code = 404
    error_code = "NOT_FOUND"
    message = "Ressource introuvable."


class OrderNotFoundError(NotFoundError):
    error_code = "ORDER_NOT_FOUND"
    message = "Commande introuvable."


class ProductNotFoundError(NotFoundError):
    error_code = "PRODUCT_NOT_FOUND"
    message = "Produit introuvable."


class StoreNotFoundError(NotFoundError):
    error_code = "STORE_NOT_FOUND"
    message = "Boutique introuvable."


class UserNotFoundError(NotFoundError):
    error_code = "USER_NOT_FOUND"
    message = "Utilisateur introuvable."


# ─── 409/422 — Stock & Inventory ─────────────────────────────────────────────

class StockError(AppException):
    """General stock/inventory error."""
    status_code = 409
    error_code = "STOCK_ERROR"
    message = "Erreur de gestion du stock."


class InsufficientStockError(StockError):
    """Not enough available (unreserved) stock to fulfill the operation."""
    error_code = "INSUFFICIENT_STOCK"
    message = "Stock disponible insuffisant."

    def __init__(self, product_id: str, requested: int, available: int, **kwargs):
        super().__init__(
            message=f"Stock insuffisant pour le produit {product_id}: "
                    f"demandé={requested}, disponible={available}",
            context={"product_id": product_id, "requested": requested, "available": available},
            **kwargs,
        )


class StockReservationError(StockError):
    """Failed to acquire stock reservation lock."""
    error_code = "STOCK_RESERVATION_FAILED"
    message = "Impossible de réserver le stock. Réessayez."


class StockReleaseError(StockError):
    """Failed to release a stock reservation."""
    error_code = "STOCK_RELEASE_FAILED"
    message = "Impossible de libérer la réservation stock."


# ─── 429 — Rate Limiting ─────────────────────────────────────────────────────

class RateLimitError(AppException):
    """Too many requests in the allowed time window."""
    status_code = 429
    error_code = "RATE_LIMITED"
    message = "Trop de requêtes. Veuillez réessayer plus tard."

    def __init__(self, retry_after: int = 60, **kwargs):
        super().__init__(**kwargs)
        self.retry_after = retry_after
        self.context["retry_after"] = retry_after


class BruteForceDetectedError(RateLimitError):
    """Auth endpoint brute-force protection triggered."""
    error_code = "BRUTE_FORCE_DETECTED"
    message = "Trop de tentatives de connexion. Compte temporairement bloqué."


# ─── 500/502/503 — Infrastructure ────────────────────────────────────────────

class DatabaseError(AppException):
    """SQLAlchemy or database-level failure."""
    status_code = 500
    error_code = "DATABASE_ERROR"
    message = "Erreur base de données."


class CacheError(AppException):
    """Redis or cache-layer failure."""
    status_code = 503
    error_code = "CACHE_ERROR"
    message = "Service de cache indisponible."


class ExternalApiError(AppException):
    """Third-party API (carrier, payment, etc.) returned an error."""
    status_code = 502
    error_code = "EXTERNAL_API_ERROR"
    message = "Service externe indisponible."

    def __init__(self, service_name: str, upstream_status: int = 0, **kwargs):
        super().__init__(**kwargs)
        self.context["service"] = service_name
        self.context["upstream_status"] = upstream_status


class PaymentError(AppException):
    """Payment processing failed."""
    status_code = 402
    error_code = "PAYMENT_FAILED"
    message = "Paiement refusé."


class ServiceUnavailableError(AppException):
    """Service is temporarily down (maintenance, overload)."""
    status_code = 503
    error_code = "SERVICE_UNAVAILABLE"
    message = "Service temporairement indisponible."
