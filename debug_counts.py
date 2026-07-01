import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

STORE_ID = "17e0f9d7-95c3-4873-b3ad-4ecd6d921139"

with engine.connect() as conn:
    res = conn.execute(text("SELECT count(*) FROM products WHERE store_id = :sid"), {"sid": STORE_ID})
    count = res.fetchone()[0]
    print(f"Total products for store {STORE_ID}: {count}")

    res = conn.execute(text("SELECT count(*) FROM products WHERE store_id = :sid AND is_active = true"), {"sid": STORE_ID})
    active_count = res.fetchone()[0]
    print(f"Active products for store {STORE_ID}: {active_count}")

    res = conn.execute(text("SELECT id, name, is_active FROM products WHERE store_id = :sid LIMIT 5"), {"sid": STORE_ID})
    for p in res.fetchall():
        print(f"ID: {p[0]}, Name: {p[1]}, Active: {p[2]}")
