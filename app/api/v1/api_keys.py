"""
API Keys — Generate and manage API keys for store integrations.
Keys are hashed before storage; the raw key is shown only once at creation.
"""
from __future__ import annotations

import hashlib
import secrets
import json
from datetime import datetime, timezone
from typing import Optional, Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Column, String, Boolean, DateTime, Text, ForeignKey, func as sqlfunc
from sqlalchemy.orm import Session

from app.api import deps
from app.db.session import get_db
from app.db.base_class import Base

router = APIRouter()


# ─── Model (inline, table created via migration) ─────────────
class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    key_hash = Column(String, nullable=False, unique=True)
    key_prefix = Column(String, nullable=False)          # e.g. "azk_live_abc1"
    permissions = Column(Text, server_default='["read"]')
    is_active = Column(Boolean, default=True)
    last_used_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


# ─── Schemas ─────────────────────────────────────────────────
class ApiKeyCreate(BaseModel):
    store_id: str
    name: str
    permissions: list[str] = ["read"]
    expires_at: Optional[str] = None


class ApiKeyOut(BaseModel):
    id: str
    store_id: str
    name: str
    key_prefix: str
    permissions: list[str]
    is_active: bool
    last_used_at: Optional[str]
    expires_at: Optional[str]
    created_at: Optional[str]

    class Config:
        from_attributes = True


def _serialize(k: ApiKey) -> dict:
    try:
        perms = json.loads(k.permissions) if k.permissions else ["read"]
    except Exception:
        perms = ["read"]
    return {
        "id": k.id,
        "store_id": k.store_id,
        "name": k.name,
        "key_prefix": k.key_prefix,
        "permissions": perms,
        "is_active": k.is_active,
        "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
        "expires_at": k.expires_at.isoformat() if k.expires_at else None,
        "created_at": k.created_at.isoformat() if k.created_at else None,
    }


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


# ─── Routes ──────────────────────────────────────────────────

@router.get("/")
def list_api_keys(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    keys = db.query(ApiKey).filter(ApiKey.store_id == store_id).order_by(ApiKey.created_at.desc()).all()
    return {"success": True, "data": [_serialize(k) for k in keys]}


@router.post("/")
def create_api_key(
    payload: ApiKeyCreate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    """Generate a new API key. The raw key is returned once and never stored."""
    # Generate: azk_live_<32 random hex chars>
    raw_key = "azk_live_" + secrets.token_hex(24)
    prefix = raw_key[:16] + "..."    # show prefix only for listing
    hashed = _hash_key(raw_key)

    expires_at = None
    if payload.expires_at:
        try:
            expires_at = datetime.fromisoformat(payload.expires_at)
        except ValueError:
            pass

    key = ApiKey(
        id=str(uuid.uuid4()),
        store_id=payload.store_id,
        name=payload.name,
        key_hash=hashed,
        key_prefix=prefix,
        permissions=json.dumps(payload.permissions),
        is_active=True,
        expires_at=expires_at,
        created_by=current_user.id,
    )
    db.add(key)
    db.commit()
    db.refresh(key)

    result = _serialize(key)
    result["raw_key"] = raw_key  # only time the raw key is exposed
    return {"success": True, "data": result}


@router.patch("/{key_id}/toggle")
def toggle_api_key(
    key_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    key = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not key:
        raise HTTPException(404, "Clé introuvable")
    key.is_active = not key.is_active  # type: ignore[assignment]
    db.commit()
    return {"success": True, "is_active": key.is_active}


@router.delete("/{key_id}")
def delete_api_key(
    key_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    key = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not key:
        raise HTTPException(404, "Clé introuvable")
    db.delete(key)
    db.commit()
    return {"success": True}


@router.post("/verify")
def verify_api_key(
    payload: dict,
    db: Session = Depends(get_db),
):
    """Verify a raw API key (used by external integrations)."""
    raw = payload.get("key", "")
    if not raw:
        raise HTTPException(400, "Clé manquante")
    hashed = _hash_key(raw)
    key = db.query(ApiKey).filter(ApiKey.key_hash == hashed, ApiKey.is_active == True).first()
    if not key:
        raise HTTPException(401, "Clé invalide ou révoquée")
    if key.expires_at and key.expires_at < datetime.now(timezone.utc):
        raise HTTPException(401, "Clé expirée")
    # Update last used
    key.last_used_at = datetime.now(timezone.utc)
    db.commit()
    try:
        perms = json.loads(key.permissions) if key.permissions else ["read"]
    except Exception:
        perms = ["read"]
    return {"success": True, "store_id": key.store_id, "permissions": perms}
