import json
import logging
import uuid
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Header, Request, BackgroundTasks, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.api import deps
from app.core.tenant import tenant_store_id
from app.models.shopify import ShopifyConnection, ShopifyMapping, ShopifyWebhookInbox, ShopifyInventorySyncQueue
from app.models.store import Store
from app.models.user import User
from app.schemas.shopify import (
    ShopifyConnectionCreate,
    ShopifyConnectionUpdate,
    ShopifyConnectionRead,
    ShopifyMappingCreate,
    ShopifyMappingRead,
    ShopifyWebhookInboxRead,
    ShopifyInventoryQueueRead,
    ShopifyReconciliationReport,
    ShopifyReconcileRequest,
)
from app.services.shopify_service import (
    validate_shopify_domain,
    verify_shopify_hmac,
    sanitize_error_message,
)
from app.services.shopify_sync import (
    ShopifyWebhookProcessor,
    sweep_pending_shopify_webhooks,
)
from app.services.shopify_inventory_service import (
    sweep_pending_inventory_syncs,
    reconcile_store_inventory,
)

logger = logging.getLogger("app.shopify.api")

router = APIRouter()


# ─── Multi-Tenant Permission Helper ──────────────────────────────────────────

def _assert_store_access(user: User, store_id: str) -> None:
    """Verifies that the current user has rights to configure this store."""
    if user.role in ("SUPER_ADMIN", "ADMIN"):
        return
    assigned = getattr(user, "assigned_store_ids", []) or []
    employee_store = getattr(user, "employee_store_id", None)
    if store_id not in assigned and store_id != employee_store:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès refusé pour cette boutique.",
        )


# ─── Connections CRUD ────────────────────────────────────────────────────────

@router.get("/connections", response_model=List[ShopifyConnectionRead])
def list_connections(
    store_id: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """List Shopify connections for the authenticated store."""
    query = db.query(ShopifyConnection)
    if store_id:
        _assert_store_access(current_user, store_id)
        query = query.filter(ShopifyConnection.store_id == store_id)
    elif current_user.role not in ("SUPER_ADMIN", "ADMIN"):
        allowed = (getattr(current_user, "assigned_store_ids", []) or [])
        if getattr(current_user, "employee_store_id", None):
            allowed.append(current_user.employee_store_id)
        query = query.filter(ShopifyConnection.store_id.in_(allowed))

    connections = query.all()
    return [ShopifyConnectionRead.from_orm_model(c) for c in connections]


@router.post("/connections", response_model=ShopifyConnectionRead, status_code=status.HTTP_201_CREATED)
def create_connection(
    payload: ShopifyConnectionCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """
    Connect a Shopify store to an AzzougShop store.
    Validates the shop domain, encrypts access tokens and webhook secrets.
    """
    _assert_store_access(current_user, payload.store_id)

    # 1. Validate Store existence
    store = db.query(Store).filter(Store.id == payload.store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="Boutique introuvable.")

    # 2. Check if a connection already exists for this store
    existing = db.query(ShopifyConnection).filter(ShopifyConnection.store_id == payload.store_id).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail="Une connexion Shopify existe déjà pour cette boutique. Utilisez PATCH pour la modifier.",
        )

    # 3. Clean and validate domain
    clean_domain = validate_shopify_domain(payload.shop_domain)
    domain_taken = db.query(ShopifyConnection).filter(ShopifyConnection.shop_domain == clean_domain).first()
    if domain_taken:
        raise HTTPException(
            status_code=409,
            detail=f"Le domaine Shopify '{clean_domain}' est déjà associé à une autre boutique.",
        )

    connection = ShopifyConnection(
        id=str(uuid.uuid4()),
        store_id=payload.store_id,
        shop_domain=clean_domain,
        api_version=payload.api_version or "2026-10",
        sync_orders=payload.sync_orders,
        sync_inventory=payload.sync_inventory,
        sync_products=payload.sync_products,
        settings=payload.settings or {},
        status="CONNECTED",
    )

    if payload.access_token:
        connection.set_access_token(payload.access_token)
    if payload.webhook_secret:
        connection.set_webhook_secret(payload.webhook_secret)

    db.add(connection)
    db.commit()
    db.refresh(connection)

    logger.info(f"Connexion Shopify créée: store={payload.store_id}, domain={clean_domain}")
    return ShopifyConnectionRead.from_orm_model(connection)


@router.patch("/connections/{connection_id}", response_model=ShopifyConnectionRead)
def update_connection(
    connection_id: str,
    payload: ShopifyConnectionUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Update connection settings, credentials, or synchronization flags."""
    conn = db.query(ShopifyConnection).filter(ShopifyConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connexion Shopify introuvable.")

    _assert_store_access(current_user, conn.store_id)

    if payload.status is not None:
        valid_statuses = {"CONNECTED", "DISCONNECTED", "ERROR", "PAUSED"}
        if payload.status not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"Statut invalide. Autorisés: {valid_statuses}")
        conn.status = payload.status

    if payload.api_version is not None:
        conn.api_version = payload.api_version
    if payload.sync_orders is not None:
        conn.sync_orders = payload.sync_orders
    if payload.sync_inventory is not None:
        conn.sync_inventory = payload.sync_inventory
    if payload.sync_products is not None:
        conn.sync_products = payload.sync_products
    if payload.settings is not None:
        conn.settings = payload.settings

    if payload.access_token is not None:
        conn.set_access_token(payload.access_token)
    if payload.webhook_secret is not None:
        conn.set_webhook_secret(payload.webhook_secret)

    db.commit()
    db.refresh(conn)
    return ShopifyConnectionRead.from_orm_model(conn)


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(
    connection_id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Delete a Shopify connection."""
    conn = db.query(ShopifyConnection).filter(ShopifyConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connexion Shopify introuvable.")

    _assert_store_access(current_user, conn.store_id)
    db.delete(conn)
    db.commit()


@router.post("/connections/upgrade-versions")
def upgrade_shopify_connections_api_version(
    target_version: str = "2026-10",
    store_id: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Dict[str, Any]:
    """
    Safely upgrades obsolete Shopify API versions (e.g. 2024-01, 2024-04)
    to a modern target version (default: 2026-10).
    Preserves explicitly configured valid modern versions without blind overwrites.
    """
    query = db.query(ShopifyConnection)
    if current_user.role not in ("SUPER_ADMIN", "ADMIN"):
        if not store_id:
            raise HTTPException(status_code=400, detail="store_id requis pour les utilisateurs non administrateurs.")
        _assert_store_access(current_user, store_id)
        query = query.filter(ShopifyConnection.store_id == store_id)
    elif store_id:
        query = query.filter(ShopifyConnection.store_id == store_id)

    conns = query.all()
    upgraded_count = 0
    preserved_count = 0
    obsolete_versions = {"2024-01", "2024-04", "2024-07", "2024-10", "2025-01", "", None}

    for conn in conns:
        if conn.api_version in obsolete_versions or conn.api_version < "2026-04":
            old_v = conn.api_version
            conn.api_version = target_version
            upgraded_count += 1
            logger.info(
                "[ShopifyVersion] Connexion %s (shop=%s) mise à niveau: %s -> %s",
                conn.id,
                conn.shop_domain,
                old_v,
                target_version,
            )
        else:
            preserved_count += 1

    db.commit()
    return {
        "status": "success",
        "target_version": target_version,
        "upgraded_connections": upgraded_count,
        "preserved_connections": preserved_count,
    }


# ─── ID Mappings CRUD ────────────────────────────────────────────────────────

@router.get("/mappings", response_model=List[ShopifyMappingRead])
def list_mappings(
    store_id: str,
    entity_type: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """List identifier mappings for a store."""
    _assert_store_access(current_user, store_id)
    query = db.query(ShopifyMapping).filter(ShopifyMapping.store_id == store_id)
    if entity_type:
        query = query.filter(ShopifyMapping.entity_type == entity_type.upper())
    return query.all()


@router.post("/mappings", response_model=ShopifyMappingRead, status_code=status.HTTP_201_CREATED)
def create_mapping(
    payload: ShopifyMappingCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Create or update an entity cross-reference mapping."""
    _assert_store_access(current_user, payload.store_id)

    # Check for existing mapping
    existing = db.query(ShopifyMapping).filter(
        ShopifyMapping.store_id == payload.store_id,
        ShopifyMapping.entity_type == payload.entity_type,
        ShopifyMapping.internal_id == payload.internal_id,
    ).first()

    if existing:
        existing.shopify_id = payload.shopify_id
        existing.shopify_secondary_id = payload.shopify_secondary_id
        if payload.extra_data:
            existing.extra_data = payload.extra_data
        db.commit()
        db.refresh(existing)
        return existing

    mapping = ShopifyMapping(
        id=str(uuid.uuid4()),
        store_id=payload.store_id,
        entity_type=payload.entity_type,
        internal_id=payload.internal_id,
        shopify_id=payload.shopify_id,
        shopify_secondary_id=payload.shopify_secondary_id,
        extra_data=payload.extra_data or {},
    )
    db.add(mapping)
    try:
        db.commit()
        db.refresh(mapping)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Conflit d'unicité: cet identifiant Shopify est déjà mappé pour cette boutique.",
        )
    return mapping


@router.delete("/mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mapping(
    mapping_id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Delete a mapping."""
    mapping = db.query(ShopifyMapping).filter(ShopifyMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping introuvable.")
    _assert_store_access(current_user, mapping.store_id)
    db.delete(mapping)
    db.commit()


# ─── Inbox Inspection & Recovery Trigger ─────────────────────────────────────

@router.get("/inbox", response_model=List[ShopifyWebhookInboxRead])
def list_inbox_events(
    store_id: str,
    status_filter: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """View durable webhook inbox events for a store."""
    _assert_store_access(current_user, store_id)
    query = db.query(ShopifyWebhookInbox).filter(ShopifyWebhookInbox.store_id == store_id)
    if status_filter:
        query = query.filter(ShopifyWebhookInbox.status == status_filter.upper())
    return query.order_by(ShopifyWebhookInbox.created_at.desc()).limit(min(limit, 100)).all()


@router.post("/inbox/sweep", response_model=dict)
def trigger_inbox_sweep(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Trigger an immediate recovery sweep of pending/failed webhooks (Admin only)."""
    if current_user.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs.")
    processed = sweep_pending_shopify_webhooks(db, limit=50)
    return {"status": "ok", "processed_count": processed}


# ─── Inventory Synchronization (Phase 3) ────────────────────────────────────

@router.get("/inventory/queue", response_model=List[ShopifyInventoryQueueRead])
def list_inventory_queue(
    store_id: str,
    status_filter: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """View durable inventory sync queue tasks for a store."""
    _assert_store_access(current_user, store_id)
    query = db.query(ShopifyInventorySyncQueue).filter(ShopifyInventorySyncQueue.store_id == store_id)
    if status_filter:
        query = query.filter(ShopifyInventorySyncQueue.status == status_filter.upper())
    return query.order_by(ShopifyInventorySyncQueue.created_at.desc()).limit(min(limit, 100)).all()


@router.post("/inventory/sync", response_model=dict)
def trigger_inventory_sync(
    store_id: str,
    limit: int = 50,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Trigger processing of pending inventory queue tasks for a store."""
    _assert_store_access(current_user, store_id)
    processed = sweep_pending_inventory_syncs(db, store_id=store_id, limit=limit)
    return {"status": "ok", "processed_count": processed}


@router.post("/inventory/dry-run", response_model=ShopifyReconciliationReport)
def run_inventory_dry_run(
    store_id: str,
    limit: int = 50,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Run read-only dry-run reconciliation preview without modifying any stock."""
    _assert_store_access(current_user, store_id)
    report = reconcile_store_inventory(db, store_id=store_id, dry_run=True, limit=limit)
    return report


@router.post("/inventory/reconcile", response_model=ShopifyReconciliationReport)
def run_inventory_reconciliation(
    payload: ShopifyReconcileRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Run controlled reconciliation (dry-run or real alignment limited to limit items)."""
    _assert_store_access(current_user, payload.store_id)
    report = reconcile_store_inventory(
        db,
        store_id=payload.store_id,
        dry_run=payload.dry_run,
        limit=payload.limit,
    )
    return report


# ─── Public Webhook Ingestion Endpoint ───────────────────────────────────────

@router.post("/webhooks", status_code=status.HTTP_200_OK)
async def receive_shopify_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(deps.get_db),
    x_shopify_hmac_sha256: Optional[str] = Header(None, alias="X-Shopify-Hmac-Sha256"),
    x_shopify_webhook_id: Optional[str] = Header(None, alias="X-Shopify-Webhook-Id"),
    x_shopify_shop_domain: Optional[str] = Header(None, alias="X-Shopify-Shop-Domain"),
    x_shopify_topic: Optional[str] = Header(None, alias="X-Shopify-Topic"),
):
    """
    Secure Webhook Receiver for Shopify.
    
    Security & Reliability Guarantees:
      1. Never trusts headers until cryptographic HMAC-SHA256 signature is verified.
      2. Reads raw binary body before JSON decoding.
      3. Verifies signature against the store's encrypted webhook secret using constant-time comparison.
      4. Guarantees deduplication / idempotency using unique delivery_id (X-Shopify-Webhook-Id).
      5. Persists event durably into shopify_webhook_inbox BEFORE returning HTTP 200.
      6. Dispatches processing via background worker + leader recoverable sweeper.
    """
    # 1. Require mandatory Shopify headers
    if not x_shopify_hmac_sha256:
        logger.warning("[ShopifyWebhook] Rejet: entête X-Shopify-Hmac-Sha256 manquant.")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Signature HMAC manquante.")

    if not x_shopify_webhook_id:
        logger.warning("[ShopifyWebhook] Rejet: entête X-Shopify-Webhook-Id manquant.")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identifiant de livraison manquant.")

    if not x_shopify_shop_domain:
        logger.warning("[ShopifyWebhook] Rejet: entête X-Shopify-Shop-Domain manquant.")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Domaine de boutique manquant.")

    if not x_shopify_topic:
        logger.warning("[ShopifyWebhook] Rejet: entête X-Shopify-Topic manquant.")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sujet de webhook manquant.")

    # 2. Read raw binary body for HMAC verification
    raw_body = await request.body()
    if not raw_body:
        logger.warning("[ShopifyWebhook] Rejet: corps de requête vide.")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Corps de requête vide.")

    # 3. Resolve the claimed shop domain
    try:
        clean_domain = validate_shopify_domain(x_shopify_shop_domain)
    except ValueError as val_err:
        logger.warning(f"[ShopifyWebhook] Rejet: domaine invalide: {val_err}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Domaine invalide.")

    # Bypass tenant isolation to lookup connection by shop_domain (since incoming webhook has no AzzougShop tenant header)
    db.info["skip_tenant_isolation"] = True
    conn = (
        db.query(ShopifyConnection)
        .filter(
            ShopifyConnection.shop_domain == clean_domain,
            ShopifyConnection.status == "CONNECTED",
        )
        .first()
    )

    if not conn:
        logger.warning(f"[ShopifyWebhook] Rejet: aucune connexion active pour le domaine '{clean_domain}'.")
        # Return 401 instead of 404 to avoid domain enumeration
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Boutique non connectée ou inactive.")

    # 4. Cryptographic HMAC verification
    webhook_secret = conn.get_webhook_secret()
    if not webhook_secret:
        logger.error(f"[ShopifyWebhook] Erreur: secret de webhook non configuré pour '{clean_domain}'.")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Configuration de webhook incomplète.")

    if not verify_shopify_hmac(raw_body, webhook_secret, x_shopify_hmac_sha256):
        client_ip = request.headers.get("x-forwarded-for") or (request.client.host if request.client else "-")
        logger.warning(f"[ShopifyWebhook] Rejet: signature HMAC invalide pour '{clean_domain}' (IP: {client_ip}).")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Signature HMAC invalide.")

    # 5. Established trust — set tenant context
    tenant_store_id.set(conn.store_id)

    # 6. Check for existing delivery (Idempotent delivery)
    existing_event = (
        db.query(ShopifyWebhookInbox)
        .filter(ShopifyWebhookInbox.delivery_id == x_shopify_webhook_id)
        .first()
    )

    if existing_event:
        logger.info(
            f"[ShopifyWebhook] Événement déjà reçu (Idempotence): delivery_id={x_shopify_webhook_id}, "
            f"status={existing_event.status}."
        )
        return {
            "status": "already_received",
            "delivery_id": x_shopify_webhook_id,
            "event_status": existing_event.status,
        }

    # 7. Parse JSON body
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception as parse_err:
        logger.error(f"[ShopifyWebhook] Payload JSON invalide pour '{clean_domain}': {parse_err}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payload JSON malformé.")

    # 8. Durable persistence in shopify_webhook_inbox
    inbox_item = ShopifyWebhookInbox(
        id=str(uuid.uuid4()),
        delivery_id=x_shopify_webhook_id,
        store_id=conn.store_id,
        topic=x_shopify_topic.strip(),
        shop_domain=conn.shop_domain,
        payload=payload,
        status="PENDING",
        attempts=0,
        max_attempts=5,
    )

    try:
        db.add(inbox_item)
        db.commit()
        db.refresh(inbox_item)
    except IntegrityError:
        # Race condition: duplicate delivery arrived in parallel
        db.rollback()
        logger.info(f"[ShopifyWebhook] Race condition d'unicité gérée avec succès: delivery_id={x_shopify_webhook_id}")
        return {
            "status": "already_received",
            "delivery_id": x_shopify_webhook_id,
        }

    # 9. Asynchronous processing dispatch (Fast path via standalone session)
    background_tasks.add_task(
        ShopifyWebhookProcessor.process_event_standalone,
        event_id=inbox_item.id,
    )

    logger.info(
        f"[ShopifyWebhook] Événement enregistré dans l'inbox: delivery_id={x_shopify_webhook_id}, "
        f"topic={x_shopify_topic}, store={conn.store_id}."
    )

    return {
        "status": "received",
        "delivery_id": x_shopify_webhook_id,
    }
