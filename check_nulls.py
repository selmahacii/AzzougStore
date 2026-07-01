import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    res = conn.execute(text("SELECT count(*) FROM orders WHERE is_deleted IS NULL"))
    null_deleted = res.fetchone()[0]
    print(f"Orders with is_deleted IS NULL: {null_deleted}")

    res = conn.execute(text("SELECT count(*) FROM products WHERE is_deleted IS NULL"))
    # Wait, does Product have is_deleted? 
    # Let's check models.
