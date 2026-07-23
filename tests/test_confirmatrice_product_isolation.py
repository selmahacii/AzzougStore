"""
Regression tests (2026-07-23): a product assigned to one confirmatrice must
be invisible to every other confirmatrice, in every surface that lists
orders (dashboard queue, sidebar counters, search/filters — all backed by
the same list_orders/get_agent_counts queries — and the single-order
GET/PATCH access check).

Two ownership signals exist in this codebase and BOTH must be exclusive:
  1. The formal `assignment_rules` table (PRODUCT/STORE rows, configured
     from the admin's "Règles d'Assignation" tab) — has a real DB
     constraint preventing two agents from both owning the same target.
  2. The informal per-employee `User.assigned_product_ids` list (configured
     straight from the employee edit form) — no DB constraint, and until
     this fix, completely unenforced against another confirmatrice's
     broader store-wide scope.

Root cause fixed: `Order.assigned_to` is only ever a snapshot, stamped once
at creation/auto-assign time. Rules can be created or products assigned to
someone else AFTER that snapshot — the fix makes both ownership signals
ALWAYS win over a stale assigned_to or an overlapping legacy scope, in both
the SQL list/count queries and the single-order Python access check
(app/api/v1/orders.py: _confirmateur_ownership_criterion,
_assignment_rule_resolved_owner_criterion, _legacy_products_claimed_by_others,
_assert_order_access).

Uses the real configured DB via SessionLocal + TestClient (same pattern as
test_assignment_rule_manual_store_bug.py) since the bug lives in SQL-level
query scoping that an in-memory SQLite fixture without the full schema
can't exercise faithfully.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings
from app.core.security import get_password_hash
from app.db.session import SessionLocal
from app.models.store import Store
from app.models.product import Product
from app.models.user import User
from app.models.order import Order, OrderItem
from app.models.events import OrderEvent
from app.models.notification import Notification
from app.models.stock import StockMovement
from app.models.audit import AuditLog
from app.models.customer import Customer
from app.models.assignment_rule import AssignmentRule
from app.services.order_service import order_service, resolve_assignment_rule


client = TestClient(app)


class Scenario:
    """
    Tracks everything created during one test so teardown can clean up
    unconditionally (mirrors test_assignment_rule_manual_store_bug.py's
    finally-block pattern, factored out so each test stays short).
    """

    def __init__(self):
        self.suffix = str(uuid.uuid4())[:8]
        self.store_ids = []
        self.product_ids = []
        self.user_ids = []
        self.order_ids = []
        self.rule_ids = []

    def make_store(self, name="Store"):
        db = SessionLocal()
        try:
            store = Store(
                id=str(uuid.uuid4()), name=f"{name} {self.suffix}",
                slug=f"{name.lower().replace(' ', '-')}-{self.suffix}-{uuid.uuid4().hex[:4]}",
                domain=f"{name.lower().replace(' ', '-')}-{self.suffix}-{uuid.uuid4().hex[:4]}.com",
                template_id="modern", owner_id="SYSTEM_ADMIN",
            )
            db.add(store)
            db.commit()
            self.store_ids.append(store.id)
            return store.id
        finally:
            db.close()

    def make_product(self, store_id, name="Product"):
        db = SessionLocal()
        try:
            product = Product(
                id=str(uuid.uuid4()), store_id=store_id, name=f"{name} {self.suffix}",
                slug=f"{name.lower().replace(' ', '-')}-{self.suffix}-{uuid.uuid4().hex[:4]}",
                description="x", price=1000, stock=50, category="General",
                sku=f"SKU-{self.suffix}-{uuid.uuid4().hex[:4]}", is_active=True,
            )
            db.add(product)
            db.commit()
            self.product_ids.append(product.id)
            return product.id
        finally:
            db.close()

    def make_confirmatrice(self, label, employee_store_id=None, assigned_store_ids=None, assigned_product_ids=None):
        db = SessionLocal()
        try:
            email = f"{label}-{self.suffix}@test.com"
            user = User(
                id=str(uuid.uuid4()), email=email, name=label,
                hashed_password=get_password_hash("test-only-password"), role="CONFIRMATEUR",
                employee_store_id=employee_store_id,
                assigned_store_ids=assigned_store_ids or [],
                assigned_product_ids=assigned_product_ids or [],
                is_active=True,
            )
            db.add(user)
            db.commit()
            self.user_ids.append(user.id)
            return user.id, email
        finally:
            db.close()

    def login(self, email):
        res = client.post(
            f"{settings.API_V1_STR}/auth/login/access-token",
            data={"username": email, "password": "test-only-password"},
        )
        assert res.status_code == 200, res.text
        return res.json()["access_token"]

    def make_order(self, store_id, items):
        """items: list of (product_id, product_name, quantity, unit_price)."""
        db = SessionLocal()
        try:
            order = order_service.create_order(
                db,
                order_data=dict(
                    store_id=store_id, customer_name="Client Test",
                    customer_phone="0550" + uuid.uuid4().hex[:6],
                    customer_address="Adresse test", customer_wilaya="Alger",
                    delivery_type="HOME", delivery_fee=0,
                    subtotal=sum(q * p for _, _, q, p in items),
                    discount=0, total=sum(q * p for _, _, q, p in items),
                    source="landing_page",
                ),
                items_data=[
                    {"product_id": pid, "product_name": name, "quantity": q, "unit_price": p}
                    for pid, name, q, p in items
                ],
                actor_id=None,
            )
            db.commit()
            db.refresh(order)
            self.order_ids.append(order.id)
            return order.id, order.assigned_to
        finally:
            db.close()

    def add_rule(self, rule_type, target_id, agent_id, is_exclusion=False):
        db = SessionLocal()
        try:
            rule = AssignmentRule(
                id=str(uuid.uuid4()), rule_type=rule_type, target_id=target_id,
                agent_id=agent_id, is_exclusion=is_exclusion, is_active=True,
            )
            db.add(rule)
            db.commit()
            self.rule_ids.append(rule.id)
            return rule.id
        finally:
            db.close()

    def force_assigned_to(self, order_id, agent_id):
        """Simulate a stale snapshot: stamp assigned_to directly, bypassing the rule engine — as if auto-assign ran before any rule existed."""
        db = SessionLocal()
        try:
            db.query(Order).filter(Order.id == order_id).update({"assigned_to": agent_id})
            db.commit()
        finally:
            db.close()

    def cleanup(self):
        db = SessionLocal()
        try:
            for oid in self.order_ids:
                db.query(OrderEvent).filter(OrderEvent.order_id == oid).delete()
                db.query(Notification).filter(Notification.order_id == oid).delete()
                db.query(StockMovement).filter(StockMovement.order_id == oid).delete()
                db.query(OrderItem).filter(OrderItem.order_id == oid).delete()
            if self.order_ids:
                db.query(Order).filter(Order.id.in_(self.order_ids)).delete(synchronize_session=False)
            if self.rule_ids:
                db.query(AssignmentRule).filter(AssignmentRule.id.in_(self.rule_ids)).delete(synchronize_session=False)
            if self.user_ids:
                db.query(AuditLog).filter(AuditLog.actor_id.in_(self.user_ids)).delete(synchronize_session=False)
            for sid in self.store_ids:
                db.query(AuditLog).filter(AuditLog.store_id == sid).delete(synchronize_session=False)
                db.query(Customer).filter(Customer.store_id == sid).delete(synchronize_session=False)
            if self.user_ids:
                db.query(User).filter(User.id.in_(self.user_ids)).delete(synchronize_session=False)
            if self.product_ids:
                db.query(Product).filter(Product.id.in_(self.product_ids)).delete(synchronize_session=False)
            if self.store_ids:
                db.query(Store).filter(Store.id.in_(self.store_ids)).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()


@pytest.fixture()
def scenario():
    s = Scenario()
    yield s
    s.cleanup()


def _order_ids_visible_to(token):
    res = client.get(f"{settings.API_V1_STR}/orders?pageSize=200", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    return {o["id"] for o in res.json()["data"]}


def _can_access_order(token, order_id):
    res = client.get(f"{settings.API_V1_STR}/orders/{order_id}", headers={"Authorization": f"Bearer {token}"})
    return res.status_code


# ─── 1. Whole-store confirmatrice sees every product's orders ───────────────

def test_store_wide_confirmatrice_sees_all_products_orders(scenario):
    store_id = scenario.make_store("StoreWide")
    p1 = scenario.make_product(store_id, "P1")
    p2 = scenario.make_product(store_id, "P2")
    _, email = scenario.make_confirmatrice("storewide", employee_store_id=store_id)
    order1_id, _ = scenario.make_order(store_id, [(p1, "P1", 1, 1000)])
    order2_id, _ = scenario.make_order(store_id, [(p2, "P2", 1, 1000)])

    token = scenario.login(email)
    visible = _order_ids_visible_to(token)
    assert {order1_id, order2_id} <= visible


# ─── 2. Product-only confirmatrice sees only orders with her product(s) ─────

def test_product_only_confirmatrice_sees_only_her_products(scenario):
    store_id = scenario.make_store("ProdOnly")
    hers = scenario.make_product(store_id, "Hers")
    other = scenario.make_product(store_id, "Other")
    agent_id, email = scenario.make_confirmatrice("prodonly", assigned_product_ids=None)
    scenario.add_rule("PRODUCT", hers, agent_id)

    her_order_id, her_assigned = scenario.make_order(store_id, [(hers, "Hers", 1, 1000)])
    other_order_id, _ = scenario.make_order(store_id, [(other, "Other", 1, 1000)])

    assert her_assigned == agent_id  # auto-assigned via the PRODUCT rule

    token = scenario.login(email)
    visible = _order_ids_visible_to(token)
    assert her_order_id in visible
    assert other_order_id not in visible


# ─── 3. Hybrid: whole Store A + specific products of Store B/C ──────────────

def test_hybrid_full_store_plus_specific_products_elsewhere(scenario):
    store_a = scenario.make_store("HybridA")
    store_b = scenario.make_store("HybridB")
    store_c = scenario.make_store("HybridC")
    a_product = scenario.make_product(store_a, "AProd")
    b_product_x = scenario.make_product(store_b, "BX")
    b_product_other = scenario.make_product(store_b, "BOther")
    c_product_z = scenario.make_product(store_c, "CZ")

    agent_id, email = scenario.make_confirmatrice(
        "hybrid", employee_store_id=store_a, assigned_product_ids=[b_product_x, c_product_z],
    )

    order_a, _ = scenario.make_order(store_a, [(a_product, "AProd", 1, 1000)])
    order_bx, _ = scenario.make_order(store_b, [(b_product_x, "BX", 1, 1000)])
    order_b_other, _ = scenario.make_order(store_b, [(b_product_other, "BOther", 1, 1000)])
    order_cz, _ = scenario.make_order(store_c, [(c_product_z, "CZ", 1, 1000)])

    token = scenario.login(email)
    visible = _order_ids_visible_to(token)
    assert order_a in visible          # whole Store A
    assert order_bx in visible         # specific product in Store B
    assert order_cz in visible         # specific product in Store C
    assert order_b_other not in visible  # NOT the rest of Store B


# ─── 4. Multiple confirmatrices, different products, same store ─────────────

def test_multiple_confirmatrices_different_products_same_store_are_isolated(scenario):
    store_id = scenario.make_store("MultiAgent")
    product_a = scenario.make_product(store_id, "ForA")
    product_b = scenario.make_product(store_id, "ForB")
    agent_a, email_a = scenario.make_confirmatrice("multi-a")
    agent_b, email_b = scenario.make_confirmatrice("multi-b")
    scenario.add_rule("PRODUCT", product_a, agent_a)
    scenario.add_rule("PRODUCT", product_b, agent_b)

    order_a, assigned_a = scenario.make_order(store_id, [(product_a, "ForA", 1, 1000)])
    order_b, assigned_b = scenario.make_order(store_id, [(product_b, "ForB", 1, 1000)])
    assert assigned_a == agent_a
    assert assigned_b == agent_b

    token_a = scenario.login(email_a)
    token_b = scenario.login(email_b)

    visible_a = _order_ids_visible_to(token_a)
    visible_b = _order_ids_visible_to(token_b)

    assert order_a in visible_a and order_b not in visible_a
    assert order_b in visible_b and order_a not in visible_b


# ─── 5. Root cause: legacy assigned_product_ids exclusivity vs. whole-store colleague ──

def test_legacy_product_assignment_excludes_it_from_a_colleagues_whole_store_scope(scenario):
    """
    The most common real-world path: an admin assigns a product to a
    confirmatrice through the simple per-employee "produits assignés" list
    (User.assigned_product_ids) — NOT the separate "Règles d'Assignation"
    tab (assignment_rules table). A DIFFERENT confirmatrice responsible for
    the WHOLE store must not see orders containing that product anywhere:
    not in her order list, not via direct GET, not in her sidebar counters.
    """
    store_id = scenario.make_store("LegacyExcl")
    claimed_product = scenario.make_product(store_id, "Claimed")
    other_product = scenario.make_product(store_id, "Unclaimed")

    owner_id, owner_email = scenario.make_confirmatrice("legacy-owner", assigned_product_ids=[claimed_product])
    store_wide_id, store_wide_email = scenario.make_confirmatrice("legacy-storewide", employee_store_id=store_id)

    claimed_order_id, _ = scenario.make_order(store_id, [(claimed_product, "Claimed", 1, 1000)])
    other_order_id, _ = scenario.make_order(store_id, [(other_product, "Unclaimed", 1, 1000)])

    owner_token = scenario.login(owner_email)
    store_wide_token = scenario.login(store_wide_email)

    # The colleague with whole-store responsibility must NOT see the claimed order.
    store_wide_visible = _order_ids_visible_to(store_wide_token)
    assert claimed_order_id not in store_wide_visible
    assert other_order_id in store_wide_visible
    assert _can_access_order(store_wide_token, claimed_order_id) == 403

    # The product's actual owner must see it (even with no store-level scope at all).
    owner_visible = _order_ids_visible_to(owner_token)
    assert claimed_order_id in owner_visible
    assert _can_access_order(owner_token, claimed_order_id) == 200


# ─── 6. Root cause: a stale Order.assigned_to must not survive a later rule ──

def test_stale_assigned_to_loses_to_a_rule_created_after_order_creation(scenario):
    """
    Order gets auto-assigned to B (broad legacy scope, no rule exists yet).
    An admin THEN creates a PRODUCT rule handing that exact product to A.
    B must immediately lose visibility/access; A must gain it — even though
    Order.assigned_to is still literally B's id (never re-stamped).
    """
    store_id = scenario.make_store("StaleAssign")
    product_id = scenario.make_product(store_id, "StaleProd")
    agent_b, email_b = scenario.make_confirmatrice("stale-b", employee_store_id=store_id)
    agent_a, email_a = scenario.make_confirmatrice("stale-a")

    order_id, _ = scenario.make_order(store_id, [(product_id, "StaleProd", 1, 1000)])
    # Simulate the real-world snapshot: assigned_to = B, stamped before any
    # rule existed (e.g. the legacy pool logic, or a manual assignment) —
    # store.assignment_active defaults to False so auto-assign wouldn't
    # normally do this itself; force it directly to isolate the scenario.
    scenario.force_assigned_to(order_id, agent_b)

    scenario.add_rule("PRODUCT", product_id, agent_a)

    token_a = scenario.login(email_a)
    token_b = scenario.login(email_b)

    assert _can_access_order(token_b, order_id) == 403
    assert order_id not in _order_ids_visible_to(token_b)

    assert _can_access_order(token_a, order_id) == 200
    assert order_id in _order_ids_visible_to(token_a)


# ─── 7. Multi-owner order: deterministic single owner, no duplicate visibility ──

def test_order_with_products_from_two_different_owners_has_one_deterministic_owner(scenario):
    """
    A single order contains two products, each PRODUCT-rule-assigned to a
    DIFFERENT confirmatrice. Exactly one of them must see/manage it — never
    both, never neither. The documented tie-break (resolve_assignment_rule):
    the product with the lexicographically smallest product_id decides
    ownership. Verified indirectly here (whichever product sorts first) and
    directly at the unit level in test_deterministic_owner_tiebreak_is_stable.
    """
    store_id = scenario.make_store("MultiOwnerOrder")
    product_1 = scenario.make_product(store_id, "One")
    product_2 = scenario.make_product(store_id, "Two")
    agent_1, email_1 = scenario.make_confirmatrice("owner-1")
    agent_2, email_2 = scenario.make_confirmatrice("owner-2")
    scenario.add_rule("PRODUCT", product_1, agent_1)
    scenario.add_rule("PRODUCT", product_2, agent_2)

    order_id, _ = scenario.make_order(
        store_id, [(product_1, "One", 1, 1000), (product_2, "Two", 1, 1000)],
    )

    winner = min(product_1, product_2)
    expected_email = email_1 if winner == product_1 else email_2
    loser_email = email_2 if winner == product_1 else email_1

    winner_token = scenario.login(expected_email)
    loser_token = scenario.login(loser_email)

    assert _can_access_order(winner_token, order_id) == 200
    assert _can_access_order(loser_token, order_id) == 403
    assert order_id in _order_ids_visible_to(winner_token)
    assert order_id not in _order_ids_visible_to(loser_token)


# ─── 8. Unassigned fallback: nobody with zero configured scope sees it ───────

def test_fully_unconfigured_confirmatrice_sees_nothing_by_default(scenario):
    store_id = scenario.make_store("Fallback")
    product_id = scenario.make_product(store_id, "FallbackProd")
    _, email = scenario.make_confirmatrice("fallback-none")  # no store, no product configured
    order_id, _ = scenario.make_order(store_id, [(product_id, "FallbackProd", 1, 1000)])

    token = scenario.login(email)
    assert order_id not in _order_ids_visible_to(token)
    assert _can_access_order(token, order_id) == 403


# ─── 9. Deterministic tie-break is a pure function of product_id, not row order ──

def test_deterministic_owner_tiebreak_is_stable_across_repeated_calls(scenario):
    """
    Two PRODUCT rules for the same order's items, naming two different
    agents — resolve_assignment_rule must return the SAME agent every time,
    regardless of DB row insertion/return order (previously unspecified).
    """
    store_id = scenario.make_store("Tiebreak")
    product_1 = scenario.make_product(store_id, "TB1")
    product_2 = scenario.make_product(store_id, "TB2")
    agent_1, _ = scenario.make_confirmatrice("tb-1")
    agent_2, _ = scenario.make_confirmatrice("tb-2")
    scenario.add_rule("PRODUCT", product_1, agent_1)
    scenario.add_rule("PRODUCT", product_2, agent_2)

    expected = agent_1 if min(product_1, product_2) == product_1 else agent_2

    db = SessionLocal()
    try:
        for _ in range(5):
            resolved = resolve_assignment_rule(db, store_id, [product_1, product_2])
            assert resolved == expected
            resolved_reversed = resolve_assignment_rule(db, store_id, [product_2, product_1])
            assert resolved_reversed == expected
    finally:
        db.close()
