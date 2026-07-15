import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import uuid
import json

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    # Find store
    store = conn.execute(text("SELECT id, name FROM stores WHERE slug ILIKE '%trustshop%' OR name ILIKE '%trustshop%' LIMIT 1")).fetchone()
    if not store:
        print("Boutique 'TrustShop' introuvable.")
        exit(1)
    
    store_id, store_name = store
    print(f"Boutique trouvée : {store_name} (ID: {store_id})")

    # Nettoyage optionnel des anciens produits de test pour repartir sur du propre
    # conn.execute(text("DELETE FROM products WHERE store_id = :sid AND slug LIKE 'demo-%'"), {"sid": store_id})

    products = [
        {
            "name": "Sérum Anti-Âge Rétinol Pur",
            "slug": "demo-serum-retinol-pur",
            "sku": "TS-SKIN-001",
            "price": 4800,
            "cost_price": 1800,
            "stock": 42,
            "category": "Cosmétiques",
            "description": "Notre sérum au rétinol pur à 0.3% est conçu pour réduire visiblement les rides et uniformiser le teint. Enrichi en vitamine B3 pour apaiser la peau et en glycérine pour une hydratation 24h. Texture non grasse, pénétration rapide.",
            "main_image": "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?q=80&w=1000&auto=format&fit=crop",
            "images": ["https://images.unsplash.com/photo-1620916566398-39f1143ab7be?q=80&w=1000&auto=format&fit=crop", "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?q=80&w=1000&auto=format&fit=crop"],
            "brand": "TrustSkin Lab",
            "tags": ["Bestseller", "Anti-âge", "Soin Visage"],
            "variants": [
                {"name": "Format", "value": "30ml", "sku": "TS-SKIN-001-30", "stock": 25},
                {"name": "Format", "value": "50ml", "sku": "TS-SKIN-001-50", "stock": 17}
            ]
        },
        {
            "name": "Crème Hydratante 'Barrière Divine'",
            "slug": "demo-creme-barriere-divine",
            "sku": "TS-SKIN-002",
            "price": 3500,
            "cost_price": 1200,
            "stock": 120,
            "category": "Cosmétiques",
            "description": "Une crème riche aux céramides et à l'acide hyaluronique. Elle restaure la barrière cutanée protectrice et procure un confort immédiat aux peaux sèches à très sèches. Formule hypoallergénique, sans parfum, idéale pour les peaux sensibles.",
            "main_image": "https://images.unsplash.com/photo-1612817288484-6f916006741a?q=80&w=1000&auto=format&fit=crop",
            "images": ["https://images.unsplash.com/photo-1612817288484-6f916006741a?q=80&w=1000&auto=format&fit=crop"],
            "brand": "TrustSkin Lab",
            "tags": ["Hydratation", "Peau Sensible"],
            "variants": []
        },
        {
            "name": "Nettoyant Moussant Doux",
            "slug": "demo-nettoyant-moussant",
            "sku": "TS-SKIN-003",
            "price": 2400,
            "cost_price": 850,
            "stock": 15,
            "category": "Hygiène",
            "description": "Élimine en douceur les impuretés et l'excès de sébum sans altérer l'hydratation naturelle de la peau. Formule enrichie en thé vert antioxydant et aloe vera apaisant. Laisse la peau propre, fraîche et éclatante.",
            "main_image": "https://images.unsplash.com/photo-1556228720-195a672e8a03?q=80&w=1000&auto=format&fit=crop",
            "images": ["https://images.unsplash.com/photo-1556228720-195a672e8a03?q=80&w=1000&auto=format&fit=crop"],
            "brand": "TrustSkin Lab",
            "tags": ["Nouveauté", "Bio"],
            "variants": []
        }
    ]
    
    for p in products:
        p_id = str(uuid.uuid4())
        try:
            conn.execute(text("""
                INSERT INTO products (
                    id, store_id, name, slug, sku, price, cost_price, stock, 
                    is_active, is_featured, is_pack, images, variants, tags, 
                    allowed_carriers, category, description, main_image, brand,
                    production_source, prod_batch_qty, low_stock_threshold,
                    created_at, updated_at
                )
                VALUES (
                    :id, :store_id, :name, :slug, :sku, :price, :cost, :stock, 
                    true, true, false, :images, :variants, :tags, 
                    '["Yalidine", "Noest", "Zaki Express"]', :cat, :desc, :img, :brand,
                    'imported', 1, 5, now(), now()
                )
            """), {
                "id": p_id, 
                "store_id": store_id, 
                "name": p["name"], 
                "slug": p["slug"], 
                "sku": p["sku"], 
                "price": p["price"], 
                "cost": p["cost_price"], 
                "stock": p["stock"], 
                "cat": p["category"],
                "desc": p["description"],
                "img": p["main_image"],
                "brand": p["brand"],
                "images": json.dumps(p["images"]),
                "variants": json.dumps(p["variants"]),
                "tags": json.dumps(p["tags"])
            })
            print(f"Produit complet créé : {p['name']}")
        except Exception as e:
            print(f"Erreur lors de la création de {p['name']}: {e}")
    
    conn.commit()
    print("\nSeeding TrustShop terminé avec des données complètes.")
