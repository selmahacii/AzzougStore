"""
Noest carrier proxy.
Fetches store API credentials from DB, proxies requests to Noest REST API.
"""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, BackgroundTasks
from sqlalchemy.orm import Session

from app.api import deps
from app.db.session import get_db
from app.models.delivery_partner import DeliveryPartner
from app.models.order import Order
from app.core.encryption import decrypt_dict

logger = logging.getLogger("carriers.noest")
router = APIRouter()

PROD_BASE = "https://app.noest-dz.com"
TIMEOUT   = 15.0


# ─── helpers ─────────────────────────────────────────────────────────────────

def _get_partner(db: Session, store_id: str) -> DeliveryPartner:
    partner = (
        db.query(DeliveryPartner)
        .filter(
            DeliveryPartner.store_id == store_id,
            DeliveryPartner.carrier_id == "noest",
            DeliveryPartner.is_active == True,
        )
        .first()
    )
    if not partner:
        raise HTTPException(404, "Noest non configuré pour cette boutique")
    return partner


def _creds(partner: DeliveryPartner) -> tuple[str, str, str]:
    """Returns (api_token, guid, base_url)."""
    try:
        cfg = decrypt_dict(partner.api_config_encrypted or "")
    except Exception:
        cfg = {}
    token = cfg.get("api_token") or cfg.get("token") or ""
    guid  = cfg.get("guid") or cfg.get("user_guid") or ""
    if not token:
        raise HTTPException(400, "Clé API Noest manquante — configurez le transporteur")
    base = PROD_BASE
    return token, guid, base


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
    }


# ─── GET /api/noest/track/{tracking_number} ──────────────────────────────────

@router.get("/track/{tracking_number}")
async def track_parcel(
    tracking_number: str,
    store_id: str = Query(...),
    db: Session = Depends(get_db),
) -> Any:
    partner = _get_partner(db, store_id)
    token, _guid, base = _creds(partner)

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            r = await client.post(
                f"{base}/api/public/get/trackings/info",
                headers=_headers(token),
                json={"trackings": [tracking_number]},
            )
        except httpx.TimeoutException:
            raise HTTPException(504, "Noest API timeout")
        except httpx.RequestError as e:
            raise HTTPException(502, f"Erreur réseau Noest: {e}")

    if r.status_code == 404:
        raise HTTPException(404, "Numéro de suivi introuvable sur Noest")
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"Noest API error: {r.text[:200]}")

    data = r.json()
    # Response: { "TRK...": { "OrderInfo": {...}, "activity": [...] } }
    parcel = data.get(tracking_number) or (list(data.values())[0] if data else {})
    return _normalize_tracking(parcel if isinstance(parcel, dict) else {})


def _normalize_tracking(data: dict) -> dict:  # type: ignore[override]
    info = data.get("OrderInfo") or {}
    activity = data.get("activity") or []

    status_raw = (info.get("statut") or info.get("status") or "").lower()
    STATUS_MAP = {
        "livré": "DELIVERED", "livre": "DELIVERED", "delivered": "DELIVERED",
        "en livraison": "OUT_FOR_DELIVERY", "fdr_activated": "OUT_FOR_DELIVERY",
        "en route": "IN_TRANSIT", "in_transit": "IN_TRANSIT",
        "retourné": "RETURNED", "retourne": "RETURNED", "returned": "RETURNED",
        "collecté": "PICKED_UP", "collected": "PICKED_UP",
        "annulé": "FAILED", "cancelled": "FAILED",
    }
    # Derive status from last activity event_key if not in OrderInfo
    if not status_raw and activity:
        last_key = (activity[-1].get("event_key") or activity[-1].get("event") or "").lower()
        status_raw = last_key

    status = STATUS_MAP.get(status_raw, "PENDING")

    events = [
        {
            "label":    ev.get("event") or "—",
            "status":   ev.get("event_key") or "",
            "location": "",
            "date":     (ev.get("date") or "")[:10],
            "time":     (ev.get("date") or "")[11:16],
        }
        for ev in activity
    ]

    wilaya_id = info.get("wilaya_id")
    return {
        "tracking_number": info.get("tracking") or "",
        "status":          status,
        "last_location":   info.get("commune") or (f"Wilaya {wilaya_id}" if wilaya_id else "—"),
        "last_event":      activity[-1].get("event") if activity else status,
        "recipient_name":  info.get("client") or data.get("recipientName") or "",
        "recipient_phone": info.get("phone") or "",
        "destination":     info.get("adresse") or "",
        "wilaya":          str(wilaya_id) if wilaya_id else "",
        "events":          events,
        "carrier":         "Noest",
    }


# ─── GET /api/noest/stations — Fetch Noest Stations ──────────────────────────────

@router.get("/stations")
async def get_stations(
    store_id: str = Query(...),
    wilaya_id: int = Query(None),
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
) -> Any:
    """Fetch the list of Noest relay stations directly from their API."""
    partner = _get_partner(db, store_id)
    token, guid, base = _creds(partner)
    
    url = f"{base}/api/public/get/stations"
    if wilaya_id:
        url += f"?wilaya_id={wilaya_id}"
        
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(url, headers=_headers(token))
        if r.status_code != 200:
            raise HTTPException(r.status_code, f"Erreur Noest: Impossible de récupérer les stations. {r.text[:200]}")
        return r.json()


# ─── POST /api/noest/parcels — Create shipment ───────────────────────────────

@router.post("/parcels")
async def create_parcel(
    payload: dict,
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
) -> Any:
    partner = _get_partner(db, store_id)
    token, guid, base = _creds(partner)

    order_id = payload.get("order_id")
    order: Optional[Order] = None
    if order_id:
        order = db.query(Order).filter(Order.id == order_id).first()

    ref = payload.get("reference") or (order.order_number if order else str(uuid.uuid4())[:8])

    from app.services.noest_mapping import find_best_commune_match, map_wilaya_name_to_id

    customer_commune_raw = payload.get("commune") or (order.customer_commune if order else "")
    customer_wilaya_raw = payload.get("wilaya_id") or (order.customer_wilaya if order else None)

    if isinstance(customer_wilaya_raw, str) and not customer_wilaya_raw.isdigit():
        wilaya_id_val = map_wilaya_name_to_id(customer_wilaya_raw)
    elif customer_wilaya_raw:
        wilaya_id_val = int(customer_wilaya_raw)
    else:
        wilaya_id_val = 16

    best_commune = await find_best_commune_match(db, store_id, wilaya_id_val, customer_commune_raw)
    if not best_commune:
        best_commune = customer_commune_raw or "Chef-lieu"

    body: dict = {
        "user_guid":  guid,
        "reference":  ref,
        "client":     payload.get("recipient_name") or (order.customer_name if order else ""),
        "phone":      payload.get("phone") or (order.customer_phone if order else ""),
        "adresse":    payload.get("address") or (order.customer_address if order else ""),
        "wilaya_id":  wilaya_id_val,
        "commune":    best_commune,
        "montant":    payload.get("price") or (order.total if order else 0),
        "produit":    payload.get("product_list") or "Colis e-commerce",
        "remarque":   order.notes if order and order.notes else "",
        "type_id":    payload.get("type_id", 1),
        "stop_desk":  1 if payload.get("is_stopdesk") else 0,
        "poids":      payload.get("weight", 0),
        "can_open":   payload.get("can_open", 0),
    }
    
    # Extract station_code if stop_desk is active
    if body["stop_desk"]:
        import re
        station_code = payload.get("station_code")
        if not station_code and order:
            match = re.search(r"Bureau Noest\s+([A-Za-z0-9_\-]+)", order.customer_address or "", re.IGNORECASE)
            if match:
                station_code = match.group(1)
        
        if not station_code:
            raise HTTPException(
                status_code=400,
                detail="Le bureau Noest sélectionné est invalide ou n'a pas été trouvé dans l'adresse. Veuillez modifier la commande pour choisir un bureau relais Noest valide."
            )
        body["station_code"] = station_code.lstrip("0") if isinstance(station_code, str) else station_code

    # Remove None values
    body = {k: v for k, v in body.items() if v is not None}

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            r = await client.post(
                f"{base}/api/public/create/order",
                headers=_headers(token),
                json=body,
            )
            
            # Check if we got validation errors (commune or station_code)
            res_temp = {}
            try:
                res_temp = r.json()
            except Exception:
                pass

            err_str = ""
            if r.status_code == 422:
                err_str = r.text.lower()
            elif r.status_code == 200 and not res_temp.get("success"):
                err_str = str(res_temp.get("message") or res_temp.get("errors") or "").lower()

            is_commune_err = "commune" in err_str
            is_station_err = "station" in err_str or "valide" in err_str

            # Retry with lowercase station_code if invalid
            if is_station_err and body.get("stop_desk") and isinstance(body.get("station_code"), str):
                orig_code = body["station_code"]
                body["station_code"] = orig_code.lower() if orig_code.isupper() else orig_code.upper()
                r = await client.post(
                    f"{base}/api/public/create/order",
                    headers=_headers(token),
                    json=body,
                )
                try:
                    res_temp = r.json()
                except Exception:
                    pass
                err_str = ""
                if r.status_code == 422:
                    err_str = r.text.lower()
                elif r.status_code == 200 and not res_temp.get("success"):
                    err_str = str(res_temp.get("message") or res_temp.get("errors") or "").lower()
                
                is_commune_err = "commune" in err_str
                is_station_err = "station" in err_str or "valide" in err_str
                
                # If STILL failing due to station, raise explicit error right away
                if is_station_err and (r.status_code == 422 or (r.status_code == 200 and not res_temp.get("success"))):
                    raise HTTPException(
                        status_code=400,
                        detail="Le code de bureau Noest sélectionné n'est plus reconnu par Noest. Veuillez modifier la commande pour sélectionner un bureau valide dans la liste."
                    )

            # Retry with fallback if commune is invalid
            if is_commune_err:
                fallback_commune = (order.customer_wilaya if order else None) or "Chef-lieu"
                body["commune"] = fallback_commune
                r = await client.post(
                    f"{base}/api/public/create/order",
                    headers=_headers(token),
                    json=body,
                )
        except httpx.TimeoutException:
            raise HTTPException(504, "Noest API timeout")
        except httpx.RequestError as e:
            raise HTTPException(502, f"Erreur réseau Noest: {e}")

    if r.status_code not in (200, 201):
        raise HTTPException(r.status_code, f"Noest: {r.text[:300]}")

    result = r.json()
    if not result.get("success"):
        err_msg = result.get("message") or str(result.get("errors") or "Erreur de validation Noest")
        # Ensure station errors are correctly mapped
        if "station" in err_msg.lower():
            err_msg = "Le code de bureau relais (Stop Desk) est invalide chez Noest. Veuillez modifier l'adresse."
        raise HTTPException(400, f"Erreur Noest: {err_msg}")

    tracking_number = result.get("tracking") or ""

    if order and tracking_number:
        order.tracking_number = tracking_number
        db.commit()

    return {"success": True, "tracking_number": tracking_number, "data": result}


# ─── POST /api/noest/test ─────────────────────────────────────────────────────

@router.post("/test")
async def test_connection(
    body: dict = {},
    store_id: str = Query(...),
    db: Session = Depends(get_db),
) -> Any:
    """Test connection. Accepts credentials directly in body (before saving) or reads from DB."""
    from datetime import datetime

    # Prefer credentials from request body (pre-save test)
    token = body.get("api_token") or body.get("token") or ""
    if not token:
        # Fall back to saved partner
        try:
            partner = _get_partner(db, store_id)
            token, _guid, _base = _creds(partner)
        except HTTPException:
            return {"ok": False, "message": "Aucun transporteur Noest configuré pour cette boutique", "latency_ms": 0}

    t0 = time.monotonic()
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(
                f"{PROD_BASE}/api/public/get/wilayas",
                headers=_headers(token),
            )
            latency_ms = int((time.monotonic() - t0) * 1000)
            ok = r.status_code == 200

            # Update DB record if partner exists
            try:
                partner = _get_partner(db, store_id)
                partner.last_test_ok = ok  # type: ignore[assignment]
                partner.last_test_at = datetime.now()  # type: ignore[assignment]
                db.commit()
            except HTTPException:
                pass

            if ok:
                return {"ok": True, "message": f"Connexion Noest OK ({latency_ms}ms)", "latency_ms": latency_ms}
            return {"ok": False, "message": f"Noest a répondu HTTP {r.status_code} — vérifiez votre api_token", "latency_ms": latency_ms}
        except Exception as e:
            return {"ok": False, "message": f"Impossible de joindre Noest: {e}", "latency_ms": 0}


# ─── POST /api/noest/webhook ──────────────────────────────────────────────────

@router.post("/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)) -> Any:
    """Receives Noest status update webhooks and updates the order."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    STATUS_MAP = {
        "livré":    "DELIVERED",
        "livre":    "DELIVERED",
        "retourné": "RETURNED",
        "retourne": "RETURNED",
        "en route": "SHIPPED",
        "collecté": "SHIPPED",
    }

    tracking    = body.get("tracking") or body.get("tracking_id") or body.get("barcode") or body.get("id")
    status_raw  = (body.get("statut") or body.get("status") or body.get("etat") or "").lower()
    new_status  = STATUS_MAP.get(status_raw)

    if tracking and new_status:
        order = db.query(Order).filter(Order.tracking_number == tracking, Order.is_deleted == False).first()
        if order and order.status != new_status:
            from app.models.events import OrderEvent
            import uuid
            
            event = OrderEvent(
                id=str(uuid.uuid4()),
                order_id=order.id,
                from_status=order.status,
                to_status=new_status,
                note=f"Statut mis à jour via Noest ({new_status})"
            )
            db.add(event)
            order.status = new_status
            db.commit()
            logger.info("Webhook Noest: %s → %s", tracking, new_status)

    return {"received": True}
