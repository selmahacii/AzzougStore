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
    "CANCELLED":   ["IN_PROGRESS"],
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
        # Uses SELECT FOR UPDATE on the store row to prevent race conditions under concurrent writes
        from sqlalchemy import func
        max_seq = db.query(func.max(Order.store_sequence_number)).filter(
            Order.store_id == store_id
        ).with_for_update(read=False, skip_locked=False).scalar()
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
            if call_result == "NRP":
                order.nrp_count = (order.nrp_count or 0) + 1
                max_nrp = 12 if order.is_abandoned_cart else 9
                if order.nrp_count >= max_nrp:
                    new_status = "CANCELLED"
                    order.next_callback_time = None
                    if not order_note:
                        order_note = f"Annulation automatique après {max_nrp} tentatives NRP."
                else:
                    order.next_callback_time = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=2)
        
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

            if new_status == "SHIPPED" and not order.tracking_number:
                from app.core.exceptions import ValidationError
                raise ValidationError(
                    message="Le numéro de suivi n'a pas été transmis. Impossible de passer au statut Expédiée."
                )

            order.status = new_status  # type: ignore[assignment]

            # ── Stock side effects ────────────────────────────────
            if new_status == "CONFIRMED" and old_status in ("CALLED", "ABANDONED"):
                # Deduct physical stock + release reservations
                for item in order.items:
                    inventory_service.confirm_stock(
                        db,
                        product_id=item.product_id,
                        quantity=item.quantity,
                        order_id=order.id,
                        actor_id=actor_id,
                        variant_details=item.variant_details,
                    )

            elif new_status in ("RETURNED", "CANCELLED"):
                if old_status in _CONFIRMED_STATES:
                    # Physical stock was deducted → return it
                    for item in order.items:
                        inventory_service.return_restock(
                            db,
                            product_id=item.product_id,
                            quantity=item.quantity,
                            order_id=order.id,
                            actor_id=actor_id,
                            variant_details=item.variant_details,
                        )
                elif old_status in _RESERVED_STATES:
                    # Only reservation existed → release it
                    for item in order.items:
                        inventory_service.release_reservation(
                            db,
                            product_id=item.product_id,
                            quantity=item.quantity,
                            order_id=order.id,
                            actor_id=actor_id,
                            variant_details=item.variant_details,
                        )

            elif new_status == "DELIVERED" and old_status != "DELIVERED":
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
