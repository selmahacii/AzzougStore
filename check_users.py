import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    res = conn.execute(text("SELECT id, name, role, employee_store_id FROM users WHERE is_active = true"))
    users = res.fetchall()
    print("Utilisateurs actifs :")
    for u in users:
        print(f" - {u[1]} ({u[2]}) | Store ID: {u[3]} | User ID: {u[0]}")
