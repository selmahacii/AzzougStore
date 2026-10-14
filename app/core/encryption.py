"""
Symmetric encryption for sensitive config values (API keys, tokens).
Uses Fernet (AES-128-CBC + HMAC-SHA256).
"""
import json
import os
from typing import Any

_fernet = None

def _get_fernet():
    global _fernet
    if _fernet is not None:
        return _fernet
    try:
        from cryptography.fernet import Fernet
        key = os.environ.get("ENCRYPTION_KEY")
        if key:
            _fernet = Fernet(key.encode() if isinstance(key, str) else key)
        # else: encryption disabled — keys stored in plaintext (dev only)
    except ImportError:
        pass  # cryptography not installed — degraded mode
    return _fernet


def encrypt_dict(data: dict) -> str:
    """Encrypt a dict to a base64 string. Falls back to JSON if no key."""
    f = _get_fernet()
    serialized = json.dumps(data)
    if f is None:
        return serialized  # dev fallback — plaintext JSON
    return f.encrypt(serialized.encode()).decode()


def decrypt_dict(encrypted: str) -> dict:
    """Decrypt an encrypted string back to a dict."""
    if not encrypted:
        return {}
    f = _get_fernet()
    if f is None:
        # Try plain JSON fallback
        try:
            return json.loads(encrypted)
        except Exception:
            return {}
    try:
        return json.loads(f.decrypt(encrypted.encode()).decode())
    except Exception:
        # May be unencrypted legacy value
        try:
            return json.loads(encrypted)
        except Exception:
            return {}


def encrypt_string(value: str) -> str:
    """Encrypt a single string value."""
    if not value:
        return value
    f = _get_fernet()
    if f is None:
        return value
    return f.encrypt(value.encode()).decode()


def decrypt_string(encrypted: str) -> str:
    """Decrypt a single string value, falling back to plaintext if invalid."""
    if not encrypted:
        return encrypted
    f = _get_fernet()
    if f is None:
        return encrypted
    try:
        return f.decrypt(encrypted.encode()).decode()
    except Exception:
        # Fallback to legacy/plaintext
        return encrypted


def mask_value(value: Any) -> str:
    """Return a masked version for display (last 4 chars visible)."""
    if value is None:
        return ""
    val_str = str(value)
    if len(val_str) < 8:
        return "****"
    return f"{'*' * (len(val_str) - 4)}{val_str[-4:]}"


from sqlalchemy.types import TypeDecorator, String as SqlString

class EncryptedString(TypeDecorator):
    """SQLAlchemy custom type that transparently encrypts string columns."""
    impl = SqlString

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return encrypt_string(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return decrypt_string(value)


from sqlalchemy.types import JSON as SqlJSON

class EncryptedJSON(TypeDecorator):
    """SQLAlchemy custom type that transparently encrypts sensitive keys (like fb_access_token) in a JSON column."""
    impl = SqlJSON

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        # Copy to avoid mutating the original dict in memory
        val_copy = dict(value)
        if "fb_access_token" in val_copy and val_copy["fb_access_token"]:
            val_copy["fb_access_token"] = encrypt_string(val_copy["fb_access_token"])
        return val_copy

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        # Copy to avoid mutating in place
        val_copy = dict(value)
        if "fb_access_token" in val_copy and val_copy["fb_access_token"]:
            val_copy["fb_access_token"] = decrypt_string(val_copy["fb_access_token"])
        return val_copy
