"""
Automatic carrier synchronization + reminder scheduler.

A single background loop (started at FastAPI startup) does two things:

1. NOEST intelligent polling
   - Only stores with an active Noest partner AND at least one non-terminal
     order (not DELIVERED/RETURNED/CANCELLED/MERGED) carrying a real
     tracking number are polled — zero API calls otherwise. Deliberately not
     restricted to exactly "SHIPPED": an order that ended up with a tracking
     number while sitting in some other status must still be checked, or it
     never picks up its real-world outcome (see _sync_partner).
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

SYNC_INTERVAL_MINUTES = float(os.getenv("NOEST_SYNC_INTERVAL_MINUTES", "15"))
# This is also the main scheduler tick (see background_loop) — every tick
# hits the DB via scan_due_reminders() regardless of any of the cadences
# below, which is what actually matters for Neon's free-tier autosuspend:
# a 2-min tick never left a gap longer than the ~5-min idle threshold, so
# the compute endpoint never suspended and stayed billed 24/7. 10 min
# leaves a real idle gap between ticks.
REMINDER_SCAN_INTERVAL_SECONDS = float(os.getenv("REMINDER_SCAN_INTERVAL_SECONDS", "600"))
# Meta Ads spend/insights auto-sync cadence (fires on the next scheduler tick
# once this many minutes have elapsed). Matches the frontend's own 24h poll
# on this data (meta-ads-dashboard.tsx) — syncing more often than the UI
# ever reads it just burns compute/network for numbers nobody sees sooner.
META_ADS_SYNC_INTERVAL_MINUTES = float(os.getenv("META_ADS_SYNC_INTERVAL_MINUTES", "1440"))
# How often to sweep product images still stuck on the ephemeral local disk
# and move them to Cloudinary. Images change far less often than orders/ads,
# so this runs on a slower cadence — just needs to run before a Space restart
# would otherwise wipe them.
CLOUDINARY_MIGRATION_INTERVAL_MINUTES = float(os.getenv("CLOUDINARY_MIGRATION_INTERVAL_MINUTES", "60"))

# NOEST wording → platform terminal statuses. Checked against BOTH
# OrderInfo.statut (French human text) AND the last activity's event_key
# (English snake_case, per NOEST's own event-key vocabulary — see their API
# docs' "Liste des événements" table). The previous version only had French
# substrings, so any tracking whose statut field was empty and fell back to
# event_key (e.g. "livraison_echoue_recu", "colis_retour_transmit_to_partner")
# never matched — those orders silently stayed SHIPPED forever, contradicting
# the requirement that every carrier-side status change be reflected here.
# Intermediate/in-transit events (en route, collecté, retour demandé/en
# transit but not yet received back) are deliberately excluded: the order
# simply stays SHIPPED until a genuinely terminal event arrives.
_TERMINAL_MAP = {
    # Delivered
    "livré": "DELIVERED", "livre": "DELIVERED", "delivered": "DELIVERED",
    # Returned — only the terminal "received/confirmed back" events, not the
    # in-progress "asked"/"en transit" ones (return_asked_by_*, *_redispatched_to_livraison).
    "retourné": "RETURNED", "retourne": "RETURNED", "returned": "RETURNED",
    "retour": "RETURNED",
    "livraison_echoue_recu": "RETURNED",           # Retour reçu par le partenaire
    "colis_retour_transmit_to_partner": "RETURNED",  # Retour transmis au partenaire
    "colis_pickup_transmit_to_partner": "RETURNED",  # Pick-Up transmis au partenaire
    "retour_dispatched_to_partenaires": "RETURNED",  # Retour transmis au partenaire
    "return_dispatched_to_partenaire": "RETURNED",   # Retour transmis au partenaire
    "return_validated_by_partener": "RETURNED",      # Retour validé par le partenaire
    "return_dispatched_to_warehouse": "RETURNED",    # Retour transmis vers entrepôt
}

# Per NOEST's official event-key table: "annulation_dispatch_retour" and
# "cancel_return_dispatched_to_partenaire" UNDO a return-in-progress — but
# both contain "retour"/"return_dispatched_to_partenaire" as substrings, so
# the naive `key in raw` check below would have wrongly classified a
# CANCELLED return as a completed one (RETURNED). Checked before the
# positive map — any of these appearing anywhere in the event means "ignore,
# not terminal", regardless of what else matches.
_CANCELLATION_MARKERS = ("annulation", "cancel_return", "canceled")

# Every event_key from NOEST's own documented "Liste des événements" table
# that is legitimately INTERMEDIATE — expected, understood, and correctly
# non-terminal. Without this, the diagnostic log below flagged these as
# "événement non reconnu" even though they're perfectly normal in-transit
# states (a return that's been asked for but not yet received back, a
# delivery attempt still in progress, etc.) — noise that would drown out
# genuinely unrecognized statuses that actually need attention.
_KNOWN_INTERMEDIATE_KEYS = {
    "upload", "customer_validation", "validation_collect_colis",
    "validation_reception_admin", "validation_reception", "fdr_activated",
    "sent_to_redispatch", "nouvel_tentative_asked_by_customer",
    "return_asked_by_customer", "return_asked_by_hub",
    "return_redispatched_to_livraison", "pickedup", "valid_return_pickup",
    "pickup_picked_recu", "verssement_admin_cust",
    "verssement_admin_cust_canceled", "verssement_hub_cust_canceled",
    "validation_reception_cash_by_partener", "echange_valide",
    "echange_valid_by_hub", "ask_to_delete_by_admin", "ask_to_delete_by_hub",
    "edited_informations", "edit_price", "edit_wilaya", "extra_fee",
    "mise_a_jour",
}

_ACTIVE_CALLBACK_STATES = ["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"]


def _extract_terminal_status(parcel: dict) -> str | None:
    """
    Derive DELIVERED/RETURNED from a Noest tracking payload, else None.

    Shared by BOTH sync paths — the intelligent poll above (payload nested
    under "OrderInfo", batch response from /trackings/info) AND the
    real-time webhook (flat body straight from Noest's push notification,
    see app.api.carriers.noest.webhook). Before this was shared, the webhook
    used its own much thinner two-keyword map ("livré"/"retourné" only) and
    silently missed every event_key-style return event
    (livraison_echoue_recu, colis_retour_transmit_to_partner, etc.) — those
    orders sat SHIPPED until the next 3-minute poll caught up, instead of
    updating the instant Noest reported the return.
    """
    info = parcel.get("OrderInfo") or {}
    raw = (
        info.get("statut") or info.get("status")
        or parcel.get("statut") or parcel.get("status") or parcel.get("etat")
        or ""
    ).strip().lower()
    if not raw:
        activity = parcel.get("activity") or []
        if activity:
            raw = (activity[-1].get("event_key") or activity[-1].get("event") or "").strip().lower()
    if any(marker in raw for marker in _CANCELLATION_MARKERS):
        return None
    for key, mapped in _TERMINAL_MAP.items():
        if key in raw:
            return mapped
    return None


async def _sync_partner(db: Session, partner: DeliveryPartner) -> int:
    """Batch-sync every order of one store's Noest partner that still has a
    real tracking number and hasn't reached a terminal state yet.

    Previously this only polled Order.status == "SHIPPED" exactly. Any order
    that ended up with a real Noest tracking number while sitting in some
    OTHER non-terminal status (e.g. the SHIPPED transition itself never
    applied due to an earlier bug, or a manual correction left it at
    CONFIRMED) was invisible to this loop FOREVER — it would never pick up
    the real-world DELIVERED/RETURNED outcome no matter how long you waited.
    Observed live: 4 of 8 real returns for one store never synced because the
    orders weren't sitting at exactly "SHIPPED". The tracking_number
    condition below already scopes this to orders that genuinely went out
    with a carrier, so broadening the status side is safe.
    """
    orders = (
        db.query(Order)
        .filter(
            Order.store_id == partner.store_id,
            Order.status.notin_(["DELIVERED", "RETURNED", "CANCELLED", "MERGED"]),
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
    stage_writes = 0
    for order in orders:
        parcel = data.get(str(order.tracking_number))
        if not isinstance(parcel, dict):
            # Noest's own response has no entry for this tracking number at
            # all — the order can NEVER resolve to DELIVERED/RETURNED until
            # this is fixed (wrong/stale tracking_number, or Noest genuinely
            # lost the parcel). Previously silent; this is exactly the class
            # of "order stuck forever, nobody notices" bug reported live.
            logger.warning(
                "[NoestSync] Aucune donnée Noest pour tracking=%s order=%s (statut actuel=%s) — "
                "vérifier que ce numéro de suivi existe bien côté Noest.",
                order.tracking_number, order.order_number, order.status,
            )
            continue
        new_status = _extract_terminal_status(parcel)

        # Write Noest's own granular stage on EVERY poll, terminal or not —
        # this is what lets a confirmatrice see real-time carrier progress
        # (fdr_activated → "En livraison", etc.) instead of only our own
        # coarse SHIPPED bucket, which never changes until DELIVERED/RETURNED.
        _activity_all = parcel.get("activity") or []
        if _activity_all:
            _last_event = _activity_all[-1]
            _stage_key = (_last_event.get("event_key") or "").strip().lower()
            _stage_label = (_last_event.get("event") or "").strip()
            if _stage_key and (order.carrier_stage != _stage_key or order.carrier_stage_label != _stage_label):
                order.carrier_stage = _stage_key
                order.carrier_stage_label = _stage_label or order.carrier_stage_label
                db.add(order)
                stage_writes += 1
                # Every carrier-transmitted stage change lands in the order's
                # own action history (OrderEvent, actor=SYSTÈME) — previously
                # only the terminal DELIVERED/RETURNED transition was logged,
                # so the timeline showed nothing between "Expédiée" and the
                # final outcome even though Noest reported every hop.
                try:
                    import uuid as _uuid_ce
                    from app.models.events import OrderEvent as _OE
                    db.add(_OE(
                        id=str(_uuid_ce.uuid4()),
                        order_id=order.id,
                        actor_id=None,
                        from_status=str(order.status),
                        to_status=str(order.status),
                        note=f"Mise à jour transporteur (Noest) : {_stage_label or _stage_key}.",
                    ))
                except Exception:
                    logger.warning("Carrier-stage event log failed for order %s", order.id, exc_info=True)

        if not new_status:
            # Not yet a terminal event — still worth flagging "colis suspendu"
            # (carrier blocked the delivery, needs staff attention) even
            # though the order stays SHIPPED. Logged once per occurrence via
            # the OrderEvent timeline, not the single-slot notes field.
            activity = _activity_all
            last_key = (activity[-1].get("event_key") or "").strip().lower() if activity else ""
            info = parcel.get("OrderInfo") or {}
            raw_statut = (info.get("statut") or info.get("status") or "").strip()
            if (
                last_key not in ("", "colis_suspendu")
                and last_key not in _TERMINAL_MAP
                and last_key not in _KNOWN_INTERMEDIATE_KEYS
                and not any(m in last_key for m in _CANCELLATION_MARKERS)
            ):
                # An event_key we don't recognize at all — surfaces gaps in
                # _TERMINAL_MAP's vocabulary (e.g. an order that's actually
                # DELIVERED/RETURNED in reality per Noest, but under a status
                # wording we've never seen and don't map, so it silently
                # never transitions here).
                logger.info(
                    "[NoestSync] Événement non reconnu order=%s tracking=%s statut=%r dernier_event_key=%r "
                    "— ni terminal ni suspendu, à vérifier si ça doit être ajouté à _TERMINAL_MAP.",
                    order.order_number, order.tracking_number, raw_statut, last_key,
                )
            if last_key == "colis_suspendu":
                # This whole block is a nice-to-have diagnostic note, not
                # core sync logic — an error here (like the wrong OrderEvent
                # import path this used to have) must never be allowed to
                # propagate out of _sync_partner and abort every remaining
                # order in the batch for the rest of the cycle, which is
                # exactly what was happening before: one "colis_suspendu"
                # order anywhere in a store's batch silently killed real-time
                # sync for every other order in that same store that cycle.
                try:
                    from app.services.order_service import _log_event as _log_order_event
                    from app.models.events import OrderEvent  # lives here, not app.models.order
                    already = (
                        db.query(OrderEvent)
                        .filter(
                            OrderEvent.order_id == order.id,
                            OrderEvent.note == "Colis suspendu par le transporteur.",
                        )
                        .first()
                    )
                    if not already:
                        _log_order_event(
                            db, order_id=order.id, actor_id=None,
                            from_status=str(order.status), to_status=str(order.status),
                            note="Colis suspendu par le transporteur.",
                        )
                        db.commit()
                except Exception as exc:
                    db.rollback()
                    logger.warning(
                        "[NoestSync] Échec de la note 'colis suspendu' pour order=%s: %s "
                        "(non bloquant, la synchronisation continue).",
                        order.order_number, exc,
                    )
            continue
        if new_status == str(order.status):
            continue
        # Lock the row only now (after the network call) and re-check the
        # status: a confirmatrice may have updated the order meanwhile.
        db.query(Order.id).filter(Order.id == order.id).with_for_update().first()
        db.refresh(order)
        if str(order.status) in ("DELIVERED", "RETURNED", "CANCELLED", "MERGED") or new_status == str(order.status):
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
    if updated or stage_writes:
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
                # date_start/date_end MUST be passed explicitly as None here.
                # sync_meta_ads's signature default is `Query(None)` — a
                # FastAPI-only sentinel that's only ever resolved to a plain
                # None by FastAPI's own request handling. Calling the function
                # directly (as this background sweep does) leaves that
                # fastapi.params.Query object as the actual argument value,
                # which is truthy — every call below silently entered the
                # custom-date-range branch and tried to JSON-encode a Query
                # object as the time_range value, failing every single time
                # ("Object of type Query is not JSON serializable"). The
                # 24h auto-sync had therefore never actually succeeded once;
                # every campaign shown so far came only from the manual
                # "Synchroniser" button, which goes through real FastAPI
                # request handling and gets a genuine None.
                sync_meta_ads(store_id=str(cfg.store_id), date_start=None, date_end=None, db=db)
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


def log_relay_domain_check() -> None:
    """
    [DomainCheck] — diagnostic périodique : vers QUOI pointe le nom de domaine
    du relais Meta, vu depuis CE serveur (résolveur DNS de l'hébergeur inclus).
    Détecte explicitement le cas 'domaine suspendu / cache DNS pas encore
    propagé' (IP de parking Namecheap 198.54.117.x) vs 'pointage Vercel OK',
    et teste la connexion TCP:443 réelle. Ne modifie rien — log uniquement.
    """
    import socket
    import time as _time
    from urllib.parse import urlparse
    from app.core.config import settings as _settings

    relay = (getattr(_settings, "META_CAPI_RELAY_URL", "") or "").strip()
    if not relay:
        return
    host = urlparse(relay).hostname
    if not host:
        logger.warning("[DomainCheck] META_CAPI_RELAY_URL invalide: %r", relay)
        return

    t0 = _time.monotonic()
    try:
        infos = socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)
        ips = sorted({sa[0] for _f, _t, _p, _c, sa in infos})
        dns_ms = int((_time.monotonic() - t0) * 1000)
    except Exception as exc:
        logger.error("[DomainCheck] host=%s ÉCHEC DNS: %s", host, exc)
        return

    def _classify(ip: str) -> str:
        if ip.startswith("198.54.117."):
            return "PARKING NAMECHEAP — domaine suspendu OU cache DNS pas encore propagé"
        if ip.startswith(("64.29.17.", "216.198.79.", "76.76.21.")):
            return "VERCEL — pointage correct"
        return "INCONNU"

    verdicts = {ip: _classify(ip) for ip in ips}

    tcp_status = "?"
    sock = None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect((ips[0], 443))
        tcp_status = "ok"
    except Exception as exc:
        tcp_status = f"ÉCHEC: {type(exc).__name__}: {exc}"
    finally:
        if sock:
            try:
                sock.close()
            except Exception:
                pass

    all_ok = tcp_status == "ok" and all("VERCEL" in v for v in verdicts.values())
    log_fn = logger.info if all_ok else logger.warning
    log_fn(
        "[DomainCheck] relais=%s | DNS(%sms) → %s | TCP:443=%s%s",
        host, dns_ms, verdicts, tcp_status,
        "" if all_ok else " — les événements Meta restent en file d'attente et partiront automatiquement dès que le pointage redevient VERCEL",
    )


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
                # DNS/TCP diagnostic first (blocking socket calls → thread)
                await asyncio.to_thread(log_relay_domain_check)
            except Exception as exc:
                logger.error("[DomainCheck] crashed: %s", exc)
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
