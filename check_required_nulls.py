import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    # Check for NULLs in orders
    res = conn.execute(text("SELECT id FROM orders WHERE status IS NULL OR total IS NULL OR created_at IS NULL"))
    bad_orders = res.fetchall()
    print(f"Orders with NULL required fields: {len(bad_orders)}")

    # Check for NULLs in order_items
    res = conn.execute(text("SELECT id FROM order_items WHERE product_name IS NULL OR quantity IS NULL OR unit_price IS NULL"))
    bad_items = res.fetchall()
    print(f"OrderItems with NULL required fields: {len(bad_items)}")

    # Check for NULLs in stock_movements
    res = conn.execute(text("SELECT id FROM stock_movements WHERE type IS NULL OR quantity IS NULL"))
    bad_movements = res.fetchall()
    print(f"StockMovements with NULL required fields: {len(bad_movements)}")
