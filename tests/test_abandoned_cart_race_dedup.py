"""
Regression test for the abandoned-cart duplicate-creation race (2026-07-22):
a customer clicking the checkout button several times in quick succession
fired several concurrent POST /orders/abandoned requests, each of which ran
the "find existing ABANDONED cart for this phone, or create one" check
before any of the others had committed — a classic TOCTOU race that let
every concurrent request create its OWN ABN-* order for the same customer.
Reported live: 16 near-identical ABN-20260714-* rows for one customer
within a single minute.

Fixed via a Postgres advisory transaction lock keyed by (store_id, phone),
serializing concurrent requests for the same customer so only the first
one creates a row — every other one finds and updates it instead.
"""
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.db.session import SessionLocal
from app.models.store import Store
from app.models.product import Product
from app.models.order import Order, OrderItem


def test_concurrent_abandoned_cart_saves_for_same_phone_create_only_one_order():
    suffix = str(uuid.uuid4())[:8]
    db = SessionLocal()
    try:
        store = Store(
            id=str(uuid.uuid4()), name=f"Race Shop {suffix}", slug=f"race-shop-{suffix}",
            domain=f"race-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        db.add(store)
        db.flush()
        product = Product(
            id=str(uuid.uuid4()), store_id=store.id, name=f"Race Product {suffix}",
            slug=f"race-product-{suffix}", description="x", price=1000, stock=10,
            category="General", sku=f"SKU-RACE-{suffix}", is_active=True,
        )
        db.add(product)
        db.commit()
        store_id, product_id = store.id, product.id
    finally:
        db.close()

    client = TestClient(app)
    phone = "0571" + suffix

    def _fire(i: int):
        payload = {
            "store_id": store_id,
            "customer_name": "Client Race",
            "customer_phone": phone,
            "customer_wilaya": "Alger",
            "customer_address": "Adresse test",
            "delivery_type": "HOME",
            "items": [{
                "product_id": product_id, "product_name": "Produit Test",
                "quantity": 1, "unit_price": 1000,
            }],
            "subtotal": 1000,
            "delivery_fee": 0,
            "total": 1000,
            "source": "storefront",
        }
        return client.post(f"{settings.API_V1_STR}/orders/abandoned", json=payload)

    try:
        # 10 concurrent "rapid clicks" for the SAME customer, no abandoned_cart_id
        # carried between them — exactly the race window this fix closes.
        with ThreadPoolExecutor(max_workers=10) as pool:
            responses = list(pool.map(_fire, range(10)))

        for r in responses:
            assert r.status_code == 201, r.text

        db = SessionLocal()
        try:
            matching = db.query(Order).filter(
                Order.store_id == store_id, Order.customer_phone == phone, Order.status == "ABANDONED",
            ).all()
            assert len(matching) == 1, (
                f"expected exactly 1 ABANDONED order for this customer after 10 concurrent saves, "
                f"got {len(matching)}"
            )
            order_id = matching[0].id
        finally:
            db.close()
    finally:
        db = SessionLocal()
        try:
            all_orders = db.query(Order).filter(Order.store_id == store_id, Order.customer_phone == phone).all()
            order_ids = [o.id for o in all_orders]
            if order_ids:
                from app.models.stock import StockMovement
                db.query(StockMovement).filter(StockMovement.order_id.in_(order_ids)).delete(synchronize_session=False)
                db.query(OrderItem).filter(OrderItem.order_id.in_(order_ids)).delete(synchronize_session=False)
                db.query(Order).filter(Order.id.in_(order_ids)).delete(synchronize_session=False)
            from app.models.customer import Customer
            db.query(Customer).filter(Customer.store_id == store_id).delete()
            db.query(Product).filter(Product.id == product_id).delete()
            db.query(Store).filter(Store.id == store_id).delete()
            db.commit()
        finally:
            db.close()
