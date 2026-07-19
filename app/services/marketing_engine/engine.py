"""
engine.py — Marketing Event Engine, single entry point.

emit_business_event() is deliberately the ONLY place in the whole codebase
that knows how to go from "something happened to an order" to "N rows
queued for delivery to ad platforms". No provider adapter, no dispatcher
code, and no future worker should ever see an Order ORM object directly —
only the canonical payload built here.

NOT YET WIRED into order_service.py / orders.py / checkout-form.tsx (see
the TODO list delivered alongside this module) — the legacy Meta CAPI flow
keeps running unchanged everywhere until this engine is called explicitly,
and even then only in shadow mode until parity is confirmed per store.

Nothing in this module makes a network call. emit_business_event() only
validates, dedups, builds the canonical (and, best-effort, provider)
payload, scores signal quality, and persists. Sending is the future
worker's job — deliberately not built yet, so the engine can be fully unit
tested in isolation first.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.marketing_event import MarketingEvent
from app.services.marketing_engine.dispatcher import dispatch_mappings_for_event
from app.services.marketing_engine.event_store import MarketingEventStore

logger = logging.getLogger("app.marketing_engine.engine")


class BusinessEvent(str, Enum):
    """
    The ERP's own vocabulary for "something happened" — providers never see
    these values directly, only whatever provider_event a
    provider_event_mappings row translates them to.
    """
    ORDER_CREATED = "ORDER_CREATED"
    ORDER_CONFIRMED = "ORDER_CONFIRMED"
    ORDER_PACKED = "ORDER_PACKED"
    ORDER_SHIPPED = "ORDER_SHIPPED"
    ORDER_DELIVERED = "ORDER_DELIVERED"
    ORDER_CANCELLED = "ORDER_CANCELLED"
    ORDER_RETURNED = "ORDER_RETURNED"
    ORDER_REFUNDED = "ORDER_REFUNDED"
    ORDER_MERGED = "ORDER_MERGED"
    PAYMENT_RECEIVED = "PAYMENT_RECEIVED"
    PAYMENT_FAILED = "PAYMENT_FAILED"
    LEAD_CREATED = "LEAD_CREATED"
    LEAD_QUALIFIED = "LEAD_QUALIFIED"
    CUSTOMER_REGISTERED = "CUSTOMER_REGISTERED"


# Weighted signal-quality fields — weight reflects how much each field
# actually helps a provider match/attribute the event; fields are not
# interchangeable (an email is worth far more than a bare referrer).
# Configurable in the sense that this dict is the single place to tune it —
# not yet exposed as a DB-editable table, listed in the TODOs.
SIGNAL_QUALITY_WEIGHTS: dict[str, float] = {
    "email": 3.0, "phone": 3.0, "external_id": 2.0,
    "ip": 1.5, "user_agent": 1.0,
    "fbp": 1.5, "fbc": 1.0, "ttclid": 1.5, "gclid": 1.5, "msclkid": 1.0,
    "utm_source": 0.5, "utm_medium": 0.5, "utm_campaign": 0.5,
    "landing_page": 0.5, "referrer": 0.3,
    "currency": 1.0, "value": 1.0,
    "consent": 0.5, "event_source": 0.3, "event_time": 0.5,
}
_SIGNAL_QUALITY_MAX = sum(SIGNAL_QUALITY_WEIGHTS.values())


def build_canonical_payload(order: Any, business_event: BusinessEvent) -> dict[str, Any]:
    """
    Order -> a single provider-agnostic payload. This is the ONLY function
    in the whole engine that reads Order columns — every provider adapter
    receives this dict, never the ORM object's business fields (status,
    parent_order_id, etc.), so a provider adapter physically cannot grow
    business logic: it never receives the information needed to make a
    business decision.

    ttclid/gclid/msclkid are read via getattr with a None default: Order
    has no such columns yet today, but the engine is written so adding them
    later (TikTok/Google/Microsoft Ads attribution) requires zero change
    here — see the "compatibilité future" requirement.
    """
    items = list(getattr(order, "items", None) or [])
    reference_dt = getattr(order, "created_at", None) or datetime.now(timezone.utc)
    if reference_dt.tzinfo is None:
        reference_dt = reference_dt.replace(tzinfo=timezone.utc)

    return {
        "order_id": order.id,
        "order_number": order.order_number,
        "business_event": business_event.value,
        "event_time": int(reference_dt.timestamp()),
        "value": round(float(order.total or 0), 2),
        "currency": "DZD",  # store-native currency; each provider adapter converts to its own ad-account currency
        "contents": [
            {"id": str(i.product_id), "quantity": int(i.quantity or 1), "price": float(i.unit_price or 0)}
            for i in items
        ],
        "email": getattr(order, "customer_email", None),
        "phone": order.customer_phone,
        "external_id": order.customer_phone or order.id,
        "ip": getattr(order, "client_ip", None),
        "user_agent": getattr(order, "client_user_agent", None),
        "fbp": getattr(order, "fbp", None),
        "fbc": getattr(order, "fbc", None),
        "fbclid": getattr(order, "fbclid", None),
        "ttclid": getattr(order, "ttclid", None),
        "gclid": getattr(order, "gclid", None),
        "msclkid": getattr(order, "msclkid", None),
        "utm_source": getattr(order, "utm_source", None),
        "utm_medium": getattr(order, "utm_medium", None),
        "utm_campaign": getattr(order, "utm_campaign", None),
        "utm_content": getattr(order, "utm_content", None),
        "utm_term": getattr(order, "utm_term", None),
        "campaign_id": getattr(order, "campaign_id", None),
        "adset_id": getattr(order, "adset_id", None),
        "ad_id": getattr(order, "ad_id", None),
        "landing_page": getattr(order, "event_source_url", None),
        "referrer": getattr(order, "referrer", None),
        # The storefront already gates every tracking call behind
        # isConsentEnabled() (src/lib/meta-tracking.ts) before anything
        # reaches the backend — by the time an order exists, consent was
        # already required. Revisit if a non-consent-gated order source is
        # ever added (see TODOs).
        "consent": True,
        "event_source": "website",
        "store_id": order.store_id,
    }


def score_signal_quality(canonical_payload: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Weighted completeness score (0-100) plus the missing fields, sorted by weight lost (most-impactful gap first) — feeds the admin dashboard's 'what's missing' view directly."""
    present_weight = 0.0
    missing: list[str] = []
    for field, weight in SIGNAL_QUALITY_WEIGHTS.items():
        if canonical_payload.get(field):
            present_weight += weight
        else:
            missing.append(field)
    score = round((present_weight / _SIGNAL_QUALITY_MAX) * 100, 1)
    missing.sort(key=lambda f: -SIGNAL_QUALITY_WEIGHTS[f])
    return score, {"missing": missing}


def compute_dedup_hash(business_event: str, provider: str, order_id: str, canonical_payload: dict[str, Any]) -> str:
    """
    Dedup level 3 (content hash), independent of event_id: catches an
    accidental duplicate even if a future bug generates a different
    event_id for what is logically the same event. The real idempotency
    guarantee is still the DB UNIQUE constraint on event_id — this is a
    second, orthogonal safety net, not a replacement for it.
    """
    canonical = json.dumps(
        {
            "business_event": business_event, "provider": provider, "order_id": order_id,
            "value": canonical_payload.get("value"), "currency": canonical_payload.get("currency"),
        },
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def build_event_id(business_event: str, order_id: str, provider: str, payload_version: int = 1) -> str:
    """Deterministic event_id — the actual idempotency guarantee (backed by the DB unique constraint), never random."""
    return f"{business_event}-{order_id}-{provider}-v{payload_version}"


def emit_business_event(
    db: Session,
    *,
    order: Any,
    business_event: BusinessEvent,
    shadow: bool = True,
    session_id: Optional[str] = None,
    customer_id: Optional[str] = None,
) -> list[MarketingEvent]:
    """
    Single entry point for the whole engine.

    Call this from order_service.py (NOT YET WIRED — see the TODO list)
    whenever a business-meaningful thing happens to an order. Returns the
    MarketingEvent rows created; an empty list means either no provider is
    configured/enabled for this business_event on this store, or every
    resulting event was already idempotently present.

    ORDER_MERGED is handled specially: instead of creating new events, it
    cancels any still-pending event for this order (see
    event_store.cancel_for_order). This is the actual fix for the bug that
    started this project — a merged duplicate must never let a pending
    Purchase-equivalent event reach a provider, because the provider was
    never told about the merge otherwise.

    shadow=True by default: rows are written with shadow=True and must be
    treated by callers/dashboards as invisible to legacy counts until a
    caller explicitly passes shadow=False for a store that has been
    promoted past shadow-mode parity. This function does not read any
    store config itself — the caller decides the mode — which keeps this a
    pure, easily-testable unit.
    """
    if not isinstance(business_event, BusinessEvent):
        raise ValueError(f"business_event must be a BusinessEvent member, got {business_event!r}")
    if order is None or not getattr(order, "id", None):
        raise ValueError("emit_business_event requires a persisted Order (order.id is required)")

    store = MarketingEventStore(db)

    if business_event is BusinessEvent.ORDER_MERGED:
        cancelled = store.cancel_for_order(order.id, reason="ORDER_MERGED")
        logger.info("[MarketingEngine] order=%s ORDER_MERGED — cancelled %d pending event(s)", order.id, cancelled)
        return []

    canonical_payload = build_canonical_payload(order, business_event)
    signal_score, signal_detail = score_signal_quality(canonical_payload)

    mappings = dispatch_mappings_for_event(db, store_id=order.store_id, business_event=business_event.value)
    created: list[MarketingEvent] = []

    for mapping, provider in mappings:
        event_id = build_event_id(business_event.value, order.id, mapping.provider)
        dedup_hash = compute_dedup_hash(business_event.value, mapping.provider, order.id, canonical_payload)

        row = store.create(
            event_id=event_id,
            business_event=business_event.value,
            provider=mapping.provider,
            provider_event=mapping.provider_event,
            order_id=order.id,
            store_id=order.store_id,
            session_id=session_id,
            customer_id=customer_id,
            raw_payload={"order_id": order.id, "business_event": business_event.value, "provider_event": mapping.provider_event},
            canonical_payload=canonical_payload,
            dedup_hash=dedup_hash,
            signal_quality_score=signal_score,
            signal_quality_detail=signal_detail,
            shadow=shadow,
        )
        if row is None:
            logger.debug("[MarketingEngine] event_id=%s already exists — idempotent no-op", event_id)
            continue

        # Best-effort provider_payload build — no network call, so safe to
        # run eagerly. A provider with no config for this store (or a
        # payload-building failure) leaves provider_payload null; the
        # future worker is responsible for skipping/retrying that case, not
        # this function, which must never let one provider's failure stop
        # the others in `mappings` from being persisted.
        try:
            config = provider.resolve_config(db, order.store_id)
        except Exception:
            logger.exception("[MarketingEngine] provider=%s resolve_config raised for order=%s", mapping.provider, order.id)
            config = None

        if config is not None:
            try:
                provider_payload = provider.build_payload(canonical_payload, order, config)
                store.set_provider_payload(
                    row, provider_payload,
                    provider_config_snapshot=provider.config_snapshot(config),
                    provider_version=getattr(provider, "version", None),
                )
            except Exception:
                logger.exception(
                    "[MarketingEngine] provider=%s build_payload failed for order=%s event_id=%s — provider_payload left null",
                    mapping.provider, order.id, event_id,
                )
        else:
            logger.info(
                "[MarketingEngine] provider=%s has no config for store=%s — event_id=%s persisted, provider_payload left null",
                mapping.provider, order.store_id, event_id,
            )

        created.append(row)

    return created
