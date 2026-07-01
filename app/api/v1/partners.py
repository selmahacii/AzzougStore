from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Any
import secrets
import hashlib
from datetime import datetime, timezone

from app.api import deps
from app.models.partner import PartnerApiKey, PartnerWebhook
from app.schemas.partner import (
    PartnerApiKey as PartnerApiKeySchema,
    PartnerApiKeyCreate,
    PartnerApiKeyUpdate,
    PartnerWebhook as PartnerWebhookSchema,
    PartnerWebhookCreate,
    PartnerWebhookUpdate
)

router = APIRouter()

# ─── API Keys Endpoints ─────────────────────────────────────

@router.get("/keys", response_model=Any)
def get_partner_keys(
    db: Session = Depends(deps.get_db),
    store_id: str = None,
    current_user = Depends(deps.get_current_user)
) -> Any:
    """Get all API keys for a store."""
    query = db.query(PartnerApiKey)
    if store_id:
        query = query.filter(PartnerApiKey.store_id == store_id)
    keys = query.order_by(PartnerApiKey.created_at.desc()).all()
    return {"success": True, "data": keys}

@router.post("/keys", response_model=Any)
def create_partner_key(
    *,
    db: Session = Depends(deps.get_db),
    obj_in: PartnerApiKeyCreate,
    current_user = Depends(deps.get_current_user)
) -> Any:
    """Generate a new API key."""
    # Generate random key
    raw_key = f"az_{secrets.token_urlsafe(32)}"
    hashed_key = hashlib.sha256(raw_key.encode()).hexdigest()
    key_preview = f"{raw_key[:6]}...{raw_key[-4:]}"

    db_obj = PartnerApiKey(
        name=obj_in.name,
        store_id=obj_in.store_id,
        hashed_key=hashed_key,
        key_preview=key_preview
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    
    # We return the raw key ONLY once on creation
    return {
        "success": True, 
        "data": db_obj, 
        "raw_key": raw_key # Frontend should show this to user
    }

@router.post("/keys/{key_id}/rotate", response_model=Any)
def rotate_partner_key(
    *,
    db: Session = Depends(deps.get_db),
    key_id: str,
    current_user = Depends(deps.get_current_user)
) -> Any:
    """Rotate an existing API key."""
    db_obj = db.query(PartnerApiKey).filter(PartnerApiKey.id == key_id).first()
    if not db_obj:
        raise HTTPException(status_code=404, detail="Key not found")
    
    raw_key = f"az_{secrets.token_urlsafe(32)}"
    hashed_key = hashlib.sha256(raw_key.encode()).hexdigest()
    key_preview = f"{raw_key[:6]}...{raw_key[-4:]}"

    db_obj.hashed_key = hashed_key
    db_obj.key_preview = key_preview
    db_obj.last_rotated_at = datetime.now(timezone.utc).replace(tzinfo=None)  # type: ignore[assignment]
    
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    
    return {"success": True, "data": db_obj, "raw_key": raw_key}

@router.delete("/keys/{key_id}", response_model=Any)
def delete_partner_key(
    *,
    db: Session = Depends(deps.get_db),
    key_id: str,
    current_user = Depends(deps.get_current_user)
) -> Any:
    """Revoke an API key."""
    db_obj = db.query(PartnerApiKey).filter(PartnerApiKey.id == key_id).first()
    if not db_obj:
        raise HTTPException(status_code=404, detail="Key not found")
    db.delete(db_obj)
    db.commit()
    return {"success": True}

# ─── Webhooks Endpoints ─────────────────────────────────────

@router.get("/webhooks", response_model=Any)
def get_partner_webhooks(
    db: Session = Depends(deps.get_db),
    store_id: str = None,
    current_user = Depends(deps.get_current_user)
) -> Any:
    """Get all webhooks for a store."""
    query = db.query(PartnerWebhook)
    if store_id:
        query = query.filter(PartnerWebhook.store_id == store_id)
    webhooks = query.order_by(PartnerWebhook.created_at.desc()).all()
    return {"success": True, "data": webhooks}

@router.post("/webhooks", response_model=Any)
def create_partner_webhook(
    *,
    db: Session = Depends(deps.get_db),
    obj_in: PartnerWebhookCreate,
    current_user = Depends(deps.get_current_user)
) -> Any:
    """Create a new webhook."""
    db_obj = PartnerWebhook(
        url=obj_in.url,
        store_id=obj_in.store_id,
        events=obj_in.events
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return {"success": True, "data": db_obj}

@router.delete("/webhooks/{webhook_id}", response_model=Any)
def delete_partner_webhook(
    *,
    db: Session = Depends(deps.get_db),
    webhook_id: str,
    current_user = Depends(deps.get_current_user)
) -> Any:
    """Delete a webhook."""
    db_obj = db.query(PartnerWebhook).filter(PartnerWebhook.id == webhook_id).first()
    if not db_obj:
        raise HTTPException(status_code=404, detail="Webhook not found")
    db.delete(db_obj)
    db.commit()
    return {"success": True}
