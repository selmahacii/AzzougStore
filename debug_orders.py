import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

STORE_ID = "17e0f9d7-95c3-4873-b3ad-4ecd6d921139"

with engine.connect() as conn:
    res = conn.execute(text("SELECT count(*) FROM orders WHERE store_id = :sid"), {"sid": STORE_ID})
    count = res.fetchone()[0]
    print(f"Total orders for store {STORE_ID}: {count}")

    res = conn.execute(text("SELECT id, order_number, status, assigned_to FROM orders WHERE store_id = :sid LIMIT 5"), {"sid": STORE_ID})
    for o in res.fetchall():
        print(f"Order: {o[1]}, Status: {o[2]}, Assigned: {o[3]}")
