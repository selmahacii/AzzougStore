import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models.product import Product
from app.models.shopify import ShopifyConnection, ShopifyMapping, ShopifyInventorySyncQueue
from app.services.inventory_service import _find_matching_variant
from app.services.shopify_service import sanitize_error_message
from app.services.shopify_client import (
    ShopifyGraphQLClient,
    ShopifyClientError,
    ShopifyCompareQuantityMismatchError,
    ShopifyRateLimitError,
)

logger = logging.getLogger("app.shopify.inventory_service")


# ─── ERP Stock Calculation ───────────────────────────────────────────────────

def calculate_erp_available_stock(product: Product, variant_str: Optional[str] = None) -> int:
    """
    Computes the authoritative sellable stock (physical stock minus reserved stock).
    - For simple products: product.stock - product.reserved_stock.
    - For variants: variant.stock - variant.reserved (never uses global product stock).
    Always returns an integer >= 0.
    """
    if not product:
        return 0

    if variant_str and product.variants:
        matched = _find_matching_variant(product.variants, variant_str)
        if matched:
            v_stock = int(matched.get("stock") or 0)
            v_reserved = int(matched.get("reserved") or 0)
            return max(0, v_stock - v_reserved)

    # Simple product or variant not found fallback
    phys = int(product.stock or 0)
    res = int(product.reserved_stock or 0)
    return max(0, phys - res)


# ─── Mapping Resolution ──────────────────────────────────────────────────────

def resolve_shopify_inventory_mapping(
    db: Session,
    store_id: str,
    product_id: str,
    variant_sku: Optional[str] = None,
    variant_str: Optional[str] = None,
) -> Optional[ShopifyMapping]:
    """
    Resolves the cross-reference ShopifyMapping for a product or variant.
    Returns the mapping carrying shopify_secondary_id (inventory_item_id).
    """
    # 1. Search for VARIANT mapping if variant information is present
    if variant_sku or variant_str:
        # Search by internal_id
        candidates = [
            f"{product_id}:{variant_sku}" if variant_sku else None,
            f"{product_id}:{variant_str}" if variant_str else None,
            variant_sku,
            variant_str,
        ]
        candidates = [c for c in candidates if c]

        mapping = (
            db.query(ShopifyMapping)
            .filter(
                ShopifyMapping.store_id == store_id,
                ShopifyMapping.entity_type == "VARIANT",
                ShopifyMapping.internal_id.in_(candidates),
            )
            .first()
        )
        if mapping:
            return mapping

        # Search by extra_data JSON matching
        all_variant_maps = (
            db.query(ShopifyMapping)
            .filter(
                ShopifyMapping.store_id == store_id,
                ShopifyMapping.entity_type == "VARIANT",
            )
            .all()
        )
        for vm in all_variant_maps:
            ed = vm.extra_data or {}
            if ed.get("product_id") == product_id:
                if (variant_sku and ed.get("sku") == variant_sku) or (
                    variant_str and (ed.get("variant") == variant_str or ed.get("variant_title") == variant_str)
                ):
                    return vm

    # 2. Search for PRODUCT mapping (simple product)
    mapping = (
        db.query(ShopifyMapping)
        .filter(
            ShopifyMapping.store_id == store_id,
            ShopifyMapping.entity_type == "PRODUCT",
            ShopifyMapping.internal_id == product_id,
        )
        .first()
    )
    return mapping


# ─── Idempotency Key Generation ───────────────────────────────────────────────

def generate_inventory_idempotency_key(
    store_id: str,
    product_id: str,
    variant_sku: Optional[str],
    shopify_inventory_item_id: Optional[str],
    shopify_location_id: Optional[str],
    stock_revision: int,
    target_quantity: int,
) -> str:
    """
    Generates a deterministic UUIDv5 idempotency key uniquely bound to the specific
    operation parameters and stock revision.
    Ensures:
      - The same operation with the same parameters & revision generates the exact same key.
      - A new revision generates a completely different key.
      - Different parameters (quantity, location, item) generate different keys.
      - Never reused for different parameters.
    """
    raw_payload = (
        f"{store_id}:{product_id}:{variant_sku or ''}:"
        f"{shopify_inventory_item_id or ''}:{shopify_location_id or ''}:"
        f"rev_{stock_revision}:qty_{target_quantity}"
    )
    return str(uuid.uuid5(uuid.NAMESPACE_OID, raw_payload))


# ─── Enqueue Outbound Sync ───────────────────────────────────────────────────

def enqueue_inventory_sync(
    db: Session,
    product_id: str,
    variant_details: Optional[dict] = None,
    previous_qty: Optional[int] = None,
) -> Optional[ShopifyInventorySyncQueue]:
    """
    Atomically enqueues or coalesces an inventory synchronization task.
    - Zero HTTP calls during this call (preserves DB transaction speed).
    - Exits immediately if the store has no active Shopify connection with sync_inventory=True.
    - Coalesces pending tasks: updates target_quantity, increments stock_revision, generates revision-bound idempotency key.
    - Automatically handles concurrency if another task is already PROCESSING by creating a newer revision.
    """
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        return None

    # Check Shopify connection
    conn = (
        db.query(ShopifyConnection)
        .filter(
            ShopifyConnection.store_id == product.store_id,
            ShopifyConnection.status == "CONNECTED",
            ShopifyConnection.sync_inventory == True,
        )
        .first()
    )
    if not conn:
        return None

    variant_str = None
    variant_sku = None
    if variant_details and isinstance(variant_details, dict):
        variant_str = variant_details.get("variant")
        variant_sku = variant_details.get("sku")

    if variant_str and product.variants:
        matched = _find_matching_variant(product.variants, variant_str)
        if matched:
            variant_sku = matched.get("sku") or variant_sku or variant_str

    target_qty = calculate_erp_available_stock(product, variant_str)

    # Resolve mapping & location
    mapping = resolve_shopify_inventory_mapping(db, product.store_id, product_id, variant_sku, variant_str)
    inv_item_id = None
    if mapping:
        inv_item_id = mapping.shopify_secondary_id or (mapping.extra_data or {}).get("inventory_item_id")

    location_id = (conn.settings or {}).get("location_id") or (conn.settings or {}).get("default_location_id")

    # Coalescence: look for an existing PENDING task for this exact item
    pending_task = (
        db.query(ShopifyInventorySyncQueue)
        .filter(
            ShopifyInventorySyncQueue.store_id == product.store_id,
            ShopifyInventorySyncQueue.product_id == product_id,
            ShopifyInventorySyncQueue.variant_sku == variant_sku,
            ShopifyInventorySyncQueue.status == "PENDING",
        )
        .with_for_update()
        .first()
    )

    if pending_task:
        if pending_task.target_quantity == target_qty:
            logger.debug(
                "[ShopifyInventory] Tâche déjà en attente avec quantité identique (%d) pour produit %s",
                target_qty,
                product_id,
            )
            return pending_task

        # Coalesce: update quantity, revision, idempotency key
        pending_task.target_quantity = target_qty
        pending_task.stock_revision += 1
        if inv_item_id and not pending_task.shopify_inventory_item_id:
            pending_task.shopify_inventory_item_id = inv_item_id
        if location_id and not pending_task.shopify_location_id:
            pending_task.shopify_location_id = location_id
        pending_task.idempotency_key = generate_inventory_idempotency_key(
            store_id=product.store_id,
            product_id=product_id,
            variant_sku=variant_sku,
            shopify_inventory_item_id=pending_task.shopify_inventory_item_id or inv_item_id,
            shopify_location_id=pending_task.shopify_location_id or location_id,
            stock_revision=pending_task.stock_revision,
            target_quantity=target_qty,
        )
        pending_task.updated_at = datetime.now(timezone.utc)
        logger.info(
            "[ShopifyInventory] Coalescence de tâche en attente: produit=%s (rev=%d, qty=%d)",
            product_id,
            pending_task.stock_revision,
            target_qty,
        )
        return pending_task

    # Find highest revision across existing tasks for this item (handles concurrent PROCESSING tasks)
    latest_task = (
        db.query(ShopifyInventorySyncQueue)
        .filter(
            ShopifyInventorySyncQueue.store_id == product.store_id,
            ShopifyInventorySyncQueue.product_id == product_id,
            ShopifyInventorySyncQueue.variant_sku == variant_sku,
        )
        .order_by(ShopifyInventorySyncQueue.stock_revision.desc())
        .first()
    )
    new_revision = (latest_task.stock_revision + 1) if latest_task else 1

    idemp_key = generate_inventory_idempotency_key(
        store_id=product.store_id,
        product_id=product_id,
        variant_sku=variant_sku,
        shopify_inventory_item_id=inv_item_id,
        shopify_location_id=location_id,
        stock_revision=new_revision,
        target_quantity=target_qty,
    )

    # Create new task in PENDING state
    task = ShopifyInventorySyncQueue(
        id=str(uuid.uuid4()),
        store_id=product.store_id,
        product_id=product_id,
        variant_sku=variant_sku,
        variant_str=variant_str,
        shopify_inventory_item_id=inv_item_id,
        shopify_location_id=location_id,
        target_quantity=target_qty,
        previous_quantity=previous_qty,
        status="PENDING",
        attempts=0,
        max_attempts=5,
        idempotency_key=idemp_key,
        stock_revision=new_revision,
    )
    db.add(task)
    logger.info(
        "[ShopifyInventory] Tâche de synchronisation ajoutée à la file: produit=%s (rev=%d, qty=%d, sku=%s)",
        product_id,
        new_revision,
        target_qty,
        variant_sku,
    )
    return task


# ─── Worker Processing ───────────────────────────────────────────────────────

def process_inventory_queue_task(
    db: Session,
    task_id: str,
    client: Optional[ShopifyGraphQLClient] = None,
) -> bool:
    """
    Executes a single inventory sync queue task.
    - Locks row with SELECT FOR UPDATE SKIP LOCKED.
    - Handles obsolescence / newer revisions (COALESCED).
    - Verifies active Shopify connection & settings.
    - Resolves missing mappings / locations with actionable error messages.
    - Invokes Shopify GraphQL Admin mutation inventorySetQuantities.
    - Handles compareQuantity mismatches without forcing overwrites.
    """
    task = (
        db.query(ShopifyInventorySyncQueue)
        .filter(ShopifyInventorySyncQueue.id == task_id)
        .with_for_update(skip_locked=True)
        .first()
    )
    if not task:
        return False

    if task.status in ("SUCCESS", "DEAD_LETTER", "COALESCED"):
        return True

    # Check connection
    conn = db.query(ShopifyConnection).filter(ShopifyConnection.store_id == task.store_id).first()
    if not conn or conn.status != "CONNECTED" or not conn.sync_inventory:
        task.status = "COALESCED"
        task.last_error = "Intégration Shopify désactivée ou en pause."
        db.commit()
        return True

    # Check if a newer task with higher revision exists (Revision Coalescence)
    newer_task = (
        db.query(ShopifyInventorySyncQueue)
        .filter(
            ShopifyInventorySyncQueue.store_id == task.store_id,
            ShopifyInventorySyncQueue.product_id == task.product_id,
            ShopifyInventorySyncQueue.variant_sku == task.variant_sku,
            ShopifyInventorySyncQueue.stock_revision > task.stock_revision,
        )
        .first()
    )
    if newer_task:
        task.status = "COALESCED"
        task.last_error = f"Ignorée: révision {task.stock_revision} rendue obsolète par révision {newer_task.stock_revision}."
        db.commit()
        return True

    # Resolve mapping if missing
    if not task.shopify_inventory_item_id:
        mapping = resolve_shopify_inventory_mapping(
            db, task.store_id, task.product_id, task.variant_sku, task.variant_str
        )
        if mapping:
            task.shopify_inventory_item_id = mapping.shopify_secondary_id or (mapping.extra_data or {}).get("inventory_item_id")
        if not task.shopify_inventory_item_id:
            task.attempts += 1
            sanitized_err = (
                f"Article non mappé: aucun mapping Shopify (inventory_item_id) pour le produit {task.product_id} "
                f"(variante: {task.variant_str or task.variant_sku or 'Général'}). "
                "Veuillez créer la correspondance dans les mappings Shopify pour permettre la synchronisation."
            )
            task.last_error = sanitized_err
            if task.attempts >= task.max_attempts:
                task.status = "DEAD_LETTER"
                task.next_retry_at = None
            else:
                task.status = "FAILED"
                task.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=2 ** task.attempts)
            db.commit()
            return False

    # Resolve location if missing
    location_id = task.shopify_location_id or (conn.settings or {}).get("location_id") or (conn.settings or {}).get("default_location_id")
    if not location_id:
        task.attempts += 1
        sanitized_err = (
            "Emplacement Shopify manquant: aucun 'location_id' configuré dans les paramètres de la boutique Shopify. "
            "Veuillez configurer l'emplacement cible."
        )
        task.last_error = sanitized_err
        if task.attempts >= task.max_attempts:
            task.status = "DEAD_LETTER"
            task.next_retry_at = None
        else:
            task.status = "FAILED"
            task.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=2 ** task.attempts)
        db.commit()
        return False
    task.shopify_location_id = location_id

    # Mark PROCESSING
    task.status = "PROCESSING"
    task.attempts += 1
    db.commit()

    # Recalculate authoritative current sellable quantity
    product = db.query(Product).filter(Product.id == task.product_id).first()
    if not product:
        task.status = "DEAD_LETTER"
        task.last_error = f"Produit ERP '{task.product_id}' introuvable."
        db.commit()
        return False

    current_avail = calculate_erp_available_stock(product, task.variant_str)
    task.target_quantity = current_avail

    # Initialize client if not injected
    if client is None:
        try:
            client = ShopifyGraphQLClient.from_connection(conn)
        except Exception as client_err:
            task.status = "FAILED"
            task.last_error = sanitize_error_message(client_err)
            task.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=2 ** task.attempts)
            db.commit()
            return False

    try:
        # Execute GraphQL mutation with idempotency key
        client.set_inventory_quantities(
            inventory_item_id=task.shopify_inventory_item_id,
            location_id=task.shopify_location_id,
            quantity=current_avail,
            compare_quantity=task.previous_quantity,
            idempotency_key=task.idempotency_key,
        )

        # Check concurrency: did an even newer task ALREADY complete while we were in-flight?
        newer_already_successful = (
            db.query(ShopifyInventorySyncQueue)
            .filter(
                ShopifyInventorySyncQueue.store_id == task.store_id,
                ShopifyInventorySyncQueue.product_id == task.product_id,
                ShopifyInventorySyncQueue.variant_sku == task.variant_sku,
                ShopifyInventorySyncQueue.stock_revision > task.stock_revision,
                ShopifyInventorySyncQueue.status == "SUCCESS",
            )
            .first()
        )
        if newer_already_successful:
            task.status = "COALESCED"
            task.processed_at = datetime.now(timezone.utc)
            task.last_error = f"Réponse tardive ignorée : révision {newer_already_successful.stock_revision} déjà publiée."
            db.commit()
            return True

        # Check concurrency: did a newer revision arrive (PENDING / RETRYING) while we were calling Shopify?
        newer_pending = (
            db.query(ShopifyInventorySyncQueue)
            .filter(
                ShopifyInventorySyncQueue.store_id == task.store_id,
                ShopifyInventorySyncQueue.product_id == task.product_id,
                ShopifyInventorySyncQueue.variant_sku == task.variant_sku,
                ShopifyInventorySyncQueue.stock_revision > task.stock_revision,
            )
            .first()
        )
        if newer_pending:
            task.status = "SUCCESS"
            task.processed_at = datetime.now(timezone.utc)
            task.last_error = f"Révision {task.stock_revision} publiée, mais révision {newer_pending.stock_revision} est en attente."
            if newer_pending.status in ("PENDING", "RETRYING"):
                newer_pending.previous_quantity = current_avail
            db.commit()
            logger.info(
                "[ShopifyInventory] Révision %d publiée, mais révision plus récente %d déjà en attente pour %s",
                task.stock_revision,
                newer_pending.stock_revision,
                task.product_id,
            )
            return True

        task.status = "SUCCESS"
        task.processed_at = datetime.now(timezone.utc)
        task.last_error = None
        task.next_retry_at = None
        db.commit()
        logger.info(
            "[ShopifyInventory] Stock synchronisé avec succès pour produit %s -> Shopify %s (qty=%d, loc=%s, rev=%d)",
            task.product_id,
            task.shopify_inventory_item_id,
            current_avail,
            task.shopify_location_id,
            task.stock_revision,
        )
        return True

    except ShopifyCompareQuantityMismatchError as c_err:
        # compareQuantity mismatch: read Shopify current level, do NOT force overwrite
        logger.warning(
            "[ShopifyInventory] Conflit de version compareQuantity pour tâche %s: %s",
            task.id,
            c_err,
        )
        try:
            actual_shopify_qty = client.get_inventory_level(
                task.shopify_inventory_item_id,
                task.shopify_location_id,
            )
        except Exception:
            actual_shopify_qty = None

        if actual_shopify_qty is not None and actual_shopify_qty == current_avail:
            # Current Shopify stock matches ERP stock already!
            task.status = "SUCCESS"
            task.processed_at = datetime.now(timezone.utc)
            task.last_error = None
            task.next_retry_at = None
            db.commit()
            return True

        # Reschedule with updated previous_quantity
        task.previous_quantity = actual_shopify_qty
        task.status = "FAILED"
        task.last_error = (
            f"Désynchronisation compareQuantity (Shopify={actual_shopify_qty}, ERP={current_avail}). "
            "Nouvelle tentative programmée avec quantité lue."
        )
        task.next_retry_at = datetime.now(timezone.utc) + timedelta(seconds=15)
        db.commit()
        return False

    except ShopifyRateLimitError as rl_err:
        logger.warning("[ShopifyInventory] Rate limit Shopify sur tâche %s: %s", task.id, rl_err)
        task.status = "FAILED"
        task.last_error = sanitize_error_message(rl_err)
        task.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=2 ** task.attempts)
        db.commit()
        return False

    except Exception as exc:
        sanitized_err = sanitize_error_message(exc)
        logger.error("[ShopifyInventory] Échec de synchronisation tâche %s: %s", task.id, sanitized_err)
        task.last_error = sanitized_err
        if task.attempts >= task.max_attempts:
            task.status = "DEAD_LETTER"
            task.next_retry_at = None
        else:
            task.status = "FAILED"
            task.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=2 ** task.attempts)
        db.commit()
        return False


# ─── Sweeper for Outbound Queue ──────────────────────────────────────────────

def sweep_pending_inventory_syncs(
    db: Session,
    store_id: Optional[str] = None,
    limit: int = 50,
    client: Optional[ShopifyGraphQLClient] = None,
) -> int:
    """
    Processes eligible pending and failed inventory sync tasks.
    Can be scoped to a specific store_id or executed globally.
    """
    now = datetime.now(timezone.utc)
    query = (
        db.query(ShopifyInventorySyncQueue)
        .filter(
            ShopifyInventorySyncQueue.status.in_(["PENDING", "FAILED"]),
            ShopifyInventorySyncQueue.attempts < ShopifyInventorySyncQueue.max_attempts,
            or_(
                ShopifyInventorySyncQueue.next_retry_at.is_(None),
                ShopifyInventorySyncQueue.next_retry_at <= now,
            ),
        )
    )
    if store_id:
        query = query.filter(ShopifyInventorySyncQueue.store_id == store_id)

    pending_tasks = (
        query
        .order_by(ShopifyInventorySyncQueue.created_at.asc())
        .limit(limit)
        .all()
    )

    success_count = 0
    for t in pending_tasks:
        if process_inventory_queue_task(db, t.id, client=client):
            success_count += 1

    return success_count


# ─── Initial Reconciliation / Dry-Run ────────────────────────────────────────

def reconcile_store_inventory(
    db: Session,
    store_id: str,
    dry_run: bool = True,
    limit: int = 50,
    client: Optional[ShopifyGraphQLClient] = None,
) -> Dict[str, Any]:
    """
    Performs inventory reconciliation between AzzougShop ERP and Shopify.
    - dry_run=True: compares quantities without modifying any database records or Shopify stock.
    - dry_run=False: creates sync queue tasks for up to `limit` divergent items and executes them.
    """
    conn = (
        db.query(ShopifyConnection)
        .filter(ShopifyConnection.store_id == store_id)
        .first()
    )
    if not conn or conn.status != "CONNECTED" or not conn.sync_inventory:
        return {
            "store_id": store_id,
            "total_items_checked": 0,
            "synced_count": 0,
            "divergent_count": 0,
            "unmapped_count": 0,
            "missing_location_count": 0,
            "dry_run": dry_run,
            "items": [],
            "error": "Boutique non connectée ou synchronisation d'inventaire désactivée.",
        }

    location_id = (conn.settings or {}).get("location_id") or (conn.settings or {}).get("default_location_id")

    if client is None:
        client = ShopifyGraphQLClient.from_connection(conn)

    products = (
        db.query(Product)
        .filter(Product.store_id == store_id, Product.is_active == True)
        .all()
    )

    items: List[Dict[str, Any]] = []
    synced_count = 0
    divergent_count = 0
    unmapped_count = 0
    missing_loc_count = 0

    for prod in products:
        if prod.variants:
            for v in prod.variants:
                if not isinstance(v, dict):
                    continue
                v_sku = v.get("sku")
                v_str = v.get("value") or v.get("name")
                erp_qty = calculate_erp_available_stock(prod, v_str)

                mapping = resolve_shopify_inventory_mapping(db, store_id, prod.id, v_sku, v_str)
                inv_item_id = None
                if mapping:
                    inv_item_id = mapping.shopify_secondary_id or (mapping.extra_data or {}).get("inventory_item_id")

                if not inv_item_id:
                    unmapped_count += 1
                    items.append({
                        "product_id": prod.id,
                        "product_name": prod.name,
                        "variant_sku": v_sku,
                        "variant_str": v_str,
                        "erp_available": erp_qty,
                        "shopify_available": None,
                        "delta": None,
                        "status": "UNMAPPED",
                        "proposed_action": "CREER_MAPPING_SHOPIFY",
                    })
                    continue

                if not location_id:
                    missing_loc_count += 1
                    items.append({
                        "product_id": prod.id,
                        "product_name": prod.name,
                        "variant_sku": v_sku,
                        "variant_str": v_str,
                        "erp_available": erp_qty,
                        "shopify_available": None,
                        "delta": None,
                        "status": "MISSING_LOCATION",
                        "proposed_action": "CONFIGURER_LOCATION_ID",
                    })
                    continue

                try:
                    shp_qty = client.get_inventory_level(inv_item_id, location_id)
                except Exception:
                    shp_qty = None

                delta = (erp_qty - shp_qty) if shp_qty is not None else None
                if shp_qty is not None and shp_qty == erp_qty:
                    synced_count += 1
                    status = "SYNCED"
                    action = "AUCUNE_ACTION"
                else:
                    divergent_count += 1
                    status = "DIVERGENT"
                    action = f"ALIGNER_SUR_{erp_qty}"

                items.append({
                    "product_id": prod.id,
                    "product_name": prod.name,
                    "variant_sku": v_sku,
                    "variant_str": v_str,
                    "erp_available": erp_qty,
                    "shopify_available": shp_qty,
                    "delta": delta,
                    "status": status,
                    "proposed_action": action,
                })
        else:
            # Simple product
            erp_qty = calculate_erp_available_stock(prod)
            mapping = resolve_shopify_inventory_mapping(db, store_id, prod.id)
            inv_item_id = None
            if mapping:
                inv_item_id = mapping.shopify_secondary_id or (mapping.extra_data or {}).get("inventory_item_id")

            if not inv_item_id:
                unmapped_count += 1
                items.append({
                    "product_id": prod.id,
                    "product_name": prod.name,
                    "variant_sku": None,
                    "variant_str": None,
                    "erp_available": erp_qty,
                    "shopify_available": None,
                    "delta": None,
                    "status": "UNMAPPED",
                    "proposed_action": "CREER_MAPPING_SHOPIFY",
                })
                continue

            if not location_id:
                missing_loc_count += 1
                items.append({
                    "product_id": prod.id,
                    "product_name": prod.name,
                    "variant_sku": None,
                    "variant_str": None,
                    "erp_available": erp_qty,
                    "shopify_available": None,
                    "delta": None,
                    "status": "MISSING_LOCATION",
                    "proposed_action": "CONFIGURER_LOCATION_ID",
                })
                continue

            try:
                shp_qty = client.get_inventory_level(inv_item_id, location_id)
            except Exception:
                shp_qty = None

            delta = (erp_qty - shp_qty) if shp_qty is not None else None
            if shp_qty is not None and shp_qty == erp_qty:
                synced_count += 1
                status = "SYNCED"
                action = "AUCUNE_ACTION"
            else:
                divergent_count += 1
                status = "DIVERGENT"
                action = f"ALIGNER_SUR_{erp_qty}"

            items.append({
                "product_id": prod.id,
                "product_name": prod.name,
                "variant_sku": None,
                "variant_str": None,
                "erp_available": erp_qty,
                "shopify_available": shp_qty,
                "delta": delta,
                "status": status,
                "proposed_action": action,
            })

    # If NOT dry run, apply sync for divergent items up to limit
    if not dry_run:
        queued_count = 0
        for it in items:
            if it["status"] == "DIVERGENT" and queued_count < limit:
                task = enqueue_inventory_sync(
                    db,
                    product_id=it["product_id"],
                    variant_details={"variant": it["variant_str"], "sku": it["variant_sku"]} if it["variant_str"] else None,
                    previous_qty=it["shopify_available"],
                )
                if task:
                    db.commit()
                    process_inventory_queue_task(db, task.id, client=client)
                    queued_count += 1

    return {
        "store_id": store_id,
        "total_items_checked": len(items),
        "synced_count": synced_count,
        "divergent_count": divergent_count,
        "unmapped_count": unmapped_count,
        "missing_location_count": missing_loc_count,
        "dry_run": dry_run,
        "items": items,
    }
