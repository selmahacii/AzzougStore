import uuid
import random
import os
import sys
from datetime import datetime, timedelta, time

# Add current directory to path so we can import app
sys.path.append(os.getcwd())

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.user import User
from app.models.store import Store
from app.models.audit import AuditLog
from app.models.events import OrderEvent
from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.pos import POSSale, POSSession, POSSaleItem
from app.core.security import get_password_hash
from app.core.tenant import tenant_store_id

# Set super admin mode to bypass tenant filtering
tenant_store_id.set("SUPER_ADMIN_MODE")

def migrate_data():
    print("--- Starting Hyper-Intensive Revenue Evolution Migration ---")
    db = SessionLocal()
    try:
        # 1. Get Store
        store_slug = "trustshop"
        store = db.query(Store).filter(Store.slug == store_slug).first()
        if not store:
            print("Store 'trustshop' not found. Please run the previous migration first.")
            return
        
        # 2. Get Catalog
        products = db.query(Product).filter(Product.store_id == store.id).all()
        if not products:
            print("No products found. Please run the previous migration first.")
            return
            
        # 3. Get Agents
        agents = db.query(User).filter(User.employee_store_id == store.id).all()

        # 4. Generate 1000 Orders over 90 days with GROWTH
        print("Generating 1000 orders over 90 days with a clear GROWTH trend...")
        base_date = datetime.utcnow() - timedelta(days=90)
        
        wilayas = ["Alger", "Oran", "Constantine", "Setif", "Annaba", "Blida", "Tizi Ouzou", "Bejaia"]
        sources = ["facebook", "instagram", "tiktok", "google", "direct"]
        
        for i in range(1000):
            # Growth Factor: biased towards the end of the 90-day period
            progress = (i / 1000) ** 1.3 
            days_to_add = progress * 90
            order_time = base_date + timedelta(days=days_to_add) + timedelta(seconds=random.randint(0, 86400))
            
            if order_time > datetime.utcnow():
                order_time = datetime.utcnow()

            assigned_agent = random.choice(agents)
            
            # High confirmation/delivery rate to show healthy revenue
            status = random.choices(
                ["NEW", "ASSIGNED", "CALLED", "CONFIRMED", "SHIPPED", "DELIVERED", "RETURNED", "CANCELED"],
                weights=[2, 2, 5, 15, 20, 50, 3, 3]
            )[0]

            order = Order(
                id=str(uuid.uuid4()),
                store_id=store.id,
                order_number=f"TS-REV-{10000 + i}",
                customer_name=f"Client Growth {i}",
                customer_phone=f"0{random.randint(5, 7)}{random.randint(10000000, 99999999)}",
                customer_address=f"Quartier {random.randint(1, 100)}",
                customer_wilaya=random.choice(wilayas),
                delivery_type="HOME",
                delivery_fee=random.choice([0, 400, 700]),
                source=random.choice(sources),
                status=status,
                assigned_to=assigned_agent.id,
                total=0,
                created_at=order_time
            )
            db.add(order)
            
            # 1-4 items per order
            total_price = 0
            for _ in range(random.randint(1, 4)):
                p = random.choice(products)
                qty = random.randint(1, 2)
                item = OrderItem(
                    id=str(uuid.uuid4()),
                    order_id=order.id,
                    product_id=p.id,
                    product_name=p.name,
                    quantity=qty,
                    unit_price=p.price
                )
                db.add(item)
                total_price += p.price * qty
            
            order.total = total_price + order.delivery_fee
            
            if i % 200 == 0:
                db.commit()

        # 5. Generate 500 POS Sales (Point of Sale)
        print("Generating 500 POS sales to enrich revenue metrics...")
        pos_session = POSSession(
            id=str(uuid.uuid4()),
            store_id=store.id,
            user_id=agents[0].id,
            status="CLOSED",
            start_at=base_date,
            end_at=datetime.utcnow()
        )
        db.add(pos_session)
        db.commit()

        for i in range(500):
            progress = (i / 500)
            days_to_add = progress * 90
            sale_time = base_date + timedelta(days=days_to_add) + timedelta(seconds=random.randint(0, 86400))
            if sale_time > datetime.utcnow():
                sale_time = datetime.utcnow()

            price = random.randint(2000, 25000)
            sale = POSSale(
                id=str(uuid.uuid4()),
                session_id=pos_session.id,
                store_id=store.id,
                receipt_number=f"POS-REV-{i}",
                subtotal=price,
                total=price,
                payment_method=random.choice(["CASH", "CARD"]),
                created_at=sale_time
            )
            db.add(sale)
            
            p = random.choice(products)
            item = POSSaleItem(
                id=str(uuid.uuid4()),
                sale_id=sale.id,
                product_id=p.id,
                product_name=p.name,
                quantity=1,
                unit_price=price,
                total_price=price
            )
            db.add(item)
            
            if i % 100 == 0:
                db.commit()

        db.commit()
        print("\n--- Revenue Evolution Migration Successful! ---")
        print(f"Added 1000 orders and 500 POS sales with a growth trend over 90 days.")
        
    except Exception as e:
        db.rollback()
        print(f"Error during migration: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    migrate_data()
