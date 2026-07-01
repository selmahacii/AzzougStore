# ═══════════════════════════════════════════════════════════════
# AzzougShop — Inventory Service (Transactional Stock Engine)
# ─────────────────────────────────────────────────────────────
# All operations use SELECT FOR UPDATE to prevent race conditions.
# All transitions emit StockMovement audit records.
#
# Workflow:
#   NEW order created  → reserve_stock()    (reservedStock += qty)
#   CALLED → CONFIRMED → confirm_stock()    (stock -= qty, reserved -= qty)
#   ANY → RETURNED     → release_or_restock() (context-aware)
#   Cancellation       → release_reservation() (reservedStock -= qty)
#   Manual restock     → restock()          (stock += qty)
# ═══════════════════════════════════════════════════════════════

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.exceptions import (
    InsufficientStockError,
    ProductNotFoundError,
    StockReleaseError,
)
from app.models.product import Product
from app.models.stock import StockMovement

logger = logging.getLogger("app.inventory")


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _find_matching_variant(variants: list, variant_str: str) -> Optional[dict]:
    if not variants or not variant_str:
        return None
    
    # Normalize the input variant_str (e.g. "Couleur: Vert Olive, Taille: 42" or "Vert Olive / 42")
    variant_str_lower = variant_str.lower()
    
    # Extract potential value tokens by splitting on common delimiters
    import re
    tokens = [t.strip().lower() for t in re.split(r'[,/|:]', variant_str) if t.strip()]
    
    best_variant = None
    # 1. First, search for a main variant matching one of the tokens or directly contained in the string
    for v in variants:
        if not isinstance(v, dict):
            continue
        v_val = str(v.get("value") or "").strip().lower()
        v_sku = str(v.get("sku") or "").strip().lower()
        v_name = str(v.get("name") or "").strip().lower()
        
        if (v_val and v_val in tokens) or (v_val and v_val in variant_str_lower) or (v_sku and v_sku in tokens):
            best_variant = v
            break
            
    if not best_variant:
        # Fallback to simple matching if name/value format was used
        name, value = None, None
        if ":" in variant_str:
            parts = [p.strip() for p in variant_str.split(":", 1)]
            if len(parts) == 2:
                name, value = parts[0], parts[1]
        else:
            value = variant_str.strip()
            
        for v in variants:
            if not isinstance(v, dict):
                continue
            v_name = str(v.get("name") or "").strip().lower()
            v_val = str(v.get("value") or "").strip().lower()
            v_sku = str(v.get("sku") or "").strip().lower()
            
            if name and value:
                if v_name == name.lower() and v_val == value.lower():
                    best_variant = v
                    break
            elif value:
                if v_val == value.lower() or v_sku == value.lower():
                    best_variant = v
                    break

    # 2. If a main variant was matched, check if we can match any nested sub_variants inside it
    if best_variant and best_variant.get("sub_variants"):
        for sv in best_variant["sub_variants"]:
            if not isinstance(sv, dict):
                continue
            sv_val = str(sv.get("value") or "").strip().lower()
            sv_sku = str(sv.get("sku") or "").strip().lower()
            if (sv_val and sv_val in tokens) or (sv_val and sv_val in variant_str_lower) or (sv_sku and sv_sku in tokens):
                return sv
                
    return best_variant


def _update_product_stock_from_variants(product: Product) -> None:
    if product.variants:
        total = 0
        for v in product.variants:
            if isinstance(v, dict):
                # Aggregate stock/reserved from sub_variants to parent variant
                if v.get("sub_variants"):
                    sub_total_stock = 0
                    sub_total_reserved = 0
                    for sv in v["sub_variants"]:
                        if isinstance(sv, dict):
                            sub_total_stock += int(sv.get("stock") or 0)
                            sub_total_reserved += int(sv.get("reserved") or 0)
                    v["stock"] = sub_total_stock
                    v["reserved"] = sub_total_reserved
                total += int(v.get("stock") or 0)
        product.stock = total


def _lock_product(db: Session, product_id: str) -> Product:
    """
    SELECT FOR UPDATE — acquires a row-level lock on the product row.
    Prevents concurrent transactions from over-selling the same product.
    Must be called inside an active transaction.
    """
    product = (
        db.query(Product)
        .filter(Product.id == product_id)
        .with_for_update()
        .first()
    )
    if product is None:
        raise ProductNotFoundError(
            message=f"Produit {product_id} introuvable lors de l'opération de stock."
        )
    return product


def _record_movement(
    db: Session,
    *,
    product_id: str,
    movement_type: str,
    quantity: int,
    order_id: Optional[str] = None,
    actor_id: Optional[str] = None,
    reason: str,
    warehouse_id: Optional[str] = None,
) -> StockMovement:
    """Create and add a StockMovement audit record (but do NOT commit)."""
    movement = StockMovement(
        id=str(uuid.uuid4()),
        product_id=product_id,
        type=movement_type,
        quantity=quantity,
        order_id=order_id,
        actor_id=actor_id,
        reason=reason,
        warehouse_id=warehouse_id,
    )
    db.add(movement)
    logger.debug(
        "StockMovement queued: product=%s type=%s qty=%d order=%s",
        product_id, movement_type, quantity, order_id,
    )
    return movement


# ─── Public API ───────────────────────────────────────────────────────────────

class InventoryService:
    """
    Transactional stock management service.

    All public methods assume they are called WITHIN an active SQLAlchemy
    Session transaction. The caller (router / order_service) is responsible
    for committing or rolling back.
    """

    # ── reserve_stock ─────────────────────────────────────────

    def reserve_stock(
        self,
        db: Session,
        *,
        product_id: str,
        quantity: int,
        order_id: str,
        actor_id: Optional[str] = None,
        variant_details: Optional[dict] = None,
    ) -> None:
        """
        Reserve `quantity` units for a new/unconfirmed order.
        If a variant is specified, verifies and reserves the variant stock.
        """
        if quantity <= 0:
            raise ValueError(f"Reserve quantity must be positive, got {quantity}")

        product = _lock_product(db, product_id)
        
        variant_str = None
        if variant_details and isinstance(variant_details, dict):
            variant_str = variant_details.get("variant")

        if variant_str and product.variants:
            matching_variant = _find_matching_variant(product.variants, variant_str)
            if matching_variant:
                v_stock = int(matching_variant.get("stock") or 0)
                v_reserved = int(matching_variant.get("reserved") or 0)
                available = v_stock - v_reserved
                
                if available < quantity:
                    raise InsufficientStockError(
                        product_id=f"{product_id} ({variant_str})",
                        requested=quantity,
                        available=available,
                    )
                
                matching_variant["reserved"] = v_reserved + quantity
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
                logger.info(
                    "Variant stock reserved: product=%s variant=%s qty=%d order=%s (reserved=%d)",
                    product_id, variant_str, quantity, order_id, matching_variant["reserved"]
                )
            else:
                logger.warning("Variant %s not found on product %s, falling back to product-level check", variant_str, product_id)
                available = product.stock - product.reserved_stock
                if available < quantity:
                    raise InsufficientStockError(
                        product_id=product_id,
                        requested=quantity,
                        available=available,
                    )
        else:
            available = product.stock - product.reserved_stock
            if available < quantity:
                raise InsufficientStockError(
                    product_id=product_id,
                    requested=quantity,
                    available=available,
                )

        product.reserved_stock += quantity

        _record_movement(
            db,
            product_id=product_id,
            movement_type="ORDER_RESERVE",
            quantity=quantity,
            order_id=order_id,
            actor_id=actor_id,
            reason=f"Réservation stock pour commande {order_id} ({variant_str or 'Général'})",
        )
        logger.info(
            "Stock reserved: product=%s qty=%d order=%s (new reserved_stock=%d)",
            product_id, quantity, order_id, product.reserved_stock,
        )

    # ── confirm_stock ─────────────────────────────────────────

    def confirm_stock(
        self,
        db: Session,
        *,
        product_id: str,
        quantity: int,
        order_id: str,
        actor_id: Optional[str] = None,
        variant_details: Optional[dict] = None,
    ) -> None:
        """
        Permanently deduct confirmed stock (CALLED → CONFIRMED transition).
        Deducts from both variant stock and product stock.
        """
        if quantity <= 0:
            raise ValueError(f"Confirm quantity must be positive, got {quantity}")

        product = _lock_product(db, product_id)
        
        variant_str = None
        if variant_details and isinstance(variant_details, dict):
            variant_str = variant_details.get("variant")

        if variant_str and product.variants:
            matching_variant = _find_matching_variant(product.variants, variant_str)
            if matching_variant:
                v_stock = int(matching_variant.get("stock") or 0)
                v_reserved = int(matching_variant.get("reserved") or 0)
                
                # Deduct variant physical stock & release reservation
                matching_variant["stock"] = max(0, v_stock - quantity)
                matching_variant["reserved"] = max(0, v_reserved - quantity)
                flag_modified(product, "variants")
                
                # Recalculate total product stock
                _update_product_stock_from_variants(product)
                logger.info(
                    "Variant stock confirmed: product=%s variant=%s qty=%d order=%s (stock=%d, reserved=%d)",
                    product_id, variant_str, quantity, order_id, matching_variant["stock"], matching_variant["reserved"]
                )
            else:
                product.stock = max(0, product.stock - quantity)
        else:
            product.stock = max(0, product.stock - quantity)

        product.reserved_stock = max(0, product.reserved_stock - quantity)

        _record_movement(
            db,
            product_id=product_id,
            movement_type="ORDER_CONFIRM",
            quantity=-quantity,
            order_id=order_id,
            actor_id=actor_id,
            reason=f"Vente confirmée pour commande {order_id} ({variant_str or 'Général'})",
        )
        logger.info(
            "Stock confirmed: product=%s qty=%d order=%s (stock=%d, reserved=%d)",
            product_id, quantity, order_id, product.stock, product.reserved_stock,
        )

    # ── release_reservation ────────────────────────────────────

    def release_reservation(
        self,
        db: Session,
        *,
        product_id: str,
        quantity: int,
        order_id: str,
        actor_id: Optional[str] = None,
        variant_details: Optional[dict] = None,
    ) -> None:
        """
        Release a reservation for a cancelled/returned unconfirmed order.
        """
        if quantity <= 0:
            raise ValueError(f"Release quantity must be positive, got {quantity}")

        product = _lock_product(db, product_id)
        
        variant_str = None
        if variant_details and isinstance(variant_details, dict):
            variant_str = variant_details.get("variant")

        if variant_str and product.variants:
            matching_variant = _find_matching_variant(product.variants, variant_str)
            if matching_variant:
                v_reserved = int(matching_variant.get("reserved") or 0)
                matching_variant["reserved"] = max(0, v_reserved - quantity)
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
                logger.info(
                    "Variant reservation released: product=%s variant=%s qty=%d order=%s (reserved=%d)",
                    product_id, variant_str, quantity, order_id, matching_variant["reserved"]
                )

        product.reserved_stock = max(0, product.reserved_stock - quantity)

        _record_movement(
            db,
            product_id=product_id,
            movement_type="ORDER_RELEASE",
            quantity=quantity,
            order_id=order_id,
            actor_id=actor_id,
            reason=f"Libération réservation pour commande {order_id} ({variant_str or 'Général'})",
        )
        logger.info(
            "Reservation released: product=%s qty=%d order=%s (reserved=%d)",
            product_id, quantity, order_id, product.reserved_stock,
        )

    # ── return_restock ─────────────────────────────────────────

    def return_restock(
        self,
        db: Session,
        *,
        product_id: str,
        quantity: int,
        order_id: str,
        actor_id: Optional[str] = None,
        variant_details: Optional[dict] = None,
    ) -> None:
        """
        Restock returned goods (CONFIRMED/SHIPPED/DELIVERED → RETURNED).
        """
        if quantity <= 0:
            raise ValueError(f"Return restock quantity must be positive, got {quantity}")

        product = _lock_product(db, product_id)
        
        variant_str = None
        if variant_details and isinstance(variant_details, dict):
            variant_str = variant_details.get("variant")

        if variant_str and product.variants:
            matching_variant = _find_matching_variant(product.variants, variant_str)
            if matching_variant:
                v_stock = int(matching_variant.get("stock") or 0)
                matching_variant["stock"] = v_stock + quantity
                flag_modified(product, "variants")
                
                # Recalculate total product stock
                _update_product_stock_from_variants(product)
                logger.info(
                    "Variant stock restocked: product=%s variant=%s qty=%d order=%s (new stock=%d)",
                    product_id, variant_str, quantity, order_id, matching_variant["stock"]
                )
            else:
                product.stock += quantity
        else:
            product.stock += quantity

        _record_movement(
            db,
            product_id=product_id,
            movement_type="RETURN_RESTOCK",
            quantity=quantity,
            order_id=order_id,
            actor_id=actor_id,
            reason=f"Retour marchandise pour commande {order_id} ({variant_str or 'Général'})",
        )
        logger.info(
            "Return restocked: product=%s qty=%d order=%s (new stock=%d)",
            product_id, quantity, order_id, product.stock,
        )

    # ── restock ────────────────────────────────────────────────

    def restock(
        self,
        db: Session,
        *,
        product_id: str,
        quantity: int,
        actor_id: Optional[str] = None,
        warehouse_id: Optional[str] = None,
        reason: Optional[str] = None,
        variant_details: Optional[dict] = None,
    ) -> Product:
        """
        Manual restock (supplier delivery, inventory correction).

        - Increments product.stock (or specific variant stock).
        - Records a RESTOCK movement.
        """
        if quantity <= 0:
            raise ValueError(f"Restock quantity must be positive, got {quantity}")

        product = _lock_product(db, product_id)
        
        variant_str = None
        if variant_details and isinstance(variant_details, dict):
            variant_str = variant_details.get("variant")

        if variant_str and product.variants:
            matching_variant = _find_matching_variant(product.variants, variant_str)
            if matching_variant:
                v_stock = int(matching_variant.get("stock") or 0)
                matching_variant["stock"] = v_stock + quantity
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
            else:
                product.stock += quantity
        else:
            product.stock += quantity

        _record_movement(
            db,
            product_id=product_id,
            movement_type="RESTOCK",
            quantity=quantity,
            order_id=None,
            actor_id=actor_id,
            warehouse_id=warehouse_id,
            reason=reason or f"Réapprovisionnement manuel ({variant_str or 'Général'})",
        )
        logger.info("Manual restock: product=%s qty=%d (new stock=%d)", product_id, quantity, product.stock)
        return product

    # ── manual_adjustment ──────────────────────────────────────

    def manual_adjustment(
        self,
        db: Session,
        *,
        product_id: str,
        quantity: int,  # Can be negative (shrinkage, loss)
        actor_id: Optional[str] = None,
        reason: str,
        variant_details: Optional[dict] = None,
    ) -> Product:
        """
        Arbitrary stock correction (e.g., inventory count, damage, theft).

        quantity > 0 → adds stock
        quantity < 0 → removes stock (cannot go below 0)
        """
        product = _lock_product(db, product_id)

        variant_str = None
        if variant_details and isinstance(variant_details, dict):
            variant_str = variant_details.get("variant")

        if variant_str and product.variants:
            matching_variant = _find_matching_variant(product.variants, variant_str)
            if matching_variant:
                v_stock = int(matching_variant.get("stock") or 0)
                v_reserved = int(matching_variant.get("reserved") or 0)
                new_v_stock = v_stock + quantity
                if new_v_stock < 0 or (new_v_stock - v_reserved) < 0:
                    raise InsufficientStockError(
                        product_id=f"{product_id} ({variant_str})",
                        requested=abs(quantity),
                        available=v_stock - v_reserved,
                    )
                matching_variant["stock"] = new_v_stock
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
            else:
                new_stock = product.stock + quantity
                reserved = product.reserved_stock or 0
                if new_stock < 0 or new_stock < reserved:
                    raise InsufficientStockError(
                        product_id=product_id,
                        requested=abs(quantity),
                        available=max(0, product.stock - reserved),
                    )
                product.stock = new_stock
        else:
            new_stock = product.stock + quantity
            reserved = product.reserved_stock or 0
            if new_stock < 0 or new_stock < reserved:
                raise InsufficientStockError(
                    product_id=product_id,
                    requested=abs(quantity),
                    available=max(0, product.stock - reserved),
                )
            product.stock = new_stock

        _record_movement(
            db,
            product_id=product_id,
            movement_type="MANUAL_ADJUSTMENT",
            quantity=quantity,
            actor_id=actor_id,
            reason=reason,
        )
        logger.info(
            "Manual adjustment: product=%s delta=%+d (new stock=%d) reason='%s'",
            product_id, quantity, product.stock, reason,
        )
        return product


# Singleton — import this in services and routers
inventory_service = InventoryService()
