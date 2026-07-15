import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import uuid
from datetime import datetime, timedelta
import random

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

STORE_ID = "17e0f9d7-95c3-4873-b3ad-4ecd6d921139" # TrustShop

def random_phone():
    return f"0{random.choice(['5','6','7'])}{random.randint(40000000, 99999999)}"

with engine.connect() as conn:
    print("Création de produits en alerte et historique de commandes...")

    # 1. Créer des produits avec stock critique
    alert_products = [
        {
            "name": "Baskets Ultra-Run Pro",
            "slug": "alert-baskets-run",
            "sku": "AL-BR-001",
            "price": 8900,
            "cost_price": 4500,
            "stock": 2,            # <--- Alerte (Seuil 5)
            "threshold": 5,
            "category": "Sport",
            "img": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=1000&auto=format&fit=crop"
        },
        {
            "name": "Casque Gaming Surround 7.1",
            "slug": "alert-casque-gaming",
            "sku": "AL-CG-002",
            "price": 12000,
            "cost_price": 6000,
            "stock": 0,            # <--- Rupture (Seuil 3)
            "threshold": 3,
            "category": "Gaming",
            "img": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=1000&auto=format&fit=crop"
        },
        {
            "name": "Clavier Mécanique RGB",
            "slug": "alert-clavier-rgb",
            "sku": "AL-CR-003",
            "price": 7500,
            "cost_price": 3200,
            "stock": 4,            # <--- Alerte (Seuil 10)
            "threshold": 10,
            "category": "Gaming",
            "img": "https://images.unsplash.com/photo-1511467687858-23d96c32e4ae?q=80&w=1000&auto=format&fit=crop"
        }
    ]

    db_alert_products = []
    for p in alert_products:
        p_id = str(uuid.uuid4())
        conn.execute(text("""
            INSERT INTO products (id, store_id, name, slug, sku, price, cost_price, stock, reserved_stock, low_stock_threshold, is_active, is_featured, is_pack, images, variants, tags, allowed_carriers, category, main_image, created_at, updated_at)
            VALUES (:id, :store_id, :name, :slug, :sku, :price, :cost, :stock, 0, :threshold, true, true, false, '[]', '[]', '[]', '["Yalidine", "Noest"]', :cat, :img, now(), now())
        """), {"id": p_id, "store_id": STORE_ID, "name": p["name"], "slug": p["slug"], "sku": p["sku"], "price": p["price"], "cost": p["cost_price"], "stock": p["stock"], "threshold": p["threshold"], "cat": p["category"], "img": p["img"]})
        
        db_alert_products.append({**p, "id": p_id})
        print(f"Produit créé en alerte : {p['name']} (Stock: {p['stock']}/{p['threshold']})")

    # 2. Créer un historique de commandes sur les 6 derniers mois
    print("Génération de l'historique des commandes (20 commandes)...")
    for i in range(20):
        order_id = str(uuid.uuid4())
        order_num = f"HIST-{1000 + i}"
        
        # Date étalée sur 6 mois
        days_ago = random.randint(1, 180)
        created_at = datetime.now() - timedelta(days=days_ago)
        
        # Statut majoritairement DELIVERED pour l'historique
        status = random.choices(["DELIVERED", "RETURNED", "CANCELLED"], weights=[80, 10, 10], k=1)[0]
        
        # Choix aléatoire d'un produit en alerte
        p = random.choice(db_alert_products)
        qty = random.randint(1, 2)
        total = p["price"] * qty + 600
        
        conn.execute(text("""
            INSERT INTO orders (id, store_id, order_number, customer_name, customer_phone, customer_address, customer_wilaya, status, subtotal, delivery_fee, total, created_at, updated_at)
            VALUES (:id, :sid, :num, :name, :phone, :addr, :wilaya, :status, :sub, 600, :total, :created, :updated)
        """), {
            "id": order_id, "sid": STORE_ID, "num": order_num, "name": f"Client Historique {i}", "phone": random_phone(), 
            "addr": "Adresse de test historique", "wilaya": "Alger", 
            "status": status, "sub": p["price"] * qty, "total": total,
            "created": created_at, "updated": created_at + timedelta(days=3)
        })
        
        conn.execute(text("""
            INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, image_url, created_at, updated_at)
            VALUES (:id, :oid, :pid, :pname, :qty, :price, :img, :created, :created)
        """), {
            "id": str(uuid.uuid4()), "oid": order_id, "pid": p["id"], "pname": p["name"], "qty": qty, "price": p["price"], "img": p["img"], "created": created_at
        })

    conn.commit()
    print("\nTerminé ! Produits en alerte et historique de 6 mois créés.")
