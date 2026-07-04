"""
Notification service — single entry point for every business notification.

`notify()` only writes the in-app row (never raises: a notification must
never break the business operation that triggered it). The `channel`
column is stored so that future email / push / whatsapp / sms dispatchers
can consume the same rows without schema changes.

Notification types:
    ORDER_ASSIGNED    — an order was assigned to an agent
    REMINDER_DUE      — a scheduled callback time has passed
    NRP_FOLLOWUP      — an NRP was recorded (with attempt count / auto-cancel)
    CART_RECOVERED    — an abandoned cart reached CONFIRMED
    ORDER_DELIVERED   — carrier confirmed delivery (commission earned)
    NOEST_SYNC_ERROR  — automatic carrier synchronization failed
    DUPLICATE_MERGED  — duplicate order(s) automatically merged
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app.models.notification import Notification

logger = logging.getLogger("app.notifications")


def notify(
    db: Session,
    *,
    type: str,
    title: str,
    message: Optional[str] = None,
    user_id: Optional[str] = None,   # None = broadcast to admins
    store_id: Optional[str] = None,
    order_id: Optional[str] = None,
    channel: str = "inapp",
) -> Optional[Notification]:
    """Persist a notification row. Swallows every error by design."""
    try:
        n = Notification(
            id=str(uuid.uuid4()),
            user_id=user_id,
            store_id=store_id,
            order_id=order_id,
            type=type,
            title=title,
            message=message,
            channel=channel,
        )
        db.add(n)
        return n
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("notify(%s) failed: %s", type, exc)
        return None
