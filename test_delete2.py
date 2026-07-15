import sys
import traceback
from app.db.session import SessionLocal
from sqlalchemy import text
from app.models.product import Product

db = SessionLocal()
try:
    pid = "prod-bfccf3e0355f"
    product = db.query(Product).filter(Product.id == pid).first()
    if product:
        db.delete(product)
        db.commit()
        print("Success delete")
    else:
        print("Not found")
except Exception as e:
    traceback.print_exc()

