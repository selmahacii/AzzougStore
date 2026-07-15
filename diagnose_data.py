import os
import sys

# Add backend dir to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.store import Store
from app.models.product import Product
from app.models.order import Order
from app.models.landing_page import LandingPage

db = SessionLocal()
try:
    print("--- STORES ---")
    stores = db.query(Store).all()
    for s in stores:
        print(f"Store ID: {s.id} | Slug: {s.slug} | Name: {s.name} | Active: {s.is_active} | Deleted: {s.is_deleted}")
        
    print("\n--- PRODUCTS ---")
    products = db.query(Product).all()
    for p in products:
        print(f"Product ID: {p.id} | Name: {p.name} | Store ID: {p.store_id} | Deleted: {p.is_deleted}")

    print("\n--- LANDING PAGES ---")
    lps = db.query(LandingPage).all()
    for lp in lps:
        print(f"LP ID: {lp.id} | Slug: {lp.slug} | Title: {lp.headline} | Store ID: {lp.store_id} | Product ID: {lp.product_id}")

    print("\n--- ORDERS COUNT BY STORE ---")
    for s in stores:
        cnt = db.query(Order).filter(Order.store_id == s.id, Order.is_deleted == False).count()
        print(f"Store: {s.name} ({s.slug}) -> {cnt} orders")

finally:
    db.close()
