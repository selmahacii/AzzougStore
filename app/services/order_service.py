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
from app.services.audit_service import audit_service
from app.services.order_similarity_engine import (
    DEFAULT_SIMILARITY_WEIGHTS,
    DEFAULT_SIMILARITY_THRESHOLDS,
    DEFAULT_TIME_WINDOW,
    SimilarityResult,
    classify_similarity,
    compute_similarity,
)

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
    # RESCHEDULED: an internal-delivery driver postpones ("Reportée" — client
    # absent, re-livraison demain) and the order returns to the confirmation
    # pipeline instead of being forced into a terminal outcome.
    "SHIPPED":     ["DELIVERED", "RETURNED", "CANCELLED", "RESCHEDULED"],
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
    # Weighted-similarity duplicate detection (app.services.order_similarity_engine)
    # — every number here is store-overridable via Store.operations_config,
    # never a hardcoded threshold used directly by auto_merge_duplicates.
    # Phone match alone is no longer sufficient to auto-merge: a same-phone
    # pair with disjoint product baskets scores far below auto_merge_threshold
    # and is left as two distinct orders (this is the exact false-positive
    # class — "genuinely two different purchases" — the old phone-only rule
    # used to silently fuse, losing the second sale's Meta conversion).
    "duplicate_detection": {
        "weights": dict(DEFAULT_SIMILARITY_WEIGHTS),
        "thresholds": dict(DEFAULT_SIMILARITY_THRESHOLDS),
        "time_window": dict(DEFAULT_TIME_WINDOW),
    },
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


def _variant_key_from_details(vd) -> str:
    if isinstance(vd, dict):
        return str(vd.get("variant") or "").strip().lower()
    return str(vd or "").strip().lower()


def _variant_key(item) -> str:
    """Merge key: same product line ⇔ same product_id AND same variant string."""
    return _variant_key_from_details(item.variant_details)


def _expand_order_item(item) -> list[dict]:
    """
    Convert a persisted OrderItem into one dict per underlying variant,
    splitting any combined "P1: ... | P2: ..." variant string (see
    expand_combined_variant_items). Used wherever a child order's already-
    persisted items get re-applied to stock or copied into another order
    (merge) — without this, a legacy combined line re-enters reserve/
    release calls as one unit and the merge or edit that touches it next
    corrupts the sibling variant's stock/reserved counters.
    """
    return expand_combined_variant_items([{
        "product_id": item.product_id,
        "product_name": item.product_name,
        "quantity": item.quantity,
        "unit_price": item.unit_price,
        "variant_details": item.variant_details,
        "image_url": item.image_url,
        "sku": getattr(item, "sku", None),
    }])


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
    # Items whose stock hold failed — NOT added to the parent's basket (see
    # below). Surfaced loudly (order note + event) instead of the previous
    # silent logger.warning-only failure: that left parent.items ahead of
    # what was ACTUALLY reserved, so a later confirmation attempt failed
    # with InsufficientStockError deducting a quantity that was never truly
    # held — a merged order stuck permanently unable to confirm or dispatch,
    # with no visible reason why. Skipping the absorption keeps the parent's
    # basket always in sync with its real stock hold; a human sees exactly
    # which item(s) couldn't be merged and can restock/adjust manually.
    failed: list[str] = []
    for c_item in list(child.items or []):
        for sub in _expand_order_item(c_item):
            qty = int(sub.get("quantity") or 0)
            if qty <= 0:
                continue
            variant_details = sub.get("variant_details")
            try:
                inventory_service.reserve_stock(
                    db, product_id=sub["product_id"], quantity=qty,
                    order_id=parent.id, actor_id=actor_id, variant_details=variant_details,
                )
                if parent_confirmed:
                    inventory_service.confirm_stock(
                        db, product_id=sub["product_id"], quantity=qty,
                        order_id=parent.id, actor_id=actor_id, variant_details=variant_details,
                    )
            except Exception as exc:
                logger.warning("Merge: stock hold for absorbed item %s failed on parent %s: %s",
                               sub["product_id"], parent.id, exc)
                variant = _variant_key_from_details(variant_details)
                failed.append(f"{sub['product_name']}{f' [{variant}]' if variant else ''} x{qty}")
                continue

            match = next(
                (p for p in (parent.items or [])
                 if p.product_id == sub["product_id"] and _variant_key(p) == _variant_key_from_details(variant_details)),
                None,
            )
            if match:
                match.quantity = int(match.quantity or 0) + qty
            else:
                parent.items.append(OrderItem(
                    id=str(uuid.uuid4()),
                    order_id=parent.id,
                    product_id=sub["product_id"],
                    product_name=sub["product_name"],
                    quantity=qty,
                    unit_price=sub["unit_price"],
                    variant_details=variant_details,
                    image_url=sub.get("image_url"),
                ))
            variant = _variant_key_from_details(variant_details)
            added.append(f"{sub['product_name']}{f' [{variant}]' if variant else ''} x{qty}")

    _recompute_totals(parent)
    if added:
        _log_event(
            db, order_id=parent.id, actor_id=actor_id,
            from_status=str(parent.status), to_status=str(parent.status),
            note=f"Panier fusionné depuis {child.order_number} : + {', '.join(added)}. "
                 f"Nouveau total : {int(parent.total or 0)} DA.",
        )
    if failed:
        _log_event(
            db, order_id=parent.id, actor_id=actor_id,
            from_status=str(parent.status), to_status=str(parent.status),
            note=f"⚠️ Fusion partielle depuis {child.order_number} : {', '.join(failed)} NON absorbé(s) "
                 f"(stock insuffisant au moment de la fusion) — vérifier le stock puis rajouter "
                 f"manuellement si nécessaire. Le reste de la commande n'est pas bloqué.",
        )


def _remove_child_items(db: Session, parent: Order, child: Order, actor_id: Optional[str]) -> None:
    """Reverse of _absorb_child_items — used by unmerge (admin, reversible)."""
    parent_confirmed = str(parent.status) in _CONFIRMED_STATES
    removed: list[str] = []
    for c_item in list(child.items or []):
        for sub in _expand_order_item(c_item):
            qty = int(sub.get("quantity") or 0)
            if qty <= 0:
                continue
            variant_details = sub.get("variant_details")
            match = next(
                (p for p in (parent.items or [])
                 if p.product_id == sub["product_id"] and _variant_key(p) == _variant_key_from_details(variant_details)),
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
                        db, product_id=sub["product_id"], quantity=take,
                        order_id=parent.id, actor_id=actor_id, variant_details=variant_details,
                    )
                else:
                    inventory_service.release_reservation(
                        db, product_id=sub["product_id"], quantity=take,
                        order_id=parent.id, actor_id=actor_id, variant_details=variant_details,
                    )
            except Exception as exc:
                logger.warning("Unmerge: stock release for %s failed on parent %s: %s",
                               sub["product_id"], parent.id, exc)
            removed.append(f"{sub['product_name']} x{take}")

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
        for sub in _expand_order_item(item):
            qty = int(sub.get("quantity") or 0)
            if qty <= 0:
                continue
            try:
                if child_was_confirmed:
                    inventory_service.return_restock(
                        db, product_id=sub["product_id"], quantity=qty,
                        order_id=child.id, actor_id=actor_id, variant_details=sub.get("variant_details"),
                    )
                else:
                    inventory_service.release_reservation(
                        db, product_id=sub["product_id"], quantity=qty,
                        order_id=child.id, actor_id=actor_id, variant_details=sub.get("variant_details"),
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
    Automatically fuse near-certain duplicate orders (same store, weighted-
    similarity score above the configured auto-merge threshold — see
    app.services.order_similarity_engine) into a single operational parent
    order carrying the AGGREGATED basket.

    Phone match ALONE is no longer sufficient to merge. A same-phone sibling
    with a disjoint product basket, a very different amount, or created days
    apart scores far below the auto-merge threshold and is left as its own
    standalone order — this is the fix for the false-positive class the
    previous phone-only rule produced: two genuinely different purchases by
    the same customer used to be silently fused into one, which also meant
    the second sale's Purchase conversion never reached Meta (this function
    runs synchronously before that send — see orders.py's POST / handler).

    A sibling that scores in the "needs_review" band (similar, but not
    certain enough to auto-merge) is NOT merged — both orders are flagged
    is_duplicate=True instead, visible on the orders page's existing
    "🟣 Doublon" badge, for a human to decide.

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

    Returns the number of orders actually merged (needs_review flags are not
    counted — they didn't merge anything, they flagged it for a human).
    """
    phone = (order.customer_phone or "").strip()
    # A MANUAL order is deliberately entered by staff who already know the
    # situation (e.g. a genuine second sale to a repeat customer, or a
    # follow-up they intentionally typed in) — auto-merge exists to catch
    # ACCIDENTAL duplicate submissions from self-service checkout (double-
    # click, page refresh), not a staff member's deliberate action. A manual
    # order must behave as an ordinary standalone order (visible in
    # "Nouvelles Commandes", dispatchable/assignable) rather than silently
    # disappear into a MERGED/DOUBLON state. Never triggers a merge as the
    # entry point here...
    if str(order.source or "").upper() == "MANUAL":
        return 0
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
    dedup_cfg = cfg.get("duplicate_detection") or {}
    weights = dedup_cfg.get("weights") or DEFAULT_SIMILARITY_WEIGHTS
    thresholds = dedup_cfg.get("thresholds") or DEFAULT_SIMILARITY_THRESHOLDS
    time_window = dedup_cfg.get("time_window") or DEFAULT_TIME_WINDOW

    # Active candidates: confirmation-stage orders + CONFIRMED ones not yet at
    # the carrier (a confirmed parent can still absorb a late duplicate).
    # ...and never swept up as a sibling into someone else's merge either —
    # same reasoning, both directions. Phone match here is only the FIRST,
    # cheap filter to bound the candidate set at the SQL level — it is NOT
    # the merge decision; every candidate still goes through the similarity
    # engine below before anything is touched.
    candidate_states = list(_MERGEABLE_STATES) + ["CONFIRMED"]
    from sqlalchemy import or_ as _or_manual
    phone_siblings = (
        db.query(Order)
        .filter(
            Order.store_id == order.store_id,
            Order.customer_phone == phone,
            Order.id != order.id,
            Order.is_deleted == False,
            Order.status.in_(candidate_states),
            _or_manual(Order.source.is_(None), Order.source != "MANUAL"),
        )
        .with_for_update()  # serialize concurrent merges on the same client
        .all()
    )
    # Never touch anything already at the carrier
    phone_siblings = [s for s in phone_siblings if not s.tracking_number]
    if not phone_siblings:
        return 0

    siblings: list[Order] = []
    review_flagged: list[tuple[Order, SimilarityResult]] = []
    for sibling in phone_siblings:
        result = compute_similarity(order, sibling, weights=weights, time_window=time_window)
        classification = classify_similarity(result, thresholds=thresholds)
        if classification == "auto_merge":
            siblings.append(sibling)
        elif classification == "needs_review":
            review_flagged.append((sibling, result))
        # "distinct" — same phone, but similarity too low: left completely
        # untouched, not even flagged. This is the actual false-positive fix:
        # e.g. same phone, disjoint basket, days apart never reaches here.

    if review_flagged:
        order.is_duplicate = True
        for sibling, result in review_flagged:
            sibling.is_duplicate = True
            note = (
                f"Doublon marketing potentiel (score {result.normalized_score:.0f}%) avec {sibling.order_number} — "
                f"{'; '.join(result.reasons) or 'signal faible'} — fusion automatique NON appliquée, vérification manuelle requise."
            )
            _log_event(db, order_id=order.id, actor_id=actor_id, from_status=str(order.status), to_status=str(order.status), note=note)
            logger.info(
                "Duplicate REVIEW flagged (not merged): %s <-> %s score=%.0f%% reasons=%s",
                order.order_number, sibling.order_number, result.normalized_score, result.reasons,
            )

    if not siblings:
        return 0

    group = [order] + siblings

    def parent_rank(o: Order):
        # Départage à 3 niveaux — sorted() prend le PREMIER (le plus petit) :
        #   1. une vraie commande (non abandonnée) l'emporte sur un panier
        #      abandonné ;
        #   2. à égalité, le statut le plus avancé l'emporte (on ne rétrograde
        #      jamais une commande déjà confirmée en la fusionnant dans une
        #      NEW) ;
        #   3. à égalité de statut, la PLUS RÉCENTE devient la commande active
        #      (avant : la plus ancienne). Cas d'usage explicite : deux paniers
        #      abandonnés du même client fusionnés — la confirmatrice doit
        #      pouvoir confirmer la DERNIÈRE tentative du client, pas la
        #      première. `-timestamp` fait remonter la plus récente en tête ;
        #      created_at NULL retombe en dernier (jamais préférée).
        _recency = -o.created_at.timestamp() if o.created_at else float("inf")
        return (
            1 if o.is_abandoned_cart else 0,                       # normal first
            -_PARENT_STATUS_PRIORITY.get(str(o.status), 0),        # advanced status first
            _recency,                                              # most recent first
        )

    parent = sorted(group, key=parent_rank)[0]
    merged_numbers: list[str] = []

    for child in group:
        if child.id == parent.id:
            continue
        if child.tracking_number:  # already at the carrier — never touch
            continue
        merge_child_into_parent(db, parent, child, actor_id, reason="fusion automatique — doublon détecté par similarité pondérée")
        merged_numbers.append(str(child.order_number))

    if not merged_numbers:
        return 0

    # Keep exactly one operational order per client, with an owner
    if not parent.assigned_to:
        inherited = next((c.assigned_to for c in group if c.id != parent.id and c.assigned_to), None)
        if inherited:
            parent.assigned_to = inherited
            snapshot_commission(db, parent, inherited)
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

def resolve_assignment_rule(
    db: Session,
    store_id: str,
    order_product_ids: list | None = None,
) -> Optional[str]:
    """
    Assignment Rule Engine (2026-07-21) — PRODUCT > STORE > CATEGORY > BRAND
    priority, generic and configurable via the assignment_rules table (see
    app/models/assignment_rule.py). Returns the resolved agent_id, or None
    if no rule matches (caller then falls back to the pre-existing
    specialist/store/least-loaded pool logic in _auto_assign, unchanged —
    this keeps every store with zero configured rules behaving exactly as
    before this feature, per the explicit backward-compatibility
    requirement).

    Exclusions: a rule with is_exclusion=True at a MORE specific level
    blocks an otherwise-matching agent at a LESS specific level — e.g. an
    agent with a STORE rule for the whole store, but a PRODUCT-level
    exclusion for one specific product, is skipped for orders containing
    that product; resolution then continues to the next priority level
    (or returns None, falling through to the default pool) instead of
    silently still assigning her.

    Deterministic tie-break (2026-07-23): an order can contain products
    belonging to DIFFERENT confirmatrices at the same rule_type level (e.g.
    item A's PRODUCT rule -> Sara, item B's PRODUCT rule -> Lyna, same
    order). Exactly one of them must win — a whole order is confirmed by
    one person, never split or duplicated across two dashboards. The
    candidate rules at each level are ordered by target_id ascending before
    picking the first unblocked one, so the choice is stable and
    reproducible (never depends on unspecified DB row order, which could
    silently flip which agent sees the order between two identical
    requests). Chosen rule, documented here as the single source of truth:
    the product with the lexicographically smallest product_id among the
    order's items decides ownership. This is an arbitrary but STABLE
    tie-break — callers needing this exact same decision for bulk list/count
    queries (app/api/v1/orders.py) replicate it in SQL with the identical
    ORDER BY target_id ASC LIMIT 1, so a single order's access check and a
    list query never disagree about who owns it.
    """
    from app.models.assignment_rule import AssignmentRule, RULE_TYPE_PRIORITY
    from app.models.product import Product

    order_pids = list(order_product_ids or [])

    category_ids: list = []
    brand_ids: list = []
    if order_pids:
        rows = (
            db.query(Product.category, Product.brand)
            .filter(Product.id.in_(order_pids))
            .all()
        )
        category_ids = list({r[0] for r in rows if r[0]})
        brand_ids = list({r[1] for r in rows if r[1]})

    target_map = {
        "PRODUCT": order_pids,
        "STORE": [store_id] if store_id else [],
        "CATEGORY": category_ids,
        "BRAND": brand_ids,
    }

    for idx, rule_type in enumerate(RULE_TYPE_PRIORITY):
        targets = target_map.get(rule_type) or []
        if not targets:
            continue

        positive_rules = (
            db.query(AssignmentRule)
            .filter(
                AssignmentRule.rule_type == rule_type,
                AssignmentRule.target_id.in_(targets),
                AssignmentRule.is_exclusion == False,
                AssignmentRule.is_active == True,
            )
            # Deterministic tie-break — see docstring above. Without this,
            # two rows matching different agents came back in unspecified
            # DB order, so which agent "won" for a multi-owner order could
            # differ between two otherwise-identical requests.
            .order_by(AssignmentRule.target_id.asc())
            .all()
        )
        if not positive_rules:
            continue

        more_specific_types = RULE_TYPE_PRIORITY[:idx]
        for rule in positive_rules:
            blocked = False
            for ms_type in more_specific_types:
                ms_targets = target_map.get(ms_type) or []
                if not ms_targets:
                    continue
                excluded = (
                    db.query(AssignmentRule.id)
                    .filter(
                        AssignmentRule.rule_type == ms_type,
                        AssignmentRule.target_id.in_(ms_targets),
                        AssignmentRule.agent_id == rule.agent_id,
                        AssignmentRule.is_exclusion == True,
                        AssignmentRule.is_active == True,
                    )
                    .first()
                )
                if excluded:
                    blocked = True
                    break
            if not blocked:
                logger.info(
                    "[AssignmentEngine] rule_type=%s target=%s -> agent=%s",
                    rule_type, rule.target_id, rule.agent_id,
                )
                return rule.agent_id
        # Every candidate at this level was blocked by a more-specific
        # exclusion — fall through to the next priority level rather than
        # returning None immediately, in case a lower-priority rule
        # (or the default pool) still resolves it.

    return None


def resolve_courier_rule(
    db: Session,
    wilaya: Optional[str],
    commune: Optional[str],
) -> Optional[str]:
    """
    Direct livreur auto-assignment by delivery destination (2026-07-21,
    chantier #3) — COMMUNE > WILAYA priority, same assignment_rules table
    and conflict-prevention as the confirmatrice engine
    (resolve_assignment_rule), just a different target dimension (order
    destination instead of product/store) and a different consumer:
    orders matching a configured commune/wilaya go DIRECTLY to a livreur,
    bypassing the confirmatrice workflow entirely (see _auto_assign_courier
    below) — everything else keeps the normal confirmatrice pipeline.

    No exclusion logic here (unlike resolve_assignment_rule): a courier
    rule is a hard geographic dispatch decision, not a broad ownership
    rule that needs per-item carve-outs — if a future need for "Ahmed
    covers Kouba except X" emerges, the same is_exclusion column already
    supports it without a schema change.
    """
    from app.models.assignment_rule import AssignmentRule, COURIER_RULE_TYPE_PRIORITY

    target_map = {"COMMUNE": [commune] if commune else [], "WILAYA": [wilaya] if wilaya else []}

    for rule_type in COURIER_RULE_TYPE_PRIORITY:
        targets = [t for t in (target_map.get(rule_type) or []) if t]
        if not targets:
            continue
        rule = (
            db.query(AssignmentRule)
            .filter(
                AssignmentRule.rule_type == rule_type,
                AssignmentRule.target_id.in_(targets),
                AssignmentRule.is_exclusion == False,
                AssignmentRule.is_active == True,
            )
            .first()
        )
        if rule:
            logger.info("[CourierAutoAssign] rule_type=%s target=%s -> livreur=%s", rule_type, rule.target_id, rule.agent_id)
            return rule.agent_id

    return None


def _auto_assign_courier(db: Session, wilaya: Optional[str], commune: Optional[str]) -> Optional[str]:
    """
    Wraps resolve_courier_rule with the same "must still be a real, active
    LIVREUR" guard _auto_assign applies to confirmatrice rule results —
    a deactivated/deleted/role-changed livreur's stale rule must never
    silently assign an order to someone who can no longer handle it.
    """
    agent_id = resolve_courier_rule(db, wilaya, commune)
    if not agent_id:
        return None
    livreur = db.query(User).filter(User.id == agent_id, User.role == "LIVREUR", User.is_active == True).first()
    if not livreur:
        logger.warning("[CourierAutoAssign] resolved livreur=%s but they are inactive/wrong role — order stays on the normal workflow", agent_id)
        return None
    return agent_id


def _auto_assign(
    db: Session,
    store: Store,
    order_product_ids: list | None = None,
    exclude_agent_id: str | None = None,
    force: bool = False
) -> Optional[str]:
    """
    Pick the best confirmateur for a new order.

    FIRST consults the Assignment Rule Engine (resolve_assignment_rule) —
    PRODUCT > STORE > CATEGORY > BRAND, configured via assignment_rules.
    If it resolves an agent, that agent is used directly (still subject to
    the store.assignment_active/MANUAL gate below, and the caller's
    exclude_agent_id). If no rule matches, falls through UNCHANGED to the
    specialist/store/least-loaded pool logic that existed before this
    feature — a store with zero configured rules behaves exactly as it did
    previously.

    Eligibility rules — UNION semantics, mirroring _confirmateur_scope_criterion
    in orders.py so an agent is auto-assigned exactly what she can see, and
    INDEPENDENT of the legacy assigned_store_scope flag (same rationale as
    orders.py: that flag silently made assigned_store_ids dead weight whenever
    it said "ALL", which is exactly the state an admin ends up in after adding
    products to a two-full-stores confirmatrice — she stopped being assigned
    either store's orders entirely):
      - Base: active role (CONFIRMATEUR | AGENT | AGENT_MANAGER), is_active == True
      - Product match: order contains one of the agent's assigned_product_ids
        (cross-store product specialist), OR
      - Store match: the order's store is fully hers — employee_store_id, OR
        the store is in her assigned_store_ids (if that list is non-empty).
    An agent with NEITHER a store list NOR a product list configured is never
    eligible — strict isolation: she must never become an accidental catch-all
    for stores she was never actually assigned to. Such an order stays
    unassigned until an admin configures or manually assigns it.
    """
    order_pid_set: set = set(order_product_ids) if order_product_ids else set()

    # Assignment Rule Engine FIRST — before the store.assignment_active/
    # MANUAL gate below. That gate exists to disable the generic specialist/
    # least-loaded POOL heuristic (an admin choosing "je gère les
    # assignations moi-même" for a store) — it was never meant to silently
    # ignore an admin's own EXPLICIT PRODUCT/STORE/CATEGORY/BRAND rule too.
    # Bug confirmed 2026-07-22: a store with assignment_logic=MANUAL made
    # every configured rule for that store a dead letter — the order stayed
    # unassigned, then became visible to whichever OTHER confirmatrice had
    # a broad "Toutes les boutiques" legacy scope (_confirmateur_scope_
    # criterion in orders.py), not the agent the rule explicitly named.
    # Defensive: same rollback-on-failure guard as _auto_assign_courier
    # below — a missing table/query error here must never break the
    # existing specialist/least-loaded pool this function has always run.
    try:
        rule_agent_id = resolve_assignment_rule(db, store.id, list(order_pid_set))
    except Exception as rule_err:
        db.rollback()
        logger.warning("Assignment Rule Engine failed, falling back to pool logic: %s", rule_err)
        rule_agent_id = None
    if rule_agent_id and rule_agent_id != exclude_agent_id:
        rule_agent = (
            db.query(User)
            .filter(User.id == rule_agent_id, User.is_active == True,
                     User.role.in_(["CONFIRMATEUR", "AGENT", "AGENT_MANAGER"]))
            .first()
        )
        if rule_agent:
            logger.info("[AutoAssign] resolved via Assignment Rule Engine -> agent=%s", rule_agent_id)
            return rule_agent_id
        logger.warning(
            "[AutoAssign] Assignment Rule Engine resolved agent=%s but they are inactive/wrong role — falling back to pool",
            rule_agent_id,
        )

    if not force:
        if not store.assignment_active or store.assignment_logic == "MANUAL":
            logger.info(
                "[AutoAssign] store=%s (%s) SKIPPED (no rule matched either): assignment_active=%s, logic=%s — order stays unassigned",
                store.id, getattr(store, "name", "?"), store.assignment_active, store.assignment_logic,
            )
            return None

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
        raw_stores = getattr(agent, "assigned_store_ids", None)
        agent_store_ids: list = raw_stores if isinstance(raw_stores, list) else []

        # Product side of the union
        product_match = bool(order_pid_set and agent_product_ids and order_pid_set.intersection(agent_product_ids))

        # Store side of the union — the order's store is FULLY hers.
        # No fallback when both lists are empty: an unconfigured agent is
        # never store-eligible (strict isolation, see docstring above).
        store_match = False
        if getattr(agent, "employee_store_id", None) == store.id:
            store_match = True
        elif agent_store_ids:
            store_match = store.id in agent_store_ids

        if product_match:
            specialists.append(agent)
        elif store_match:
            store_agents.append(agent)

        logger.info(
            "[AutoAssign] eval agent=%s boutiques_assignees=%s nb_produits=%d employee_store=%s → product_match=%s store_match=%s verdict=%s (order store=%s)",
            getattr(agent, "email", agent.id), agent_store_ids, len(agent_product_ids),
            getattr(agent, "employee_store_id", None), product_match, store_match,
            "SPECIALIST" if product_match else ("STORE" if store_match else "REJETÉ"),
            store.id,
        )

    # Prioritize specialists if any match
    eligible = specialists if specialists else store_agents

    if not eligible:
        logger.info(
            "[AutoAssign] store=%s (%s): AUCUN agent éligible parmi %d actifs — commande non assignée",
            store.id, getattr(store, "name", "?"), len(all_agents),
        )
        return None
    logger.info(
        "[AutoAssign] store=%s: %d spécialiste(s), %d agent(s) boutique → pool=%s, logique=%s",
        store.id, len(specialists), len(store_agents),
        "SPECIALISTES" if specialists else "BOUTIQUE", store.assignment_logic,
    )

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
        logger.info("[AutoAssign] LEAST_LOADED → agent=%s (charges=%s)", loads[0][1], loads)
        return loads[0][1]

    return None


def snapshot_commission(db: Session, order: Order, agent_id: Optional[str]) -> None:
    """
    Commission historique figée (2026-07-21) — appelée à CHAQUE écriture de
    order.assigned_to (création OU réassignation manuelle), jamais ailleurs.
    Copie les réglages de paie ACTUELS de l'agent sur la commande elle-même
    : un changement ultérieur de son taux/type de paiement ne modifie plus
    jamais les commissions déjà figées ici (voir compute_salary dans
    salary_service.py, qui lit ces colonnes en priorité sur les réglages
    live de l'employé).

    agent_id=None efface le snapshot (commande désassignée) — cohérent
    avec le fait qu'une commande sans agent ne génère aucune commission.
    """
    if not agent_id:
        order.commission_agent_id = None
        order.commission_payment_type = None
        order.commission_payment_amount = None
        order.commission_recovered_rate = None
        order.commission_lost_rate = None
        order.commission_upsell_rate = None
        order.commission_snapshot_at = None
        return

    agent = db.query(User).filter(User.id == agent_id).first()
    if not agent:
        return

    order.commission_agent_id = agent_id
    order.commission_payment_type = agent.payment_type
    order.commission_payment_amount = agent.payment_amount
    order.commission_recovered_rate = getattr(agent, "payment_recovered_cart", 0) or 0
    order.commission_lost_rate = getattr(agent, "payment_lost_cart", 0) or 0
    order.commission_upsell_rate = getattr(agent, "payment_upsell", 0) or 0
    order.commission_snapshot_at = datetime.now(timezone.utc).replace(tzinfo=None)


# ─── Order Event Logger ────────────────────────────────────────────────────────

def _log_event(
    db: Session,
    *,
    order_id: str,
    actor_id: Optional[str] = None,
    actor_role: Optional[str] = None,
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
        actor_role=actor_role,
        from_status=from_status,
        to_status=to_status,
        note=note,
        call_result=call_result,
        call_attempt=call_attempt,
    )
    db.add(event)

    # Mirror into the generic cross-entity audit trail ("Fil d'activité" /
    # Team Activity) so order actions show up in the same searchable-by-
    # profile/date feed as every other tracked action (stock, users,
    # landing pages, ...) — this was the actual reported gap: OrderEvent
    # already recorded everything correctly, it just never reached that
    # feed because nothing wrote there for orders. store_id is looked up
    # directly from the order row rather than trusted from the ambient
    # tenant context var, which can legitimately differ from this specific
    # order's real store and would silently mis-file the log entry.
    try:
        order_store_id = db.query(Order.store_id).filter(Order.id == order_id).scalar()
        audit_service.record_change(
            db,
            actor_id=actor_id,
            entity_name="Order",
            entity_id=order_id,
            action="CREATE" if from_status is None else "STATUS_CHANGE",
            before={"status": from_status} if from_status is not None else None,
            after={"status": to_status, "note": note, "call_result": call_result},
            store_id=order_store_id,
        )
    except Exception:
        logger.warning("Audit trail mirror failed for order %s", order_id, exc_info=True)


def expand_combined_variant_items(items_data: List[dict]) -> List[dict]:
    """
    Split a single cart/order line that packs several distinct variant
    selections into one combined string (built by the storefront's
    dz-cod-renderer / landing-page-renderer as e.g.
    "P1: Couleur: Vert, Taille: XL | P2: Couleur: Bleu Nuit, Taille: XL"
    when a buyer picks more than one variant of the same product) into one
    line PER variant, each with its own quantity.

    Without this, a single OrderItem represents units of two DIFFERENT
    variants under one variant_details.variant string. Every stock
    operation (reserve/confirm/release/restock) matches that string against
    ONE product variant via _find_matching_variant's token search, so the
    whole item's quantity gets attributed to whichever variant matches
    first while the other variant's stock/reserved count silently drifts
    out of sync with what the order actually holds — the exact class of
    bug behind "the UI shows it available, saving says insufficient".

    Called both at order creation and whenever an order's items are
    rewritten (PATCH /info, merge absorption) so a combined line can never
    reach reserve_stock/confirm_stock/release_reservation as one unit.
    """
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
                    "sku": item.get("sku"),
                })
        else:
            expanded_items.append(item)
    return expanded_items


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

        # Courier auto-assignment by destination (chantier #3, 2026-07-21) —
        # checked FIRST, before any confirmatrice logic: a commune/wilaya
        # explicitly configured for a livreur goes directly to them,
        # bypassing the confirmatrice workflow entirely (assigned_to stays
        # unset). Everything else continues the normal pipeline below,
        # unchanged.
        #
        # Defensive: this is a NEW, non-critical feature bolted onto the
        # most critical path in the whole app (order creation) — a missing
        # table (migration not yet applied in some environment) or any
        # other query failure here must NEVER take down real order
        # creation. rollback() is required, not optional: a failed query
        # leaves the session's transaction aborted, so every subsequent
        # query in this same request (stock reservation, the order INSERT
        # itself) would also fail without it.
        try:
            resolved_courier_id = _auto_assign_courier(
                db, order_data.get("customer_wilaya"), order_data.get("customer_commune"),
            )
        except Exception as courier_err:
            db.rollback()
            logger.warning("Courier auto-assignment failed, continuing without it: %s", courier_err)
            resolved_courier_id = None

        # If the creator (actor) is a CONFIRMATEUR (confirmation agent), force the assignment to them.
        creator_confirmatrice = None
        if actor_id and not resolved_courier_id:
            from app.models.user import User
            creator_confirmatrice = db.query(User).filter(User.id == actor_id, User.role == "CONFIRMATEUR").first()

        if resolved_courier_id:
            order_data.pop("assigned_to", None)
            explicit_agent = None
        elif creator_confirmatrice:
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
            livreur_id=resolved_courier_id,
            **{k: v for k, v in order_data.items() if k not in ("assigned_to", "livreur_id")},
        )
        db.add(order)
        db.flush()  # Get ID without committing
        snapshot_commission(db, order, explicit_agent)

        # Expand combined variants if any (e.g. "P1: Couleur: Noir | P2: Couleur: Bordeaux")
        items_data = expand_combined_variant_items(items_data)

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

        # NOTE: auto_merge_duplicates is deliberately NOT called here.
        # create_order's sole caller (POST /orders in orders.py) already runs
        # it synchronously — and commits — BEFORE enqueueing this order's
        # Purchase CAPI event, which is what actually needs the merge
        # decision made first. Duplicating that call here would just re-run
        # the same query a second time for no behavioral difference.
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
        actor_name: str | None = None,
        actor_role: str | None = None,
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
        
        # Persist notes on the order model if provided. Full per-actor history
        # already lives in the OrderEvent log (_log_event below, surfaced via
        # GET /orders/{id}/events and OrderTraceabilityPanel) — this field is
        # just the "at a glance" note shown in the row. Prefixing with the
        # actor's role means a confirmatrice's note and a livreur's delivery
        # note are each clearly attributed instead of one silently replacing
        # the other with no indication of who left it.
        #
        # System-triggered updates (actor_id is None — Noest auto-sync,
        # scheduled jobs) must NOT touch this field: it used to overwrite
        # whatever internal note a confirmatrice had written for the order
        # with "Synchronisation automatique Noest : DELIVERED." every time
        # the background sync ran, silently erasing her note. The status
        # change itself is still fully recorded in the OrderEvent timeline
        # below regardless — only the always-visible "at a glance" note is
        # protected from system overwrites.
        if order_note and actor_id is not None:
            role_labels = {
                "CONFIRMATEUR": "Confirmatrice",
                "LIVREUR": "Livreur",
                "MANAGER": "Manager",
                "ADMIN": "Admin",
                "SUPER_ADMIN": "Admin",
            }
            if actor_role and actor_role in role_labels:
                tag = f"{role_labels[actor_role]} — {actor_name}" if actor_name else role_labels[actor_role]
                order.notes = f"[{tag}] {order_note}"  # type: ignore[assignment]
            else:
                order.notes = order_note  # type: ignore[assignment]

            # A confirmatrice's note used to only reach Noest at parcel
            # creation time — editing it afterwards (the common case, since
            # notes are refined during the confirmation call, often after the
            # label already exists) never made it to the carrier. Push the
            # updated note now if this order already has a Noest tracking
            # number. Best-effort: never blocks or fails the note save itself.
            if order.tracking_number:
                try:
                    from app.api.carriers.noest import push_remarque_update
                    push_remarque_update(db, order)
                except Exception as exc:
                    logger.warning("Could not push note update to Noest for order %s: %s", order.id, exc)

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
                actor_role=actor_role,
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
        if new_assignee is not None:
            old_assignee = order.assigned_to
            assignee_changed = new_assignee != old_assignee
            order.assigned_to = new_assignee
            # An explicit administrative reassignment is authoritative for
            # THIS order and must survive future Assignment Rule Engine
            # re-checks (see Order.assignment_locked / _assert_order_access)
            # — an admin handing this specific order to an agent overrides
            # even a PRODUCT rule naming someone else. Set the lock even
            # when new_assignee already equals the current assigned_to
            # (the common real case: an admin re-confirms/reasserts "this
            # order stays with her" without changing the value — she still
            # needs the lock to actually take effect, or the very next
            # access check silently re-applies the rule engine and undoes
            # her decision, which is what a purely change-gated check
            # missed). A confirmatrice's own "claim on action" (assigned_to
            # =self sent alongside a status change) does NOT lock: the rule
            # engine must stay free to resolve the order to whoever it
            # names next time, unchanged from before.
            if actor_role in ("ADMIN", "SUPER_ADMIN", "MANAGER"):
                order.assignment_locked = True
            if assignee_changed:
                snapshot_commission(db, order, new_assignee)
                cur_status = str(order.status)
                _log_event(
                    db,
                    order_id=order.id,
                    actor_id=actor_id,
                    actor_role=actor_role,
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

            # Switching a shipped carrier parcel to an internal driver:
            # the NOEST tracking is no longer the source of truth for this
            # order — drop it (no orphan tracking number) and step the
            # status back to CONFIRMED so it re-enters a clean pipeline.
            # NOEST has no verified public cancel endpoint wired here yet;
            # the note flags it so ops can cancel it manually carrier-side.
            switch_note = None
            if new_livreur and order.tracking_number:
                switch_note = (
                    f"Switch transporteur → livreur interne : tracking {order.tracking_number} "
                    f"détaché (à annuler manuellement chez NOEST si déjà pris en charge)."
                )
                order.tracking_number = None
                if cur_status == "SHIPPED":
                    order.status = "CONFIRMED"
                    cur_status = "CONFIRMED"

            _log_event(
                db,
                order_id=order.id,
                actor_id=actor_id,
                actor_role=actor_role,
                from_status=cur_status,
                to_status=cur_status,
                note=switch_note or (f"Livreur assigné ({new_livreur})" if new_livreur
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
                actor_role=actor_role,
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
