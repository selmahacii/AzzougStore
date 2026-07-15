
from app.db.session import SessionLocal
from app.models.order import Order
from app.models.user import User
from sqlalchemy import func, case
import json

db = SessionLocal()
try:
    print("--- Orders Overview ---")
    total_orders = db.query(func.count(Order.id)).scalar()
    orders_with_assigned = db.query(func.count(Order.id)).filter(Order.assigned_to != None).scalar()
    print(f"Total Orders: {total_orders}")
    print(f"Orders with assigned_to: {orders_with_assigned}")

    print("\n--- Assigned Agents ---")
    assigned_agents = db.query(Order.assigned_to, func.count(Order.id)).group_by(Order.assigned_to).all()
    for agent_id, count in assigned_agents:
        if agent_id:
            user = db.query(User).filter(User.id == agent_id).first()
            print(f"Agent ID: {agent_id}, Name: {user.name if user else 'NOT FOUND'}, Order Count: {count}")
        else:
            print(f"Unassigned Orders: {count}")

    print("\n--- Analytics Agents Query Simulation ---")
    confirmed_case = case((Order.status == "CONFIRMED", 1), else_=0)
    results = db.query(
        User.id,
        User.name,
        func.count(Order.id).label("total"),
        func.sum(confirmed_case).label("confirmed")
    ).join(Order, Order.assigned_to == User.id).group_by(User.id, User.name).order_by(func.count(Order.id).desc()).limit(10).all()
    
    print(f"Query Results: {results}")

except Exception as e:
    print(f"ERROR: {e}")
finally:
    db.close()
