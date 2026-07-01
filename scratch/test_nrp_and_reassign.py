import sys
from datetime import datetime, timezone, timedelta

sys.path.append(r"c:\Users\ZBOOK\Downloads\azzougshop\backend")

from app.db.session import SessionLocal
from app.models.store import Store
from app.models.user import User
from app.models.product import Product
from app.models.order import Order
from app.models.events import OrderEvent
from app.services.order_service import order_service
from app.worker import auto_reassign_inactive_orders

def run_tests():
    db = SessionLocal()
    try:
        # 1. Setup Store, Products & Agents
        store = db.query(Store).first()
        if not store:
            print("FAILURE: No store found in database. Run seeding first.")
            return

        # Fetch a real product from this store to avoid foreign key violations
        product = db.query(Product).filter(Product.store_id == store.id).first()
        if not product:
            print(f"FAILURE: No product found for store {store.name} ({store.id}). Run seeding first.")
            return
        
        print(f"Using product: {product.name} ({product.id})")

        # Ensure assignment is active for store
        store.assignment_active = True
        store.assignment_logic = "ROUND_ROBIN"

        # Create two test agents/confimators
        agent_a = db.query(User).filter(User.email == "agent_a@test.com").first()
        if not agent_a:
            agent_a = User(
                id="agent_a_id",
                email="agent_a@test.com",
                name="Agent A",
                hashed_password="...",
                role="CONFIRMATEUR",
                is_active=True,
                employee_store_id=store.id
            )
            db.add(agent_a)
        else:
            agent_a.is_active = True
            agent_a.employee_store_id = store.id

        agent_b = db.query(User).filter(User.email == "agent_b@test.com").first()
        if not agent_b:
            agent_b = User(
                id="agent_b_id",
                email="agent_b@test.com",
                name="Agent B",
                hashed_password="...",
                role="CONFIRMATEUR",
                is_active=True,
                employee_store_id=store.id
            )
            db.add(agent_b)
        else:
            agent_b.is_active = True
            agent_b.employee_store_id = store.id

        db.commit()

        # ----------------------------------------------------
        # TEST 1: NRP Auto-Cancellation (5 attempts)
        # ----------------------------------------------------
        print("Running Test 1: NRP Auto-Cancellation...")
        
        # Create an order using agent_a.id as actor_id
        order = order_service.create_order(
            db=db,
            order_data={
                "store_id": store.id,
                "customer_name": "Test NRP Customer",
                "customer_phone": "0771234567",
                "customer_address": "Test Address",
                "customer_wilaya": "Alger",
                "total": 1200,
                "assigned_to": agent_a.id
            },
            items_data=[
                {
                    "product_id": product.id,
                    "product_name": product.name,
                    "quantity": 1,
                    "unit_price": 1200
                }
            ],
            actor_id=agent_a.id
        )
        db.commit()

        print(f"Created order {order.order_number} with status: {order.status}, nrp_count: {order.nrp_count}")

        # Simulate 5 NRP calls
        for attempt in range(1, 6):
            print(f"Submitting NRP call attempt #{attempt}...")
            order = order_service.update_order(
                db=db,
                order=order,
                update_data={
                    "call_result": "NRP",
                    "call_attempt": attempt
                },
                actor_id=agent_a.id
            )
            db.commit()
            print(f"  Order status: {order.status}, nrp_count: {order.nrp_count}, callback: {order.next_callback_time}")

        # Verify it is cancelled
        assert order.status == "CANCELLED", f"Expected CANCELLED, got {order.status}"
        assert order.nrp_count == 5, f"Expected 5, got {order.nrp_count}"
        assert order.next_callback_time is None, f"Expected None callback, got {order.next_callback_time}"

        # Verify log event exists
        cancel_event = db.query(OrderEvent).filter(
            OrderEvent.order_id == order.id,
            OrderEvent.to_status == "CANCELLED"
        ).first()
        assert cancel_event is not None, "Cancellation event not logged."
        assert "NRP" in cancel_event.note, f"Expected note containing NRP, got {cancel_event.note}"
        print("[SUCCESS] TEST 1: NRP Auto-Cancellation passed successfully!")

        # ----------------------------------------------------
        # TEST 2: Inactivity Auto-Reassignment
        # ----------------------------------------------------
        print("\nRunning Test 2: Inactivity Auto-Reassignment...")
        
        # Create an order assigned to agent_a
        order_inact = order_service.create_order(
            db=db,
            order_data={
                "store_id": store.id,
                "customer_name": "Test Inactive Customer",
                "customer_phone": "0771234568",
                "customer_address": "Test Address 2",
                "customer_wilaya": "Alger",
                "total": 1500,
                "assigned_to": agent_a.id
            },
            items_data=[
                {
                    "product_id": product.id,
                    "product_name": product.name,
                    "quantity": 1,
                    "unit_price": 1500
                }
            ],
            actor_id=agent_a.id
        )
        db.commit()

        # Artificially set updated_at to 2.5 hours ago
        order_inact.updated_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2, minutes=30)
        db.add(order_inact)
        db.commit()

        # Run the celery background task function directly
        res = auto_reassign_inactive_orders()
        print(f"Task result: {res}")

        # Reload order
        db.refresh(order_inact)
        print(f"Order assignee after reassignment check: {order_inact.assigned_to}")
        assert order_inact.assigned_to is not None, "Expected order to be assigned to someone."
        assert order_inact.assigned_to != agent_a.id, f"Expected reassigned away from {agent_a.name} ({agent_a.id}), but got {order_inact.assigned_to}"
        
        # Verify event
        reassign_event = db.query(OrderEvent).filter(
            OrderEvent.order_id == order_inact.id,
            OrderEvent.note.like("%Réassignation automatique%")
        ).first()
        assert reassign_event is not None, "Reassignment event not logged."
        print(f"Logged note: {reassign_event.note}")
        print("[SUCCESS] TEST 2: Inactivity Auto-Reassignment passed successfully!")

    finally:
        db.close()

if __name__ == "__main__":
    run_tests()
