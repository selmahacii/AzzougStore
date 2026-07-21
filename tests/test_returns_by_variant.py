"""
Regression test for GET /stock/returns-by-variant (2026-07-21): per-product
return-restock totals were already tracked (stock_retourne in
/product/{id}/breakdown), but not broken down PER VARIANT — staff had no
way to see how many units of each specific color/size actually came back.
inventory_service.return_restock already encodes the variant name at the
end of StockMovement.reason ("... (VariantName)"); this endpoint
re-extracts it and sums per (product, variant), scoped to store_id.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.core.security import get_password_hash
from app.db.session import SessionLocal
from app.models.store import Store
from app.models.product import Product
from app.models.user import User
from app.models.stock import StockMovement
from app.models.order import Order
from app.services.inventory_service import inventory_service


def test_returns_by_variant_sums_per_variant_and_scopes_by_store():
    client = TestClient(app)
    suffix = str(uuid.uuid4())[:8]
    db = SessionLocal()
    try:
        store = Store(
            id=str(uuid.uuid4()), name=f"Returns Shop {suffix}", slug=f"returns-shop-{suffix}",
            domain=f"returns-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        other_store = Store(
            id=str(uuid.uuid4()), name=f"Other Shop {suffix}", slug=f"other-shop-{suffix}",
            domain=f"other-shop-{suffix}.com", template_id="modern", owner_id="SYSTEM_ADMIN",
        )
        db.add(store)
        db.add(other_store)
        db.flush()

        product = Product(
            id=str(uuid.uuid4()), store_id=store.id, name=f"Returns Product {suffix}",
            slug=f"returns-product-{suffix}", description="x", price=1000, stock=10,
            category="General", sku=f"SKU-RET-{suffix}", is_active=True,
            variants=[{"name": "Couleur", "value": "Noir", "stock": 5, "reserved": 0}],
        )
        other_product = Product(
            id=str(uuid.uuid4()), store_id=other_store.id, name=f"Other Product {suffix}",
            slug=f"other-product-{suffix}", description="x", price=1000, stock=10,
            category="General", sku=f"SKU-OTHER-{suffix}", is_active=True,
        )
        db.add(product)
        db.add(other_product)

        admin_email = f"admin-returns-{suffix}@test.com"
        admin_password = "test-only-password"
        admin = User(
            id=str(uuid.uuid4()), email=admin_email, name="Test Admin Returns",
            hashed_password=get_password_hash(admin_password), role="SUPER_ADMIN", is_active=True,
        )
        db.add(admin)

        orders = [
            Order(
                id=str(uuid.uuid4()), order_number=f"ORD-RET-{suffix}-{i}", store_id=(store.id if i < 3 else other_store.id),
                customer_name="Client Retour", customer_phone=f"055{i}" + suffix,
                customer_address="Adresse test", customer_wilaya="Alger", delivery_type="HOME",
                delivery_fee=0, subtotal=1000, discount=0, total=1000, source="landing_page", status="RETURNED",
            )
            for i in range(4)
        ]
        db.add_all(orders)
        db.commit()

        # Two returns of the SAME variant (should sum to 3), one plain
        # return with no variant (should bucket as "Général"), and one
        # return on a DIFFERENT store's product (must never leak in).
        inventory_service.return_restock(
            db, product_id=product.id, quantity=2, order_id=orders[0].id, variant_details={"variant": "Couleur: Noir"},
        )
        inventory_service.return_restock(
            db, product_id=product.id, quantity=1, order_id=orders[1].id, variant_details={"variant": "Couleur: Noir"},
        )
        inventory_service.return_restock(db, product_id=product.id, quantity=4, order_id=orders[2].id)
        inventory_service.return_restock(db, product_id=other_product.id, quantity=9, order_id=orders[3].id)
        db.commit()
        order_ids = [o.id for o in orders]

        product_id, other_product_id = product.id, other_product.id
        store_id, other_store_id = store.id, other_store.id
        admin_id = admin.id
    finally:
        db.close()

    login = client.post(
        f"{settings.API_V1_STR}/auth/login/access-token",
        data={"username": admin_email, "password": admin_password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    try:
        res = client.get(f"{settings.API_V1_STR}/stock/returns-by-variant?store_id={store_id}", headers=headers)
        assert res.status_code == 200, res.text
        data = res.json()["data"]
        assert data[product_id]["Couleur: Noir"] == 3
        assert data[product_id]["Général"] == 4
        assert other_product_id not in data, "a return on a different store's product must never leak into this store's totals"
    finally:
        db = SessionLocal()
        try:
            db.query(StockMovement).filter(StockMovement.product_id.in_([product_id, other_product_id])).delete(synchronize_session=False)
            db.query(Order).filter(Order.id.in_(order_ids)).delete(synchronize_session=False)
            db.query(Product).filter(Product.id.in_([product_id, other_product_id])).delete(synchronize_session=False)
            db.query(User).filter(User.id == admin_id).delete()
            db.query(Store).filter(Store.id.in_([store_id, other_store_id])).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()
