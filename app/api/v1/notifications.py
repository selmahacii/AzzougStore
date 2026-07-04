"""
Notifications feed API.

Visibility rules:
- Every user sees their own notifications (user_id == current user).
- Admin roles (SUPER_ADMIN / ADMIN / MANAGER) additionally see broadcasts
  (user_id IS NULL): recovered carts, Noest sync errors, …
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api import deps
from app.models.notification import Notification
from app.models.user import User

router = APIRouter()

ADMIN_ROLES = ("SUPER_ADMIN", "ADMIN", "MANAGER")


def _visible(query, user: User):
    if user.role in ADMIN_ROLES:
        return query.filter(or_(Notification.user_id == user.id, Notification.user_id.is_(None)))
    return query.filter(Notification.user_id == user.id)


def _serialize(n: Notification) -> dict:
    return {
        "id": n.id,
        "type": n.type,
        "title": n.title,
        "message": n.message,
        "order_id": n.order_id,
        "store_id": n.store_id,
        "channel": n.channel,
        "is_read": n.is_read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("", response_model=dict, include_in_schema=False)
@router.get("/", response_model=dict)
def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(30, le=100),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    base = _visible(db.query(Notification), current_user)
    if unread_only:
        base = base.filter(Notification.is_read == False)
    items = base.order_by(Notification.created_at.desc()).limit(limit).all()
    unread = _visible(db.query(Notification), current_user).filter(Notification.is_read == False).count()
    return {"success": True, "data": [_serialize(n) for n in items], "unread": unread}


@router.patch("/{id}/read", response_model=dict)
def mark_read(
    id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    n = _visible(db.query(Notification), current_user).filter(Notification.id == id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification introuvable.")
    n.is_read = True
    db.commit()
    return {"success": True}


@router.post("/read-all", response_model=dict)
def mark_all_read(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    updated = (
        _visible(db.query(Notification), current_user)
        .filter(Notification.is_read == False)
        .update({Notification.is_read: True}, synchronize_session=False)
    )
    db.commit()
    return {"success": True, "updated": updated}
