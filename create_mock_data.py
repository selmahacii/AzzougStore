import os
import sys
import uuid
import random
from datetime import datetime, timezone, timedelta

sys.path.append("/app")

from app.db.session import SessionLocal
from app.models.store import Store
from app.models.product import Product
from app.models.order import Order, OrderItem
from app.models.user import User

def create_mock_product(db, store_id, index):
    product = Product(
        id=str(uuid.uuid4()),
        store_id=store_id,
        name=f"Produit Test {index}",
        slug=f"produit-test-{index}-{random.randint(1000, 9999)}",
        price=random.randint(2000, 15000),
        stock=100,
        is_active=True
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product

def generate_mock_orders_for_store(slug):
    db = SessionLocal()
    try:
        # Get store by slug
        store = db.query(Store).filter(Store.slug == slug).first()
        if not store:
            print(f"Store with slug '{slug}' not found.")
            return

        # Check products
        products = db.query(Product).filter(Product.store_id == store.id).limit(5).all()
        if not products:
            print(f"No products found for {store.name}. Creating some mock products...")
            for i in range(3):
                products.append(create_mock_product(db, store.id, i+1))

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
        
        created_count = 0

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
                order_number=f"MOCK-{store.name[:3].upper()}-{random.randint(10000, 99999)}",
                customer_name=f"Client Test {store.name} {i}",
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
            created_count += 1

        db.commit()
        print(f"Successfully created {created_count} mock orders for {store.name}!")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    generate_mock_orders_for_store("azconfort")
    generate_mock_orders_for_store("p")
