import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import uuid
import random
from datetime import datetime, timedelta

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

STORE_ID = "17e0f9d7-95c3-4873-b3ad-4ecd6d921139" # TrustShop

with engine.connect() as conn:
    print("Génération des fournisseurs et achats pour TrustShop...")

    # 1. Trouver un entrepôt pour cette boutique
    warehouse = conn.execute(text("SELECT id FROM warehouses WHERE store_id = :sid LIMIT 1"), {"sid": STORE_ID}).fetchone()
    if not warehouse:
        # Créer un entrepôt par défaut si inexistant
        warehouse_id = str(uuid.uuid4())
        conn.execute(text("""
            INSERT INTO warehouses (id, store_id, code, name, address, wilaya, is_active, created_at, updated_at)
            VALUES (:id, :sid, 'W-TR-01', 'Dépôt Principal', 'Zone Industrielle', 'Alger', true, now(), now())
        """), {"id": warehouse_id, "sid": STORE_ID})
        print("Entrepôt par défaut créé.")
    else:
        warehouse_id = warehouse[0]

    # 2. Créer des Fournisseurs (Suppliers)
    suppliers_data = [
        {"name": "Global Sourcing DZ", "city": "Alger", "category": "Cosmétiques", "reliability": 95.0},
        {"name": "TechImport SARL", "city": "Oran", "category": "Électronique", "reliability": 88.5},
        {"name": "EcoPack Solutions", "city": "Blida", "category": "Emballages", "reliability": 99.0},
        {"name": "Maison Luxe Sourcing", "city": "Constantine", "category": "Maison", "reliability": 75.0}
    ]

    supplier_ids = []
    for s in suppliers_data:
        s_id = str(uuid.uuid4())
        total_due = random.randint(200000, 1000000)
        total_paid = random.randint(100000, total_due)
        conn.execute(text("""
            INSERT INTO suppliers (
                id, store_id, name, code, phone, city, total_due, total_paid, total_remaining, 
                reliability_score, supply_category, is_active, is_verified, created_at, updated_at
            )
            VALUES (
                :id, :sid, :name, :code, :phone, :city, :due, :paid, :rem, 
                :score, :cat, true, true, now(), now()
            )
        """), {
            "id": s_id, "sid": STORE_ID, "name": s["name"], "code": f"SUP-{random.randint(100,999)}",
            "phone": f"0{random.randint(5,7)}55443322", "city": s["city"], "due": total_due, 
            "paid": total_paid, "rem": total_due - total_paid, "score": s["reliability"], "cat": s["category"]
        })
        supplier_ids.append(s_id)
        print(f"Fournisseur créé : {s['name']}")

    # 3. Créer des Achats (Purchases)
    # Récupérer quelques produits
    res = conn.execute(text("SELECT id, name, sku, cost_price FROM products WHERE store_id = :sid LIMIT 5"), {"sid": STORE_ID})
    products = res.fetchall()

    if products:
        print("Génération des bons de commande fournisseur...")
        for i in range(6):
            p_id = str(uuid.uuid4())
            ref = f"PO-2025-{random.randint(1000, 9999)}"
            s_id = random.choice(supplier_ids)
            
            # Statuts réalistes
            p_status = random.choice(["PENDING", "PARTIAL", "PAID"])
            r_status = random.choice(["PENDING", "PARTIAL", "RECEIVED"])
            
            # Choisir 1-2 produits pour cet achat
            items = random.sample(products, random.randint(1, 2))
            total_po = 0
            
            conn.execute(text("""
                INSERT INTO purchases (
                    id, store_id, supplier_id, warehouse_id, reference, payment_status, reception_status, total, amount_paid, created_at, updated_at
                )
                VALUES (:id, :sid, :sup, :wid, :ref, :p_stat, :r_stat, 0, 0, now(), now())
            """), {
                "id": p_id, "sid": STORE_ID, "sup": s_id, "wid": warehouse_id, "ref": ref, 
                "p_stat": p_status, "r_stat": r_status
            })

            for prod in items:
                qty = random.randint(50, 200)
                unit_cost = prod[3] or 1000
                line_cost = qty * unit_cost
                total_po += line_cost
                
                conn.execute(text("""
                    INSERT INTO purchase_items (id, purchase_id, product_id, product_name, sku, quantity, unit_cost, total_cost, created_at, updated_at)
                    VALUES (:id, :pid, :prod_id, :pname, :sku, :qty, :cost, :total, now(), now())
                """), {
                    "id": str(uuid.uuid4()), "pid": p_id, "prod_id": prod[0], "pname": prod[1], 
                    "sku": prod[2], "qty": qty, "cost": unit_cost, "total": line_cost
                })

            # Update PO total
            conn.execute(text("UPDATE purchases SET total = :total, subtotal = :total, amount_paid = :paid WHERE id = :id"), {
                "id": p_id, "total": total_po, "paid": total_po if p_status == "PAID" else (total_po // 2 if p_status == "PARTIAL" else 0)
            })
            print(f"Achat {ref} créé ({r_status}) - Total: {total_po} DA")

    conn.commit()
    print("\nFournisseurs et achats générés avec succès.")
