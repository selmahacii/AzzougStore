import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

try:
    print("Checking status values in DB...")
    results = db.execute(text("SELECT status, count(*) FROM orders GROUP BY status")).all()
    for row in results:
        print(f"Status: '{row[0]}', Count: {row[1]}")
except Exception as e:
    print(f"Error: {e}")
finally:
    db.close()
