import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import uuid
from datetime import datetime, date, timedelta
import random

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

STORE_ID = "17e0f9d7-95c3-4873-b3ad-4ecd6d921139" # TrustShop

with engine.connect() as conn:
    print("Génération des données financières pour TrustShop...")

    # 1. Créer des Portefeuilles (Wallets)
    wallets = [
        {"name": "Caisse Principale", "type": "CASH", "balance": 150000},
        {"name": "Compte BNA", "type": "BANK", "balance": 850000},
        {"name": "Compte CCP", "type": "BANK", "balance": 320000},
        {"name": "Baridimob", "type": "MOBILE", "balance": 45000}
    ]

    wallet_ids = []
    for w in wallets:
        w_id = str(uuid.uuid4())
        conn.execute(text("""
            INSERT INTO wallets (id, store_id, name, type, balance, total_in, total_out, is_active, created_at, updated_at)
            VALUES (:id, :sid, :name, :type, :bal, :bal, 0, true, now(), now())
        """), {"id": w_id, "sid": STORE_ID, "name": w["name"], "type": w["type"], "bal": w["balance"]})
        wallet_ids.append(w_id)
        print(f"Portefeuille créé : {w['name']}")

    # 2. Créer des Versements (Disbursements / Incomes)
    print("Génération des versements...")
    for i in range(5):
        t_id = str(uuid.uuid4())
        amount = random.randint(50000, 200000)
        conn.execute(text("""
            INSERT INTO financial_transactions (id, store_id, wallet_id, reference, type, category, amount, beneficiary, description, transaction_date, created_at, updated_at)
            VALUES (:id, :sid, :wid, :ref, 'DISBURSEMENT', 'DEPOSIT', :amount, 'TrustShop Admin', 'Versement périodique', :date, now(), now())
        """), {
            "id": t_id, "sid": STORE_ID, "wid": random.choice(wallet_ids), 
            "ref": f"VERS-{202500+i}", "amount": amount, 
            "date": datetime.now() - timedelta(days=random.randint(1, 30))
        })

    # 3. Créer des Charges Divers (Expenses)
    print("Génération des charges...")
    expense_cats = ["ADVERTISING", "RENT", "SALARY", "PACKAGING", "FUEL"]
    for i in range(8):
        e_id = str(uuid.uuid4())
        amount = random.randint(2000, 50000)
        cat = random.choice(expense_cats)
        conn.execute(text("""
            INSERT INTO expenses (id, store_id, category, label, amount, tax_amount, total_amount, status, expense_date, wallet_id, created_at, updated_at)
            VALUES (:id, :sid, :cat, :label, :amount, 0, :amount, 'PAID', :date, :wid, now(), now())
        """), {
            "id": e_id, "sid": STORE_ID, "cat": cat, "label": f"Charge {cat} #{i}", 
            "amount": amount, "date": date.today() - timedelta(days=random.randint(1, 60)),
            "wid": random.choice(wallet_ids)
        })

    # 4. Créer des Paiements (Transactions de type Payment)
    print("Génération des paiements...")
    for i in range(10):
        t_id = str(uuid.uuid4())
        amount = random.randint(1000, 15000)
        conn.execute(text("""
            INSERT INTO financial_transactions (id, store_id, wallet_id, reference, type, category, amount, description, transaction_date, created_at, updated_at)
            VALUES (:id, :sid, :wid, :ref, 'PAYMENT', 'SALE_PAYMENT', :amount, 'Paiement commande client', :date, now(), now())
        """), {
            "id": t_id, "sid": STORE_ID, "wid": random.choice(wallet_ids), 
            "ref": f"PAY-{202500+i}", "amount": amount, 
            "date": datetime.now() - timedelta(days=random.randint(1, 30))
        })

    conn.commit()
    print("\nDonnées financières générées avec succès.")
