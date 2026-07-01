import pytest
from httpx import AsyncClient
import uuid
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
from app.core.config import settings

@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac

INTERNAL_KEY_HEADER = {"x-internal-key": settings.INTERNAL_API_KEY}

@pytest.mark.asyncio
async def test_tenant_data_leakage_protection(client):
    # 1. Create two distinct boutiques
    s1_slug = f"boutique-a-{str(uuid.uuid4())[:4]}"
    s2_slug = f"boutique-b-{str(uuid.uuid4())[:4]}"
    
    store1 = (await client.post(f"{settings.API_V1_STR}/stores/", json={"name": "A", "slug": s1_slug}, headers=INTERNAL_KEY_HEADER)).json()
    store2 = (await client.post(f"{settings.API_V1_STR}/stores/", json={"name": "B", "slug": s2_slug}, headers=INTERNAL_KEY_HEADER)).json()
    
    s1_id = store1["id"]
    s2_id = store2["id"]

    # 2. Add product to Store A
    p1 = (await client.post(
        f"{settings.API_V1_STR}/products/",
        json={"name": "Secret A", "price": 100, "store_id": s1_id, "category": "A", "sku": f"SKU-A-{s1_slug}"},
        headers=INTERNAL_KEY_HEADER
    )).json()

    # 3. Try to access Product A while impersonating Store B
    # We use X-Store-Id header which is what TenantMiddleware looks at
    leak_check = await client.get(
        f"{settings.API_V1_STR}/products/",
        headers={"X-Store-Id": s2_id}
    )
    
    # Even if we don't use internal key (which bypasses), the middleware should have filters
    # Wait, internal key in get_current_user bypasses AUTH, but TenantMiddleware might still apply
    
    # The read_products endpoint in products.py does:
    # if store_id: query = query.filter(Product.store_id == store_id)
    # Plus the TenantMiddleware (if implemented with global filters)
    
    data = leak_check.json()
    # It should only show products for Store B (which has 0)
    assert data["total"] == 0
    assert not any(p["id"] == p1["id"] for p in data["data"])
    print(f"\n✅ Isolation validée : La boutique B ({s2_slug}) ne voit pas les produits de la boutique A.")

    # 4. Access as Store A
    auth_check = await client.get(
        f"{settings.API_V1_STR}/products/",
        headers={"X-Store-Id": s1_id}
    )
    data_a = auth_check.json()
    assert data_a["total"] >= 1
    assert any(p["id"] == p1["id"] for p in data_a["data"])
    print(f"✅ Isolation validée : La boutique A ({s1_slug}) voit bien ses propres produits.")

    # Cleanup
    await client.delete(f"{settings.API_V1_STR}/stores/{s1_id}", headers=INTERNAL_KEY_HEADER)
    await client.delete(f"{settings.API_V1_STR}/stores/{s2_id}", headers=INTERNAL_KEY_HEADER)
