"""
Regression tests (2026-07-23 staff-engineer audit): TenantMiddleware
(app/core/tenant.py) derives the "current tenant" purely from the
CLIENT-SUPPLIED X-Store-Id header — a convenience default, not a security
boundary, since the header is entirely attacker-controlled. Several
inventory/product endpoints additionally opted OUT of even that soft
default via `skip_tenant_isolation=True` and took `store_id` as a plain,
UNCHECKED query/path parameter: any authenticated confirmatrice/manager
from Store A could pass Store B's UUID and see (or, for quick_update_stock,
MUTATE) Store B's inventory.

Fixed via app/core/store_access.py (assert_store_access /
user_accessible_store_ids), applied across every stock.py/products.py
endpoint that scopes itself to one store. These tests hit the real routes
end-to-end (not just the helper in isolation) to prove the boundary
actually holds at the HTTP layer.

LIVREUR is deliberately excluded from the isolation check (unrestricted,
same as ADMIN) — pre-existing, documented design: one delivery agent
serves every store in this deployment (see app/api/v1/products.py:26 and
stock.py's manual-movement endpoint comment). A regression here would
silently break every livreur's ability to do their job.
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
from app.models.stock import StockMovement
from app.models.user import User

client = TestClient(app)


class Scenario:
    def __init__(self):
        self.suffix = str(uuid.uuid4())[:8]
        self.store_ids = []
        self.product_ids = []
        self.user_ids = []

    def make_store(self, label):
        db = SessionLocal()
        try:
            store = Store(
                id=str(uuid.uuid4()), name=f"{label} {self.suffix}",
                slug=f"{label.lower()}-{self.suffix}-{uuid.uuid4().hex[:4]}",
                domain=f"{label.lower()}-{self.suffix}-{uuid.uuid4().hex[:4]}.com",
                template_id="modern", owner_id="SYSTEM_ADMIN",
            )
            db.add(store)
            db.commit()
            self.store_ids.append(store.id)
            return store.id
        finally:
            db.close()

    def make_product(self, store_id, stock=20):
        db = SessionLocal()
        try:
            product = Product(
                id=str(uuid.uuid4()), store_id=store_id, name=f"Prod {self.suffix}",
                slug=f"prod-{self.suffix}-{uuid.uuid4().hex[:4]}", description="x",
                price=1000, stock=stock, category="General",
                sku=f"SKU-ISO-{self.suffix}-{uuid.uuid4().hex[:4]}", is_active=True,
            )
            db.add(product)
            db.commit()
            self.product_ids.append(product.id)
            return product.id
        finally:
            db.close()

    def make_employee(self, label, role, employee_store_id=None):
        db = SessionLocal()
        try:
            email = f"{label}-{self.suffix}@test.com"
            user = User(
                id=str(uuid.uuid4()), email=email, name=label,
                hashed_password=get_password_hash("test-only-password"), role=role,
                employee_store_id=employee_store_id, is_active=True,
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

    def cleanup(self):
        db = SessionLocal()
        try:
            if self.product_ids:
                db.query(StockMovement).filter(StockMovement.product_id.in_(self.product_ids)).delete(synchronize_session=False)
                db.query(Product).filter(Product.id.in_(self.product_ids)).delete(synchronize_session=False)
            if self.user_ids:
                db.query(User).filter(User.id.in_(self.user_ids)).delete(synchronize_session=False)
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


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ─── 1. Store-wide inventory dashboards reject a manager from another store ──

@pytest.mark.parametrize("path", [
    "/stock/dashboard", "/stock/discrepancies", "/stock/alerts-engine",
    "/stock/livreurs", "/stock/lots", "/stock/returns-by-variant", "/stock/summary",
])
def test_manager_of_store_a_cannot_read_store_b_inventory(scenario, path):
    store_a = scenario.make_store("StoreA")
    store_b = scenario.make_store("StoreB")
    _, email_a = scenario.make_employee("mgr-a", "MANAGER", employee_store_id=store_a)
    token_a = scenario.login(email_a)

    res = client.get(f"{settings.API_V1_STR}{path}", params={"store_id": store_b}, headers=_auth(token_a))
    assert res.status_code == 403, f"{path}: expected 403, got {res.status_code}: {res.text}"

    # Sanity: the SAME manager can access her own store fine.
    res_own = client.get(f"{settings.API_V1_STR}{path}", params={"store_id": store_a}, headers=_auth(token_a))
    assert res_own.status_code == 200, f"{path} (own store): {res_own.text}"


def test_confirmatrice_with_no_store_configured_gets_403_everywhere(scenario):
    """A product-only confirmatrice (no employee_store_id, no
    assigned_store_ids) has zero whole-store inventory access — correct:
    whole-store views are a different scope than individually assigned
    products."""
    store_a = scenario.make_store("NoScope")
    _, email = scenario.make_employee("noscope-conf", "CONFIRMATEUR")
    token = scenario.login(email)

    res = client.get(f"{settings.API_V1_STR}/stock/dashboard", params={"store_id": store_a}, headers=_auth(token))
    assert res.status_code == 403


# ─── 2. Unscoped calls (no store_id) restrict to accessible stores, not everyone's ──

def test_unscoped_movement_list_never_returns_another_stores_movements(scenario):
    store_a = scenario.make_store("UnscopedA")
    store_b = scenario.make_store("UnscopedB")
    product_b = scenario.make_product(store_b)
    _, email_a = scenario.make_employee("unscoped-mgr", "MANAGER", employee_store_id=store_a)
    token_a = scenario.login(email_a)

    # Create a movement in store B (as an admin-only action would) directly via DB.
    from app.models.stock import StockMovement
    db = SessionLocal()
    try:
        db.add(StockMovement(id=str(uuid.uuid4()), product_id=product_b, type="RESTOCK", quantity=5, reason="seed"))
        db.commit()
    finally:
        db.close()

    res = client.get(f"{settings.API_V1_STR}/stock/", params={"pageSize": 100}, headers=_auth(token_a))
    assert res.status_code == 200, res.text
    returned_product_ids = {m["product_id"] for m in res.json()["data"]}
    assert product_b not in returned_product_ids


def test_unscoped_alerts_never_returns_another_stores_products(scenario):
    store_a = scenario.make_store("AlertsA")
    store_b = scenario.make_store("AlertsB")
    scenario.make_product(store_b, stock=0)  # would trigger an OUT alert
    _, email_a = scenario.make_employee("alerts-mgr", "MANAGER", employee_store_id=store_a)
    token_a = scenario.login(email_a)

    res = client.get(f"{settings.API_V1_STR}/stock/alerts", headers=_auth(token_a))
    assert res.status_code == 200, res.text
    returned_store_ids = {row["store_id"] for row in res.json()["data"]}
    assert store_b not in returned_store_ids


# ─── 3. quick_update_stock (WRITE) — the most severe finding: cross-store mutation ──

def test_manager_cannot_quick_update_another_stores_product_stock(scenario):
    store_a = scenario.make_store("WriteA")
    store_b = scenario.make_store("WriteB")
    product_b = scenario.make_product(store_b, stock=10)
    _, email_a = scenario.make_employee("write-mgr", "MANAGER", employee_store_id=store_a)
    token_a = scenario.login(email_a)

    res = client.patch(
        f"{settings.API_V1_STR}/products/{product_b}/stock",
        json={"stock": 999}, headers=_auth(token_a),
    )
    assert res.status_code == 403, res.text

    db = SessionLocal()
    try:
        product = db.query(Product).filter(Product.id == product_b).first()
        assert product.stock == 10  # unchanged
    finally:
        db.close()


def test_manager_can_quick_update_her_own_stores_product_stock(scenario):
    store_a = scenario.make_store("WriteOwnA")
    product_a = scenario.make_product(store_a, stock=10)
    _, email_a = scenario.make_employee("write-own-mgr", "MANAGER", employee_store_id=store_a)
    token_a = scenario.login(email_a)

    res = client.patch(
        f"{settings.API_V1_STR}/products/{product_a}/stock",
        json={"stock": 42}, headers=_auth(token_a),
    )
    assert res.status_code == 200, res.text

    db = SessionLocal()
    try:
        product = db.query(Product).filter(Product.id == product_a).first()
        assert product.stock == 42
    finally:
        db.close()


# ─── 4. LIVREUR retains cross-store access (documented, intentional design) ──

def test_livreur_retains_cross_store_read_access_by_design(scenario):
    store_a = scenario.make_store("LivreurA")
    store_b = scenario.make_store("LivreurB")
    _, email = scenario.make_employee("livreur-x", "LIVREUR", employee_store_id=store_a)
    token = scenario.login(email)

    res = client.get(f"{settings.API_V1_STR}/stock/dashboard", params={"store_id": store_b}, headers=_auth(token))
    assert res.status_code == 200, (
        "LIVREUR must keep cross-store visibility (one delivery agent serves "
        f"every store) — got {res.status_code}: {res.text}"
    )


def test_livreur_can_quick_update_stock_in_a_different_store(scenario):
    store_a = scenario.make_store("LivreurWriteA")
    store_b = scenario.make_store("LivreurWriteB")
    product_b = scenario.make_product(store_b, stock=5)
    _, email = scenario.make_employee("livreur-writer", "LIVREUR", employee_store_id=store_a)
    token = scenario.login(email)

    res = client.patch(
        f"{settings.API_V1_STR}/products/{product_b}/stock",
        json={"stock": 7}, headers=_auth(token),
    )
    assert res.status_code == 200, res.text


# ─── 5. Admin/super-admin remain fully unrestricted ──────────────────────────

def test_super_admin_is_unrestricted_across_stores(scenario):
    store_a = scenario.make_store("AdminA")
    store_b = scenario.make_store("AdminB")
    _, email = scenario.make_employee("super-x", "SUPER_ADMIN")
    token = scenario.login(email)

    for store_id in (store_a, store_b):
        res = client.get(f"{settings.API_V1_STR}/stock/dashboard", params={"store_id": store_id}, headers=_auth(token))
        assert res.status_code == 200, res.text


# ─── 6. Per-product analytics/breakdown also enforce store ownership ────────

def test_product_analytics_rejects_a_store_id_the_product_does_not_belong_to(scenario):
    store_a = scenario.make_store("AnalyticsA")
    store_b = scenario.make_store("AnalyticsB")
    product_a = scenario.make_product(store_a)
    _, email_b = scenario.make_employee("analytics-mgr-b", "MANAGER", employee_store_id=store_b)
    token_b = scenario.login(email_b)

    res = client.get(
        f"{settings.API_V1_STR}/products/{product_a}/analytics",
        params={"store_id": store_a}, headers=_auth(token_b),
    )
    assert res.status_code == 403, res.text


def test_product_stock_breakdown_rejects_a_product_from_another_store(scenario):
    store_a = scenario.make_store("BreakdownA")
    store_b = scenario.make_store("BreakdownB")
    product_b = scenario.make_product(store_b)
    _, email_a = scenario.make_employee("breakdown-mgr-a", "MANAGER", employee_store_id=store_a)
    token_a = scenario.login(email_a)

    res = client.get(
        f"{settings.API_V1_STR}/stock/product/{product_b}/breakdown",
        headers=_auth(token_a),
    )
    assert res.status_code == 403, res.text
