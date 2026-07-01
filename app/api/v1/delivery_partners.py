# pyrefly: ignore-all-errors
"""
Delivery Partners API
CRUD for carrier integrations + tracking proxy + webhook receiver.
"""
from datetime import datetime, timezone
from typing import Optional, List, Any
import uuid
import httpx
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Body, Request, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from app.api import deps
from app.db.session import get_db
from app.models.delivery_partner import DeliveryPartner, DeliveryFeeGrid
from app.models.order import Order
from app.models.events import OrderEvent
from app.models.product import Product
from app.core.encryption import encrypt_dict, decrypt_dict, mask_value

router = APIRouter()

# ─── Carrier catalogue (mirrors frontend) ───────────────────
CARRIER_API = {
    "yalidine": {
        "sandbox_url": "https://dev.yalidine.app/api/v1",
        "prod_url":    "https://api.yalidine.app/api/v1",
        "auth_style":  "headers",        # X-API-ID + X-API-TOKEN
    },
    "zaki": {
        "sandbox_url": "https://sandbox.zaki.dz/api",
        "prod_url":    "https://api.zaki.dz/v1",
        "auth_style":  "bearer",
    },
    "noest": {
        "sandbox_url": "https://staging.noest.dz/api",
        "prod_url":    "https://api.noest.dz/v2",
        "auth_style":  "bearer",
    },
    "procolis": {
        "sandbox_url": "https://test.procolis.com/api/v1",
        "prod_url":    "https://app.procolis.com/api/v1",
        "auth_style":  "bearer",
    },
    "ecotrack": {
        "sandbox_url": "https://sandbox.ecotrack.dz/api",
        "prod_url":    "https://api.ecotrack.dz/v1",
        "auth_style":  "bearer",
    },
    "zr_express": {
        "sandbox_url": "https://api.zrexpress.app/api/v1",
        "prod_url":    "https://api.zrexpress.app/api/v1",
        "auth_style":  "zr",          # X-Api-Key + X-Tenant headers
    },
}

STATUS_MAP = {
    # Yalidine statuses
    "delivered": "DELIVERED",
    "in_transit": "SHIPPED",
    "returned": "RETURNED",
    "cancelled": "CANCELLED",
    "picked_up": "SHIPPED",
    "echec": "RETURNED",
    "echec_livraison": "RETURNED",
    "echèc": "RETURNED",
    "supprimer": "CANCELLED",
    "supprimer definitivement": "CANCELLED",
    "échèc": "RETURNED",
    "échec": "RETURNED",
    # Noest statuses
    "livré": "DELIVERED",
    "en_route": "SHIPPED",
    "retourné": "RETURNED",
    "annulé": "CANCELLED",
    "retour": "RETURNED",
    "retournee": "RETURNED",
    "retournée": "RETURNED",
}


# ─── Schemas ─────────────────────────────────────────────────

class PartnerCreate(BaseModel):
    store_id: str
    carrier_id: str
    name: str
    is_sandbox: bool = True
    api_config: dict                 # raw keys — will be encrypted before storage
    fee_home: float = 0.0
    fee_relay: float = 0.0
    free_shipping_threshold: Optional[float] = None
    webhook_url: Optional[str] = None
    type: Optional[str] = "EXTERNAL" # INTERNAL | EXTERNAL
    commission_type: Optional[str] = "FIXED" # FIXED | PERCENTAGE
    commission_value: Optional[float] = 0.0
    performance_score: Optional[float] = 100.0


class PartnerUpdate(BaseModel):
    is_active: Optional[bool] = None
    is_sandbox: Optional[bool] = None
    api_config: Optional[dict] = None
    fee_home: Optional[float] = None
    fee_relay: Optional[float] = None
    free_shipping_threshold: Optional[float] = None
    webhook_url: Optional[str] = None
    type: Optional[str] = None
    commission_type: Optional[str] = None
    commission_value: Optional[float] = None
    performance_score: Optional[float] = None


class PartnerOut(BaseModel):
    id: str
    store_id: str
    carrier_id: str
    name: str
    is_active: bool
    is_sandbox: bool
    api_config_masked: dict          # keys masked for display
    fee_home: float
    fee_relay: float
    free_shipping_threshold: Optional[float]
    webhook_url: Optional[str]
    last_test_at: Optional[datetime]
    last_test_ok: Optional[bool]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


def _serialize(p: DeliveryPartner) -> dict:
    try:
        config = decrypt_dict(p.api_config_encrypted or "")
        masked = {k: mask_value(v) for k, v in config.items()}
    except Exception:
        masked = {}
    return {
        "id": p.id,
        "store_id": p.store_id,
        "carrier_id": p.carrier_id,
        "code": p.carrier_id,
        "name": p.name,
        "logo_url": getattr(p, "logo_url", None),
        "logoUrl": getattr(p, "logo_url", None),
        "is_active": p.is_active,
        "is_sandbox": getattr(p, "is_sandbox", True),
        "api_config_masked": masked,
        "fee_home": getattr(p, "fee_home", 0.0) or 0.0,
        "fee_relay": getattr(p, "fee_relay", 0.0) or 0.0,
        "free_shipping_threshold": getattr(p, "free_shipping_threshold", None),
        "webhook_url": getattr(p, "webhook_url", None),
        "type": getattr(p, "type", "EXTERNAL"),
        "commission_type": getattr(p, "commission_type", "FIXED"),
        "commission_value": getattr(p, "commission_value", 0.0),
        "performance_score": getattr(p, "performance_score", 100.0),
        "last_test_at": p.last_test_at.isoformat() if getattr(p, "last_test_at", None) else None,
        "last_test_ok": getattr(p, "last_test_ok", None),
        "configured_by": getattr(p, "configured_by", None),
        "created_at": p.created_at.isoformat() if getattr(p, "created_at", None) else None,
        "updated_at": p.updated_at.isoformat() if getattr(p, "updated_at", None) else None,
        "pricing_grid": [
            {"wilaya_id": e.wilaya_id, "home_fee": e.home_fee, "office_fee": e.office_fee}
            for e in p.pricing_grid
        ] if p.pricing_grid else [],
    }


# ─── Public: Calculate delivery fee ─────────────────────────

_WILAYAS = [
    'Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa',
    'Biskra', 'Béchar', 'Blida', 'Bouira', 'Tamanrasset', 'Tébessa',
    'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger', 'Djelfa', 'Jijel',
    'Sétif', 'Saïda', 'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma',
    'Constantine', 'Médéa', 'Mostaganem', "M'Sila", 'Mascara', 'Ouargla',
    'Oran', 'El Bayadh', 'Illizi', 'Bordj Bou Arréridj', 'Boumerdès',
    'El Tarf', 'Tindouf', 'Tissemsilt', 'El Oued', 'Khenchela',
    'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent',
    'Ghardaïa', 'Relizane', "El M'Ghair", 'El Meniaa', 'Ouled Djellal',
    'Bordj Baji Mokhtar', 'Béni Abbès', 'Timimoun', 'Touggourt', 'Djanet',
    'In Salah', 'In Guezzam',
]

def _wilaya_name_to_id(name: str) -> Optional[int]:
    """Convert wilaya name to 1-based numeric ID, or None if not found."""
    try:
        return int(name)  # already a numeric string
    except (ValueError, TypeError):
        pass
    normalized = name.strip().lower()
    for i, w in enumerate(_WILAYAS):
        if w.lower() == normalized:
            return i + 1
    return None


@router.get("/calculate")
def calculate_delivery_fee(
    partner_id: str = Query(..., alias="partnerId"),
    wilaya_id: str = Query(..., alias="wilayaId"),
    delivery_type: str = Query("home", alias="type"),
    product_ids: Optional[str] = Query(None, alias="productIds"),
    db: Session = Depends(get_db),
):
    """
    Public endpoint for the storefront to get delivery fee for a carrier + wilaya.
    Priority: product-specific custom rate → per-wilaya grid → flat partner fee.
    """
    partner = db.query(DeliveryPartner).filter(
        DeliveryPartner.id == partner_id,
        DeliveryPartner.is_active == True,
    ).first()
    if not partner:
        return {"success": False, "fee": None}

    is_office = delivery_type.lower() in ("office", "relay", "bureau", "desk", "office_fee", "desk_fee")
    numeric_id = _wilaya_name_to_id(wilaya_id)

    # 1. Resolve fee using products if productIds are provided
    if product_ids and numeric_id is not None:
        p_ids = [pid.strip() for pid in product_ids.split(",") if pid.strip()]
        if p_ids:
            products = db.query(Product).filter(Product.id.in_(p_ids)).all()
            if products:
                resolved_fees = []
                for product in products:
                    product_fee = None
                    if product.delivery_fees:
                        try:
                            import json
                            d_fees = product.delivery_fees
                            if isinstance(d_fees, str):
                                d_fees = json.loads(d_fees)
                            
                            if isinstance(d_fees, dict):
                                if d_fees.get("is_free") or d_fees.get("isFree"):
                                    product_fee = 0.0
                                else:
                                    fees_grid = d_fees.get("fees", {})
                                    carrier_key = partner.carrier_id
                                    carrier_fees = fees_grid.get(carrier_key) or fees_grid.get(partner.id)
                                    if isinstance(carrier_fees, dict):
                                        w_fees = carrier_fees.get(str(numeric_id)) or carrier_fees.get(numeric_id)
                                        if isinstance(w_fees, dict):
                                            type_key = "desk" if is_office else "home"
                                            fee_val = w_fees.get(type_key)
                                            if fee_val is None and type_key == "desk":
                                                fee_val = w_fees.get("office") or w_fees.get("relay")
                                            
                                            if fee_val is not None:
                                                product_fee = float(fee_val)
                        except Exception as e:
                            logger.error(f"Error parsing delivery_fees for product {product.id}: {e}")

                    # Fallback to default carrier grid or flat rate for this product
                    if product_fee is None:
                        grid_entry = db.query(DeliveryFeeGrid).filter(
                            DeliveryFeeGrid.partner_id == partner_id,
                            DeliveryFeeGrid.wilaya_id == numeric_id,
                        ).first()
                        if grid_entry:
                            product_fee = float(grid_entry.office_fee if is_office else grid_entry.home_fee)
                        else:
                            product_fee = float(partner.fee_relay if is_office else partner.fee_home)

                    resolved_fees.append(product_fee)

                if resolved_fees:
                    max_fee = max(resolved_fees)
                    return {
                        "success": True,
                        "data": {
                            "fee": max_fee,
                            "partner_id": partner_id,
                            "wilaya_id": numeric_id,
                            "type": delivery_type,
                            "source": "product_custom"
                        }
                    }

    # 2. Try default carrier per-wilaya fee grid
    if numeric_id is not None:
        grid_entry = db.query(DeliveryFeeGrid).filter(
            DeliveryFeeGrid.partner_id == partner_id,
            DeliveryFeeGrid.wilaya_id == numeric_id,
        ).first()
        if grid_entry:
            fee = grid_entry.office_fee if is_office else grid_entry.home_fee
            return {"success": True, "data": {"fee": fee, "partner_id": partner_id, "wilaya_id": numeric_id, "type": delivery_type, "source": "grid"}}

    # 3. Fall back to partner flat rate
    fee = partner.fee_relay if is_office else partner.fee_home
    return {"success": True, "data": {"fee": fee, "partner_id": partner_id, "type": delivery_type, "source": "flat"}}


# ─── Public Availability ─────────────────────────────────────

@router.get("/availability")
def get_partners_availability(
    store_id: str = Query(..., alias="storeId"),
    product_ids: Optional[str] = Query(None, alias="productIds"),
    db: Session = Depends(get_db),
):
    """
    Public endpoint for the storefront to check which carriers are active for a store.
    No authentication required.
    """
    partners = db.query(DeliveryPartner).filter(
        DeliveryPartner.store_id == store_id,
        DeliveryPartner.is_active == True
    ).all()
    
    # Filter by product allowed_carriers
    if product_ids:
        ids_list = [i.strip() for i in product_ids.split(",") if i.strip()]
        if ids_list:
            products = db.query(Product).filter(Product.id.in_(ids_list)).all()
            
            allowed_sets = []
            for prod in products:
                if prod.allowed_carriers and len(prod.allowed_carriers) > 0:
                    allowed_sets.append(set(prod.allowed_carriers))
            
            if allowed_sets:
                # Intersection of all products' allowed carriers
                common_carriers = set.intersection(*allowed_sets)
                partners = [
                    p for p in partners 
                    if p.id in common_carriers or p.carrier_id in common_carriers or p.name in common_carriers
                ]

    return {"success": True, "data": [_serialize(p) for p in partners]}


# ─── Fee Grid ────────────────────────────────────────────────

class FeeGridEntry(BaseModel):
    wilaya_id: int
    home_fee: float = 0.0
    office_fee: float = 0.0


class FeeGridPayload(BaseModel):
    fees: List[FeeGridEntry]


@router.post("/{partner_id}/fees")
def save_fee_grid(
    partner_id: str,
    payload: FeeGridPayload,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    """Bulk upsert per-wilaya delivery fees for a partner."""
    logger.info(f"[fees] save_fee_grid called: partner_id={partner_id}, count={len(payload.fees)}")
    partner = db.query(DeliveryPartner).filter(DeliveryPartner.id == partner_id).first()
    if not partner:
        logger.error(f"[fees] partner {partner_id} not found")
        raise HTTPException(404, "Partner not found")

    try:
        deleted = db.query(DeliveryFeeGrid).filter(DeliveryFeeGrid.partner_id == partner_id).delete()
        logger.info(f"[fees] deleted {deleted} existing entries")

        for entry in payload.fees:
            grid = DeliveryFeeGrid(
                id=str(uuid.uuid4()),
                partner_id=partner_id,
                wilaya_id=entry.wilaya_id,
                home_fee=entry.home_fee,
                office_fee=entry.office_fee,
            )
            db.add(grid)

        db.commit()
        logger.info(f"[fees] committed {len(payload.fees)} fee entries for partner {partner_id}")
    except Exception as e:
        db.rollback()
        logger.exception(f"[fees] DB error saving fees: {e}")
        raise HTTPException(500, f"Erreur base de données: {str(e)}")

    return {"success": True, "message": f"{len(payload.fees)} tarifs sauvegardés"}


@router.post("/{partner_id}/sync-fees")
async def sync_fees(
    partner_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    """Auto-fetch delivery fees from the carrier's API and populate the fee grid."""
    partner = db.query(DeliveryPartner).filter(DeliveryPartner.id == partner_id).first()
    if not partner:
        raise HTTPException(404, "Partner not found")

    config = decrypt_dict(partner.api_config_encrypted or "")
    carrier = CARRIER_API.get(partner.carrier_id)
    if not carrier and partner.carrier_id != "zr_express":
        raise HTTPException(400, "Synchronisation automatique non supportée pour ce transporteur.")

    base_url = carrier["sandbox_url"] if partner.is_sandbox else carrier["prod_url"] if carrier else ""
    headers = _build_headers(partner.carrier_id, carrier.get("auth_style", "") if carrier else "zr", config)

    fee_entries = []
    
    try:
        import httpx
        import uuid
        async with httpx.AsyncClient(timeout=10.0) as client:
            if partner.carrier_id == "yalidine":
                r = await client.get(f"{base_url}/deliveryfees/", headers=headers)
                if r.status_code >= 400:
                    raise Exception(f"Yalidine API error: {r.text[:100]}")
                data = r.json()
                items = data.get("data", [])
                for item in items:
                    wid = item.get("wilaya_id")
                    if wid:
                        fee_entries.append({
                            "wilaya_id": wid,
                            "home_fee": item.get("home_fee", 0.0),
                            "office_fee": item.get("desk_fee", 0.0),
                        })

            elif partner.carrier_id == "zr_express":
                # Use existing zr_client logic for ZR Express
                from app.core.zr_express import ZRExpressClient
                zr = ZRExpressClient(
                    base_url="https://api.zrexpress.dz",
                    secret_key=config.get("secret_key") or config.get("api_key", ""),
                    tenant_id=config.get("tenant_id", "")
                )
                data = zr.get_all_rates()
                # data is expected to be a dict of wilaya_id -> {"home_fee": X, "office_fee": Y} or similar list
                for item in data:
                    # zr_express returns wilaya_id, to_desk, to_home
                    wid = item.get("wilaya_id")
                    if wid:
                        fee_entries.append({
                            "wilaya_id": wid,
                            "home_fee": item.get("to_home", item.get("home_fee", 0.0)),
                            "office_fee": item.get("to_desk", item.get("office_fee", 0.0)),
                        })
            else:
                raise HTTPException(400, "Synchronisation automatique non supportée pour ce transporteur.")

        if not fee_entries:
            raise Exception("Aucun tarif trouvé depuis l'API du transporteur.")

        # Save to DB - do not overwrite existing fees
        existing = db.query(DeliveryFeeGrid).filter(DeliveryFeeGrid.partner_id == partner_id).all()
        existing_map = {e.wilaya_id: e for e in existing}
        
        added_count = 0
        for entry in fee_entries:
            wid = entry["wilaya_id"]
            if wid not in existing_map:
                grid = DeliveryFeeGrid(
                    id=str(uuid.uuid4()),
                    partner_id=partner_id,
                    wilaya_id=wid,
                    home_fee=entry["home_fee"],
                    office_fee=entry["office_fee"],
                )
                db.add(grid)
                added_count += 1
            
        db.commit()
        return {"success": True, "message": f"{added_count} nouveaux tarifs synchronisés avec succès. Les tarifs existants ont été préservés."}

    except Exception as e:
        db.rollback()
        logger.exception(f"[fees] Auto-sync failed for {partner_id}: {e}")
        raise HTTPException(502, f"Échec de la synchronisation: {str(e)}")


@router.get("/{partner_id}/fees")
def get_fee_grid(
    partner_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    """Get all per-wilaya fees for a partner."""
    entries = db.query(DeliveryFeeGrid).filter(
        DeliveryFeeGrid.partner_id == partner_id
    ).all()
    return {
        "success": True,
        "data": [
            {"wilaya_id": e.wilaya_id, "home_fee": e.home_fee, "office_fee": e.office_fee}
            for e in entries
        ],
    }


# ─── CRUD ────────────────────────────────────────────────────

@router.get("/")
def list_partners(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    partners = db.query(DeliveryPartner).filter(
        DeliveryPartner.store_id == store_id
    ).order_by(DeliveryPartner.created_at).all()
    return {"success": True, "data": [_serialize(p) for p in partners]}


@router.post("/")
def upsert_partner(
    payload: PartnerCreate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    """Create or replace a carrier config for a store (upsert by store+carrier)."""
    encrypted = encrypt_dict(payload.api_config)

    existing = db.query(DeliveryPartner).filter(
        DeliveryPartner.store_id == payload.store_id,
        DeliveryPartner.carrier_id == payload.carrier_id,
    ).first()

    now = datetime.now(timezone.utc)
    if existing:
        existing.name = payload.name
        existing.is_sandbox = payload.is_sandbox
        existing.api_config_encrypted = encrypted
        existing.fee_home = payload.fee_home
        existing.fee_relay = payload.fee_relay
        existing.free_shipping_threshold = payload.free_shipping_threshold
        existing.webhook_url = payload.webhook_url
        existing.type = payload.type or "EXTERNAL"
        existing.commission_type = payload.commission_type or "FIXED"
        existing.commission_value = payload.commission_value or 0.0
        existing.performance_score = payload.performance_score or 100.0
        existing.is_active = True  # type: ignore[assignment]
        existing.configured_by = current_user.id
        existing.updated_at = now
        db.commit()
        db.refresh(existing)
        return {"success": True, "data": _serialize(existing)}

    partner = DeliveryPartner(
        id=str(uuid.uuid4()),
        store_id=payload.store_id,
        carrier_id=payload.carrier_id,
        name=payload.name,
        is_sandbox=payload.is_sandbox,
        api_config_encrypted=encrypted,
        fee_home=payload.fee_home,
        fee_relay=payload.fee_relay,
        free_shipping_threshold=payload.free_shipping_threshold,
        webhook_url=payload.webhook_url,
        type=payload.type or "EXTERNAL",
        commission_type=payload.commission_type or "FIXED",
        commission_value=payload.commission_value or 0.0,
        performance_score=payload.performance_score or 100.0,
        configured_by=current_user.id,
        updated_at=now,
    )
    db.add(partner)
    db.commit()
    db.refresh(partner)
    return {"success": True, "data": _serialize(partner)}


@router.patch("/{partner_id}")
def update_partner(
    partner_id: str,
    payload: PartnerUpdate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    partner = db.query(DeliveryPartner).filter(DeliveryPartner.id == partner_id).first()
    if not partner:
        raise HTTPException(404, "Partner not found")

    if payload.is_active is not None:
        partner.is_active = payload.is_active
    if payload.is_sandbox is not None:
        partner.is_sandbox = payload.is_sandbox
    if payload.api_config is not None:
        partner.api_config_encrypted = encrypt_dict(payload.api_config)
    if payload.fee_home is not None:
        partner.fee_home = payload.fee_home
    if payload.fee_relay is not None:
        partner.fee_relay = payload.fee_relay
    if payload.free_shipping_threshold is not None:
        partner.free_shipping_threshold = payload.free_shipping_threshold
    if payload.webhook_url is not None:
        partner.webhook_url = payload.webhook_url
    if payload.type is not None:
        partner.type = payload.type
    if payload.commission_type is not None:
        partner.commission_type = payload.commission_type
    if payload.commission_value is not None:
        partner.commission_value = payload.commission_value
    if payload.performance_score is not None:
        partner.performance_score = payload.performance_score

    partner.configured_by = current_user.id
    partner.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(partner)
    return {"success": True, "data": _serialize(partner)}


@router.patch("/{partner_id}/toggle")
def toggle_partner(
    partner_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    partner = db.query(DeliveryPartner).filter(DeliveryPartner.id == partner_id).first()
    if not partner:
        raise HTTPException(404, "Partner not found")
    partner.is_active = not partner.is_active  # type: ignore[assignment]
    db.commit()
    return {"success": True, "is_active": partner.is_active}


@router.delete("/{partner_id}")
def delete_partner(
    partner_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    partner = db.query(DeliveryPartner).filter(DeliveryPartner.id == partner_id).first()
    if not partner:
        raise HTTPException(404, "Partner not found")
    db.delete(partner)
    db.commit()
    return {"success": True, "message": "Carrier supprimé"}


# ─── Connectivity Test ───────────────────────────────────────

@router.post("/{partner_id}/test")
async def test_partner(
    partner_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    partner = db.query(DeliveryPartner).filter(DeliveryPartner.id == partner_id).first()
    if not partner:
        raise HTTPException(404, "Partner not found")

    config = decrypt_dict(partner.api_config_encrypted or "")
    carrier = CARRIER_API.get(partner.carrier_id)

    ok = False
    message = "Test échoué"
    latency_ms = 0

    if carrier:
        base_url = carrier["sandbox_url"] if partner.is_sandbox else carrier["prod_url"]
        headers = _build_headers(partner.carrier_id, carrier["auth_style"], config)
        try:
            import time
            t0 = time.monotonic()
            async with httpx.AsyncClient(timeout=8.0) as client:
                # Each carrier has a different ping/health endpoint
                ping_path = _get_ping_path(partner.carrier_id)
                r = await client.get(f"{base_url}{ping_path}", headers=headers)
            latency_ms = int((time.monotonic() - t0) * 1000)
            ok = r.status_code < 400
            message = "Connexion établie. Credentials valides." if ok else f"Erreur {r.status_code}: {r.text[:100]}"
        except httpx.ConnectError:
            message = "Impossible de joindre le serveur carrier."
        except httpx.TimeoutException:
            message = "Timeout — serveur carrier lent."
        except Exception as e:
            message = f"Erreur réseau: {str(e)[:80]}"
    else:
        # custom carrier — just check URL reachability
        api_url = config.get("api_url", "")
        if api_url:
            try:
                import time
                t0 = time.monotonic()
                async with httpx.AsyncClient(timeout=8.0) as client:
                    r = await client.get(api_url, timeout=5.0)
                latency_ms = int((time.monotonic() - t0) * 1000)
                ok = r.status_code < 500
                message = "URL accessible." if ok else f"HTTP {r.status_code}"
            except Exception as e:
                message = f"URL inaccessible: {str(e)[:80]}"
        else:
            message = "Aucune URL configurée."

    # Persist test result
    partner.last_test_at = datetime.now(timezone.utc)  # type: ignore[assignment]
    partner.last_test_ok = ok  # type: ignore[assignment]
    db.commit()

    return {"success": True, "ok": ok, "message": message, "latency_ms": latency_ms}


# ─── Tracking Proxy ──────────────────────────────────────────

@router.get("/track/{carrier_id}/{tracking_number}")
async def track_shipment(
    carrier_id: str,
    tracking_number: str,
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    """Proxy tracking request to the configured carrier API."""
    partner = db.query(DeliveryPartner).filter(
        DeliveryPartner.store_id == store_id,
        DeliveryPartner.carrier_id == carrier_id,
        DeliveryPartner.is_active == True,
    ).first()

    if not partner:
        raise HTTPException(404, f"Carrier '{carrier_id}' non configuré pour cette boutique")

    config = decrypt_dict(partner.api_config_encrypted or "")
    carrier = CARRIER_API.get(carrier_id)

    if not carrier:
        raise HTTPException(400, "Carrier non supporté")

    base_url = carrier["sandbox_url"] if partner.is_sandbox else carrier["prod_url"]
    headers = _build_headers(carrier_id, carrier["auth_style"], config)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            track_url = _get_track_url(carrier_id, base_url, tracking_number)
            r = await client.get(track_url, headers=headers)
            r.raise_for_status()
            raw = r.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Carrier API error: {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Impossible de joindre {carrier_id}: {str(e)[:100]}")

    return {"success": True, "data": _normalize_tracking(carrier_id, tracking_number, raw)}


# ─── Webhook Receiver ────────────────────────────────────────

@router.post("/webhook/{carrier_id}")
async def receive_webhook(
    carrier_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Receive delivery status updates pushed by carrier.
    No auth — carriers call this endpoint.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON payload")

    background_tasks.add_task(_process_webhook, carrier_id, payload, db)
    return {"success": True, "message": "Webhook received"}


def _process_webhook(carrier_id: str, payload: dict, db: Session):
    """Map carrier webhook payload to internal order status update and create OrderEvent."""
    tracking_number = (
        payload.get("tracking_number")
        or payload.get("parcel_id")
        or payload.get("reference")
        or payload.get("code")
    )
    carrier_status = (
        payload.get("status")
        or payload.get("etat")
        or payload.get("state")
        or ""
    )
    carrier_status_lower = carrier_status.lower()

    if not tracking_number:
        return

    internal_status = STATUS_MAP.get(carrier_status_lower)

    order = db.query(Order).filter(Order.tracking_number == tracking_number).first()
    if not order:
        return

    # Always log tracking updates as an OrderEvent for micro-details
    order_event = OrderEvent(
        id=str(uuid.uuid4()),
        order_id=order.id,
        from_status=order.status,
        to_status=internal_status or order.status,
        note=f"Mise à jour transporteur: {carrier_status} (Via {carrier_id})",
        created_at=datetime.now(timezone.utc)
    )
    db.add(order_event)

    # Only advance — never go backward (if we mapped it)
    if internal_status:
        STATUS_RANK = {
            "NEW": 0, "ASSIGNED": 1, "CALLED": 2, "CONFIRMED": 3,
            "SHIPPED": 4, "DELIVERED": 5, "RETURNED": 6, "CANCELLED": 6,
        }
        if STATUS_RANK.get(internal_status, 0) > STATUS_RANK.get(order.status, 0):
            order.status = internal_status
    
    db.commit()


# ─── Helpers ─────────────────────────────────────────────────

def _build_headers(carrier_id: str, auth_style: str, config: dict) -> dict:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if carrier_id == "yalidine":
        headers["X-API-ID"] = config.get("api_id", "")
        headers["X-API-TOKEN"] = config.get("api_token", "")
    elif carrier_id == "zr_express" or auth_style == "zr":
        headers["X-Api-Key"] = config.get("secret_key") or config.get("api_key", "")
        headers["X-Tenant"] = config.get("tenant_id", "")
    elif auth_style == "bearer":
        key = config.get("api_key") or config.get("token") or config.get("secret", "")
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _get_ping_path(carrier_id: str) -> str:
    return {
        "yalidine":   "/parcels?page_size=1",
        "noest":      "/ping",
        "zaki":       "/health",
        "procolis":   "/info",
        "ecotrack":   "/health",
        "zr_express": "/delivery-pricing/rates",
    }.get(carrier_id, "/")


def _get_track_url(carrier_id: str, base_url: str, number: str) -> str:
    return {
        "yalidine":   f"{base_url}/parcels/{number}",
        "noest":      f"{base_url}/tracking/{number}",
        "zaki":       f"{base_url}/parcels/{number}/track",
        "procolis":   f"{base_url}/parcel/{number}",
        "ecotrack":   f"{base_url}/track/{number}",
        "zr_express": f"{base_url}/parcels/{number}",
    }.get(carrier_id, f"{base_url}/track/{number}")


def _normalize_tracking(carrier_id: str, number: str, raw: dict) -> dict:
    """Normalize carrier-specific response to a common schema."""
    if carrier_id == "yalidine":
        history = raw.get("tracking_history", [])
        return {
            "carrier": "Yalidine",
            "number": number,
            "status": raw.get("status", ""),
            "last_event": raw.get("last_status_label", ""),
            "last_location": raw.get("commune_name", ""),
            "estimated_delivery": raw.get("date_livraison", None),
            "events": [
                {
                    "date": e.get("date", ""),
                    "label": e.get("status_label", ""),
                    "location": e.get("commune_name", ""),
                }
                for e in history
            ],
        }
    if carrier_id == "zr_express":
        history: list = raw.get("stateHistories") or raw.get("state_histories") or []
        return {
            "carrier": "ZR Express",
            "number": number,
            "status": raw.get("state", {}).get("name", raw.get("status", "")),
            "last_event": raw.get("state", {}).get("name", ""),
            "last_location": raw.get("hub", {}).get("name", "") if isinstance(raw.get("hub"), dict) else "",
            "estimated_delivery": None,
            "events": [
                {
                    "date": e.get("createdAt", e.get("created_at", "")),
                    "label": e.get("state", {}).get("name", "") if isinstance(e.get("state"), dict) else str(e.get("state", "")),
                    "location": "",
                }
                for e in history
            ],
        }
    # Generic fallback — return raw with normalized wrapper
    return {
        "carrier": carrier_id,
        "number": number,
        "status": raw.get("status", raw.get("etat", "")),
        "last_event": raw.get("last_event", raw.get("dernier_evenement", "")),
        "last_location": raw.get("location", raw.get("localisation", "")),
        "estimated_delivery": raw.get("estimated_delivery", None),
        "events": raw.get("events", raw.get("historique", [])),
    }


# ═══════════════════════════════════════════════════════════════
# ZR Express — dedicated endpoints
# ═══════════════════════════════════════════════════════════════

def _get_zr_client(partner: DeliveryPartner):
    """Build a ZRExpressClient from a DeliveryPartner record."""
    from app.services.zr_express import client_from_config
    config = decrypt_dict(partner.api_config_encrypted or "")
    return client_from_config(config)


@router.post("/{partner_id}/zr/test")
def zr_test_connection(
    partner_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    """Test ZR Express credentials for a partner."""
    partner = db.query(DeliveryPartner).filter(
        DeliveryPartner.id == partner_id,
        DeliveryPartner.carrier_id == "zr_express",
    ).first()
    if not partner:
        raise HTTPException(404, "ZR Express partner not found")

    try:
        zr = _get_zr_client(partner)
        result = zr.test_connection()
    except ValueError as e:
        result = {"ok": False, "message": str(e)}

    partner.last_test_at = datetime.now(timezone.utc)  # type: ignore[assignment]
    partner.last_test_ok = bool(result.get("ok", False))  # pyrefly: ignore[bad-assignment]
    db.commit()

    return {"success": True, **result}


@router.get("/{partner_id}/zr/rates")
def zr_get_rates(
    partner_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    """Fetch delivery rates from ZR Express."""
    partner = db.query(DeliveryPartner).filter(
        DeliveryPartner.id == partner_id,
        DeliveryPartner.carrier_id == "zr_express",
    ).first()
    if not partner:
        raise HTTPException(404, "ZR Express partner not found")

    try:
        zr = _get_zr_client(partner)
        data = zr.get_all_rates()
        return {"success": True, "data": data}
    except Exception as e:
        raise HTTPException(502, f"ZR Express API error: {str(e)[:200]}")


@router.post("/{partner_id}/zr/push-order/{order_id}")
def zr_push_order(
    partner_id: str,
    order_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    """Create a parcel in ZR Express from an existing order."""
    partner = db.query(DeliveryPartner).filter(
        DeliveryPartner.id == partner_id,
        DeliveryPartner.carrier_id == "zr_express",
    ).first()
    if not partner:
        raise HTTPException(404, "ZR Express partner not found")

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    try:
        zr = _get_zr_client(partner)
        # Build micro-detailed product label from order items or fallback to order number
        details_list = []
        for item in order.items:
            var_desc = ""
            if item.variant_details:
                if isinstance(item.variant_details, dict):
                    if "variant" in item.variant_details:
                        var_desc = f" ({item.variant_details['variant']})"
                    else:
                        parts = [f"{k}: {v}" for k, v in item.variant_details.items() if k != "variant"]
                        if parts:
                            var_desc = f" ({', '.join(parts)})"
                elif isinstance(item.variant_details, str):
                    var_desc = f" ({item.variant_details})"
            details_list.append(f"{item.product_name}{var_desc} x{item.quantity}")
        
        product_label = " | ".join(details_list)
        if len(product_label) > 255:
            product_label = product_label[:252] + "..."
        if not product_label:
            product_label = order.order_number

        result = zr.create_parcel(
            customer_name=str(order.customer_name),
            customer_phone=str(order.customer_phone),
            customer_address=str(order.customer_address or ""),
            wilaya=str(order.customer_wilaya or ""),
            commune=str(order.customer_commune) if getattr(order, "customer_commune", None) else None,  # pyrefly: ignore
            amount=float(order.total),  # pyrefly: ignore
            product_name=str(product_label),
            quantity=1,
            delivery_type=str(getattr(order, "delivery_type", "HOME")),
            notes=str(order.notes) if order.notes else None,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"ZR Express: {str(e)[:300]}")

    # Save tracking number back to order
    tracking = (
        result.get("trackingNumber")
        or result.get("tracking_number")
        or result.get("data", {}).get("trackingNumber")
    )
    if tracking:
        order.tracking_number = tracking
        db.commit()

    return {"success": True, "tracking_number": tracking, "zr_response": result}


@router.get("/{partner_id}/zr/track/{tracking_number}")
def zr_track(
    partner_id: str,
    tracking_number: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    """Get parcel tracking info from ZR Express."""
    partner = db.query(DeliveryPartner).filter(
        DeliveryPartner.id == partner_id,
        DeliveryPartner.carrier_id == "zr_express",
    ).first()
    if not partner:
        raise HTTPException(404, "ZR Express partner not found")

    try:
        zr = _get_zr_client(partner)
        raw = zr.get_parcel_by_tracking(tracking_number)
        normalized = _normalize_tracking("zr_express", tracking_number, raw)
        return {"success": True, "data": normalized}
    except Exception as e:
        raise HTTPException(502, f"ZR Express tracking error: {str(e)[:200]}")


@router.delete("/{partner_id}/zr/parcel/{parcel_id}")
def zr_delete_parcel(
    partner_id: str,
    parcel_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    """Cancel/delete a parcel in ZR Express."""
    partner = db.query(DeliveryPartner).filter(
        DeliveryPartner.id == partner_id,
        DeliveryPartner.carrier_id == "zr_express",
    ).first()
    if not partner:
        raise HTTPException(404, "ZR Express partner not found")

    try:
        zr = _get_zr_client(partner)
        result = zr.delete_parcel(parcel_id)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(502, f"ZR Express: {str(e)[:200]}")


@router.post("/{partner_id}/zr/webhook/register")
def zr_register_webhook(
    partner_id: str,
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user),
):
    """Register our webhook URL with ZR Express for this partner."""
    partner = db.query(DeliveryPartner).filter(
        DeliveryPartner.id == partner_id,
        DeliveryPartner.carrier_id == "zr_express",
    ).first()
    if not partner:
        raise HTTPException(404, "ZR Express partner not found")

    endpoint_url = payload.get("endpoint_url")
    if not endpoint_url:
        raise HTTPException(400, "endpoint_url requis")

    try:
        zr = _get_zr_client(partner)
        result = zr.register_webhook(endpoint_url)
        # Save webhook URL locally
        partner.webhook_url = endpoint_url
        db.commit()
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(502, f"ZR Express: {str(e)[:200]}")


@router.post("/zr/webhook")
async def zr_webhook_receiver(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Public webhook endpoint for ZR Express status push notifications.
    ZR Express calls this URL when a parcel status changes.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    background_tasks.add_task(_process_zr_webhook, payload, db)
    return {"success": True}


def _process_zr_webhook(payload: dict, db: Session):
    from app.services.zr_express import ZR_STATUS_MAP
    tracking = (
        payload.get("trackingNumber")
        or payload.get("tracking_number")
        or payload.get("parcelTrackingNumber")
    )
    state_name = ""
    if isinstance(payload.get("state"), dict):
        state_name = payload["state"].get("name", "")
    else:
        state_name = str(payload.get("state") or payload.get("status") or "")

    if not tracking:
        return

    internal_status = ZR_STATUS_MAP.get(state_name)
    if not internal_status:
        return

    order = db.query(Order).filter(Order.tracking_number == tracking).first()
    if not order:
        return

    STATUS_RANK = {
        "NEW": 0, "ASSIGNED": 1, "CALLED": 2, "CONFIRMED": 3,
        "PROCESSING": 4, "SHIPPED": 5, "DELIVERED": 6, "RETURNED": 6, "CANCELLED": 6,
    }
    if STATUS_RANK.get(internal_status, 0) > STATUS_RANK.get(str(order.status), 0):
        order.status = internal_status  # pyrefly: ignore[bad-assignment]
        db.commit()


# ─── Internal Delivery Endpoints ───────────────────────────────

class InternalAssignPayload(BaseModel):
    order_id: str
    driver_id: str
    partner_id: str

class DeliveryStatusPayload(BaseModel):
    status: str

@router.post("/internal/assign", response_model=dict)
def assign_internal_delivery(
    payload: InternalAssignPayload,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    from app.models.internal_delivery import InternalDelivery
    from app.models.user import User

    order = db.query(Order).filter(Order.id == payload.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    driver = db.query(User).filter(User.id == payload.driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    partner = db.query(DeliveryPartner).filter(DeliveryPartner.id == payload.partner_id).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Delivery partner not found")

    if getattr(partner, "type", "EXTERNAL") != "INTERNAL":
        raise HTTPException(status_code=400, detail="Delivery partner is not configured as INTERNAL")

    # Calculate commission
    commission = 0.0
    c_type = getattr(partner, "commission_type", "FIXED")
    c_val = getattr(partner, "commission_value", 0.0) or 0.0

    if c_type == "FIXED":
        commission = c_val
    elif c_type == "PERCENTAGE":
        commission = (c_val / 100.0) * order.total

    # Check if internal delivery record already exists
    delivery = db.query(InternalDelivery).filter(InternalDelivery.order_id == payload.order_id).first()
    if not delivery:
        delivery = InternalDelivery(
            id=str(uuid.uuid4()),
            order_id=payload.order_id
        )
        db.add(delivery)

    delivery.driver_id = payload.driver_id
    delivery.status = "ASSIGNED"
    delivery.commission = int(commission)
    delivery.delivered_at = None

    # Update order logistics
    order.carrier_id = payload.partner_id
    order.status = "ASSIGNED"
    order.assigned_to = payload.driver_id

    db.commit()
    db.refresh(delivery)

    return {
        "success": True,
        "message": f"Order assigned to internal driver {driver.name} successfully.",
        "data": {
            "delivery_id": delivery.id,
            "driver_name": driver.name,
            "commission": delivery.commission,
            "status": delivery.status
        }
    }

@router.get("/internal/deliveries", response_model=dict)
def list_internal_deliveries(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    from app.models.internal_delivery import InternalDelivery
    from app.models.user import User

    deliveries = db.query(InternalDelivery).join(Order).filter(Order.store_id == store_id).all()
    
    data = []
    for d in deliveries:
        driver = db.query(User).filter(User.id == d.driver_id).first()
        order = db.query(Order).filter(Order.id == d.order_id).first()
        
        data.append({
            "id": d.id,
            "order_id": d.order_id,
            "order_number": order.order_number if order else "N/A",
            "customer_name": order.customer_name if order else "N/A",
            "customer_wilaya": order.customer_wilaya if order else "N/A",
            "total_amount": order.total if order else 0,
            "driver_id": d.driver_id,
            "driver_name": driver.name if driver else "Inconnu",
            "status": d.status,
            "commission": d.commission,
            "delivered_at": d.delivered_at.isoformat() if d.delivered_at else None,
            "created_at": d.created_at.isoformat() if d.created_at else None
        })

    return {"success": True, "data": data}

@router.post("/internal/deliveries/{delivery_id}/status", response_model=dict)
def update_internal_delivery_status(
    delivery_id: str,
    payload: DeliveryStatusPayload,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
):
    from app.models.internal_delivery import InternalDelivery
    from app.models.user import User

    delivery = db.query(InternalDelivery).filter(InternalDelivery.id == delivery_id).first()
    if not delivery:
        raise HTTPException(status_code=404, detail="Internal delivery not found")

    delivery.status = payload.status
    
    # Map status to order status
    order = db.query(Order).filter(Order.id == delivery.order_id).first()
    if order:
        if payload.status == "DELIVERED":
            order.status = "DELIVERED"
            delivery.delivered_at = datetime.now()
        elif payload.status == "RETURNED":
            order.status = "RETURNED"
        elif payload.status == "PICKED_UP":
            order.status = "SHIPPED"
        else:
            order.status = "ASSIGNED"

    # Recalculate performance score of the driver
    driver = db.query(User).filter(User.id == delivery.driver_id).first()
    if driver:
        # Fetch all deliveries for this driver
        driver_deliveries = db.query(InternalDelivery).filter(InternalDelivery.driver_id == delivery.driver_id).all()
        total_d = len(driver_deliveries)
        delivered_d = len([x for x in driver_deliveries if x.status == "DELIVERED"])
        
        perf_score = round((delivered_d / total_d) * 100.0, 1) if total_d > 0 else 100.0
        
        # Find the delivery partner associated with this driver to update score (if any partner is linked or we just save in driver record or store in partner)
        if order and order.carrier_id:
            partner = db.query(DeliveryPartner).filter(DeliveryPartner.id == order.carrier_id).first()
            if partner:
                partner.performance_score = perf_score

    db.commit()
    db.refresh(delivery)
    return {"success": True, "message": f"Internal delivery status updated to {payload.status}.", "data": {"status": delivery.status}}

