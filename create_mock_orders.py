import os
import sys
import uuid
import random
from datetime import datetime, timezone, timedelta

# In the container, /app is the root of backend
sys.path.append("/app")

from app.db.session import SessionLocal
from app.models.store import Store
from app.models.product import Product
from app.models.order import Order, OrderItem
from app.models.user import User

def generate_mock_orders():
    db = SessionLocal()
    try:
        # Get a store
        store = db.query(Store).first()
        if not store:
            print("No store found. Please create a store first.")
            return

        # Get some products
        products = db.query(Product).filter(Product.store_id == store.id).limit(5).all()
        if not products:
            print("No products found. Please create products first.")
            return

        # Get an agent
        agent = db.query(User).filter(User.role == "AGENT").first()
        agent_id = agent.id if agent else None

        statuses = [
            "NEW", "ASSIGNED", "IN_PROGRESS", "CALLED", 
            "CONFIRMED", "SHIPPED", "DELIVERED", 
            "RETURNED", "CANCELLED"
        ]
        
        print(f"Creating 25 mock orders for store {store.name}...")

        base_time = datetime.now(timezone.utc).replace(tzinfo=None)

        for i in range(25):
            order_id = str(uuid.uuid4())
            status = random.choice(statuses)
            
            # Select random product
            product = random.choice(products)
            qty = random.randint(1, 3)
            price = product.price
            total = qty * price + 500 # 500 DA for delivery
            
            new_order = Order(
                id=order_id,
                store_id=store.id,
                order_number=f"MOCK-{random.randint(10000, 99999)}",
                customer_name=f"Client Test {i}",
                customer_phone=f"0550{random.randint(100000, 999999)}",
                customer_address=f"Adresse Test {i}",
                customer_wilaya="Alger",
                delivery_fee=500,
                subtotal=qty * price,
                total=total,
                status=status,
                assigned_to=agent_id if status not in ["NEW"] else None,
                created_at=base_time - timedelta(hours=random.randint(1, 72)),
            )
            
            new_item = OrderItem(
                id=str(uuid.uuid4()),
                order_id=order_id,
                product_id=product.id,
                product_name=product.name,
                quantity=qty,
                unit_price=price
            )
            
            db.add(new_order)
            db.add(new_item)

        db.commit()
        print("Successfully created 25 mock orders!")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    generate_mock_orders()
