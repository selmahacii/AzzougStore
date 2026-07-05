"""
Meta Conversions API (CAPI) — central service.

Everything Meta-related on the server goes through here so that:
- user_data normalization follows Meta's documentation exactly
  (https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters)
- Pixel and CAPI always share the same event_id (deduplication)
- every send is retried, validated and persisted in `meta_capi_logs`
  for the diagnostics dashboard.

Graph API version: v21.0.
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
import unicodedata
import uuid
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

logger = logging.getLogger("app.meta_capi")

GRAPH_VERSION = "v21.0"
_RETRIES = 2          # total attempts = 1 + _RETRIES
_RETRY_BACKOFF = 1.5  # seconds, multiplied per attempt
_HEX64 = re.compile(r"^[0-9a-f]{64}$")


# ─── Normalization (Meta spec) ────────────────────────────────────────────────

def _strip_accents(value: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", value) if unicodedata.category(c) != "Mn"
    )


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _hash_if_needed(value: str) -> str:
    """Accept pre-hashed values (64 hex chars) as-is, hash otherwise."""
    v = value.strip().lower()
    return v if _HEX64.match(v) else _sha256(v)


def normalize_email(email: Optional[str]) -> Optional[str]:
    if not email or "@" not in email:
        return None
    return _sha256(email.strip().lower())


def normalize_phone(phone: Optional[str]) -> Optional[str]:
    """E.164 without '+' — Algerian numbers get the 213 country code."""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if not digits:
        return None
    if digits.startswith("00213"):
        digits = digits[2:]
    if digits.startswith("213") and len(digits) >= 11:
        pass
    elif digits.startswith("0") and len(digits) == 10:
        digits = "213" + digits[1:]
    elif len(digits) == 9 and digits[0] in ("5", "6", "7"):
        digits = "213" + digits
    return _sha256(digits)


def normalize_name(name: Optional[str]) -> Optional[str]:
    """Lowercase, no accents, letters only (Meta: a-z only, no punctuation)."""
    if not name:
        return None
    cleaned = re.sub(r"[^a-z]", "", _strip_accents(name.strip().lower()))
    return _sha256(cleaned) if cleaned else None


def normalize_city(city: Optional[str]) -> Optional[str]:
    """Lowercase, no accents, no spaces/punctuation."""
    if not city:
        return None
    # Drop arabic/annotated prefixes like "القبة · Kouba"
    if "·" in city:
        city = city.split("·")[-1]
    cleaned = re.sub(r"[^a-z]", "", _strip_accents(city.strip().lower()))
    return _sha256(cleaned) if cleaned else None


def normalize_state(state: Optional[str]) -> Optional[str]:
    """Wilaya → Meta 'st' (lowercase, no accents, no punctuation)."""
    return normalize_city(state)


def normalize_zip(zip_code: Optional[str]) -> Optional[str]:
    if not zip_code:
        return None
    cleaned = re.sub(r"\s", "", str(zip_code).lower())[:5]
    return _sha256(cleaned) if cleaned else None


def normalize_country_dz() -> str:
    """2-letter ISO, lowercase, hashed."""
    return _sha256("dz")


def normalize_external_id(external_id: Optional[str]) -> Optional[str]:
    if not external_id:
        return None
    return _hash_if_needed(str(external_id))


def build_user_data(
    *,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    full_name: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    zip_code: Optional[str] = None,
    external_id: Optional[str] = None,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    fbp: Optional[str] = None,
    fbc: Optional[str] = None,
    fbclid: Optional[str] = None,
) -> Dict[str, Any]:
    """Assemble a fully-normalized Meta user_data dict (max Event Match Quality)."""
    if full_name and not (first_name or last_name):
        parts = full_name.strip().split()
        if parts:
            first_name = parts[0]
            last_name = parts[-1] if len(parts) > 1 else None

    ud: Dict[str, Any] = {}
    if (v := normalize_email(email)):
        ud["em"] = [v]
    if (v := normalize_phone(phone)):
        ud["ph"] = [v]
    if (v := normalize_name(first_name)):
        ud["fn"] = [v]
    if (v := normalize_name(last_name)):
        ud["ln"] = [v]
    if (v := normalize_city(city)):
        ud["ct"] = [v]
    if (v := normalize_state(state)):
        ud["st"] = [v]
    if (v := normalize_zip(zip_code)):
        ud["zp"] = [v]
    ud["country"] = [normalize_country_dz()]
    if (v := normalize_external_id(external_id)):
        ud["external_id"] = [v]
    if client_ip:
        ud["client_ip_address"] = client_ip.split(",")[0].strip()
    if user_agent:
        ud["client_user_agent"] = user_agent
    if fbp:
        ud["fbp"] = fbp
    if fbc:
        ud["fbc"] = fbc
    elif fbclid:
        # Rebuild fbc from a raw fbclid per Meta spec: fb.1.<ms>.<fbclid>
        ud["fbc"] = f"fb.1.{int(time.time() * 1000)}.{fbclid}"
    return ud


# ─── Event helpers ────────────────────────────────────────────────────────────

def purchase_event_id(order_id: str) -> str:
    """Deterministic, shared by the browser Pixel — dedup key at Meta."""
    return f"purchase-{order_id}"


def build_purchase_event(order, *, client_ip: Optional[str], user_agent: Optional[str]) -> Dict[str, Any]:
    """Full Graph-compliant Purchase event from an Order ORM object."""
    items = list(order.items or [])
    contents = [
        {"id": str(i.product_id), "quantity": int(i.quantity or 1),
         "item_price": float(i.unit_price or 0)}
        for i in items
    ]
    event: Dict[str, Any] = {
        "event_name": "Purchase",
        "event_time": int(time.time()),
        "event_id": purchase_event_id(str(order.id)),
        "action_source": "website",
        "user_data": build_user_data(
            phone=order.customer_phone,
            full_name=order.customer_name,
            city=order.customer_commune,
            state=order.customer_wilaya,
            external_id=order.customer_phone or str(order.id),
            client_ip=client_ip,
            user_agent=user_agent,
            fbp=getattr(order, "fbp", None),
            fbc=getattr(order, "fbc", None),
            fbclid=getattr(order, "fbclid", None),
        ),
        "custom_data": {
            "value": float(order.total or 0),
            "currency": "DZD",
            "content_type": "product",
            "content_ids": [str(i.product_id) for i in items],
            "contents": contents,
            "num_items": sum(int(i.quantity or 1) for i in items),
            "order_id": str(order.order_number),
        },
    }
    source_url = getattr(order, "event_source_url", None)
    if source_url:
        event["event_source_url"] = source_url
    return event


# ─── Sending + logging ────────────────────────────────────────────────────────

def _log_send(
    db: Session,
    *,
    store_id: Optional[str],
    order_id: Optional[str],
    event_name: str,
    event_id: str,
    status: str,
    error_message: Optional[str] = None,
    events_received: Optional[int] = None,
) -> None:
    try:
        from app.models.marketing import MetaCapiLog
        db.add(MetaCapiLog(
            id=str(uuid.uuid4()),
            store_id=store_id,
            order_id=order_id,
            event_name=event_name,
            event_id=event_id,
            status=status,
            error_message=(error_message or "")[:1000] or None,
            events_received=events_received,
        ))
        db.commit()
    except Exception as exc:  # never break business flow for a log line
        db.rollback()
        logger.warning("meta_capi log write failed: %s", exc)


def send_events(
    pixel_id: str,
    access_token: str,
    events: List[Dict[str, Any]],
    *,
    test_event_code: Optional[str] = None,
) -> Dict[str, Any]:
    """
    POST events to the Graph API with retries and response validation.
    Returns {"success": bool, "events_received": int|None, "error": str|None,
             "fbtrace_id": str|None}.
    """
    url = f"https://graph.facebook.com/{GRAPH_VERSION}/{pixel_id}/events"
    body: Dict[str, Any] = {"data": events, "access_token": access_token}
    if test_event_code:
        body["test_event_code"] = test_event_code

    last_error: Optional[str] = None
    for attempt in range(1 + _RETRIES):
        try:
            resp = httpx.post(url, json=body, timeout=10.0)
            data = resp.json() if resp.content else {}
            if resp.status_code == 200:
                received = data.get("events_received")
                if received is not None and received < len(events):
                    logger.warning(
                        "[MetaCAPI] partial delivery: %s/%s events received (fbtrace=%s)",
                        received, len(events), data.get("fbtrace_id"),
                    )
                return {
                    "success": True,
                    "events_received": received,
                    "error": None,
                    "fbtrace_id": data.get("fbtrace_id"),
                }
            err = (data.get("error") or {})
            last_error = f"HTTP {resp.status_code}: {err.get('message') or resp.text[:200]}"
            # 4xx (bad token, bad payload) will not improve on retry
            if 400 <= resp.status_code < 500:
                break
        except Exception as exc:
            last_error = str(exc)
        if attempt < _RETRIES:
            time.sleep(_RETRY_BACKOFF * (attempt + 1))

    logger.error("[MetaCAPI] send failed after retries: %s", last_error)
    return {"success": False, "events_received": None, "error": last_error, "fbtrace_id": None}


def send_purchase_for_order(
    order_id: str,
    *,
    client_ip: Optional[str],
    user_agent: Optional[str],
) -> None:
    """
    Background task entry point: loads the order in a fresh session,
    builds a fully-normalized Purchase event and ships it, logging the result.
    """
    from app.db.session import SessionLocal
    from app.models.marketing import MetaAdsConfig
    from app.models.order import Order

    db = SessionLocal()
    try:
        order = db.query(Order).filter(Order.id == order_id).first()
        if not order:
            return
        config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == order.store_id).first()
        if not config or not config.pixel_id or not config.access_token or len(config.access_token) < 15:
            return

        event = build_purchase_event(order, client_ip=client_ip, user_agent=user_agent)
        result = send_events(config.pixel_id, config.access_token, [event])
        _log_send(
            db,
            store_id=str(order.store_id),
            order_id=str(order.id),
            event_name="Purchase",
            event_id=event["event_id"],
            status="success" if result["success"] else "error",
            error_message=result["error"],
            events_received=result["events_received"],
        )
        if result["success"]:
            logger.info(
                "Meta CAPI Purchase sent for %s (event_id=%s, received=%s)",
                order.order_number, event["event_id"], result["events_received"],
            )
    finally:
        db.close()
