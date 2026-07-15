import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend')))

from app.db.session import SessionLocal
from app.models.order import Order
from app.schemas.order import OrderList
from sqlalchemy.orm import joinedload

def test_pydantic_serialization():
    db = SessionLocal()
    try:
        query = db.query(Order).filter(Order.is_deleted == False)
        total = query.count()
        orders = query.options(
            joinedload(Order.items),
            joinedload(Order.assignee),
            joinedload(Order.customer),
            joinedload(Order.carrier),
        ).limit(5).all()

        print(f"Total active orders in DB: {total}")
        if not orders:
            print("No orders found in database.")
            return

        order = orders[0]
        print(f"First order items count in SQL model: {len(order.items)}")
        for item in order.items:
            print(f"  - Item: {item.product_name}, Qty: {item.quantity}, Variant details: {item.variant_details}")

        # Let's serialize using OrderList
        payload = {
            "success": True,
            "data": orders,
            "total": total,
            "page": 1,
            "pageSize": 5,
            "totalPages": 1
        }
        serialized = OrderList(**payload)
        print("\nSerialized OrderList output:")
        first_serialized_order = serialized.data[0]
        
        # Check if items exists
        has_items = hasattr(first_serialized_order, 'items')
        print(f"Serialized order has 'items' attribute: {has_items}")
        if has_items:
            serialized_items = first_serialized_order.items
            print(f"Serialized order items count: {len(serialized_items)}")
            for item in serialized_items:
                print(f"  - Serialized Item: {item.product_name}, Qty: {item.quantity}, Variant details: {item.variant_details}")
        else:
            print("Warning: Serialized order does NOT have 'items' attribute!")

    finally:
        db.close()

if __name__ == '__main__':
    test_pydantic_serialization()
