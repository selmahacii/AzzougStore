import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.models.order import Order
from app.schemas.order import OrderRead
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

try:
    order = db.query(Order).first()
    if order:
        print(f"Testing serialization for order: {order.id}")
        read = OrderRead.from_orm(order)
        print("Success!")
        print(read.model_dump_json(indent=2))
    else:
        print("No orders found!")
except Exception as e:
    print(f"Error during serialization: {e}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
