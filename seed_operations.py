import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import uuid
import json
from datetime import datetime, timedelta
import random

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

STORE_ID = "17e0f9d7-95c3-4873-b3ad-4ecd6d921139" # TrustShop

ALGERIAN_WILAYAS = ["Alger", "Oran", "Constantine", "Annaba", "Blida", "Batna", "Setif", "Bejaia", "Tlemcen", "Skikda", "Tizi Ouzou", "Bechar", "Ghardaia"]
NAMES = ["Ahmed", "Mohamed", "Amine", "Sarah", "Lydia", "Yasmine", "Karim", "Omar", "Imane", "Walid", "Ryma", "Sofiane", "Fares"]
LASTNAMES = ["Zitouni", "Brahimi", "Mansouri", "Khelifi", "Azzoug", "Belkaid", "Saidi", "Hamidi", "Bouaziz", "Merah"]

def random_phone():
    return f"0{random.choice(['5','6','7'])}{random.randint(40000000, 99999999)}"

with engine.connect() as conn:
    print(f"Démarrage du seeding étendu pour TrustShop...")

    # 1. Ajouter une gamme Électronique / Maison
    gadgets = [
        {
            "name": "Écouteurs Sans Fil 'Pro Sound'",
            "slug": "demo-ecouteurs-pro-sound",
            "sku": "EL-ESF-201",
            "price": 6500,
            "cost_price": 2800,
            "stock": 150,
            "category": "Électronique",
            "description": "Écouteurs Bluetooth 5.3 avec réduction de bruit active. Autonomie de 30h avec boîtier de charge. Son cristallin et basses profondes.",
            "main_image": "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?q=80&w=1000&auto=format&fit=crop",
            "brand": "TrustTech"
        },
        {
            "name": "Montre Connectée 'Vitality'",
            "slug": "demo-montre-vitality",
            "sku": "EL-MC-202",
            "price": 12500,
            "cost_price": 5500,
            "stock": 45,
            "category": "Électronique",
            "description": "Écran AMOLED, suivi cardiaque, sommeil et oxygène sanguin. GPS intégré et 100+ modes sportifs. Étanche 5ATM.",
            "main_image": "https://images.unsplash.com/photo-1579586337278-3befd40fd17a?q=80&w=1000&auto=format&fit=crop",
            "brand": "TrustTech"
        },
        {
            "name": "Lampe d'Ambiance Intelligente",
            "slug": "demo-lampe-smart",
            "sku": "HA-LS-301",
            "price": 4200,
            "cost_price": 1600,
            "stock": 200,
            "category": "Maison",
            "description": "Lampe LED RGB contrôlable par application. 16 millions de couleurs et synchronisation musicale pour une ambiance unique.",
            "main_image": "https://images.unsplash.com/photo-1534073828943-f801091bb18c?q=80&w=1000&auto=format&fit=crop",
            "brand": "TrustHome"
        }
    ]

    for p in gadgets:
        p_id = str(uuid.uuid4())
        try:
            conn.execute(text("""
                INSERT INTO products (id, store_id, name, slug, sku, price, cost_price, stock, reserved_stock, low_stock_threshold, is_active, is_featured, is_pack, images, variants, tags, allowed_carriers, category, description, main_image, brand, created_at, updated_at)
                VALUES (:id, :store_id, :name, :slug, :sku, :price, :cost, :stock, 0, 5, true, true, false, '[]', '[]', '[]', '["Yalidine", "Noest", "Zaki Express"]', :cat, :desc, :img, :brand, now(), now())
            """), {"id": p_id, "store_id": STORE_ID, "name": p["name"], "slug": p["slug"], "sku": p["sku"], "price": p["price"], "cost": p["cost_price"], "stock": p["stock"], "cat": p["category"], "desc": p["description"], "img": p["main_image"], "brand": p["brand"]})
            print(f"Produit ajouté : {p['name']}")
        except Exception as e:
            print(f"Erreur ajout produit: {e}")

    # 2. Générer un volume important de commandes (Sales)
    res = conn.execute(text("SELECT id, name, price, main_image FROM products WHERE store_id = :sid"), {"sid": STORE_ID})
    all_products = res.fetchall()

    if all_products:
        print(f"Génération de 30 nouvelles commandes...")
        for i in range(30):
            order_id = str(uuid.uuid4())
            order_num = f"TS-{2025100 + i}"
            
            # Distribution réaliste des statuts
            status = random.choices(
                ["NEW", "CONFIRMED", "SHIPPED", "DELIVERED", "RETURNED", "CANCELLED"],
                weights=[10, 20, 20, 40, 5, 5],
                k=1
            )[0]
            
            name = f"{random.choice(NAMES)} {random.choice(LASTNAMES)}"
            wilaya = random.choice(ALGERIAN_WILAYAS)
            
            # Commande avec 1 à 3 articles
            items_to_add = random.sample(all_products, random.randint(1, min(3, len(all_products))))
            subtotal = 0
            
            # Créer l'ordre (subtotal et total seront mis à jour après)
            conn.execute(text("""
                INSERT INTO orders (id, store_id, order_number, customer_name, customer_phone, customer_address, customer_wilaya, status, subtotal, delivery_fee, total, created_at, updated_at)
                VALUES (:id, :sid, :num, :name, :phone, :addr, :wilaya, :status, 0, 600, 600, :created, :updated)
            """), {
                "id": order_id, "sid": STORE_ID, "num": order_num, "name": name, "phone": random_phone(), 
                "addr": f"Cité {random.randint(1,999)} Logements, {wilaya}", "wilaya": wilaya, 
                "status": status,
                "created": datetime.now() - timedelta(days=random.randint(0, 45)),
                "updated": datetime.now()
            })

            for p in items_to_add:
                qty = random.randint(1, 2)
                line_total = p[2] * qty
                subtotal += line_total
                
                conn.execute(text("""
                    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, image_url, created_at, updated_at)
                    VALUES (:id, :oid, :pid, :pname, :qty, :price, :img, now(), now())
                """), {
                    "id": str(uuid.uuid4()), "oid": order_id, "pid": p[0], "pname": p[1], "qty": qty, "price": p[2], "img": p[3]
                })

            # Mettre à jour les totaux de l'ordre
            conn.execute(text("UPDATE orders SET subtotal = :sub, total = :total WHERE id = :id"), {
                "id": order_id, "sub": subtotal, "total": subtotal + 600
            })
            print(f"Commande {order_num} ({status}) - {subtotal + 600} DA")

    # 3. Simuler des opérations d'achat (Stock Movements)
    print("Enregistrement des mouvements de stock (Achats)...")
    for p in all_products:
        # Un achat de stock massif le mois dernier
        conn.execute(text("""
            INSERT INTO stock_movements (id, product_id, type, quantity, reason, created_at, updated_at)
            VALUES (:id, :pid, 'RESTOCK', :qty, :reason, :created, now())
        """), {
            "id": str(uuid.uuid4()), "pid": p[0], "qty": random.randint(100, 200), 
            "reason": "Importation Lot #2025-A", 
            "created": datetime.now() - timedelta(days=40)
        })

    conn.commit()
    print("\nTrustShop est maintenant peuplé avec un catalogue varié et un historique d'opérations complet.")
