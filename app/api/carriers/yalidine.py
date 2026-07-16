"""
Yalidine carrier proxy.
All calls decode the store's API credentials from the DB, then forward
to the real Yalidine REST API. The frontend never sees raw API keys.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, BackgroundTasks
from sqlalchemy.orm import Session

from app.api import deps
from app.db.session import get_db
from app.models.delivery_partner import DeliveryPartner, DeliveryFeeGrid
from app.models.order import Order
from app.core.encryption import decrypt_dict

logger = logging.getLogger("carriers.yalidine")
router = APIRouter()

SANDBOX_BASE = "https://dev.yalidine.app/api/v1"
PROD_BASE    = "https://api.yalidine.app/v1"
TIMEOUT      = 15.0


# ─── helpers ─────────────────────────────────────────────────────────────────

def _get_partner(db: Session, store_id: str) -> DeliveryPartner:
    partner = (
        db.query(DeliveryPartner)
        .filter(
            DeliveryPartner.store_id == store_id,
            DeliveryPartner.carrier_id == "yalidine",
            DeliveryPartner.is_active == True,
        )
        .first()
    )
    if not partner:
        raise HTTPException(404, "Yalidine non configuré pour cette boutique")
    return partner


def _creds(partner: DeliveryPartner) -> tuple[str, str, str]:
    """Returns (api_id, api_token, base_url)."""
    try:
        cfg = decrypt_dict(partner.api_config_encrypted or "")
    except Exception:
        cfg = {}
    api_id    = cfg.get("api_id") or cfg.get("id") or ""
    api_token = cfg.get("api_token") or cfg.get("token") or ""
    if not api_id or not api_token:
        raise HTTPException(400, "Clés API Yalidine manquantes — configurez le transporteur")
    base = SANDBOX_BASE if getattr(partner, "is_sandbox", True) else PROD_BASE
    return api_id, api_token, base


def _headers(api_id: str, api_token: str) -> dict:
    return {
        "X-API-ID":    api_id,
        "X-API-TOKEN": api_token,
        "Content-Type": "application/json",
        "Accept":       "application/json",
    }


def _normalize_events(raw_events: list) -> list:
    """Normalise Yalidine event list to our standard format."""
    out = []
    for ev in raw_events:
        out.append({
            "label":    ev.get("status_label") or ev.get("label") or ev.get("status") or "—",
            "status":   ev.get("status") or "",
            "location": ev.get("wilaya_name") or ev.get("location") or "",
            "date":     (ev.get("date") or ev.get("created_at") or "")[:10],
            "time":     (ev.get("time") or ev.get("created_at") or "")[-8:] if ev.get("time") or ev.get("created_at") else "",
        })
    return out


def _normalize_tracking(data: dict) -> dict:
    """Translate Yalidine parcel response to our standard tracking shape."""
    status_raw = (data.get("last_status") or data.get("status") or "PENDING").lower()
    status_map = {
        "livré":          "DELIVERED",
        "delivered":      "DELIVERED",
        "en_route":       "IN_TRANSIT",
        "in_transit":     "IN_TRANSIT",
        "en cours":       "IN_TRANSIT",
        "retourné":       "RETURNED",
        "returned":       "RETURNED",
        "collecté":       "PICKED_UP",
        "picked_up":      "PICKED_UP",
        "en livraison":   "OUT_FOR_DELIVERY",
        "out_for_delivery": "OUT_FOR_DELIVERY",
        "annulé":         "FAILED",
        "cancelled":      "FAILED",
    }
    status = status_map.get(status_raw, "PENDING")

    events = _normalize_events(
        data.get("tracking", []) or data.get("events", []) or []
    )

    return {
        "tracking_number": data.get("tracking") or data.get("barcode") or data.get("id") or "",
        "status":          status,
        "last_location":   data.get("commune_destination") or data.get("wilaya_destination") or "—",
        "last_event":      data.get("last_status_label") or data.get("status_label") or status,
        "recipient_name":  data.get("firstname", "") + " " + data.get("familyname", ""),
        "recipient_phone": data.get("contact_phone") or "",
        "destination":     data.get("address") or "",
        "wilaya":          data.get("wilaya_destination") or "",
        "events":          events,
        "carrier":         "Yalidine",
    }


# ─── GET /api/yalidine/stations — Bureaux / stopdesks ────────────────────────

import time as _time
_stations_cache: dict = {}  # store_id -> {"data": [...], "at": monotonic}
_STATIONS_TTL = 3600.0  # centers list rarely changes


@router.get("/stations")
async def get_stations(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """List Yalidine centers (stopdesks) for the store's account. Cached 1h."""
    cached = _stations_cache.get(store_id)
    if cached and _time.monotonic() - cached["at"] < _STATIONS_TTL:
        return {"success": True, "data": cached["data"], "cached": True}

    # Not configured is a normal state for stores without Yalidine —
    # return an empty list instead of spamming 404s.
    try:
        partner = _get_partner(db, store_id)
        api_id, api_token, base = _creds(partner)
    except HTTPException as e:
        _stations_cache[store_id] = {"data": [], "at": _time.monotonic()}
        return {"success": False, "data": [], "message": e.detail}

    centers: list = []
    page = 1
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            while page <= 10:  # safety bound
                resp = await client.get(
                    f"{base}/centers/",
                    params={"page": page, "page_size": 100},
                    headers=_headers(api_id, api_token),
                )
                if resp.status_code != 200:
                    logger.warning("Yalidine centers page %d failed: %s %s", page, resp.status_code, resp.text[:200])
                    break
                body = resp.json()
                batch = body.get("data", [])
                centers.extend(batch)
                if not body.get("has_more") or not batch:
                    break
                page += 1
    except httpx.HTTPError as e:
        logger.error("Yalidine centers fetch error: %s", e)
        raise HTTPException(502, f"Erreur réseau Yalidine: {e}")

    _stations_cache[store_id] = {"data": centers, "at": _time.monotonic()}
    return {"success": True, "data": centers}


# ─── GET /api/yalidine/track/{tracking_number} ───────────────────────────────

@router.get("/track/{tracking_number}")
async def track_parcel(
    tracking_number: str,
    store_id: str = Query(...),
    db: Session = Depends(get_db),
) -> Any:
    partner = _get_partner(db, store_id)
    api_id, api_token, base = _creds(partner)

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            r = await client.get(
                f"{base}/parcels/{tracking_number}/",
                headers=_headers(api_id, api_token),
            )
        except httpx.TimeoutException:
            raise HTTPException(504, "Yalidine API timeout")
        except httpx.RequestError as e:
            raise HTTPException(502, f"Erreur réseau Yalidine: {e}")

    if r.status_code == 404:
        raise HTTPException(404, "Numéro de suivi introuvable sur Yalidine")
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"Yalidine API error: {r.text[:200]}")

    return _normalize_tracking(r.json())


# ─── POST /api/yalidine/parcels — Create a shipment ──────────────────────────

@router.post("/parcels")
async def create_parcel(
    payload: dict,
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
) -> Any:
    """
    Create a parcel order in Yalidine.
    The frontend sends our internal order fields; we translate and forward.
    """
    partner = _get_partner(db, store_id)
    api_id, api_token, base = _creds(partner)

    order_id = payload.get("order_id")
    order: Optional[Order] = None
    if order_id:
        order = db.query(Order).filter(Order.id == order_id).first()

    def _clean_commune_name(commune_val: str | None, wilaya_name: str | None) -> str:
        if not commune_val: 
            return str(wilaya_name) if wilaya_name else "Chef-lieu"
        if "·" in commune_val:
            commune_val = commune_val.split("·")[-1].strip()
        import re
        commune_val = re.sub(r"\s+", " ", commune_val).strip()
        if wilaya_name:
            w_clean = wilaya_name.strip()
            if commune_val.lower().startswith(w_clean.lower() + " ") and len(commune_val) > len(w_clean) + 1:
                commune_val = commune_val[len(w_clean) + 1:].strip()
        return commune_val

    customer_commune_raw = payload.get("commune") or (order.customer_commune if order else "")
    customer_wilaya_raw = payload.get("wilaya") or (order.customer_wilaya if order else "")

    # Build Yalidine parcel body from our order fields
    body = {
        "firstname":       payload.get("firstname") or (order.customer_name.split()[0] if order else ""),
        "familyname":      payload.get("familyname") or (order.customer_name.split()[-1] if order else ""),
        "contact_phone":   payload.get("phone") or (order.customer_phone if order else ""),
        "address":         payload.get("address") or (order.customer_address if order else ""),
        "from_wilaya_name": payload.get("from_wilaya", "Alger"),
        "to_wilaya_name":  customer_wilaya_raw,
        "to_commune_name": _clean_commune_name(customer_commune_raw, customer_wilaya_raw),
        "product_list":    payload.get("product_list", "Colis"),
        "price":           payload.get("price") or (order.total if order else 0),
        "do_insurance":    payload.get("do_insurance", False),
        "declared_value":  payload.get("declared_value", 0),
        "height":          payload.get("height", 0),
        "width":           payload.get("width", 0),
        "length":          payload.get("length", 0),
        "weight":          payload.get("weight", 0),
        "freeshipping":    payload.get("freeshipping", 0),
        "is_stopdesk":     payload.get("is_stopdesk", False),
        "stopdesk_id":     payload.get("stopdesk_id"),
        "remarque":        order.notes if order and order.notes else "",
        "has_exchange":    False,
    }

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            r = await client.post(
                f"{base}/parcels/",
                headers=_headers(api_id, api_token),
                json=[body],
            )
        except httpx.TimeoutException:
            raise HTTPException(504, "Yalidine API timeout")
        except httpx.RequestError as e:
            raise HTTPException(502, f"Erreur réseau Yalidine: {e}")

    if r.status_code not in (200, 201):
        raise HTTPException(r.status_code, f"Yalidine: {r.text[:300]}")

    result = r.json()
    parcels = result if isinstance(result, list) else result.get("parcels", [result])
    tracking_number = (parcels[0] if parcels else {}).get("tracking") or ""

    # Persist tracking number on our order
    if order and tracking_number:
        # Same invariant as the main dispatch endpoint: a carrier parcel and
        # an internal driver can never both be active on the same order.
        if order.livreur_id:
            from app.models.events import OrderEvent as _OE
            import uuid as _uuid3
            db.add(_OE(id=str(_uuid3.uuid4()), order_id=order.id, actor_id=current_user.id,
                       from_status=order.status, to_status=order.status,
                       note=f"Switch livreur interne -> transporteur (Yalidine) : nouveau tracking {tracking_number}."))
            order.livreur_id = None
        order.tracking_number = tracking_number
        if order.status not in ("SHIPPED", "DELIVERED"):
            order.status = "SHIPPED"
        db.commit()

    return {"success": True, "tracking_number": tracking_number, "data": parcels[0] if parcels else result}


# ─── GET /api/yalidine/wilayas — Fetch wilayas + fees from Yalidine ──────────

@router.get("/wilayas")
async def get_wilayas(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
) -> Any:
    partner = _get_partner(db, store_id)
    api_id, api_token, base = _creds(partner)

    # Return cached fees if available
    cached = db.query(DeliveryFeeGrid).filter(DeliveryFeeGrid.partner_id == partner.id).all()
    if cached:
        return {
            "success": True,
            "data": [
                {"wilayaId": g.wilaya_id, "homeFee": g.home_fee, "officeFee": g.office_fee}
                for g in cached
            ],
        }

    # Fetch from Yalidine
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            r = await client.get(f"{base}/wilayas/", headers=_headers(api_id, api_token))
        except httpx.RequestError as e:
            raise HTTPException(502, f"Erreur réseau Yalidine: {e}")

    if r.status_code != 200:
        raise HTTPException(r.status_code, f"Yalidine: {r.text[:200]}")

    wilayas = r.json().get("data", r.json()) if isinstance(r.json(), dict) else r.json()
    return {"success": True, "data": wilayas}


# ─── POST /api/yalidine/wilayas — Sync & persist fees from Yalidine ──────────

@router.post("/wilayas")
async def sync_wilayas(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
) -> Any:
    partner = _get_partner(db, store_id)
    api_id, api_token, base = _creds(partner)

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            r = await client.get(f"{base}/deliveryfees/", headers=_headers(api_id, api_token))
        except httpx.RequestError as e:
            raise HTTPException(502, f"Erreur réseau Yalidine: {e}")

    if r.status_code != 200:
        raise HTTPException(r.status_code, f"Yalidine fees error: {r.text[:200]}")

    fees_raw = r.json().get("data", r.json()) if isinstance(r.json(), dict) else r.json()

    # Upsert into DeliveryFeeGrid
    count = 0
    for row in fees_raw:
        wilaya_id = row.get("wilaya_id") or row.get("wilayaId") or row.get("id")
        if not wilaya_id:
            continue
        home_fee   = int(row.get("home_fee") or row.get("homeFee") or 0)
        office_fee = int(row.get("office_fee") or row.get("officeFee") or row.get("desk_fee") or 0)

        existing = db.query(DeliveryFeeGrid).filter(
            DeliveryFeeGrid.partner_id == partner.id,
            DeliveryFeeGrid.wilaya_id  == wilaya_id,
        ).first()
        if existing:
            existing.home_fee   = home_fee
            existing.office_fee = office_fee
        else:
            db.add(DeliveryFeeGrid(
                id=__import__("uuid").uuid4().__str__(),
                partner_id=partner.id,
                wilaya_id=wilaya_id,
                home_fee=home_fee,
                office_fee=office_fee,
            ))
        count += 1

    db.commit()
    return {"success": True, "message": f"{count} wilayas synchronisées depuis Yalidine"}


# ─── POST /api/yalidine/test — Test API connection ───────────────────────────

@router.post("/test")
async def test_connection(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
) -> Any:
    import time
    partner = _get_partner(db, store_id)
    api_id, api_token, base = _creds(partner)

    t0 = time.monotonic()
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(f"{base}/wilayas/", headers=_headers(api_id, api_token))
            latency_ms = int((time.monotonic() - t0) * 1000)
            if r.status_code == 200:
                partner.last_test_ok = True  # type: ignore[assignment]
                partner.last_test_at = __import__("datetime").datetime.now()  # type: ignore[assignment]
                db.commit()
                return {"ok": True, "message": f"Connexion Yalidine OK ({latency_ms}ms)", "latency_ms": latency_ms}
            else:
                partner.last_test_ok = False  # type: ignore[assignment]
                db.commit()
                return {"ok": False, "message": f"Erreur Yalidine: HTTP {r.status_code}", "latency_ms": latency_ms}
        except Exception as e:
            return {"ok": False, "message": str(e), "latency_ms": 0}


# ─── POST /api/yalidine/webhook — Receive Yalidine status webhooks ────────────

@router.post("/webhook")
async def webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> Any:
    """
    Yalidine calls this URL when a parcel status changes.
    We update the matching order's status automatically.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    STATUS_MAP = {
        "livré":          "DELIVERED",
        "delivered":      "DELIVERED",
        "retourné":       "RETURNED",
        "returned":       "RETURNED",
        "en_route":       "SHIPPED",
        "in_transit":     "SHIPPED",
        "en livraison":   "SHIPPED",
        "collecté":       "SHIPPED",
    }

    tracking = body.get("tracking") or body.get("barcode")
    new_status_raw = (body.get("status") or body.get("last_status") or "").lower()
    new_status = STATUS_MAP.get(new_status_raw)

    if tracking and new_status:
        # Row-locked, re-checked-after-lock, routed through order_service.
        # update_order — NOT a raw `order.status = new_status` assignment.
        # This used to bypass the entire stock/state-machine logic: a
        # customer return reported by Yalidine here never restocked the
        # product (no return_restock call), unlike every other path
        # (noest_sync.py, the admin PATCH endpoint) that already went
        # through update_order. Same bug class as the internal-delivery
        # endpoint in delivery_partners.py, fixed the same way.
        db.query(Order.id).filter(Order.tracking_number == tracking, Order.is_deleted == False).with_for_update().first()
        order = db.query(Order).filter(Order.tracking_number == tracking, Order.is_deleted == False).first()
        if order and order.status != new_status:
            from app.services.order_service import order_service
            try:
                order_service.update_order(
                    db,
                    order=order,
                    update_data={
                        "status": new_status,
                        "notes": None,
                        "note": f"Statut mis à jour via Yalidine ({new_status})",
                    },
                    actor_id=None,  # system/carrier webhook, no logged-in user
                )
                db.commit()
                logger.info("Webhook Yalidine: order %s → %s", tracking, new_status)
            except Exception as exc:
                db.rollback()
                logger.warning("Webhook Yalidine: transition to %s refused for order %s: %s", new_status, order.id, exc)

    return {"received": True}
