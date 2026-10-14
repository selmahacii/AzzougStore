"""
Regression tests (2026-07-23 inventory/product audit): four routes used to
mutate Product.stock directly instead of going through InventoryService —
POS sales, purchase-voucher reception, and two spots in supplier returns.
For a NON-variant product that's harmless (there's nothing else to drift
from); for a VARIANT product it silently corrupted data: the aggregate
Product.stock was changed but the matching entry inside Product.variants
was not, so the next InventoryService call for that product (e.g. a
storefront order reserving stock) recomputed Product.stock by re-summing
variant sub-stocks (_update_product_stock_from_variants) and overwrote the
POS/purchase/return adjustment as if it never happened.

Also covers the low-stock/out-of-stock/overstock classification, which used
to be independently re-implemented in 4 places in app/api/v1/stock.py — two
of them compared raw Product.stock (ignoring reservations and variants
entirely) while the other two used the reservation- and variant-aware
calculation, so the SAME product could show different status on different
dashboard tabs. Unified behind product_stock_status()/product_available_stock()
in app/services/inventory_service.py.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from app.db.session import SessionLocal
from app.core.security import get_password_hash
from app.models.store import Store
from app.models.product import Product
from app.models.stock import StockMovement
from app.models.supplier import Supplier
from app.models.warehouse import Warehouse
from app.models.purchase import Purchase, PurchaseItem
from app.models.returns import Return, ReturnItem
from app.models.user import User
from app.models.order import Order
from app.services.inventory_service import (
    inventory_service,
    product_available_stock,
    product_stock_status,
)
from app.core.exceptions import InsufficientStockError


VARIANTS = [
    {"name": "Taille", "value": "S", "sku": "SKU-S", "stock": 10, "reserved": 0},
    {"name": "Taille", "value": "L", "sku": "SKU-L", "stock": 4, "reserved": 0},
]


class Scenario:
    def __init__(self):
        self.suffix = str(uuid.uuid4())[:8]
        self.store_ids = []
        self.product_ids = []
        self.supplier_ids = []
        self.warehouse_ids = []
        self.purchase_ids = []
        self.return_ids = []
        self.user_ids = []
        self.order_ids = []

    def make_store(self):
        db = SessionLocal()
        try:
            store = Store(
                id=str(uuid.uuid4()), name=f"InvAudit {self.suffix}",
                slug=f"invaudit-{self.suffix}-{uuid.uuid4().hex[:4]}",
                domain=f"invaudit-{self.suffix}-{uuid.uuid4().hex[:4]}.com",
                template_id="modern", owner_id="SYSTEM_ADMIN",
            )
            db.add(store)
            db.commit()
            self.store_ids.append(store.id)
            return store.id
        finally:
            db.close()

    def make_product(self, store_id, variants=None, stock=20, reserved_stock=0, low_stock_threshold=5):
        db = SessionLocal()
        try:
            product = Product(
                id=str(uuid.uuid4()), store_id=store_id, name=f"Prod {self.suffix}",
                slug=f"prod-{self.suffix}-{uuid.uuid4().hex[:4]}", description="x",
                price=1000, stock=stock, reserved_stock=reserved_stock,
                low_stock_threshold=low_stock_threshold,
                variants=variants, category="General",
                sku=f"SKU-{self.suffix}-{uuid.uuid4().hex[:4]}", is_active=True,
            )
            db.add(product)
            db.commit()
            self.product_ids.append(product.id)
            return product.id
        finally:
            db.close()

    def make_supplier(self, store_id):
        db = SessionLocal()
        try:
            supplier = Supplier(id=str(uuid.uuid4()), store_id=store_id, name=f"Sup {self.suffix}")
            db.add(supplier)
            db.commit()
            self.supplier_ids.append(supplier.id)
            return supplier.id
        finally:
            db.close()

    def make_warehouse(self, store_id):
        db = SessionLocal()
        try:
            wh = Warehouse(id=str(uuid.uuid4()), store_id=store_id, code=f"W-{self.suffix}", name=f"WH {self.suffix}")
            db.add(wh)
            db.commit()
            self.warehouse_ids.append(wh.id)
            return wh.id
        finally:
            db.close()

    def make_user(self):
        db = SessionLocal()
        try:
            user = User(
                id=str(uuid.uuid4()), email=f"validator-{self.suffix}@test.com", name="Validator",
                hashed_password=get_password_hash("test-only-password"), role="SUPER_ADMIN", is_active=True,
            )
            db.add(user)
            db.commit()
            self.user_ids.append(user.id)
            return user.id
        finally:
            db.close()

    def make_order(self, store_id):
        """Minimal Order row so a StockMovement.order_id FK has a real target."""
        db = SessionLocal()
        try:
            order = Order(
                id=str(uuid.uuid4()), store_id=store_id, order_number=f"ORD-{self.suffix}-{uuid.uuid4().hex[:4]}",
                customer_name="Client Test", customer_phone="0550" + uuid.uuid4().hex[:6],
                customer_address="Adresse test", customer_wilaya="Alger",
                delivery_type="HOME", delivery_fee=0, subtotal=0, discount=0, total=0,
                status="NEW", source="landing_page",
            )
            db.add(order)
            db.commit()
            self.order_ids.append(order.id)
            return order.id
        finally:
            db.close()

    def cleanup(self):
        db = SessionLocal()
        try:
            if self.order_ids:
                db.query(StockMovement).filter(StockMovement.order_id.in_(self.order_ids)).delete(synchronize_session=False)
                db.query(Order).filter(Order.id.in_(self.order_ids)).delete(synchronize_session=False)
            if self.return_ids:
                db.query(ReturnItem).filter(ReturnItem.return_id.in_(self.return_ids)).delete(synchronize_session=False)
                db.query(Return).filter(Return.id.in_(self.return_ids)).delete(synchronize_session=False)
            if self.purchase_ids:
                db.query(PurchaseItem).filter(PurchaseItem.purchase_id.in_(self.purchase_ids)).delete(synchronize_session=False)
                db.query(Purchase).filter(Purchase.id.in_(self.purchase_ids)).delete(synchronize_session=False)
            if self.product_ids:
                db.query(StockMovement).filter(StockMovement.product_id.in_(self.product_ids)).delete(synchronize_session=False)
                db.query(Product).filter(Product.id.in_(self.product_ids)).delete(synchronize_session=False)
            if self.warehouse_ids:
                db.query(Warehouse).filter(Warehouse.id.in_(self.warehouse_ids)).delete(synchronize_session=False)
            if self.user_ids:
                db.query(User).filter(User.id.in_(self.user_ids)).delete(synchronize_session=False)
            if self.supplier_ids:
                db.query(Supplier).filter(Supplier.id.in_(self.supplier_ids)).delete(synchronize_session=False)
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


# ─── 1. POS sale on a variant product no longer corrupts variant stock ──────

def test_pos_sale_on_variant_product_updates_the_matching_variant(scenario):
    import copy
    store_id = scenario.make_store()
    product_id = scenario.make_product(store_id, variants=copy.deepcopy(VARIANTS))

    db = SessionLocal()
    try:
        inventory_service.sell_at_pos(
            db, product_id=product_id, quantity=2,
            variant_details={"variant": "Taille: L"}, actor_id=None,
        )
        db.commit()

        product = db.query(Product).filter(Product.id == product_id).first()
        variant_l = next(v for v in product.variants if v["value"] == "L")
        assert variant_l["stock"] == 2  # 4 - 2
        assert product.stock == 10 + 2  # aggregate re-summed: S(10) + L(2)

        movement = (
            db.query(StockMovement)
            .filter(StockMovement.product_id == product_id, StockMovement.type == "POS_SALE")
            .first()
        )
        assert movement is not None
        assert movement.quantity == -2
    finally:
        db.close()


def test_pos_sale_then_storefront_reservation_do_not_stomp_each_other(scenario):
    """
    The exact corruption scenario: a POS sale of variant L, followed by a
    storefront order reserving variant S. Before the fix, POS decremented
    only the aggregate; _update_product_stock_from_variants (triggered by
    the subsequent reserve_stock call) would then re-sum the UNCHANGED
    variant stocks and silently restore the units the POS sale removed.
    """
    import copy
    store_id = scenario.make_store()
    product_id = scenario.make_product(store_id, variants=copy.deepcopy(VARIANTS))
    order_id = scenario.make_order(store_id)

    db = SessionLocal()
    try:
        inventory_service.sell_at_pos(
            db, product_id=product_id, quantity=3,
            variant_details={"variant": "Taille: L"}, actor_id=None,
        )
        db.commit()

        inventory_service.reserve_stock(
            db, product_id=product_id, quantity=1, order_id=order_id,
            variant_details={"variant": "Taille: S"},
        )
        db.commit()

        product = db.query(Product).filter(Product.id == product_id).first()
        variant_l = next(v for v in product.variants if v["value"] == "L")
        variant_s = next(v for v in product.variants if v["value"] == "S")
        assert variant_l["stock"] == 1  # 4 - 3, must still reflect the POS sale
        assert variant_s["stock"] == 10
        assert variant_s["reserved"] == 1
        assert product.stock == variant_s["stock"] + variant_l["stock"]  # 11, not the stale 14
    finally:
        db.close()


def test_pos_sale_rejects_insufficient_stock(scenario):
    product_id = scenario.make_product(scenario.make_store(), stock=1)
    db = SessionLocal()
    try:
        with pytest.raises(InsufficientStockError):
            inventory_service.sell_at_pos(db, product_id=product_id, quantity=5, actor_id=None)
        db.rollback()
    finally:
        db.close()


# ─── 2. Purchase-voucher reception routed through InventoryService ──────────

def test_purchase_reception_uses_inventory_service_and_records_restock(scenario):
    store_id = scenario.make_store()
    product_id = scenario.make_product(store_id, stock=5)
    supplier_id = scenario.make_supplier(store_id)
    warehouse_id = scenario.make_warehouse(store_id)
    validator_id = scenario.make_user()

    db = SessionLocal()
    try:
        purchase = Purchase(
            id=str(uuid.uuid4()), store_id=store_id, supplier_id=supplier_id,
            warehouse_id=warehouse_id, reference=f"PO-{scenario.suffix}", total=1000,
        )
        db.add(purchase)
        db.flush()
        item = PurchaseItem(
            id=str(uuid.uuid4()), purchase_id=purchase.id, product_id=product_id,
            product_name="Prod", quantity=10, unit_cost=100, total_cost=1000, received_quantity=10,
        )
        db.add(item)
        db.commit()
        purchase_id = purchase.id
        scenario.purchase_ids.append(purchase_id)
    finally:
        db.close()

    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    res = client.post(f"/api/v1/purchase-vouchers/{purchase_id}/validate?validator_id={validator_id}")
    assert res.status_code == 200, res.text

    db = SessionLocal()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        assert product.stock == 15  # 5 + 10
        movement = (
            db.query(StockMovement)
            .filter(StockMovement.product_id == product_id, StockMovement.type == "RESTOCK")
            .first()
        )
        assert movement is not None
        assert movement.quantity == 10
        assert movement.warehouse_id == warehouse_id
    finally:
        db.close()


# ─── 3. Supplier return creation/reintegration routed through InventoryService ──

def test_supplier_return_creation_decrements_stock_via_inventory_service(scenario):
    store_id = scenario.make_store()
    product_id = scenario.make_product(store_id, stock=10)
    supplier_id = scenario.make_supplier(store_id)
    warehouse_id = scenario.make_warehouse(store_id)

    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)

    res = client.post("/api/v1/returns/", json={
        "store_id": store_id, "supplier_id": supplier_id, "warehouse_id": warehouse_id,
        "reason": "DEFECTIVE", "reduce_stock": True,
        "items": [{"product_id": product_id, "product_name": "Prod", "quantity": 3, "unit_credit": 100}],
    })
    assert res.status_code == 200, res.text
    return_id = res.json()["data"]["id"]
    scenario.return_ids.append(return_id)

    db = SessionLocal()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        assert product.stock == 7  # 10 - 3
        movement = db.query(StockMovement).filter(StockMovement.product_id == product_id, StockMovement.type == "OUT").first()
        assert movement is not None and movement.quantity == -3
    finally:
        db.close()


def test_supplier_return_creation_rejects_insufficient_stock(scenario):
    store_id = scenario.make_store()
    product_id = scenario.make_product(store_id, stock=2)
    supplier_id = scenario.make_supplier(store_id)
    warehouse_id = scenario.make_warehouse(store_id)

    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)

    res = client.post("/api/v1/returns/", json={
        "store_id": store_id, "supplier_id": supplier_id, "warehouse_id": warehouse_id,
        "reason": "DEFECTIVE", "reduce_stock": True,
        "items": [{"product_id": product_id, "product_name": "Prod", "quantity": 99, "unit_credit": 100}],
    })
    # InsufficientStockError carries its own status_code (409, "Conflict")
    # and returns.py's create_return handler re-raises it as-is via
    # `hasattr(e, "status_code")` before the (dead-in-this-path) explicit
    # 400 branch below it — a pre-existing quirk, not something this fix
    # changes; asserting the real observed behavior.
    assert res.status_code == 409

    db = SessionLocal()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        assert product.stock == 2  # unchanged — rolled back
    finally:
        db.close()


def test_return_reintegration_on_status_transition_restocks_via_inventory_service(scenario):
    store_id = scenario.make_store()
    product_id = scenario.make_product(store_id, stock=5)
    supplier_id = scenario.make_supplier(store_id)
    warehouse_id = scenario.make_warehouse(store_id)

    db = SessionLocal()
    try:
        ret = Return(
            id=str(uuid.uuid4()), store_id=store_id, supplier_id=supplier_id,
            warehouse_id=warehouse_id, reference=f"RET-{scenario.suffix}", total_credit=100,
            items=[ReturnItem(
                id=str(uuid.uuid4()), product_id=product_id, product_name="Prod",
                quantity=4, unit_credit=100, total_credit=400,
            )],
        )
        db.add(ret)
        db.commit()
        scenario.return_ids.append(ret.id)
        return_id = ret.id
    finally:
        db.close()

    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    # NB: ReturnStatus only defines RECEIVED_BY_SUPPLIER (not "RECEIVED") —
    # the route's own reintegration check compares against literal
    # "RECEIVED", making that half of the check dead code (a pre-existing,
    # separate bug out of scope here). "CLOSED" is the transition that
    # actually reaches the reintegration branch today.
    res = client.patch(f"/api/v1/returns/{return_id}", json={"status": "CLOSED"})
    assert res.status_code == 200, res.text

    db = SessionLocal()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        assert product.stock == 9  # 5 + 4
        movement = (
            db.query(StockMovement)
            .filter(StockMovement.product_id == product_id, StockMovement.type == "RETURN_RESTOCK")
            .first()
        )
        assert movement is not None and movement.quantity == 4
    finally:
        db.close()


# ─── 4. Single source of truth for low-stock classification ─────────────────

def test_product_stock_status_out_low_overstock_ok():
    class FakeProduct:
        def __init__(self, stock, reserved_stock=0, low_stock_threshold=5, variants=None):
            self.stock = stock
            self.reserved_stock = reserved_stock
            self.low_stock_threshold = low_stock_threshold
            self.variants = variants

    assert product_stock_status(FakeProduct(stock=0)) == "OUT"
    assert product_stock_status(FakeProduct(stock=3, low_stock_threshold=5)) == "LOW"
    assert product_stock_status(FakeProduct(stock=10, low_stock_threshold=5)) == "OK"
    assert product_stock_status(FakeProduct(stock=100, low_stock_threshold=5)) == "OVERSTOCK"


def test_product_stock_status_accounts_for_reserved_stock():
    """
    The bug this closes: raw Product.stock=10 with reserved_stock=8 looks
    fine at a glance, but only 2 units are actually sellable — below a
    threshold of 5. Two of stock.py's four endpoints ignored reserved_stock
    entirely before this fix and would have reported this product as "OK".
    """
    class FakeProduct:
        stock = 10
        reserved_stock = 8
        low_stock_threshold = 5
        variants = None

    assert product_available_stock(FakeProduct()) == 2
    assert product_stock_status(FakeProduct()) == "LOW"


def test_product_stock_status_uses_variant_bottleneck():
    """
    A product's variants can each have wildly different stock levels — the
    product-level status must reflect the SCARCEST variant, not the summed
    aggregate, since a customer picking that specific variant only sees
    what's left of it.
    """
    class FakeProduct:
        stock = 14  # 10 (S) + 4 (L), matches VARIANTS
        reserved_stock = 0
        low_stock_threshold = 5
        variants = [
            {"value": "S", "stock": 10, "reserved": 0},
            {"value": "L", "stock": 4, "reserved": 0},
        ]

    assert product_available_stock(FakeProduct()) == 4
    assert product_stock_status(FakeProduct()) == "LOW"  # 4 <= threshold 5, even though aggregate stock=14 looks fine
