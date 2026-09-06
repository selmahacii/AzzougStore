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

def _find_matching_variant(variants: list, variant_str: Any) -> Optional[dict]:
    if not variants or not variant_str:
        return None
    
    if isinstance(variant_str, dict):
        variant_str = variant_str.get("variant") or variant_str.get("value") or str(variant_str)
    variant_str = str(variant_str).strip()
    if not variant_str:
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


def _sync_sub_variants_stock(matching_variant: dict, delta: int) -> None:
    """Keep nested sub_variants stock synchronized when parent variant stock is adjusted."""
    if matching_variant.get("sub_variants") and len(matching_variant["sub_variants"]) > 0:
        subs = [sv for sv in matching_variant["sub_variants"] if isinstance(sv, dict)]
        if not subs:
            return
        if len(subs) == 1:
            subs[0]["stock"] = max(0, int(subs[0].get("stock") or 0) + delta)
        elif delta > 0:
            per_sv = delta // len(subs)
            rem_sv = delta % len(subs)
            for s_idx, sv in enumerate(subs):
                sv_qty = per_sv + (1 if s_idx < rem_sv else 0)
                sv["stock"] = int(sv.get("stock") or 0) + sv_qty
        else:
            needed = abs(delta)
            for sv in subs:
                if needed <= 0:
                    break
                cur = int(sv.get("stock") or 0)
                deduct = min(cur, needed)
                sv["stock"] = max(0, cur - deduct)
                needed -= deduct


def _sync_sub_variants_reserved(matching_variant: dict, delta: int) -> None:
    """Keep nested sub_variants reservations synchronized when parent variant reservations are adjusted."""
    if matching_variant.get("sub_variants") and len(matching_variant["sub_variants"]) > 0:
        subs = [sv for sv in matching_variant["sub_variants"] if isinstance(sv, dict)]
        if not subs:
            return
        if len(subs) == 1:
            subs[0]["reserved"] = max(0, int(subs[0].get("reserved") or 0) + delta)
        elif delta > 0:
            per_sv = delta // len(subs)
            rem_sv = delta % len(subs)
            for s_idx, sv in enumerate(subs):
                sv_qty = per_sv + (1 if s_idx < rem_sv else 0)
                sv["reserved"] = int(sv.get("reserved") or 0) + sv_qty
        else:
            needed = abs(delta)
            for sv in subs:
                if needed <= 0:
                    break
                cur = int(sv.get("reserved") or 0)
                deduct = min(cur, needed)
                sv["reserved"] = max(0, cur - deduct)
                needed -= deduct


def _update_product_stock_from_variants(product: Product) -> None:
    if product.variants and isinstance(product.variants, list):
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
        from app.core.cache import invalidate, invalidate_prefix
        lps = db.query(LandingPage).filter(LandingPage.product_id == product.id).all()
        for lp in lps:
            invalidate(f"landing_page:{lp.store_id}:{lp.slug}")
        invalidate(f"product:{product.id}")
        if getattr(product, "store_id", None):
            invalidate_prefix(f"product_listing:{product.store_id}")
        invalidate_prefix("product_listing:all")
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
                _sync_sub_variants_reserved(matching_variant, quantity)
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
                logger.info(
                    "Variant stock reserved: product=%s variant=%s qty=%d order=%s (reserved=%d)",
                    product_id, variant_str, quantity, order_id, matching_variant["reserved"]
                )
            else:
                logger.error(
                    "reserve_stock: variant '%s' NOT FOUND on product %s which HAS variants — "
                    "falling back to product-level reservation. This can cause variant/aggregate "
                    "stock drift. Check variant_details formatting for order %s.",
                    variant_str, product_id, order_id,
                )
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
                _sync_sub_variants_stock(matching_variant, -quantity)
                _sync_sub_variants_reserved(matching_variant, -quantity)
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
        _sync_product_availability_and_invalidate_cache(db, product)
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
                _sync_sub_variants_reserved(matching_variant, -quantity)
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

        Idempotent: if a RETURN_RESTOCK movement already exists for this
        (order_id, product_id) pair, the call is a safe no-op. This prevents
        double-restocking on network retries, double-clicks, or accidental
        repeated status transitions that would otherwise inflate stock.
        """
        if quantity <= 0:
            raise ValueError(f"Return restock quantity must be positive, got {quantity}")

        # ── Idempotency guard ────────────────────────────────────────────
        # Check BEFORE acquiring the row lock (the EXISTS query is read-only
        # and cheap). If the movement is already there we skip completely —
        # no lock, no write, no log noise beyond the warning below.
        if order_id:
            already_restocked = (
                db.query(StockMovement.id)
                .filter(
                    StockMovement.order_id == order_id,
                    StockMovement.product_id == product_id,
                    StockMovement.type == "RETURN_RESTOCK",
                )
                .first()
            )
            if already_restocked:
                logger.warning(
                    "return_restock: RETURN_RESTOCK already exists for order=%s product=%s — "
                    "skipping to prevent double-restock (idempotent no-op).",
                    order_id, product_id,
                )
                return

        product = _lock_product(db, product_id)

        variant_str = None
        if variant_details and isinstance(variant_details, dict):
            variant_str = variant_details.get("variant")

        if product.variants and len(product.variants) > 0:
            matching_variant = None
            if variant_str:
                matching_variant = _find_matching_variant(product.variants, variant_str)
            if matching_variant:
                v_stock = int(matching_variant.get("stock") or 0)
                matching_variant["stock"] = v_stock + quantity
                _sync_sub_variants_stock(matching_variant, quantity)
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
                logger.info(
                    "Variant stock restocked: product=%s variant=%s qty=%d order=%s (new stock=%d)",
                    product_id, variant_str, quantity, order_id, matching_variant["stock"]
                )
            elif len(product.variants) == 1:
                v = product.variants[0]
                if isinstance(v, dict):
                    v["stock"] = int(v.get("stock") or 0) + quantity
                    if v.get("sub_variants") and len(v["sub_variants"]) > 0:
                        sv0 = v["sub_variants"][0]
                        if isinstance(sv0, dict):
                            sv0["stock"] = int(sv0.get("stock") or 0) + quantity
                    flag_modified(product, "variants")
                    _update_product_stock_from_variants(product)
            else:
                per_v = quantity // len(product.variants)
                rem = quantity % len(product.variants)
                for idx, v in enumerate(product.variants):
                    if isinstance(v, dict):
                        v_qty = per_v + (1 if idx < rem else 0)
                        v["stock"] = int(v.get("stock") or 0) + v_qty
                        if v.get("sub_variants") and len(v["sub_variants"]) > 0:
                            sv0 = v["sub_variants"][0]
                            if isinstance(sv0, dict):
                                sv0["stock"] = int(sv0.get("stock") or 0) + v_qty
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
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
        _sync_product_availability_and_invalidate_cache(db, product)
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

        if product.variants and len(product.variants) > 0:
            matching_variant = None
            if variant_str:
                matching_variant = _find_matching_variant(product.variants, variant_str)
            if matching_variant:
                v_stock = int(matching_variant.get("stock") or 0)
                matching_variant["stock"] = v_stock + quantity
                _sync_sub_variants_stock(matching_variant, quantity)
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
            elif len(product.variants) == 1:
                v = product.variants[0]
                if isinstance(v, dict):
                    v["stock"] = int(v.get("stock") or 0) + quantity
                    if v.get("sub_variants") and len(v["sub_variants"]) > 0:
                        sv0 = v["sub_variants"][0]
                        if isinstance(sv0, dict):
                            sv0["stock"] = int(sv0.get("stock") or 0) + quantity
                    flag_modified(product, "variants")
                    _update_product_stock_from_variants(product)
            else:
                # Distribute quantity evenly across variants so sub-stocks and aggregate stock remain 100% in sync
                per_v = quantity // len(product.variants)
                rem = quantity % len(product.variants)
                for idx, v in enumerate(product.variants):
                    if isinstance(v, dict):
                        v_qty = per_v + (1 if idx < rem else 0)
                        v["stock"] = int(v.get("stock") or 0) + v_qty
                        if v.get("sub_variants") and len(v["sub_variants"]) > 0:
                            sv0 = v["sub_variants"][0]
                            if isinstance(sv0, dict):
                                sv0["stock"] = int(sv0.get("stock") or 0) + v_qty
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
        else:
            product.stock += quantity

        reason_text = reason or f"Réapprovisionnement manuel ({variant_str or 'Général'})"
        if variant_str and f"({variant_str})" not in reason_text:
            reason_text = f"{reason_text} ({variant_str})"

        _record_movement(
            db,
            product_id=product_id,
            movement_type="RESTOCK",
            quantity=quantity,
            order_id=None,
            actor_id=actor_id,
            warehouse_id=warehouse_id,
            reason=reason_text,
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
                _sync_sub_variants_stock(matching_variant, -quantity)
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
        _sync_product_availability_and_invalidate_cache(db, product)
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

        if product.variants and len(product.variants) > 0:
            matching_variant = None
            if variant_str:
                matching_variant = _find_matching_variant(product.variants, variant_str)

            if matching_variant:
                v_stock = int(matching_variant.get("stock") or 0)
                new_v_stock = v_stock + quantity
                if quantity < 0 and new_v_stock < 0:
                    raise InsufficientStockError(
                        product_id=f"{product_id} ({variant_str})",
                        requested=abs(quantity),
                        available=max(0, v_stock),
                    )
                matching_variant["stock"] = max(0, new_v_stock)
                _sync_sub_variants_stock(matching_variant, quantity)
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
            elif len(product.variants) == 1:
                v = product.variants[0]
                if isinstance(v, dict):
                    v_stock = int(v.get("stock") or 0)
                    new_v_stock = v_stock + quantity
                    if quantity < 0 and new_v_stock < 0:
                        raise InsufficientStockError(
                            product_id=f"{product_id} ({v.get('value') or 'Défaut'})",
                            requested=abs(quantity),
                            available=max(0, v_stock),
                        )
                    v["stock"] = max(0, new_v_stock)
                    if v.get("sub_variants") and len(v["sub_variants"]) > 0:
                        sv0 = v["sub_variants"][0]
                        if isinstance(sv0, dict):
                            sv0["stock"] = max(0, int(sv0.get("stock") or 0) + quantity)
                    flag_modified(product, "variants")
                    _update_product_stock_from_variants(product)
            else:
                if quantity > 0:
                    per_v = quantity // len(product.variants)
                    rem = quantity % len(product.variants)
                    for idx, v in enumerate(product.variants):
                        if isinstance(v, dict):
                            v_qty = per_v + (1 if idx < rem else 0)
                            v["stock"] = int(v.get("stock") or 0) + v_qty
                            if v.get("sub_variants") and len(v["sub_variants"]) > 0:
                                sv0 = v["sub_variants"][0]
                                if isinstance(sv0, dict):
                                    sv0["stock"] = int(sv0.get("stock") or 0) + v_qty
                else:
                    needed = abs(quantity)
                    total_avail = sum(max(0, int(v.get("stock") or 0)) for v in product.variants if isinstance(v, dict))
                    if total_avail < needed:
                        raise InsufficientStockError(product_id=product_id, requested=needed, available=total_avail)
                    for v in product.variants:
                        if needed <= 0:
                            break
                        if isinstance(v, dict):
                            cur = int(v.get("stock") or 0)
                            deduct = min(cur, needed)
                            v["stock"] = cur - deduct
                            needed -= deduct
                            if v.get("sub_variants") and len(v["sub_variants"]) > 0:
                                sv0 = v["sub_variants"][0]
                                if isinstance(sv0, dict):
                                    sv0["stock"] = max(0, int(sv0.get("stock") or 0) - deduct)
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
        else:
            new_stock = product.stock + quantity
            if quantity < 0 and new_stock < 0:
                raise InsufficientStockError(
                    product_id=product_id,
                    requested=abs(quantity),
                    available=max(0, product.stock),
                )
            product.stock = max(0, new_stock)

        reason_text = reason or f"Ajustement manuel ({variant_str or 'Général'})"
        if variant_str and f"({variant_str})" not in reason_text:
            reason_text = f"{reason_text} ({variant_str})"

        _record_movement(
            db,
            product_id=product_id,
            movement_type="MANUAL_ADJUSTMENT",
            quantity=quantity,
            actor_id=actor_id,
            reason=reason_text,
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

        if product.variants and len(product.variants) > 0:
            matching_variant = None
            if variant_str:
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
                _sync_sub_variants_stock(matching_variant, quantity_delta)
                flag_modified(product, "variants")
                _update_product_stock_from_variants(product)
            elif len(product.variants) == 1:
                v = product.variants[0]
                if isinstance(v, dict):
                    v_stock = int(v.get("stock") or 0)
                    v_reserved = int(v.get("reserved") or 0)
                    new_v_stock = v_stock + quantity_delta
                    if new_v_stock < 0 or (new_v_stock - v_reserved) < 0:
                        raise InsufficientStockError(
                            product_id=f"{product_id} ({v.get('value') or 'Défaut'})",
                            requested=abs(quantity_delta),
                            available=v_stock - v_reserved,
                        )
                    v["stock"] = new_v_stock
                    if v.get("sub_variants") and len(v["sub_variants"]) > 0:
                        sv0 = v["sub_variants"][0]
                        if isinstance(sv0, dict):
                            sv0["stock"] = new_v_stock
                    flag_modified(product, "variants")
                    _update_product_stock_from_variants(product)
            else:
                if quantity_delta > 0:
                    per_v = quantity_delta // len(product.variants)
                    rem = quantity_delta % len(product.variants)
                    for idx, v in enumerate(product.variants):
                        if isinstance(v, dict):
                            v_qty = per_v + (1 if idx < rem else 0)
                            v["stock"] = int(v.get("stock") or 0) + v_qty
                            if v.get("sub_variants") and len(v["sub_variants"]) > 0:
                                sv0 = v["sub_variants"][0]
                                if isinstance(sv0, dict):
                                    sv0["stock"] = int(sv0.get("stock") or 0) + v_qty
                else:
                    needed = abs(quantity_delta)
                    total_avail = sum(max(0, int(v.get("stock") or 0) - int(v.get("reserved") or 0)) for v in product.variants if isinstance(v, dict))
                    if total_avail < needed:
                        raise InsufficientStockError(product_id=product_id, requested=needed, available=total_avail)
                    for v in product.variants:
                        if needed <= 0:
                            break
                        if isinstance(v, dict):
                            avail_v = max(0, int(v.get("stock") or 0) - int(v.get("reserved") or 0))
                            deduct = min(avail_v, needed)
                            v["stock"] = int(v.get("stock") or 0) - deduct
                            needed -= deduct
                            if v.get("sub_variants") and len(v["sub_variants"]) > 0:
                                sv0 = v["sub_variants"][0]
                                if isinstance(sv0, dict):
                                    sv0["stock"] = max(0, int(sv0.get("stock") or 0) - deduct)
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

        reason_text = reason
        if variant_str and f"({variant_str})" not in reason_text:
            reason_text = f"{reason_text} ({variant_str})"

        _record_movement(
            db, product_id=product_id, movement_type=movement_type, quantity=quantity_delta,
            order_id=order_id, actor_id=actor_id, reason=reason_text, warehouse_id=warehouse_id,
        )
        _sync_product_availability_and_invalidate_cache(db, product)
        logger.info(
            "Manual movement: product=%s type=%s delta=%+d (new stock=%d)",
            product_id, movement_type, quantity_delta, product.stock,
        )
        return product

    def reconcile_and_fix_all_stock(self, db: Session) -> dict:
        """
        Scans all orders and stock movements to:
        1. Purge orphan/deleted order movements and duplicate logs.
        2. Restore physical stock over-deducted by past duplicate updates.
        3. Recalculate physical and reserved stock from real shipped & pending orders.
        """
        from app.models.stock import StockMovement
        from app.models.product import Product
        from app.models.order import Order, OrderItem
        from sqlalchemy.orm import attributes

        stats = {
            "duplicate_movements_deleted": 0,
            "stock_restored_units": 0,
            "products_reconciled": 0,
        }

        db.info["skip_tenant_isolation"] = True

        # 0. Purge orphan stock movements (order_id points to non-existent or deleted order)
        valid_orders = db.query(Order.id, Order.status).filter((Order.is_deleted == False) | (Order.is_deleted.is_(None))).all()
        valid_order_map = {r[0]: r[1] for r in valid_orders}
        valid_order_ids = set(valid_order_map.keys())

        orphan_movements = db.query(StockMovement).filter(
            StockMovement.order_id.isnot(None),
            ~StockMovement.order_id.in_(valid_order_ids)
        ).all()
        for om in orphan_movements:
            db.delete(om)
            stats["duplicate_movements_deleted"] += 1

        db.flush()

        # 1. Clean duplicate movements per (order_id, product_id, type, reason)
        movements = db.query(StockMovement).filter(StockMovement.order_id.isnot(None)).all()
        grouped: dict = {}
        for m in movements:
            key = (m.order_id, m.product_id, m.type, m.reason or "")
            grouped.setdefault(key, []).append(m)

        for key, m_list in grouped.items():
            if len(m_list) > 1:
                # Keep earliest movement record, delete duplicates
                m_list.sort(key=lambda x: x.created_at or "")
                duplicates = m_list[1:]
                for dup in duplicates:
                    db.delete(dup)
                    stats["duplicate_movements_deleted"] += 1

                    # If this was a duplicate ORDER_CONFIRM movement that over-deducted physical stock,
                    # restore the deducted physical stock back to product/variant!
                    if dup.type == "ORDER_CONFIRM":
                        product = db.query(Product).filter(Product.id == dup.product_id).first()
                        if product:
                            qty_to_restore = abs(dup.quantity or 0)
                            if qty_to_restore > 0:
                                stats["stock_restored_units"] += qty_to_restore
                                variant_str = None
                                if dup.reason and "(" in dup.reason and ")" in dup.reason:
                                    variant_str = dup.reason.split("(")[-1].split(")")[0].strip()
                                    if variant_str == "Général":
                                        variant_str = None

                                if variant_str and product.variants:
                                    mv = _find_matching_variant(product.variants, variant_str)
                                    if mv:
                                        mv["stock"] = int(mv.get("stock") or 0) + qty_to_restore
                                        _sync_sub_variants_stock(mv, qty_to_restore)
                                        attributes.flag_modified(product, "variants")
                                        _update_product_stock_from_variants(product)
                                else:
                                    product.stock = (product.stock or 0) + qty_to_restore

        db.flush()

        # 2. Recalculate reserved_stock and verify physical stock against real order items
        pending_statuses = {"NEW", "ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "PENDING"}
        confirmed_statuses = {"CONFIRMED", "SHIPPED", "DELIVERED", "COMPLETED", "PAID"}

        products = db.query(Product).all()

        for product in products:
            stats["products_reconciled"] += 1

            # Real pending order items
            pending_items = (
                db.query(OrderItem)
                .join(Order, OrderItem.order_id == Order.id)
                .filter(OrderItem.product_id == product.id, Order.status.in_(pending_statuses), (Order.is_deleted == False) | (Order.is_deleted.is_(None)))
                .all()
            )
            total_pending_qty = sum(item.quantity or 0 for item in pending_items)
            product.reserved_stock = total_pending_qty

            if product.variants and isinstance(product.variants, list):
                for v in product.variants:
                    if isinstance(v, dict):
                        v["reserved"] = 0
                        if v.get("sub_variants"):
                            for sv in v["sub_variants"]:
                                if isinstance(sv, dict):
                                    sv["reserved"] = 0

                for item in pending_items:
                    v_str = None
                    if item.variant_details and isinstance(item.variant_details, dict):
                        v_str = item.variant_details.get("variant")

                    if v_str:
                        mv = _find_matching_variant(product.variants, v_str)
                        if mv:
                            mv["reserved"] = int(mv.get("reserved") or 0) + (item.quantity or 0)
                            _sync_sub_variants_reserved(mv, item.quantity or 0)

                attributes.flag_modified(product, "variants")
                _update_product_stock_from_variants(product)

            _sync_product_availability_and_invalidate_cache(db, product)

        db.commit()
        return stats


# Singleton — import this in services and routers
inventory_service = InventoryService()
