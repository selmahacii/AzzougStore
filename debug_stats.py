
from app.db.session import SessionLocal
from app.models.customer import Customer
from sqlalchemy import func
import json

db = SessionLocal()
try:
    store_id = "0c1e1c06-4a8e-421d-961b-78b688db7560"
    
    print("--- Testing count ---")
    total = db.query(Customer).filter(Customer.store_id == store_id).count()
    print(f"Total: {total}")
    
    print("\n--- Testing Tier Dist ---")
    tier_dist = db.query(
        Customer.tier,
        func.count(Customer.id).label("count"),
        func.sum(Customer.total_spent).label("revenue")
    ).filter(Customer.store_id == store_id).group_by(Customer.tier).all()
    print(f"Tier Dist: {tier_dist}")
    
    print("\n--- Testing Top Customers ---")
    top_customers = db.query(Customer).filter(Customer.store_id == store_id).order_by(Customer.total_spent.desc()).limit(5).all()
    print(f"Top Customers: {len(top_customers)}")
    
except Exception as e:
    print(f"ERROR: {e}")
finally:
    db.close()
