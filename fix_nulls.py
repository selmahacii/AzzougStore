import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    print("Correction des valeurs NULL pour is_deleted...")
    conn.execute(text("UPDATE orders SET is_deleted = false WHERE is_deleted IS NULL"))
    conn.commit()
    print("Terminé.")
