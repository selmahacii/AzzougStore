"""
Automatic carrier synchronization + reminder scheduler.

A single background loop (started at FastAPI startup) does two things:

1. NOEST intelligent polling
   - Only stores with an active Noest partner AND at least one SHIPPED
     order carrying a tracking number are polled — zero API calls otherwise.
   - All trackings of a store are batched into ONE request
     (POST /api/public/get/trackings/info accepts a list).
   - Detected terminal states (livré / retourné) go through
     order_service.update_order, so COD payment recording, return restock,
     customer tier, notifications, commissions and salaries all follow the
     same business logic as a manual update. Nothing is duplicated.

2. Reminder scheduler (REMINDER_DUE notifications)
   - Every tick, orders whose next_callback_time has passed notify their
     assigned confirmatrice (once per due callback, deduplicated).

Configuration (env):
    NOEST_SYNC_INTERVAL_MINUTES  — polling cadence, default 10
    REMINDER_SCAN_INTERVAL_SECONDS — reminder cadence, default 120
    DISABLE_BACKGROUND_SYNC=1    — disable the whole loop (tests/CI)
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.delivery_partner import DeliveryPartner
from app.models.notification import Notification
from app.models.order import Order
from app.services.notification_service import notify
from app.services.order_service import order_service

logger = logging.getLogger("app.noest_sync")

SYNC_INTERVAL_MINUTES = float(os.getenv("NOEST_SYNC_INTERVAL_MINUTES", "3"))
REMINDER_SCAN_INTERVAL_SECONDS = float(os.getenv("REMINDER_SCAN_INTERVAL_SECONDS", "120"))
# Meta Ads spend/insights auto-sync cadence (fires on the next scheduler tick
# once this many minutes have elapsed).
META_ADS_SYNC_INTERVAL_MINUTES = float(os.getenv("META_ADS_SYNC_INTERVAL_MINUTES", "3"))
# How often to sweep product images still stuck on the ephemeral local disk
# and move them to Cloudinary. Images change far less often than orders/ads,
# so this runs on a slower cadence — just needs to run before a Space restart
# would otherwise wipe them.
CLOUDINARY_MIGRATION_INTERVAL_MINUTES = float(os.getenv("CLOUDINARY_MIGRATION_INTERVAL_MINUTES", "7"))

# NOEST wording → platform terminal statuses. Intermediate states
# (en route, collecté…) are ignored: the order simply stays SHIPPED.
_TERMINAL_MAP = {
    "livré": "DELIVERED", "livre": "DELIVERED", "delivered": "DELIVERED",
    "retourné": "RETURNED", "retourne": "RETURNED", "returned": "RETURNED",
    "retour": "RETURNED",
}

_ACTIVE_CALLBACK_STATES = ["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"]


def _extract_terminal_status(parcel: dict) -> str | None:
    """Derive DELIVERED/RETURNED from a Noest tracking payload, else None."""
    info = parcel.get("OrderInfo") or {}
    raw = (info.get("statut") or info.get("status") or "").strip().lower()
    if not raw:
        activity = parcel.get("activity") or []
        if activity:
            raw = (activity[-1].get("event_key") or activity[-1].get("event") or "").strip().lower()
    for key, mapped in _TERMINAL_MAP.items():
        if key in raw:
            return mapped
    return None


async def _sync_partner(db: Session, partner: DeliveryPartner) -> int:
    """Batch-sync every SHIPPED order of one store's Noest partner. Returns updates applied."""
    orders = (
        db.query(Order)
        .filter(
            Order.store_id == partner.store_id,
            Order.status == "SHIPPED",
            Order.tracking_number.isnot(None),
            Order.tracking_number != "",
            Order.is_deleted == False,
        )
        .all()
    )
    if not orders:
        return 0  # nothing to poll — no API call

    from app.api.carriers.noest import _creds, _headers, TIMEOUT
    token, _guid, base = _creds(partner)
    trackings = [str(o.tracking_number) for o in orders]

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(
            f"{base}/api/public/get/trackings/info",
            headers=_headers(token),
            json={"trackings": trackings},
        )
    if r.status_code != 200:
        raise RuntimeError(f"Noest trackings/info HTTP {r.status_code}: {r.text[:200]}")

    data = r.json() if isinstance(r.json(), dict) else {}
    updated = 0
    for order in orders:
        parcel = data.get(str(order.tracking_number))
        if not isinstance(parcel, dict):
            continue
        new_status = _extract_terminal_status(parcel)
        if not new_status or new_status == str(order.status):
            continue
        # Lock the row only now (after the network call) and re-check the
        # status: a confirmatrice may have updated the order meanwhile.
        db.query(Order.id).filter(Order.id == order.id).with_for_update().first()
        db.refresh(order)
        if str(order.status) != "SHIPPED" or new_status == str(order.status):
            continue
        try:
            order_service.update_order(
                db,
                order=order,
                update_data={
                    "status": new_status,
                    "notes": None,
                    "note": f"Synchronisation automatique Noest : {new_status}.",
                },
                actor_id=None,  # system actor
            )
            updated += 1
        except Exception as exc:
            logger.warning("Noest sync: transition %s → %s refused for %s: %s",
                           order.status, new_status, order.order_number, exc)
    if updated:
        db.commit()
    return updated


async def sync_noest_once() -> None:
    """One full polling pass over every active Noest partner."""
    db = SessionLocal()
    try:
        partners = (
            db.query(DeliveryPartner)
            .filter(DeliveryPartner.carrier_id == "noest", DeliveryPartner.is_active == True)
            .all()
        )
        for partner in partners:
            try:
                n = await _sync_partner(db, partner)
                if n:
                    logger.info("Noest sync: %d order(s) updated for store %s", n, partner.store_id)
            except Exception as exc:
                logger.error("Noest sync failed for store %s: %s", partner.store_id, exc)
                notify(
                    db,
                    type="NOEST_SYNC_ERROR",
                    title="Erreur de synchronisation Noest",
                    message=f"Boutique {partner.store_id} : {str(exc)[:300]}",
                    user_id=None,  # broadcast to admins
                    store_id=str(partner.store_id),
                )
                db.commit()
    finally:
        db.close()


def scan_due_reminders() -> None:
    """Notify assignees whose scheduled callbacks are due (deduplicated)."""
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        due_orders = (
            db.query(Order)
            .filter(
                Order.next_callback_time.isnot(None),
                Order.next_callback_time <= now,
                Order.status.in_(_ACTIVE_CALLBACK_STATES),
                Order.assigned_to.isnot(None),
                Order.is_deleted == False,
            )
            .all()
        )
        created = 0
        for order in due_orders:
            already = (
                db.query(Notification)
                .filter(
                    Notification.order_id == order.id,
                    Notification.type == "REMINDER_DUE",
                    Notification.created_at >= order.next_callback_time,
                )
                .first()
            )
            if already:
                continue
            notify(
                db,
                type="REMINDER_DUE",
                title=f"Rappel à passer — {order.order_number}",
                message=f"{order.customer_name or 'Client'} ({order.customer_phone}) attend un rappel"
                        + (f" — NRP {order.nrp_count}" if order.nrp_count else "") + ".",
                user_id=order.assigned_to,
                store_id=str(order.store_id),
                order_id=str(order.id),
            )
            created += 1
        if created:
            db.commit()
            logger.info("Reminder scan: %d notification(s) created", created)
    finally:
        db.close()


def scan_payday_reminders() -> None:
    """
    Salary-date reminder, two audiences, same trigger (admin-set `payday`,
    day of month 1-28, reached today):
      - SALARY_DUE  → sent to the employee themselves: purely informational,
        "today is your payday".
      - EMPLOYEE_PAYDAY → broadcast to admins/managers: "you need to pay
        [name] today", shown in the admin dashboard notification feed.
    Both are deduplicated per employee per period so they fire once a month,
    not once a day. Neither touches payroll generation or figures.
    """
    from app.models.user import User

    db = SessionLocal()
    try:
        today = datetime.now(timezone.utc)
        if today.day < 1:  # defensive; day is always >= 1
            return
        period = today.strftime("%Y-%m")

        employees = db.query(User).filter(
            User.payday == today.day,
            User.is_active == True,
        ).all()

        created = 0
        for emp in employees:
            already = (
                db.query(Notification)
                .filter(
                    Notification.user_id == emp.id,
                    Notification.type == "SALARY_DUE",
                    Notification.message.contains(period),
                )
                .first()
            )
            if not already:
                notify(
                    db,
                    type="SALARY_DUE",
                    title="Date de paie",
                    message=f"Aujourd'hui ({today.strftime('%d/%m/%Y')}) est votre date de versement de salaire pour {period}.",
                    user_id=emp.id,
                )

            already_admin = (
                db.query(Notification)
                .filter(
                    Notification.type == "EMPLOYEE_PAYDAY",
                    Notification.message.contains(f"[{emp.id}]"),
                    Notification.message.contains(period),
                )
                .first()
            )
            if not already_admin:
                notify(
                    db,
                    type="EMPLOYEE_PAYDAY",
                    title="Salaire à verser",
                    message=f"Vous devez payer {emp.name} aujourd'hui ({period}). [{emp.id}]",
                    user_id=None,
                )
            created += 1
        if created:
            db.commit()
            logger.info("Payday reminder: %d employee(s) notified for %s", created, period)
    finally:
        db.close()


def sync_meta_ads_all() -> None:
    """
    Auto-sync Ads Insights (spend / impressions / clicks / reach) for every
    store that has a usable Meta Ads connection. Runs the exact same routine
    as the manual "Synchroniser" button, so the ERP dashboard shows real,
    fresh figures (cost per purchase, ROAS…) without anyone clicking. Now that
    insights are pulled through the Vercel relay, this actually reaches Meta
    from HuggingFace instead of falling back to mock campaigns.
    """
    db = SessionLocal()
    try:
        from app.models.marketing import MetaAdsConfig
        from app.api.v1.meta_ads import sync_meta_ads

        configs = db.query(MetaAdsConfig).all()
        synced = 0
        for cfg in configs:
            # Only stores with a real connection (token + ad account) — others
            # would just spin up mock data or error out.
            if not getattr(cfg, "access_token", None) or not getattr(cfg, "ad_account_id", None):
                continue
            try:
                sync_meta_ads(store_id=str(cfg.store_id), db=db)
                synced += 1
            except Exception as exc:
                logger.warning("Meta Ads auto-sync failed for store %s: %s", cfg.store_id, exc)
                try:
                    db.rollback()  # keep the shared session usable for the next store
                except Exception:
                    pass
        if synced:
            logger.info("Meta Ads auto-sync: %d store(s) refreshed", synced)
    finally:
        db.close()


def sync_cloudinary_migration() -> None:
    """
    Automatic sweep that moves any product image still stuck on the backend's
    ephemeral local disk over to Cloudinary — no admin click required. Runs on
    its own cadence in the background loop; a no-op (near-instant) once
    everything has already migrated.
    """
    db = SessionLocal()
    try:
        from app.api.v1.upload import run_cloudinary_migration
        result = run_cloudinary_migration(db)
        if result.get("products_updated"):
            logger.info(
                "Cloudinary auto-migration: %d produit(s) migré(s), %d échec(s)",
                result.get("products_updated", 0), result.get("images_still_local_or_failed", 0),
            )
    except Exception as exc:
        logger.warning("Cloudinary auto-migration crashed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


async def background_loop() -> None:
    """Main scheduler: reminders every tick, Noest poll every N minutes."""
    if os.getenv("DISABLE_BACKGROUND_SYNC") == "1":
        logger.info("Background sync disabled by DISABLE_BACKGROUND_SYNC=1")
        return
    logger.info(
        "Background sync started (Noest every %.0f min, Meta Ads every %.0f min, "
        "Cloudinary migration every %.0f min, reminders every %.0f s)",
        SYNC_INTERVAL_MINUTES, META_ADS_SYNC_INTERVAL_MINUTES,
        CLOUDINARY_MIGRATION_INTERVAL_MINUTES, REMINDER_SCAN_INTERVAL_SECONDS,
    )
    seconds_since_sync = SYNC_INTERVAL_MINUTES * 60  # poll immediately at boot
    seconds_since_meta_sync = META_ADS_SYNC_INTERVAL_MINUTES * 60  # sync immediately at boot
    seconds_since_cloudinary_sync = CLOUDINARY_MIGRATION_INTERVAL_MINUTES * 60  # migrate immediately at boot
    while True:
        try:
            scan_due_reminders()
        except Exception as exc:
            logger.error("Reminder scan crashed: %s", exc)
        if seconds_since_sync >= SYNC_INTERVAL_MINUTES * 60:
            seconds_since_sync = 0
            try:
                await sync_noest_once()
            except Exception as exc:
                logger.error("Noest sync pass crashed: %s", exc)
            try:
                scan_payday_reminders()
            except Exception as exc:
                logger.error("Payday reminder scan crashed: %s", exc)
            try:
                from app.services.meta_capi import retry_pending_events
                # retry_pending_events() makes blocking network calls (with
                # time.sleep backoffs) — running it inline here would freeze
                # this process's single asyncio event loop, stalling every
                # in-flight HTTP request until the sweep finishes. Offload it
                # to a worker thread so a Meta outage can't take the whole
                # app down with it.
                await asyncio.to_thread(retry_pending_events)
            except Exception as exc:
                logger.error("Meta CAPI retry sweep crashed: %s", exc)
        if seconds_since_meta_sync >= META_ADS_SYNC_INTERVAL_MINUTES * 60:
            seconds_since_meta_sync = 0
            try:
                # Blocking httpx calls inside — offload to a worker thread so it
                # can't stall the event loop (same reasoning as the CAPI sweep).
                await asyncio.to_thread(sync_meta_ads_all)
            except Exception as exc:
                logger.error("Meta Ads auto-sync pass crashed: %s", exc)
        if seconds_since_cloudinary_sync >= CLOUDINARY_MIGRATION_INTERVAL_MINUTES * 60:
            seconds_since_cloudinary_sync = 0
            try:
                # Reads/writes local files and calls the Cloudinary API —
                # blocking, so offload to a worker thread like the other sweeps.
                await asyncio.to_thread(sync_cloudinary_migration)
            except Exception as exc:
                logger.error("Cloudinary auto-migration pass crashed: %s", exc)
        await asyncio.sleep(REMINDER_SCAN_INTERVAL_SECONDS)
        seconds_since_sync += REMINDER_SCAN_INTERVAL_SECONDS
        seconds_since_meta_sync += REMINDER_SCAN_INTERVAL_SECONDS
        seconds_since_cloudinary_sync += REMINDER_SCAN_INTERVAL_SECONDS
