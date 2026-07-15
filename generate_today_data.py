import os
import uuid
import random
from datetime import datetime, timedelta
from sqlalchemy import create_engine, text

# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5440/azzougshop")
if os.path.exists("/.dockerenv") and "localhost" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("localhost", "db").replace("5440", "5432")

print(f"Connecting to: {DATABASE_URL}")
engine = create_engine(DATABASE_URL)

def generate_today():
    with engine.begin() as conn:
        print("Génération de données pour AUJOURD'HUI...")
        
        # 1. Store ID
        res = conn.execute(text("SELECT id FROM stores WHERE is_active = true LIMIT 1"))
        store = res.fetchone()
        if not store: return
        store_id = store[0]
        
        # 2. Agents
        res = conn.execute(text("SELECT id FROM users WHERE is_active = true AND employee_store_id = :sid"), {"sid": store_id})
        agent_ids = [a[0] for a in res.fetchall()]
        
        # 3. Products
        res = conn.execute(text("SELECT id, name, price FROM products WHERE store_id = :sid"), {"sid": store_id})
        available_products = res.fetchall()
        
        # 4. 50 orders for TODAY
        for i in range(50):
            order_id = str(uuid.uuid4())
            order_num = f"TODAY-{200 + i}"
            status = random.choice(["NEW", "CONFIRMED", "SHIPPED", "DELIVERED"])
            created_at = datetime.now()
            
            assigned_to = random.choice(agent_ids) if agent_ids else None
            
            conn.execute(text("""
                INSERT INTO orders (id, store_id, order_number, customer_name, customer_phone, customer_address, customer_wilaya, status, subtotal, delivery_fee, total, assigned_to, created_at, updated_at)
                VALUES (:id, :sid, :num, :name, :phone, :addr, :wilaya, :status, 0, 500, 500, :assignee, :created, :updated)
            """), {
                "id": order_id, "sid": store_id, "num": order_num, "name": f"Client Today {i}", "phone": "0555999999", 
                "addr": "Adresse", "wilaya": "Alger", "status": status, "assignee": assigned_to,
                "created": created_at, "updated": created_at
            })
            
            if available_products:
                p = random.choice(available_products)
                conn.execute(text("""
                    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, created_at, updated_at)
                    VALUES (:id, :oid, :pid, :pname, 1, :price, :created, :created)
                """), {
                    "id": str(uuid.uuid4()), "oid": order_id, "pid": p[0], "pname": p[1], "price": p[2], "created": created_at
                })
                
                conn.execute(text("UPDATE orders SET subtotal = :sub, total = :total WHERE id = :id"), {
                    "id": order_id, "sub": p[2], "total": p[2] + 500
                })
            
        print("Succès ! 50 commandes générées pour AUJOURD'HUI.")

if __name__ == "__main__":
    generate_today()
