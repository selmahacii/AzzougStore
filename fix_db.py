import sys
from app.db.session import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    db.execute(text("ALTER TABLE product_delivery_partners ADD COLUMN created_at TIMESTAMP DEFAULT NOW(), ADD COLUMN updated_at TIMESTAMP DEFAULT NOW()"))
    db.commit()
    print("Columns added successfully")
except Exception as e:
    print(e)
