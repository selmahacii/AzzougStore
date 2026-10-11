import re
import hmac
import hashlib
import base64
import logging
from typing import Optional, Any

logger = logging.getLogger("app.shopify")


def validate_shopify_domain(domain: str) -> str:
    """
    Validates and normalizes a Shopify shop domain.
    Strips protocols, trailing slashes, leading/trailing whitespace, and forces lowercase.
    Ensures safe domain pattern (no query parameters, no path traversal, no injection).
    """
    if not domain or not isinstance(domain, str):
        raise ValueError("Le nom de domaine Shopify est requis.")

    cleaned = domain.strip().lower()
    cleaned = re.sub(r"^https?://", "", cleaned)
    cleaned = cleaned.split("/")[0].split("?")[0].split("#")[0].strip()

    # Valid hostname regex: alphanumeric labels separated by dots, each label up to 63 chars
    hostname_pattern = r"^([a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$"
    if not re.match(hostname_pattern, cleaned):
        raise ValueError(
            f"Domaine Shopify invalide: '{domain}'. "
            "Format attendu: 'nom-boutique.myshopify.com' ou un nom de domaine valide."
        )

    return cleaned


def verify_shopify_hmac(raw_body: bytes, secret: str, hmac_header: Optional[str]) -> bool:
    """
    Verifies that the incoming raw HTTP body matches the Shopify HMAC-SHA256 signature.
    Shopify computes HMAC-SHA256 with the app's shared webhook secret and base64-encodes it.
    
    Uses hmac.compare_digest for constant-time comparison to prevent timing attacks.
    """
    if not secret or not hmac_header or not raw_body:
        return False

    try:
        secret_bytes = secret.strip().encode("utf-8")
        computed_digest = hmac.new(secret_bytes, raw_body, hashlib.sha256).digest()
        computed_hmac = base64.b64encode(computed_digest).decode("utf-8")
        return hmac.compare_digest(computed_hmac, hmac_header.strip())
    except Exception as exc:
        logger.warning(f"Erreur lors du calcul de signature HMAC Shopify: {exc}")
        return False


def sanitize_error_message(error: Any) -> str:
    """
    Expunges sensitive credentials, access tokens, API secrets, and Bearer strings
    from error messages before storing them in the database or logs.
    """
    if error is None:
        return ""

    msg = str(error)

    # Redact Shopify tokens (shpat_..., shpca_..., shppa_..., shpua_...)
    msg = re.sub(r"shp[a-z]{2}_[a-zA-Z0-9]{20,}", "[REDACTED_SHOPIFY_TOKEN]", msg)

    # Redact Bearer tokens
    msg = re.sub(r"Bearer\s+[a-zA-Z0-9\-_.]+", "Bearer [REDACTED_TOKEN]", msg, flags=re.IGNORECASE)

    # Redact long hex secrets (32 to 64 hex characters)
    msg = re.sub(r"\b[a-f0-9]{32,64}\b", "[REDACTED_HEX_SECRET]", msg, flags=re.IGNORECASE)

    # Redact passwords in connection strings or queries
    msg = re.sub(r"://([^:]+):([^@]+)@", r"://\1:[REDACTED_PASSWORD]@", msg)

    # Truncate to safe length
    max_len = 2000
    if len(msg) > max_len:
        msg = msg[:max_len] + "... [TRUNCATED]"

    return msg
