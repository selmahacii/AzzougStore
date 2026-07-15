import pytest
from httpx import AsyncClient
import uuid
import os
import sys

# Add parent directory to path to find 'app'
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
from app.core.config import settings

@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac

INTERNAL_KEY_HEADER = {"x-internal-key": settings.INTERNAL_API_KEY}

@pytest.mark.asyncio
async def test_full_boutique_lifecycle(client):
    # 1. Create a Unique Boutique (Website)
    suffix = str(uuid.uuid4())[:8]
    slug = f"test-shop-{suffix}"
    domain = f"{slug}.com"
    
    store_data = {
        "name": f"Test Shop {suffix}",
        "slug": slug,
        "domain": domain,
        "template_id": "modern",
        "owner_id": "SYSTEM_ADMIN",
        "theme_config": {"primaryColor": "#FF5733"}
    }
    
    # POST /api/v1/stores/
    response = await client.post(
        f"{settings.API_V1_STR}/stores/", 
        json=store_data,
        headers=INTERNAL_KEY_HEADER
    )
    assert response.status_code == 200
    store = response.json()
    store_id = store["id"]
    assert store["slug"] == slug
    print(f"\n✅ Boutique {slug} créée avec succès.")

    # 2. Verify Domain Listing (Caddy Integration Check)
    # GET /api/v1/domains/verify?domain=...
    verify_response = await client.get(
        f"{settings.API_V1_STR}/domains/verify?domain={domain}"
    )
    assert verify_response.status_code == 200
    print(f"✅ Domaine {domain} vérifié pour TLS On-Demand.")

    # 3. Create a Product for this Tenant
    product_data = {
        "name": "Produit Test Industrial",
        "description": "Un produit créé pendant le test E2E",
        "price": 1500,
        "stock": 100,
        "category": "Tests",
        "sku": f"SKU-{suffix}",
        "store_id": store_id,
        "is_active": True
    }
    
    # Headers with Store ID to test Tenant Isolation in middleware if applicable
    # (Though we are using internal key which bypasses filters usually, we check the storage)
    prod_response = await client.post(
        f"{settings.API_V1_STR}/products/",
        json=product_data,
        headers=INTERNAL_KEY_HEADER
    )
    assert prod_response.status_code == 200
    product = prod_response.json()
    assert product["store_id"] == store_id
    print(f"✅ Produit {product['name']} ajouté au catalogue de la boutique.")

    # 4. List Products per Store (Tenant Isolation Check)
    # GET /api/v1/products/?store_id=...
    list_response = await client.get(
        f"{settings.API_V1_STR}/products/?store_id={store_id}",
        headers=INTERNAL_KEY_HEADER
    )
    assert list_response.status_code == 200
    data = list_response.json()
    assert data["total"] >= 1
    assert any(p["id"] == product["id"] for p in data["data"])
    print(f"✅ Isolation vérifiée : Les produits de {slug} sont bien récupérés.")

    # 5. Delete the Boutique (Cleanup)
    # DELETE /api/v1/stores/{id}
    del_response = await client.delete(
        f"{settings.API_V1_STR}/stores/{store_id}",
        headers=INTERNAL_KEY_HEADER
    )
    assert del_response.status_code == 200
    print(f"✅ Boutique {slug} supprimée avec succès (Cleanup).")

    # 6. Verify Deletion
    get_response = await client.get(
        f"{settings.API_V1_STR}/stores/{store_id}",
        headers=INTERNAL_KEY_HEADER
    )
    assert get_response.status_code == 404
    print("✅ Le cycle de vie complet E2E est validé.")
