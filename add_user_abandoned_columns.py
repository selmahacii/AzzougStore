import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

# We can also load from the main folder .env if it is in backend folder
if not os.getenv("DATABASE_URL"):
    # Try parent directory
    load_dotenv("../.env")

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("DATABASE_URL not found in .env")
    exit(1)

engine = create_engine(DATABASE_URL)

columns_to_add = [
    ("payment_recovered_cart", "INTEGER", "0"),
    ("payment_lost_cart", "INTEGER", "0"),
]

with engine.connect() as conn:
    for col_name, col_type, default_val in columns_to_add:
        try:
            print(f"Adding column {col_name}...")
            # Check if column exists first
            check_sql = text(f"SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='{col_name}'")
            exists = conn.execute(check_sql).fetchone()
            
            if not exists:
                alter_sql = text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type} DEFAULT {default_val}")
                conn.execute(alter_sql)
                conn.commit()
                print(f"Column {col_name} added successfully.")
            else:
                print(f"Column {col_name} already exists.")
        except Exception as e:
            print(f"Error adding {col_name}: {e}")

print("Database update complete.")
