import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    print("Correction des totaux et champs obligatoires...")
    conn.execute(text("UPDATE orders SET total = 0 WHERE total IS NULL"))
    conn.execute(text("UPDATE orders SET subtotal = 0 WHERE subtotal IS NULL"))
    conn.execute(text("UPDATE orders SET delivery_fee = 0 WHERE delivery_fee IS NULL"))
    conn.execute(text("UPDATE orders SET discount = 0 WHERE discount IS NULL"))
    conn.execute(text("UPDATE orders SET status = 'NEW' WHERE status IS NULL"))
    conn.execute(text("UPDATE orders SET is_deleted = false WHERE is_deleted IS NULL"))
    
    conn.execute(text("UPDATE order_items SET unit_price = 0 WHERE unit_price IS NULL"))
    conn.execute(text("UPDATE order_items SET quantity = 1 WHERE quantity IS NULL"))
    
    conn.commit()
    print("Terminé.")
