import os
import uuid
import random
from datetime import datetime, timedelta
from sqlalchemy import create_engine, text

# Database configuration
# Auto-detect if we are inside docker or not
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5440/azzougshop")
if os.path.exists("/.dockerenv") and "localhost" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("localhost", "db").replace("5440", "5432")

print(f"Connecting to: {DATABASE_URL}")
engine = create_engine(DATABASE_URL)

ALGERIAN_WILAYAS = ["Alger", "Oran", "Constantine", "Annaba", "Blida", "Batna", "Setif", "Bejaia", "Tlemcen", "Skikda", "Tizi Ouzou", "Chlef", "Setif"]
NAMES = ["Ahmed", "Mohamed", "Amine", "Sarah", "Lydia", "Yasmine", "Karim", "Omar", "Imane", "Walid", "Ryma", "Sofiane", "Fares"]
LASTNAMES = ["Zitouni", "Brahimi", "Mansouri", "Khelifi", "Azzoug", "Belkaid", "Saidi", "Hamidi", "Bouaziz", "Merah"]

def random_phone():
    return f"0{random.choice(['5','6','7'])}{random.randint(40000000, 99999999)}"

def generate():
    with engine.begin() as conn:
        print("Démarrage de la génération de données riches...")
        
        # 1. Trouver un Store ID actif
        res = conn.execute(text("SELECT id FROM stores WHERE is_active = true LIMIT 1"))
        store = res.fetchone()
        if not store:
            print("Aucune boutique active trouvée.")
            return
        store_id = store[0]
        print(f"Boutique cible : {store_id}")
        
        # 2. Trouver les agents (users)
        res = conn.execute(text("SELECT id, name FROM users WHERE is_active = true"))
        agents = res.fetchall()
        agent_ids = [a[0] for a in agents]
        print(f"Agents trouvés : {len(agent_ids)}")
        
        # 3. Créer des produits
        products_data = [
            ("Smartphone Galaxy X", "galaxy-x-demo", "ELEC-001-D", 85000, 55000),
            ("Écouteurs Bluetooth", "ecouteurs-bt-demo", "ELEC-002-D", 4500, 1800),
            ("Machine à café Elite", "cafe-elite-demo", "HOME-001-D", 12500, 6200),
            ("Robe d'été 'Sahara'", "robe-sahara-demo", "TEXT-001-D", 3500, 1200),
            ("Chaussures Sport Pro", "sport-pro-demo", "TEXT-002-D", 7500, 3100)
        ]
        
        for name, slug, sku, price, cost in products_data:
            try:
                check = conn.execute(text("SELECT id FROM products WHERE sku = :sku"), {"sku": sku}).fetchone()
                if not check:
                    p_id = str(uuid.uuid4())
                    conn.execute(text("""
                        INSERT INTO products (id, store_id, name, slug, sku, price, cost_price, stock, reserved_stock, low_stock_threshold, is_active, is_featured, is_pack, images, variants, tags, category, created_at, updated_at)
                        VALUES (:id, :store_id, :name, :slug, :sku, :price, :cost, 100, 0, 5, true, true, false, '[]', '[]', '[]', 'Demo', now(), now())
                    """), {"id": p_id, "store_id": store_id, "name": name, "slug": slug, "sku": sku, "price": price, "cost": cost})
                else:
                    conn.execute(text("UPDATE products SET cost_price = :cost, price = :price WHERE sku = :sku"), {"cost": cost, "price": price, "sku": sku})
            except Exception as e:
                print(f"Skipping product {sku}: {e}")
        
        # 4. Récupérer les produits pour les ordres
        res = conn.execute(text("SELECT id, name, price FROM products WHERE store_id = :sid"), {"sid": store_id})
        available_products = res.fetchall()
        
        # 5. Générer encore 100 commandes (en plus des précédentes)
        print("Génération de 100 commandes historiques additionnelles...")
        for i in range(100):
            order_id = str(uuid.uuid4())
            order_num = f"AZD-EXT-{3000 + i}"
            
            status = random.choices(
                ["NEW", "CONFIRMED", "SHIPPED", "DELIVERED", "RETURNED", "CANCELLED"],
                weights=[5, 10, 15, 60, 5, 5],
                k=1
            )[0]
            
            days_ago = random.randint(0, 180)
            created_at = datetime.now() - timedelta(days=days_ago)
            
            assigned_to = random.choice(agent_ids) if agent_ids else None
            customer_name = f"{random.choice(NAMES)} {random.choice(LASTNAMES)}"
            wilaya = random.choice(ALGERIAN_WILAYAS)
            
            conn.execute(text("""
                INSERT INTO orders (id, store_id, order_number, customer_name, customer_phone, customer_address, customer_wilaya, status, subtotal, delivery_fee, total, assigned_to, created_at, updated_at)
                VALUES (:id, :sid, :num, :name, :phone, :addr, :wilaya, :status, 0, 500, 500, :assignee, :created, :updated)
            """), {
                "id": order_id, "sid": store_id, "num": order_num, "name": customer_name, "phone": random_phone(), 
                "addr": f"Rue {random.randint(1,50)}, {wilaya}", "wilaya": wilaya, 
                "status": status,
                "assignee": assigned_to,
                "created": created_at,
                "updated": created_at + timedelta(hours=random.randint(24, 72))
            })
            
            items = random.sample(available_products, random.randint(1, min(2, len(available_products))))
            subtotal = 0
            for p in items:
                qty = random.randint(1, 2)
                line_total = p[2] * qty
                subtotal += line_total
                conn.execute(text("""
                    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, created_at, updated_at)
                    VALUES (:id, :oid, :pid, :pname, :qty, :price, :created, :created)
                """), {
                    "id": str(uuid.uuid4()), "oid": order_id, "pid": p[0], "pname": p[1], "qty": qty, "price": p[2], "created": created_at
                })
            
            conn.execute(text("UPDATE orders SET subtotal = :sub, total = :total WHERE id = :id"), {
                "id": order_id, "sub": subtotal, "total": subtotal + 500
            })
            
        print(f"Succès ! 100 commandes additionnelles générées.")

if __name__ == "__main__":
    try:
        generate()
    except Exception as e:
        print(f"FATAL ERROR: {e}")
