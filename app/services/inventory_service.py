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
    # 1. First, search for a main variant matching one of the tokens EXACTLY.
    # Exact-token matches must be exhausted across ALL variants before any
    # substring fallback runs: short values like "L" are substrings of both
    # "XL"/"XXL" and of color words containing an "l" ("Bleu Nuit"), so a
    # first-match substring scan picked TAILLE L for an order that said
    # "Bleu Nuit / XL" — then failed with "Stock insuffisant" on the wrong
    # variant while the requested one had plenty of stock.
    _clean_variants = [v for v in variants if isinstance(v, dict)]
    for v in _clean_variants:
        v_val = str(v.get("value") or "").strip().lower()
        v_sku = str(v.get("sku") or "").strip().lower()
        if (v_val and v_val in tokens) or (v_sku and v_sku in tokens):
            best_variant = v
            break
    if not best_variant:
        # Substring fallback, longest value first so "vert olive" wins over
        # "vert" and "xl" can never lose to a stray "l".
        for v in sorted(_clean_variants, key=lambda x: -len(str(x.get("value") or ""))):
            v_val = str(v.get("value") or "").strip().lower()
            if v_val and v_val in variant_str_lower:
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

    # 2. If a main variant was matched, check if we can match any nested
    # sub_variants inside it. Same two-pass rule as above — this is where the
    # real-world failure happened: sizes are iterated S, M, L, XL, XXL, and
    # the old single-pass substring check returned TAILLE L for
    # "Bleu Nuit / XL" because "l" is a substring of that string, so the
    # order reserved/checked the L size (0 available) instead of XL (3).
    if best_variant and best_variant.get("sub_variants"):
        subs = [sv for sv in best_variant["sub_variants"] if isinstance(sv, dict)]
        for sv in subs:
            sv_val = str(sv.get("value") or "").strip().lower()
            sv_sku = str(sv.get("sku") or "").strip().lower()
            if (sv_val and sv_val in tokens) or (sv_sku and sv_sku in tokens):
                return sv
        for sv in sorted(subs, key=lambda s: -len(str(s.get("value") or ""))):
            sv_val = str(sv.get("value") or "").strip().lower()
            if sv_val and sv_val in variant_str_lower:
                return sv

    return best_variant


def _update_product_stock_from_variants(product: Product) -> None:
    if product.variants:
        total = 0
        total_reserved = 0
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
                total_reserved += int(v.get("reserved") or 0)
        product.stock = total
        avail = max(0, total - total_reserved)
        if avail > 0 and not getattr(product, "is_active", True):
            product.is_active = True


def _sync_product_availability_and_invalidate_cache(db: Session, product: Product) -> None:
    """
    Synchronizes product.is_active with current sellable stock and invalidates
    both Redis & L1 cache for linked LandingPages so public storefront views get
    immediate, real-time stock updates.
    """
    avail = max(0, (product.stock or 0) - (product.reserved_stock or 0))
    if avail > 0 and not getattr(product, "is_active", True):
        product.is_active = True

    try:
        from app.models.landing_page import LandingPage
        from app.core.cache import invalidate
        lps = db.query(LandingPage).filter(LandingPage.product_id == product.id).all()
        for lp in lps:
            invalidate(f"landing_page:{lp.store_id}:{lp.slug}")
        invalidate(f"product:{product.id}")
    except Exception as exc:
        logger.warning(f"Failed to invalidate landing page cache for product {product.id}: {exc}")


def _lock_product(db: Session, product_id: str) -> Product:
    """
    SELECT FOR UPDATE — acquires a row-level lock on the product row.
    Prevents concurrent transactions from over-selling the same product.
    Must be called inside an active transaction.
    """
    if not product_id:
        raise ProductNotFoundError(message="ID produit non spécifié")
    product = (
        db.query(Product)
        .filter((Product.id == product_id) | (Product.sku == product_id))
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


def product_available_stock(product: Product) -> int:
    """
    Single source of truth for a product's AVAILABLE stock (sellable right
    now) — physical stock minus reserved. For a product with variants,
    returns the LOWEST available quantity across its variants (the
    bottleneck: the product as a whole is only as available as its
    scarcest variant), mirroring what a customer actually experiences when
    ordering.
    Used by every stock dashboard/alert endpoint so "low stock" means the
    same thing everywhere — previously (2026-07-23 audit) stock.py's
    /stock/dashboard and /stock/alerts-engine used raw Product.stock
    (ignoring reservations and variants entirely) while /stock/summary and
    /stock/alerts used this reservation-aware, variant-aware calculation —
    the SAME product could show as "low stock" on one tab and "fine" on
    another.
    """
    if product.variants:
        lowest = None
        for v in product.variants:
            if isinstance(v, dict):
                v_stock = int(v.get("stock") or 0)
                v_reserved = int(v.get("reserved") or 0)
                v_available = max(0, v_stock - v_reserved)
                if lowest is None or v_available < lowest:
                    lowest = v_available
        if lowest is not None:
            return lowest
    return max(0, (product.stock or 0) - (product.reserved_stock or 0))


def product_stock_status(product: Product) -> str:
    """
    "OUT" | "LOW" | "OVERSTOCK" | "OK" classification, built on
    product_available_stock() + the product's own low_stock_threshold —
    the single source of truth every stock dashboard/alert endpoint should
    read from instead of re-deriving the threshold comparison itself.
    "OVERSTOCK" is a heuristic (available > 5x threshold) — there's no real
    "maximum stock" concept on Product yet.
    """
    available = product_available_stock(product)
    threshold = product.low_stock_threshold if product.low_stock_threshold is not None else 5
    if available <= 0:
        return "OUT"
    if available <= threshold:
        return "LOW"
    if available > 5 * threshold:
        return "OVERSTOCK"
    return "OK"


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
        allow_out_of_stock: bool = True,
    ) -> None:
        """
        Reserve `quantity` units for a new/unconfirmed order.
        If a variant is specified, verifies and reserves the variant stock.
        When `allow_out_of_stock=True` (default), logs a warning and proceeds with
        reservation even if digital stock counter is 0, ensuring COD orders are never lost.
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
                    logger.warning(
                        "Insufficient stock for variant %s on product %s (requested=%d, available=%d) for order %s",
                        variant_str, product_id, quantity, available, order_id
                    )
                    if not allow_out_of_stock:
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
                    logger.warning(
                        "Insufficient stock for product %s (requested=%d, available=%d) for order %s",
                        product_id, quantity, available, order_id
                    )
                    if not allow_out_of_stock:
                        raise InsufficientStockError(
                            product_id=product_id,
                            requested=quantity,
                            available=available,
                        )
        else:
            available = product.stock - product.reserved_stock
            if available < quantity:
                logger.warning(
                    "Insufficient stock for product %s (requested=%d, available=%d) for order %s",
                    product_id, quantity, available, order_id
                )
                if not allow_out_of_stock:
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
        _sync_product_availability_and_invalidate_cache(db, product)
        logger.info("Manual restock: product=%s qty=%d (new stock=%d)", product_id, quantity, product.stock)
        return product

    # ── sell_at_pos ────────────────────────────────────────────

    def sell_at_pos(
        self,
        db: Session,
        *,
        product_id: str,
        quantity: int,
        actor_id: Optional[str] = None,
        variant_details: Optional[dict] = None,
        reason: Optional[str] = None,
    ) -> Product:
        """
        Instant point-of-sale decrement. Unlike confirm_stock, a POS sale
        never went through reserve_stock first (no NEW/CALLED lifecycle at
        the counter), so this never touches reserved_stock — it's a direct
        stock decrement, same variant-aware resolution as every other
        InventoryService method (see _find_matching_variant). Before this
        method existed, pos.py decremented product.stock directly and never
        touched the matching entry inside product.variants — for a variant
        product, the next storefront order recomputed product.stock by
        re-summing variant sub-stocks (_update_product_stock_from_variants)
        and silently undid the POS sale.
        """
        if quantity <= 0:
            raise ValueError(f"Sale quantity must be positive, got {quantity}")

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
                matching_variant["stock"] = max(0, v_stock - quantity)
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
                logger.info(
                    "POS sale (variant): product=%s variant=%s qty=%d (new stock=%d)",
                    product_id, variant_str, quantity, matching_variant["stock"],
                )
            else:
                available = product.stock - product.reserved_stock
                if available < quantity:
                    raise InsufficientStockError(product_id=product_id, requested=quantity, available=available)
                product.stock = max(0, product.stock - quantity)
        else:
            available = product.stock - product.reserved_stock
            if available < quantity:
                raise InsufficientStockError(product_id=product_id, requested=quantity, available=available)
            product.stock = max(0, product.stock - quantity)

        _record_movement(
            db,
            product_id=product_id,
            movement_type="POS_SALE",
            quantity=-quantity,
            actor_id=actor_id,
            reason=reason or f"Vente au comptoir ({variant_str or 'Général'})",
        )
        logger.info("POS sale: product=%s qty=%d (new stock=%d)", product_id, quantity, product.stock)
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
        _sync_product_availability_and_invalidate_cache(db, product)
        logger.info(
            "Manual adjustment: product=%s delta=%+d (new stock=%d) reason='%s'",
            product_id, quantity, product.stock, reason,
        )
        return product

    # ── record_manual_movement ──────────────────────────────────

    def record_manual_movement(
        self,
        db: Session,
        *,
        product_id: str,
        quantity_delta: int,
        movement_type: str,
        reason: str,
        actor_id: Optional[str] = None,
        warehouse_id: Optional[str] = None,
        order_id: Optional[str] = None,
        variant_details: Optional[dict] = None,
    ) -> Product:
        """
        General-purpose stock delta + movement record for flows that don't
        map onto reserve/confirm/release/restock/return_restock's specific
        semantics — e.g. supplier-return reverse logistics (returns.py),
        which needs its own movement_type ("OUT" / "RETURN_RESTOCK") and has
        no order_id to attach. Still goes through the same locking, variant-
        aware resolution, and available-stock guard as every other method
        here, instead of a call site hand-rolling its own product.stock
        mutation (previously: returns.py decremented/incremented the
        aggregate directly, silently drifting from product.variants for any
        variant product — same class of bug fixed for POS/purchase-voucher
        reception, see sell_at_pos/restock).
        quantity_delta: positive increases stock, negative decreases it.
        """
        if quantity_delta == 0:
            raise ValueError("quantity_delta must be non-zero")

        product = _lock_product(db, product_id)

        variant_str = None
        if variant_details and isinstance(variant_details, dict):
            variant_str = variant_details.get("variant")

        if variant_str and product.variants:
            matching_variant = _find_matching_variant(product.variants, variant_str)
            if matching_variant:
                v_stock = int(matching_variant.get("stock") or 0)
                v_reserved = int(matching_variant.get("reserved") or 0)
                new_v_stock = v_stock + quantity_delta
                if new_v_stock < 0 or (new_v_stock - v_reserved) < 0:
                    raise InsufficientStockError(
                        product_id=f"{product_id} ({variant_str})",
                        requested=abs(quantity_delta),
                        available=v_stock - v_reserved,
                    )
                matching_variant["stock"] = new_v_stock
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
            else:
                new_stock = product.stock + quantity_delta
                reserved = product.reserved_stock or 0
                if new_stock < 0 or new_stock < reserved:
                    raise InsufficientStockError(
                        product_id=product_id, requested=abs(quantity_delta),
                        available=max(0, product.stock - reserved),
                    )
                product.stock = new_stock
        else:
            new_stock = product.stock + quantity_delta
            reserved = product.reserved_stock or 0
            if new_stock < 0 or new_stock < reserved:
                raise InsufficientStockError(
                    product_id=product_id, requested=abs(quantity_delta),
                    available=max(0, product.stock - reserved),
                )
            product.stock = new_stock

        _record_movement(
            db, product_id=product_id, movement_type=movement_type, quantity=quantity_delta,
            order_id=order_id, actor_id=actor_id, reason=reason, warehouse_id=warehouse_id,
        )
        _sync_product_availability_and_invalidate_cache(db, product)
        logger.info(
            "Manual movement: product=%s type=%s delta=%+d (new stock=%d)",
            product_id, movement_type, quantity_delta, product.stock,
        )
        return product


# Singleton — import this in services and routers
inventory_service = InventoryService()
