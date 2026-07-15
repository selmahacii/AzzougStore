import sqlite3
import os
from sqlalchemy import create_engine, text

# First let's check what DB is used. There is usually a pyrefly.toml or .env
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.db.session import engine

def upgrade():
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE orders ADD COLUMN confirmation_start_time TIMESTAMP;"))
            conn.commit()
        except Exception as e:
            print("Error adding confirmation_start_time:", e)
            conn.rollback()
            
        try:
            conn.execute(text("ALTER TABLE orders ADD COLUMN nrp_count INTEGER DEFAULT 0;"))
            conn.commit()
        except Exception as e:
            print("Error adding nrp_count:", e)
            conn.rollback()
            
        try:
            conn.execute(text("ALTER TABLE orders ADD COLUMN next_callback_time TIMESTAMP;"))
            conn.commit()
        except Exception as e:
            print("Error adding next_callback_time:", e)
            conn.rollback()
            
    print("Migration finished!")

if __name__ == "__main__":
    upgrade()
