import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("DATABASE_URL not found in .env")
    exit(1)

print(f"Connecting to database...")
engine = create_engine(DATABASE_URL)

col_name = "delivery_fees"
col_type = "JSON"
default_val = "NULL"

with engine.connect() as conn:
    try:
        print(f"Checking if column {col_name} exists...")
        # Check if column exists first
        check_sql = text(f"SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='{col_name}'")
        exists = conn.execute(check_sql).fetchone()
        
        if not exists:
            print(f"Adding column {col_name}...")
            alter_sql = text(f"ALTER TABLE products ADD COLUMN {col_name} {col_type} DEFAULT {default_val}")
            conn.execute(alter_sql)
            conn.commit()
            print(f"Column {col_name} added successfully.")
        else:
            print(f"Column {col_name} already exists.")
    except Exception as e:
        print(f"Error adding {col_name}: {e}")

print("Database update complete.")
