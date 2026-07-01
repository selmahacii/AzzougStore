import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if "localhost" in DATABASE_URL and os.path.exists("/.dockerenv"):
    DATABASE_URL = DATABASE_URL.replace("localhost", "db").replace("5440", "5432")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

try:
    print("Injection des données analytiques...")
    
    # 1. Update product cost prices (60% of sale price)
    db.execute(text("UPDATE products SET cost_price = price * 0.6 WHERE cost_price IS NULL OR cost_price = 0"))
    
    # 2. Select some orders and mark them as DELIVERED
    # We use a subquery to get 10 IDs
    db.execute(text("""
        UPDATE orders 
        SET status = 'DELIVERED',
            total = COALESCE(subtotal, 0) + COALESCE(delivery_fee, 0) - COALESCE(discount, 0),
            updated_at = now()
        WHERE id IN (SELECT id FROM orders WHERE is_deleted = false LIMIT 10)
    """))
    
    # 3. Ensure order items have prices for COGS calculation
    db.execute(text("""
        UPDATE order_items 
        SET unit_price = p.price 
        FROM products p 
        WHERE order_items.product_id = p.id AND (order_items.unit_price IS NULL OR order_items.unit_price = 0)
    """))
    
    db.commit()
    print("Succès ! Les données sont prêtes.")
except Exception as e:
    print(f"Erreur : {e}")
    db.rollback()
finally:
    db.close()
