# ═══════════════════════════════════════════════════════════════
# AzzougShop — Order Service (Refactored)
# State machine enforcement + transactional stock side-effects.
# ═══════════════════════════════════════════════════════════════

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.orm import Session, joinedload

from app.core.exceptions import (
    InvalidStateTransitionError,
    OrderNotFoundError,
    StoreNotFoundError,
    PermissionError,
    InsufficientStockError,
    ProductNotFoundError,
)
from app.models.customer import Customer
from app.models.events import OrderEvent
from app.models.finance import FinancialTransaction, TransactionType, Wallet
from app.models.order import Order, OrderItem
from app.models.store import Store
from app.models.user import User
from app.services.inventory_service import inventory_service
from app.services.notification_service import notify

logger = logging.getLogger("app.order_service")

# ─── State Machine ────────────────────────────────────────────────────────────

# Valid (from, to) status transitions
_VALID_TRANSITIONS: dict[str, list[str]] = {
    "NEW":         ["ASSIGNED", "RETURNED", "CANCELLED", "IN_PROGRESS", "CONFIRMED"],
    "ASSIGNED":    ["CALLED", "RETURNED", "CANCELLED", "IN_PROGRESS", "CONFIRMED", "RESCHEDULED"],
    "CALLED":      ["CONFIRMED", "NEW", "RETURNED", "CANCELLED", "IN_PROGRESS", "RESCHEDULED"],
    "IN_PROGRESS": ["CONFIRMED", "CANCELLED", "RESCHEDULED", "IN_PROGRESS"],
    "RESCHEDULED": ["CONFIRMED", "CANCELLED", "IN_PROGRESS", "RESCHEDULED"],
    "CONFIRMED":   ["SHIPPED", "RETURNED", "CANCELLED", "IN_PROGRESS", "RESCHEDULED"],
    "SHIPPED":     ["DELIVERED", "RETURNED", "CANCELLED"],
    "DELIVERED":   ["RETURNED"],
    "RETURNED":    [],
    # A confirmatrice can reopen a cancelled order (edit it) or confirm it
    # directly after winning the client back on a later call.
    "CANCELLED":   ["IN_PROGRESS", "CONFIRMED"],
    "ABANDONED":   ["CONFIRMED", "CANCELLED", "IN_PROGRESS", "RESCHEDULED"],
}

# States from which stock was already physically deducted
_CONFIRMED_STATES = {"CONFIRMED", "SHIPPED", "DELIVERED"}
# States from which only a reservation exists
_RESERVED_STATES  = {"NEW", "ASSIGNED", "CALLED", "ABANDONED", "IN_PROGRESS", "RESCHEDULED"}


def _is_valid_transition(from_status: str, to_status: str) -> bool:
    if from_status == to_status:
        return False
    return to_status in _VALID_TRANSITIONS.get(from_status, [])


# ─── Per-store operational business rules ─────────────────────────────────────
# Every value below used to be hardcoded; it is now read from
# Store.operations_config with these values as safe defaults.

DEFAULT_OPERATIONS_CONFIG: dict = {
    "max_nrp_normal": 9,        # auto-cancel a normal order after N NRP attempts
    "max_nrp_abandoned": 12,    # auto-cancel an abandoned cart after N NRP attempts
    "nrp_callback_hours": 2.0,  # automatic callback delay after each NRP
    "auto_merge_duplicates": True,  # fuse same-phone orders into one operational order
}


def get_operations_config(db: Session, store_id: Optional[str]) -> dict:
    """Merge the store's operations_config over the defaults."""
    cfg = dict(DEFAULT_OPERATIONS_CONFIG)
    if store_id:
        store = db.query(Store).filter(Store.id == store_id).first()
        raw = getattr(store, "operations_config", None) if store else None
        if isinstance(raw, dict):
            for key in cfg:
                if raw.get(key) is not None:
                    cfg[key] = raw[key]
    return cfg


# ─── Automatic duplicate merge ────────────────────────────────────────────────

# Orders still in the confirmation stage can be fused; anything at the carrier
# or terminal is never touched.
_MERGEABLE_STATES = {"NEW", "PENDING", "ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "ABANDONED"}

# Which order of a same-phone group stays operational (the "parent"):
# a normal order always beats an abandoned cart, then the most advanced
# status wins, then the oldest order.
_PARENT_STATUS_PRIORITY = {
    "CONFIRMED": 6, "RESCHEDULED": 5, "IN_PROGRESS": 5, "CALLED": 5,
    "ASSIGNED": 4, "NEW": 3, "PENDING": 3, "ABANDONED": 1,
}


def _variant_key(item) -> str:
    """Merge key: same product line ⇔ same product_id AND same variant string."""
    vd = item.variant_details
    if isinstance(vd, dict):
        return str(vd.get("variant") or "").strip().lower()
    return str(vd or "").strip().lower()


def _recompute_totals(order: Order) -> None:
    subtotal = sum(int(i.quantity or 0) * float(i.unit_price or 0) for i in (order.items or []))
    order.subtotal = subtotal
    order.total = max(0, subtotal + float(order.delivery_fee or 0) - float(order.discount or 0))


def _absorb_child_items(db: Session, parent: Order, child: Order, actor_id: Optional[str]) -> None:
    """
    Aggregate the child's basket into the parent (the child keeps its own
    OrderItems untouched for audit):
      - same product + same variant → quantities are summed;
      - same product, different variant → separate line;
      - different product → appended line.
    The parent takes an equivalent stock hold for what it absorbs (physical
    deduction too when the parent is already CONFIRMED), and its totals are
    recomputed. Caller must have freed the child's stock hold beforehand.
    """
    parent_confirmed = str(parent.status) in _CONFIRMED_STATES
    added: list[str] = []
    for c_item in list(child.items or []):
        qty = int(c_item.quantity or 0)
        if qty <= 0:
            continue
        try:
            inventory_service.reserve_stock(
                db, product_id=c_item.product_id, quantity=qty,
                order_id=parent.id, actor_id=actor_id, variant_details=c_item.variant_details,
            )
            if parent_confirmed:
                inventory_service.confirm_stock(
                    db, product_id=c_item.product_id, quantity=qty,
                    order_id=parent.id, actor_id=actor_id, variant_details=c_item.variant_details,
                )
        except Exception as exc:
            logger.warning("Merge: stock hold for absorbed item %s failed on parent %s: %s",
                           c_item.product_id, parent.id, exc)

        match = next(
            (p for p in (parent.items or [])
             if p.product_id == c_item.product_id and _variant_key(p) == _variant_key(c_item)),
            None,
        )
        if match:
            match.quantity = int(match.quantity or 0) + qty
        else:
            parent.items.append(OrderItem(
                id=str(uuid.uuid4()),
                order_id=parent.id,
                product_id=c_item.product_id,
                product_name=c_item.product_name,
                quantity=qty,
                unit_price=c_item.unit_price,
                variant_details=c_item.variant_details,
                image_url=c_item.image_url,
            ))
        variant = _variant_key(c_item)
        added.append(f"{c_item.product_name}{f' [{variant}]' if variant else ''} x{qty}")

    _recompute_totals(parent)
    if added:
        _log_event(
            db, order_id=parent.id, actor_id=actor_id,
            from_status=str(parent.status), to_status=str(parent.status),
            note=f"Panier fusionné depuis {child.order_number} : + {', '.join(added)}. "
                 f"Nouveau total : {int(parent.total or 0)} DA.",
        )


def _remove_child_items(db: Session, parent: Order, child: Order, actor_id: Optional[str]) -> None:
    """Reverse of _absorb_child_items — used by unmerge (admin, reversible)."""
    parent_confirmed = str(parent.status) in _CONFIRMED_STATES
    removed: list[str] = []
    for c_item in list(child.items or []):
        qty = int(c_item.quantity or 0)
        if qty <= 0:
            continue
        match = next(
            (p for p in (parent.items or [])
             if p.product_id == c_item.product_id and _variant_key(p) == _variant_key(c_item)),
            None,
        )
        if not match:
            continue
        take = min(qty, int(match.quantity or 0))
        if take <= 0:
            continue
        match.quantity = int(match.quantity or 0) - take
        if match.quantity <= 0:
            parent.items.remove(match)
            db.delete(match)
        try:
            if parent_confirmed:
                inventory_service.return_restock(
                    db, product_id=c_item.product_id, quantity=take,
                    order_id=parent.id, actor_id=actor_id, variant_details=c_item.variant_details,
                )
            else:
                inventory_service.release_reservation(
                    db, product_id=c_item.product_id, quantity=take,
                    order_id=parent.id, actor_id=actor_id, variant_details=c_item.variant_details,
                )
        except Exception as exc:
            logger.warning("Unmerge: stock release for %s failed on parent %s: %s",
                           c_item.product_id, parent.id, exc)
        removed.append(f"{c_item.product_name} x{take}")

    _recompute_totals(parent)
    if removed:
        _log_event(
            db, order_id=parent.id, actor_id=actor_id,
            from_status=str(parent.status), to_status=str(parent.status),
            note=f"Défusion de {child.order_number} : - {', '.join(removed)}. "
                 f"Nouveau total : {int(parent.total or 0)} DA.",
        )


def merge_child_into_parent(
    db: Session,
    parent: Order,
    child: Order,
    actor_id: Optional[str],
    reason: str = "doublon même téléphone",
) -> None:
    """
    Single merge primitive used by BOTH automatic and manual merges:
      1. free the child's stock hold (reservation or physical, by category),
      2. mark the child MERGED (original status preserved, nothing deleted),
      3. aggregate its basket into the parent (product+variant merge rules),
      4. write the traceability event on the child.
    """
    child_was_confirmed = str(child.status) in _CONFIRMED_STATES
    child.status_before_merge = str(child.status)
    child.status = "MERGED"
    child.parent_order_id = parent.id
    child.merged_by = actor_id
    child.merged_at = datetime.now(timezone.utc).replace(tzinfo=None)
    child.is_duplicate = True

    for item in list(child.items or []):
        try:
            if child_was_confirmed:
                inventory_service.return_restock(
                    db, product_id=item.product_id, quantity=item.quantity,
                    order_id=child.id, actor_id=actor_id, variant_details=item.variant_details,
                )
            else:
                inventory_service.release_reservation(
                    db, product_id=item.product_id, quantity=item.quantity,
                    order_id=child.id, actor_id=actor_id, variant_details=item.variant_details,
                )
        except Exception as exc:
            logger.warning("Merge: stock release failed for child %s: %s", child.id, exc)

    _absorb_child_items(db, parent, child, actor_id)

    _log_event(
        db, order_id=child.id, actor_id=actor_id,
        from_status=child.status_before_merge, to_status="MERGED",
        note=f"Fusionnée dans la commande {parent.order_number} ({reason}). "
             f"Son panier a été agrégé au panier de la commande parente.",
    )


def auto_merge_duplicates(db: Session, order: Order, actor_id: Optional[str] = None) -> int:
    """
    Automatically fuse every same-phone, same-store ACTIVE order into a single
    operational parent order carrying the AGGREGATED basket.

    - Detection ignores cancelled / returned / deleted / already-merged orders
      and anything already at the carrier (tracking number set).
    - Children get status=MERGED with their original status preserved
      (status_before_merge), parent_order_id, merged_at — nothing is deleted:
      items, notes and the full OrderEvent timeline stay on each child.
    - The parent's basket becomes the aggregation of all duplicates
      (same product+variant → summed quantities), totals recomputed, and the
      equivalent stock hold moves to the parent.
    - The parent inherits an assignee from its children when it has none, so
      the confirmatrice always manages exactly ONE logical basket per client.

    Returns the number of orders merged.
    """
    phone = (order.customer_phone or "").strip()
    # Entry status: any order still in the confirmation stage, OR already
    # CONFIRMED-without-tracking (it can still legitimately absorb a late
    # duplicate — e.g. reopened from CANCELLED, or a sibling created after).
    if not phone or (str(order.status) not in _MERGEABLE_STATES and str(order.status) != "CONFIRMED"):
        return 0
    if str(order.status) == "CONFIRMED" and order.tracking_number:
        return 0

    cfg = get_operations_config(db, str(order.store_id))
    if not cfg.get("auto_merge_duplicates", True):
        return 0

    # Active candidates: confirmation-stage orders + CONFIRMED ones not yet at
    # the carrier (a confirmed parent can still absorb a late duplicate).
    candidate_states = list(_MERGEABLE_STATES) + ["CONFIRMED"]
    siblings = (
        db.query(Order)
        .filter(
            Order.store_id == order.store_id,
            Order.customer_phone == phone,
            Order.id != order.id,
            Order.is_deleted == False,
            Order.status.in_(candidate_states),
        )
        .with_for_update()  # serialize concurrent merges on the same client
        .all()
    )
    # Never touch anything already at the carrier
    siblings = [s for s in siblings if not s.tracking_number]
    if not siblings:
        return 0

    group = [order] + siblings

    def parent_rank(o: Order):
        return (
            1 if o.is_abandoned_cart else 0,                       # normal first
            -_PARENT_STATUS_PRIORITY.get(str(o.status), 0),        # advanced status first
            o.created_at or datetime.min,                          # oldest first
        )

    parent = sorted(group, key=parent_rank)[0]
    merged_numbers: list[str] = []

    for child in group:
        if child.id == parent.id:
            continue
        if child.tracking_number:  # already at the carrier — never touch
            continue
        merge_child_into_parent(db, parent, child, actor_id, reason="fusion automatique — doublon même téléphone")
        merged_numbers.append(str(child.order_number))

    if not merged_numbers:
        return 0

    # Keep exactly one operational order per client, with an owner
    if not parent.assigned_to:
        inherited = next((c.assigned_to for c in group if c.id != parent.id and c.assigned_to), None)
        if inherited:
            parent.assigned_to = inherited
            if str(parent.status) == "NEW":
                parent.status = "ASSIGNED"
    parent.is_duplicate = False

    _log_event(
        db,
        order_id=parent.id,
        actor_id=actor_id,
        from_status=str(parent.status),
        to_status=str(parent.status),
        note=f"Fusion automatique : doublon(s) {', '.join(merged_numbers)} rattaché(s) à cette commande.",
    )
    notify(
        db,
        type="DUPLICATE_MERGED",
        title=f"Doublon fusionné — {parent.order_number}",
        message=f"{len(merged_numbers)} commande(s) du même client ({phone}) fusionnée(s) automatiquement : {', '.join(merged_numbers)}.",
        user_id=parent.assigned_to,
        store_id=str(parent.store_id),
        order_id=str(parent.id),
    )
    logger.info(
        "Auto-merged %d duplicate(s) [%s] into %s (store=%s)",
        len(merged_numbers), ", ".join(merged_numbers), parent.order_number, parent.store_id,
    )
    return len(merged_numbers)


# ─── Auto-assignment Logic ────────────────────────────────────────────────────

def _auto_assign(
    db: Session,
    store: Store,
    order_product_ids: list | None = None,
    exclude_agent_id: str | None = None,
    force: bool = False
) -> Optional[str]:
    """
    Pick the best confirmateur for a new order.

    Eligibility rules:
      - Base: active role (CONFIRMATEUR | AGENT | AGENT_MANAGER), is_active == True
      - Two assignment modes for each agent:
        A) Agent has assigned_product_ids → matches any store's order that contains
           at least one of their products (cross-store product specialist)
        B) Agent has no assigned_product_ids → only matches orders from their own
           employee_store_id, respecting assigned_store_scope/ids for further filtering
    """
    if not force:
        if not store.assignment_active or store.assignment_logic == "MANUAL":
            return None

    order_pid_set: set = set(order_product_ids) if order_product_ids else set()

    # Fetch ALL active agents — we need product-specialists from any store
    all_agents = (
        db.query(User)
        .filter(
            User.role.in_(["CONFIRMATEUR", "AGENT", "AGENT_MANAGER"]),
            User.is_active == True,
        )
        .all()
    )

    specialists = []
    store_agents = []
    
    for agent in all_agents:
        if exclude_agent_id and agent.id == exclude_agent_id:
            continue

        raw_products = getattr(agent, "assigned_product_ids", None)
        agent_product_ids: list = raw_products if isinstance(raw_products, list) else []

        if agent_product_ids:
            # Product-specialist: eligible for this order if products overlap
            if order_pid_set and order_pid_set.intersection(agent_product_ids):
                logger.info(f"Agent {agent.id} (specialist) matches products for order")
                specialists.append(agent)
            else:
                logger.info(f"Agent {agent.id} (specialist) rejected: no product overlap")
            # strictly a specialist, they do not fall back to store check
        else:
            # Store-based agent: must be authorized for this store
            is_authorized = False
            
            # Primary store matches
            if getattr(agent, "employee_store_id", None) == store.id:
                is_authorized = True
            
            # Or scope matches
            scope = getattr(agent, "assigned_store_scope", "ALL")
            if scope == "ALL":
                is_authorized = True
            elif scope == "SPECIFIC":
                raw_stores = getattr(agent, "assigned_store_ids", None)
                store_ids: list = raw_stores if isinstance(raw_stores, list) else []
                if store.id in store_ids:
                    is_authorized = True
                    
            if is_authorized:
                logger.info(f"Agent {agent.id} (store-based) matches store {store.id}")
                store_agents.append(agent)
            else:
                logger.info(f"Agent {agent.id} (store-based) rejected: unauthorized for store {store.id}")

    # Prioritize specialists if any match
    eligible = specialists if specialists else store_agents

    if not eligible:
        return None

    logic = store.assignment_logic
    if logic == "MANUAL" or not logic:
        logic = "LEAST_LOADED"

    if logic == "ROUND_ROBIN":
        last_order = (
            db.query(Order)
            .filter(
                Order.store_id == store.id,
                Order.assigned_to.in_([a.id for a in eligible]),
            )
            .order_by(Order.created_at.desc())
            .first()
        )
        if not last_order:
            return eligible[0].id
        agent_ids = [a.id for a in eligible]
        try:
            last_idx = agent_ids.index(last_order.assigned_to)
            return eligible[(last_idx + 1) % len(eligible)].id
        except ValueError:
            return eligible[0].id

    if logic == "LEAST_LOADED":
        loads = []
        for agent in eligible:
            count = (
                db.query(Order)
                .filter(
                    Order.assigned_to == agent.id,
                    Order.status.in_(["NEW", "ASSIGNED", "CALLED"]),
                    Order.is_deleted == False,
                )
                .count()
            )
            loads.append((count, agent.id))
        loads.sort()
        return loads[0][1]

    return None


# ─── Order Event Logger ────────────────────────────────────────────────────────

def _log_event(
    db: Session,
    *,
    order_id: str,
    actor_id: Optional[str] = None,
    from_status: Optional[str],
    to_status: str,
    note: Optional[str] = None,
    call_result: Optional[str] = None,
    call_attempt: int = 1,
) -> None:
    event = OrderEvent(
        id=str(uuid.uuid4()),
        order_id=order_id,
        actor_id=actor_id,
        from_status=from_status,
        to_status=to_status,
        note=note,
        call_result=call_result,
        call_attempt=call_attempt,
    )
    db.add(event)


# ─── Service ──────────────────────────────────────────────────────────────────

class OrderService:

    def create_order(
        self,
        db: Session,
        order_data: dict,
        items_data: List[dict],
        actor_id: Optional[str] = None,
    ) -> Order:
        """
        Atomically creates an order, its line items, and reserves stock.

        Steps:
          1. Validate store exists.
          2. Generate order number.
          3. Auto-assign agent (optional).
          4. Reserve stock per item (SELECT FOR UPDATE).
          5. Create OrderEvent (NEW).
          6. Return order (caller commits).
        """
        store_id = order_data.get("store_id")
        store = db.query(Store).filter(Store.id == store_id).first()
        if not store:
            raise StoreNotFoundError(message=f"Boutique {store_id} introuvable.")

        # Generate deterministic, human-readable order number
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        order_number = f"ORD-{now.strftime('%Y%m%d')}-{str(uuid.uuid4())[:6].upper()}"

        # Generate sequential number per store for admin/agent display ("Commande N°X")
        # Lock the STORE row to serialize sequence generation under concurrent
        # writes — FOR UPDATE cannot be applied to an aggregate query in Postgres.
        from sqlalchemy import func
        db.query(Store.id).filter(Store.id == store_id).with_for_update().first()
        max_seq = db.query(func.max(Order.store_sequence_number)).filter(
            Order.store_id == store_id
        ).scalar()
        store_sequence_number = (max_seq or 0) + 1

        # Determine initial status / assignment
        order_product_ids = [item["product_id"] for item in items_data if item.get("product_id")]
        
        # If the creator (actor) is a CONFIRMATEUR (confirmation agent), force the assignment to them.
        creator_confirmatrice = None
        if actor_id:
            from app.models.user import User
            creator_confirmatrice = db.query(User).filter(User.id == actor_id, User.role == "CONFIRMATEUR").first()
            
        if creator_confirmatrice:
            order_data.pop("assigned_to", None)
            explicit_agent = creator_confirmatrice.id
        else:
            auto_agent = _auto_assign(db, store, order_product_ids)
            explicit_agent = order_data.pop("assigned_to", None) or auto_agent
            
        initial_status = "ASSIGNED" if explicit_agent else "NEW"

        promo_code = order_data.get("promo_code")
        if promo_code:
            from app.models.promotion import Promotion
            promo = db.query(Promotion).filter(
                Promotion.code == promo_code.upper(),
                Promotion.store_id == store_id,
                Promotion.is_active == True
            ).with_for_update().first()
            
            if not promo:
                raise ValueError(f"Code promo {promo_code} invalide.")
            
            now_dt = datetime.now(timezone.utc).replace(tzinfo=None)
            if promo.starts_at and promo.starts_at > now_dt:
                raise ValueError("Ce code promo n'est pas encore actif.")
            if promo.ends_at and promo.ends_at < now_dt:
                raise ValueError("Ce code promo a expiré.")
            if promo.is_flash_sale and promo.flash_sale_ends_at and promo.flash_sale_ends_at < now_dt:
                raise ValueError("La vente flash est terminée.")
            if promo.max_uses and promo.used_count >= promo.max_uses:
                raise ValueError("Ce code promo a atteint sa limite d'utilisation.")
            
            promo.used_count += 1
            db.add(promo)

        order = Order(
            id=str(uuid.uuid4()),
            order_number=order_number,
            store_sequence_number=store_sequence_number,
            status=initial_status,
            assigned_to=explicit_agent,
            **{k: v for k, v in order_data.items() if k != "assigned_to"},
        )
        db.add(order)
        db.flush()  # Get ID without committing

        # Expand combined variants if any (e.g. "P1: Couleur: Noir | P2: Couleur: Bordeaux")
        expanded_items = []
        for item in items_data:
            variant_details = item.get("variant_details")
            variant_str = ""
            if isinstance(variant_details, dict):
                variant_str = variant_details.get("variant") or ""
            elif isinstance(variant_details, str):
                variant_str = variant_details

            if variant_str and ("P1:" in variant_str or "|" in variant_str):
                parts = [p.strip() for p in variant_str.split("|")]
                variant_groups = {}
                for part in parts:
                    clean_part = part
                    if ":" in clean_part and (clean_part.startswith("P") or clean_part.split(":")[0].strip().startswith("P")):
                        subparts = clean_part.split(":", 1)
                        if len(subparts) > 1:
                            clean_part = subparts[1].strip()
                    
                    details = {}
                    pairs = [pr.strip() for pr in clean_part.split(",")]
                    for pair in pairs:
                        if ":" in pair:
                            k, v = pair.split(":", 1)
                            details[k.strip()] = v.strip()
                    
                    var_name_parts = []
                    if "Couleur" in details:
                        var_name_parts.append(details["Couleur"])
                    elif "Color" in details:
                        var_name_parts.append(details["Color"])
                    if "Taille" in details:
                        var_name_parts.append(details["Taille"])
                    elif "Size" in details:
                        var_name_parts.append(details["Size"])
                    
                    if not var_name_parts and details:
                        var_name_parts = list(details.values())
                        
                    details["variant"] = " / ".join(var_name_parts)
                    
                    variant_key = details["variant"]
                    if variant_key not in variant_groups:
                        variant_groups[variant_key] = {
                            "details": details,
                            "count": 0
                        }
                    variant_groups[variant_key]["count"] += 1
                
                for var_key, group in variant_groups.items():
                    expanded_items.append({
                        "product_id": item["product_id"],
                        "product_name": item["product_name"],
                        "quantity": group["count"],
                        "unit_price": item["unit_price"],
                        "variant_details": group["details"],
                        "image_url": item.get("image_url"),
                        "sku": item.get("sku")
                    })
            else:
                expanded_items.append(item)
        items_data = expanded_items

        # Reserve stock for each line item
        for item in items_data:
            try:
                inventory_service.reserve_stock(
                    db,
                    product_id=item["product_id"],
                    quantity=item["quantity"],
                    order_id=order.id,
                    actor_id=actor_id,
                    variant_details=item.get("variant_details"),
                )
            except (InsufficientStockError, ProductNotFoundError) as stock_err:
                raise stock_err
            except Exception as stock_err:
                # Log other generic database/network issues but don't abort storefront flows
                logger.warning("Stock reservation skipped for product %s due to system error: %s", item.get("product_id"), stock_err)
            db.add(OrderItem(
                id=str(uuid.uuid4()),
                order_id=order.id,
                **{k: v for k, v in item.items() if k in {"product_id", "product_name", "quantity", "unit_price", "variant_details", "image_url"}},
            ))

        # Audit event (best-effort — don't fail the order if event logging is broken)
        try:
            note = "Commande créée automatiquement assignée." if explicit_agent else "Commande créée. Assignation manuelle requise."
            _log_event(db, order_id=order.id, actor_id=actor_id, from_status=None, to_status=initial_status, note=note)
        except Exception as evt_err:
            logger.warning("Order event logging failed: %s", evt_err)

        if explicit_agent and explicit_agent != actor_id:
            notify(
                db,
                type="ORDER_ASSIGNED",
                title=f"Nouvelle commande assignée — {order.order_number}",
                message=f"{order.customer_name or 'Client'} · {order.customer_wilaya or ''} · {order.total or 0} DA",
                user_id=explicit_agent,
                store_id=str(order.store_id),
                order_id=str(order.id),
            )

        # Upsert guest customer record
        try:
            self._upsert_guest_customer(db, order)
        except Exception as exc:
            logger.warning("Guest customer upsert failed for order %s: %s", order.order_number, exc)

        logger.info("Order created: %s (store=%s, status=%s, agent=%s)", order.order_number, store_id, initial_status, explicit_agent)
        return order

    def _upsert_guest_customer(self, db: Session, order: Order) -> None:
        """Create or update a guest customer record from order data."""
        phone = order.customer_phone
        if not phone:
            return
        existing = db.query(Customer).filter(
            Customer.store_id == order.store_id,
            Customer.phone == phone,
        ).first()
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if existing:
            # Update info if missing
            if not existing.name or existing.is_guest:
                existing.name = order.customer_name or existing.name
            if order.customer_wilaya and not existing.wilaya:
                existing.wilaya = order.customer_wilaya
            if order.customer_address and not existing.address:
                existing.address = order.customer_address
            existing.last_order_at = now  # type: ignore[assignment]
            if existing.is_guest:
                existing.total_orders = (existing.total_orders or 0) + 1  # type: ignore[assignment]
            # Link order to existing customer
            if not order.customer_id:
                order.customer_id = existing.id
        else:
            customer = Customer(
                id=str(uuid.uuid4()),
                store_id=order.store_id,
                phone=phone,
                name=order.customer_name or "Visiteur",
                wilaya=order.customer_wilaya,
                address=order.customer_address,
                is_guest=True,
                source="ORDER",
                tier="BRONZE",
                total_orders=1,
                last_order_at=now,
            )
            db.add(customer)
            db.flush()
            order.customer_id = customer.id

    def update_order(
        self,
        db: Session,
        *,
        order: Order,
        update_data: dict,
        actor_id: str,
    ) -> Order:
        """
        Update order status/assignment with full state machine enforcement
        and automatic stock side effects.

        Stock transitions:
          CALLED → CONFIRMED        : confirm_stock (deduct from physical stock)
          ANY_RESERVED → RETURNED   : release_reservation (free reservedStock)
          ANY_CONFIRMED → RETURNED  : return_restock (add back to physical stock)
        """
        old_status: str = str(order.status)
        new_status = update_data.get("status")
        new_assignee = update_data.get("assigned_to")
        order_note: str | None = update_data.get("notes") or update_data.get("note")
        call_result = update_data.get("call_result")
        call_attempt = update_data.get("call_attempt", 1)
        scheduled_callback_at = update_data.get("scheduled_callback_at")
        
        # ── NRP / Confirmation Logic ──────────────────────────────
        from datetime import timedelta
        
        # Start timer on first interaction
        if not order.confirmation_start_time and (new_status in ("IN_PROGRESS", "RESCHEDULED") or call_result):
            order.confirmation_start_time = datetime.now(timezone.utc).replace(tzinfo=None)

        if call_result == "NRP" or new_status == "IN_PROGRESS":
            new_status = "IN_PROGRESS"
            # If specifically NRP, increment count and schedule callback
            # (limits and delay are per-store admin settings, see operations_config)
            if call_result == "NRP":
                ops_cfg = get_operations_config(db, str(order.store_id))
                order.nrp_count = (order.nrp_count or 0) + 1
                max_nrp = int(
                    ops_cfg["max_nrp_abandoned"] if order.is_abandoned_cart else ops_cfg["max_nrp_normal"]
                )
                if order.nrp_count >= max_nrp:
                    new_status = "CANCELLED"
                    order.next_callback_time = None
                    if not order_note:
                        order_note = f"Annulation automatique après {max_nrp} tentatives NRP."
                    notify(
                        db,
                        type="NRP_FOLLOWUP",
                        title=f"Annulation auto NRP — {order.order_number}",
                        message=f"Plafond de {max_nrp} tentatives NRP atteint : commande annulée automatiquement.",
                        user_id=order.assigned_to,
                        store_id=str(order.store_id),
                        order_id=str(order.id),
                    )
                else:
                    callback_hours = float(ops_cfg["nrp_callback_hours"])
                    order.next_callback_time = (
                        datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=callback_hours)
                    )
                    notify(
                        db,
                        type="NRP_FOLLOWUP",
                        title=f"NRP {order.nrp_count}/{max_nrp} — {order.order_number}",
                        message=f"Client injoignable. Rappel automatique planifié dans {callback_hours:g} h.",
                        user_id=order.assigned_to,
                        store_id=str(order.store_id),
                        order_id=str(order.id),
                    )
        
        if scheduled_callback_at:
            order.next_callback_time = scheduled_callback_at
        
        # Persist notes on the order model if provided
        if order_note:
            order.notes = order_note  # type: ignore[assignment]

        if new_status and new_status != old_status:
            # Enforce state machine
            if not _is_valid_transition(old_status, new_status):
                raise InvalidStateTransitionError(
                    message=f"Transition invalide: {old_status} → {new_status}.",
                    context={"from": old_status, "to": new_status},
                )

            if new_status == "SHIPPED" and not order.tracking_number and not order.livreur_id:
                # A carrier shipment needs a tracking number; an INTERNAL
                # delivery (livreur assigned) legitimately has none.
                from app.core.exceptions import ValidationError
                raise ValidationError(
                    message="Le numéro de suivi n'a pas été transmis. Impossible de passer au statut Expédiée."
                )

            order.status = new_status  # type: ignore[assignment]

            # ── Stock side effects — full symmetric matrix ─────────
            # Every status belongs to exactly one stock category:
            #   R (reserved)  = NEW/ASSIGNED/CALLED/ABANDONED/IN_PROGRESS/RESCHEDULED
            #   C (deducted)  = CONFIRMED/SHIPPED/DELIVERED
            #   Z (no stock)  = CANCELLED/RETURNED/MERGED
            # Any category change applies the matching inventory operation, so
            # the physical stock can never drift regardless of the path taken
            # (confirm from any stage, rollback of a confirmation, reopening a
            # cancelled order, re-confirming it…).
            was_c = old_status in _CONFIRMED_STATES
            was_r = old_status in _RESERVED_STATES
            now_c = new_status in _CONFIRMED_STATES
            now_r = new_status in _RESERVED_STATES

            def _each_item(op, **extra):
                for item in order.items:
                    op(
                        db,
                        product_id=item.product_id,
                        quantity=item.quantity,
                        order_id=order.id,
                        actor_id=actor_id,
                        variant_details=item.variant_details,
                        **extra,
                    )

            if was_r and now_c:
                # Reservation → sale: deduct physical stock, release reservation
                _each_item(inventory_service.confirm_stock)
            elif was_c and now_r:
                # Confirmation rolled back: put stock back, hold a reservation again
                _each_item(inventory_service.return_restock)
                _each_item(inventory_service.reserve_stock)
            elif was_r and not (now_c or now_r):
                # Reservation → terminal: free the reservation
                _each_item(inventory_service.release_reservation)
            elif was_c and not (now_c or now_r):
                # Sale → cancelled/returned: restock physically
                _each_item(inventory_service.return_restock)
            elif not (was_c or was_r) and now_r:
                # Reopened (e.g. CANCELLED → IN_PROGRESS): reserve again
                _each_item(inventory_service.reserve_stock)
            elif not (was_c or was_r) and now_c:
                # Reopened straight to confirmed (CANCELLED → CONFIRMED):
                # reserve (availability check) then confirm (net: deduct)
                _each_item(inventory_service.reserve_stock)
                _each_item(inventory_service.confirm_stock)

            if new_status == "DELIVERED" and old_status != "DELIVERED":
                # Auto-record COD payment in finance
                self._record_delivery_payment(db, order)

            _log_event(
                db,
                order_id=order.id,
                actor_id=actor_id,
                from_status=old_status,
                to_status=new_status,
                note=order_note or f"Statut changé : {old_status} → {new_status}",
                call_result=call_result,
                call_attempt=call_attempt,
            )
            logger.info("Order %s status: %s → %s (actor=%s)", order.order_number, old_status, new_status, actor_id)

            # ── Propagate milestones to merged children (audit trail) ──
            # The children stay MERGED (one commission, one shipment), but
            # their timeline explicitly says how the client was served.
            if new_status in ("CONFIRMED", "SHIPPED", "DELIVERED"):
                merged_children = (
                    db.query(Order)
                    .filter(Order.parent_order_id == order.id, Order.status == "MERGED")
                    .all()
                )
                labels = {"CONFIRMED": "Confirmée", "SHIPPED": "Expédiée", "DELIVERED": "Livrée"}
                for ch in merged_children:
                    _log_event(
                        db, order_id=ch.id, actor_id=actor_id,
                        from_status="MERGED", to_status="MERGED",
                        note=f"{labels[new_status]} via la commande parente {order.order_number}"
                             + (f" — suivi : {order.tracking_number}" if order.tracking_number else "")
                             + ".",
                    )

            # ── Defensive re-merge ──────────────────────────────────
            # Duplicate detection must be independent of the operational
            # status: whenever an order (re)enters an active phase — reopened
            # from CANCELLED, an NRP callback puts it back in IN_PROGRESS,
            # it gets freshly CONFIRMED — re-scan for same-phone siblings
            # that were never merged (legacy data, races, admin edits) so the
            # confirmatrice never ends up with two operational orders for the
            # same client. No-op (0 merged) in the overwhelming common case
            # where everything was already merged at creation time.
            if new_status in _MERGEABLE_STATES or new_status == "CONFIRMED":
                # Skip if `order` is already an established parent (has
                # merged children) — re-running would risk demoting it to a
                # child of some sibling and orphaning its own children's
                # parent_order_id chain. An existing parent already absorbs
                # new duplicates at THEIR creation time; nothing to catch up.
                already_a_parent = (
                    db.query(Order.id)
                    .filter(Order.parent_order_id == order.id, Order.status == "MERGED")
                    .first()
                    is not None
                )
                if not already_a_parent:
                    try:
                        auto_merge_duplicates(db, order, actor_id=actor_id)
                    except Exception as exc:
                        logger.warning("Defensive re-merge failed for %s: %s", order.order_number, exc)

            # ── Business notifications ────────────────────────────
            if new_status == "CONFIRMED" and order.is_abandoned_cart:
                # Origin marker: this cart is now RECOVERED, forever —
                # the type badge never flips back whatever the status does.
                if not order.recovered_at:
                    order.recovered_at = datetime.now(timezone.utc).replace(tzinfo=None)
                notify(
                    db,
                    type="CART_RECOVERED",
                    title=f"Panier récupéré 🟩 — {order.order_number}",
                    message=f"Panier abandonné confirmé ({order.customer_name}, {order.customer_phone}).",
                    user_id=None,  # broadcast to admins
                    store_id=str(order.store_id),
                    order_id=str(order.id),
                )
            elif new_status == "DELIVERED":
                notify(
                    db,
                    type="ORDER_DELIVERED",
                    title=f"Commande livrée — {order.order_number}",
                    message=(
                        "Livraison confirmée par le transporteur. "
                        + ("Commission panier récupéré acquise." if order.is_abandoned_cart else "Commission acquise.")
                    ),
                    user_id=order.assigned_to,
                    store_id=str(order.store_id),
                    order_id=str(order.id),
                )

        # ── Assignment change ──────────────────────────────────────
        if new_assignee is not None and new_assignee != order.assigned_to:
            old_assignee = order.assigned_to
            order.assigned_to = new_assignee
            cur_status = str(order.status)
            _log_event(
                db,
                order_id=order.id,
                actor_id=actor_id,
                from_status=cur_status,
                to_status=cur_status,
                note=f"Réassigné de {old_assignee} à {new_assignee}",
            )
            notify(
                db,
                type="ORDER_ASSIGNED",
                title=f"Commande assignée — {order.order_number}",
                message=f"{order.customer_name or 'Client'} · {order.customer_wilaya or ''} · {order.total or 0} DA",
                user_id=new_assignee,
                store_id=str(order.store_id),
                order_id=str(order.id),
            )

        # ── Delivery agent (livreur) assignment ────────────────────
        new_livreur = update_data.get("livreur_id")
        if new_livreur is not None and new_livreur != order.livreur_id:
            old_livreur = order.livreur_id
            order.livreur_id = new_livreur or None
            cur_status = str(order.status)
            _log_event(
                db,
                order_id=order.id,
                actor_id=actor_id,
                from_status=cur_status,
                to_status=cur_status,
                note=(f"Livreur assigné ({new_livreur})" if new_livreur
                      else f"Livreur retiré ({old_livreur})"),
            )
            if new_livreur:
                notify(
                    db,
                    type="ORDER_ASSIGNED",
                    title=f"Livraison assignée — {order.order_number}",
                    message=(f"{order.customer_name or 'Client'} · {order.customer_phone or ''} · "
                             f"{order.customer_wilaya or ''} {order.customer_commune or ''} · {order.total or 0} DA"),
                    user_id=new_livreur,
                    store_id=str(order.store_id),
                    order_id=str(order.id),
                )

        # ── Note-only update ────────────────────────────────────────
        if order_note and not new_status and new_assignee is None:
            cur_status = str(order.status)
            _log_event(
                db,
                order_id=order.id,
                actor_id=actor_id,
                from_status=cur_status,
                to_status=cur_status,
                note=order_note,
                call_result=call_result,
                call_attempt=call_attempt,
            )

        # ── Customer tier update on delivery ──────────────────────
        if new_status == "DELIVERED" and old_status != "DELIVERED" and order.customer_id:
            self._update_customer_tier(db, str(order.customer_id))

        return order

    def _update_customer_tier(self, db: Session, customer_id: str) -> None:
        """Recalculate and update customer loyalty tier after delivery."""
        from app.models.customer import Customer
        from sqlalchemy import func

        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return
        delivered_count = (
            db.query(func.count(Order.id))
            .filter(Order.customer_id == customer_id, Order.status == "DELIVERED", Order.is_deleted == False)
            .scalar()
        ) or 0
        customer.tier = "GOLD" if delivered_count >= 10 else "SILVER" if delivered_count >= 3 else "BRONZE"  # type: ignore[assignment]
        customer.total_orders = delivered_count  # type: ignore[assignment]
        logger.debug("Customer %s tier updated to %s (%d deliveries)", customer_id, customer.tier, delivered_count)

    def soft_delete(self, db: Session, *, order: Order, actor_id: str) -> None:
        """
        Soft-delete an order. Returns stock if physically deducted,
        or releases reservation if only reserved.
        """
        if order.status in _CONFIRMED_STATES:
            for item in order.items:
                try:
                    inventory_service.return_restock(
                        db,
                        product_id=item.product_id,
                        quantity=item.quantity,
                        order_id=order.id,
                        actor_id=actor_id,
                        variant_details=item.variant_details,
                    )
                except Exception as exc:
                    logger.warning("Could not restock deleted order %s: %s", order.id, exc)
        elif order.status in _RESERVED_STATES:
            for item in order.items:
                try:
                    inventory_service.release_reservation(
                        db,
                        product_id=item.product_id,
                        quantity=item.quantity,
                        order_id=order.id,
                        actor_id=actor_id,
                        variant_details=item.variant_details,
                    )
                except Exception as exc:
                    logger.warning("Could not release reservation for deleted order %s: %s", order.id, exc)

        order.is_deleted = True  # type: ignore[assignment]
        order.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)  # type: ignore[assignment]
        del_status = str(order.status)
        _log_event(db, order_id=order.id, actor_id=actor_id, from_status=del_status, to_status=del_status, note="Commande supprimée (soft delete).")

    def _record_delivery_payment(self, db: Session, order: Order) -> None:
        """Create a PAYMENT finance transaction when an order is delivered (COD)."""
        try:
            wallet = db.query(Wallet).filter(Wallet.store_id == order.store_id).first()
            if not wallet:
                logger.warning("No wallet found for store %s — delivery payment not recorded", order.store_id)
                return
            tx = FinancialTransaction(
                id=str(uuid.uuid4()),
                reference=f"COD-{order.order_number}",
                wallet_id=wallet.id,
                store_id=order.store_id,
                type=TransactionType.PAYMENT,
                amount=order.total,
                description=f"Paiement COD — {order.order_number} ({order.customer_name})",
                transaction_date=datetime.now(timezone.utc).replace(tzinfo=None),
            )
            wallet.balance += order.total  # type: ignore[operator]
            wallet.total_in += order.total  # type: ignore[operator]
            db.add(tx)
            logger.info("Payment recorded: %s DA for order %s", order.total, order.order_number)
            
            # Deduct abandoned cart recovery fee if applicable
            if order.is_abandoned_cart and order.abandoned_cart_recovery_fee and order.abandoned_cart_recovery_fee > 0:
                fee_tx = FinancialTransaction(
                    id=str(uuid.uuid4()),
                    reference=f"FEE-{order.order_number}",
                    wallet_id=wallet.id,
                    store_id=order.store_id,
                    type=TransactionType.DISBURSEMENT,
                    category="commission",
                    amount=-order.abandoned_cart_recovery_fee,
                    description=f"Commission de récupération - {order.order_number}",
                    transaction_date=datetime.now(timezone.utc).replace(tzinfo=None),
                )
                wallet.balance -= order.abandoned_cart_recovery_fee  # type: ignore[operator]
                wallet.total_out += order.abandoned_cart_recovery_fee  # type: ignore[operator]
                db.add(fee_tx)
                logger.info("Recovery fee deducted: %s DA for order %s", order.abandoned_cart_recovery_fee, order.order_number)
                
        except Exception as exc:
            logger.warning("Could not record delivery payment for order %s: %s", order.id, exc)


order_service = OrderService()
