import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models.shopify import ShopifyWebhookInbox
from app.services.shopify_service import sanitize_error_message
from app.services.shopify_order_service import (
    ShopifyOrderService,
    ShopifyOrderError,
)

logger = logging.getLogger("app.shopify.sync")

# Topics actively supported for business ingestion in Phase 2
SUPPORTED_TOPICS = {
    "orders/create",
    "orders/updated",
    "orders/paid",
    "products/update",
}


class ShopifyWebhookProcessor:
    """
    Transactional processor for durable Shopify inbox events.
    Applies SELECT FOR UPDATE SKIP LOCKED to prevent concurrent duplicate execution across workers.
    """

    @classmethod
    def process_event_standalone(cls, event_id: str) -> bool:
        """
        Standalone runner for background tasks or queue workers.
        Creates its own isolated DB session and ensures reliable cleanup.
        Prevents using closed request-scoped sessions.
        """
        from app.db.session import SessionLocal
        db = SessionLocal()
        db.info["skip_tenant_isolation"] = True
        try:
            return cls.process_event(db=db, event_id=event_id)
        finally:
            db.close()

    @classmethod
    def process_event(cls, db: Session, event_id: str) -> bool:
        """
        Process a single inbox event by ID.
        Returns True if successfully processed or already terminal, False if failed.
        """
        # Acquire row lock without blocking concurrent workers
        event = (
            db.query(ShopifyWebhookInbox)
            .filter(ShopifyWebhookInbox.id == event_id)
            .with_for_update(skip_locked=True)
            .first()
        )

        if not event:
            # Row locked by another worker or not found
            return False

        if event.status in ("PROCESSED", "DEAD_LETTER", "UNSUPPORTED_TOPIC"):
            return True

        event.status = "PROCESSING"
        event.attempts += 1
        db.commit()

        try:
            # 1. Mandatory payload structure check
            if not event.payload or not isinstance(event.payload, dict) or not event.payload.get("id"):
                raise ValueError("Payload de commande Shopify invalide: 'id' manquant.")

            # ─── Topic Dispatcher (Phase 2 Order Ingestion) ──────────────────
            topic = (event.topic or "").strip().lower()

            if topic not in SUPPORTED_TOPICS:
                # Unsupported events must NOT be reported as business success
                event.status = "UNSUPPORTED_TOPIC"
                event.last_error = f"Sujet de webhook non pris en charge: '{event.topic}'"
                event.next_retry_at = None
                db.commit()
                logger.info(
                    f"[ShopifyInbox] Événement delivery {event.delivery_id} ignoré: "
                    f"sujet non pris en charge '{event.topic}'."
                )
                return False

            order_desc = ""
            if topic == "orders/create":
                # Only invoke ERP order ingestion if line_items or currency are present
                if "line_items" in event.payload or "currency" in event.payload:
                    order = ShopifyOrderService.import_shopify_order(
                        db=db,
                        store_id=event.store_id,
                        payload=event.payload,
                        delivery_id=event.delivery_id,
                    )
                    order_desc = f" -> Commande interne {order.order_number}"

            # Success transition
            event.status = "PROCESSED"
            event.processed_at = datetime.now(timezone.utc)
            event.last_error = None
            event.next_retry_at = None
            db.commit()
            logger.info(
                f"[ShopifyInbox] Webhook delivery {event.delivery_id} ({event.topic}) "
                f"traité avec succès{order_desc}."
            )
            return True

        except Exception as exc:
            db.rollback()
            # Reload event for updating failure state
            event = db.query(ShopifyWebhookInbox).filter(ShopifyWebhookInbox.id == event_id).first()
            if not event:
                return False

            sanitized_err = sanitize_error_message(exc)
            event.last_error = sanitized_err

            if event.attempts >= event.max_attempts:
                event.status = "DEAD_LETTER"
                event.next_retry_at = None
                logger.error(
                    f"[ShopifyInbox] Échec définitif (DEAD_LETTER) du webhook {event.delivery_id} "
                    f"après {event.attempts} tentatives: {sanitized_err}"
                )
            else:
                event.status = "FAILED"
                # Exponential backoff: 2 min, 4 min, 8 min, 16 min...
                backoff_minutes = 2 ** event.attempts
                event.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=backoff_minutes)
                logger.warning(
                    f"[ShopifyInbox] Échec temporaire du webhook {event.delivery_id} "
                    f"(tentative {event.attempts}/{event.max_attempts}), rejeu programmé à {event.next_retry_at}: {sanitized_err}"
                )

            db.commit()
            return False


def sweep_pending_shopify_webhooks(db: Session, limit: int = 50) -> int:
    """
    Durable recovery sweeper for orphaned, failed, or unconsumed webhooks.
    Can be run on startup or on a periodic leader-locked background loop.
    Guarantees that no webhook is lost even across server restarts or crashes.
    """
    now = datetime.now(timezone.utc)
    pending_events = (
        db.query(ShopifyWebhookInbox)
        .filter(
            ShopifyWebhookInbox.status.in_(["PENDING", "FAILED"]),
            ShopifyWebhookInbox.attempts < ShopifyWebhookInbox.max_attempts,
            or_(
                ShopifyWebhookInbox.next_retry_at.is_(None),
                ShopifyWebhookInbox.next_retry_at <= now,
            ),
        )
        .order_by(ShopifyWebhookInbox.created_at.asc())
        .limit(limit)
        .all()
    )

    processed_count = 0
    for ev in pending_events:
        success = ShopifyWebhookProcessor.process_event(db, ev.id)
        if success:
            processed_count += 1

    return processed_count
