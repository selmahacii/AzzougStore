import sys
import traceback
from app.db.session import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    pid = "prod-bfccf3e0355f"
    db.execute(text("UPDATE stock_movements SET product_id = NULL WHERE product_id = :pid"), {"pid": pid})
    db.execute(text("UPDATE purchase_items  SET product_id = NULL WHERE product_id = :pid"), {"pid": pid})
    db.execute(text("UPDATE pos_sale_items  SET product_id = NULL WHERE product_id = :pid"), {"pid": pid})
    db.execute(text("UPDATE return_items    SET product_id = NULL WHERE product_id = :pid"), {"pid": pid})
    print("Success")
except Exception as e:
    traceback.print_exc()

