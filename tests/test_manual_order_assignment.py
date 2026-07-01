import pytest
from httpx import AsyncClient
import uuid
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
from app.core.config import settings
from app.models.user import User
from app.models.order import Order

@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac

INTERNAL_KEY_HEADER = {"x-internal-key": settings.INTERNAL_API_KEY}

@pytest.mark.asyncio
async def test_manual_order_assignment_by_confirmatrice(client):
    suffix = str(uuid.uuid4())[:8]
    slug = f"test-assign-shop-{suffix}"
    
    # 1. Create a Store
    store_response = await client.post(
        f"{settings.API_V1_STR}/stores/", 
        json={
            "name": f"Test Assign Shop {suffix}",
            "slug": slug,
            "domain": f"{slug}.com",
            "template_id": "modern",
            "owner_id": "SYSTEM_ADMIN",
            "theme_config": {"primaryColor": "#FF5733"}
        },
        headers=INTERNAL_KEY_HEADER
    )
    assert store_response.status_code == 200
    store = store_response.json()
    store_id = store["id"]

    # 2. Create a Product
    product_response = await client.post(
        f"{settings.API_V1_STR}/products/",
        json={
            "name": f"Product Not Assigned {suffix}",
            "description": "Product not assigned to the confirmatrice",
            "price": 2500,
            "stock": 50,
            "category": "General",
            "sku": f"SKU-UNASSIGNED-{suffix}",
            "store_id": store_id,
            "is_active": True
        },
        headers=INTERNAL_KEY_HEADER
    )
    assert product_response.status_code == 200
    product = product_response.json()
    product_id = product["id"]

    # 3. Create a Confirmatrice (agent)
    confirmatrice_email = f"conf-{suffix}@azzougshop.com"
    conf_response = await client.post(
        f"{settings.API_V1_STR}/users/",
        json={
            "email": confirmatrice_email,
            "password": "password123",
            "name": f"Confirmatrice {suffix}",
            "role": "CONFIRMATEUR",
            "phone": "0550000001",
            "daily_target": 15,
            "employee_store_id": store_id,
            "is_active": True,
            "payment_type": "PER_CONFIRMED_ORDER",
            "payment_amount": 100,
            "assigned_store_scope": "SPECIFIC",
            "assigned_store_ids": [store_id],
            "assigned_product_ids": [] # Explicitly no assigned products (so she is not a specialist for any product)
        },
        headers=INTERNAL_KEY_HEADER
    )
    assert conf_response.status_code == 200
    confirmatrice = conf_response.json()
    confirmatrice_id = confirmatrice["id"]

    # 4. Create an Order containing that product, acting as the confirmatrice
    # We pass headers x-internal-key and x-user-id to simulate authentication of the confirmatrice
    agent_headers = {
        "x-internal-key": settings.INTERNAL_API_KEY,
        "x-user-id": confirmatrice_id
    }
    
    order_payload = {
        "store_id": store_id,
        "customer_name": "Test Client",
        "customer_phone": "0550999999",
        "customer_address": "Alger, Algerie",
        "customer_wilaya": "Alger",
        "delivery_type": "HOME",
        "delivery_fee": 500.0,
        "subtotal": 2500.0,
        "discount": 0.0,
        "total": 3000.0,
        "source": "MANUAL",
        "items": [{
            "product_id": product_id,
            "product_name": product["name"],
            "quantity": 1,
            "unit_price": 2500.0
        }]
    }

    order_response = await client.post(
        f"{settings.API_V1_STR}/orders/",
        json=order_payload,
        headers=agent_headers
    )
    assert order_response.status_code == 201
    order = order_response.json()
    
    # 5. Assertions
    # The order must be assigned to the confirmatrice who created it
    assert order["assigned_to"] == confirmatrice_id
    print("\n✅ Order created and assigned successfully to the creator confirmatrice.")

    # Cleanup
    await client.delete(f"{settings.API_V1_STR}/stores/{store_id}", headers=INTERNAL_KEY_HEADER)
    # Note: User is not deleted here since store cleanup deletes cascading dependencies but not unrelated users.
    # In sqlite/test db it is fine.
