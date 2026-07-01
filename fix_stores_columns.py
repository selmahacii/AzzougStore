
import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("DATABASE_URL not found in .env")
    exit(1)

# Ensure we are using the correct port from .env if needed, 
# but DATABASE_URL usually has it.
print(f"Connecting to: {DATABASE_URL}")
engine = create_engine(DATABASE_URL)

stores_columns = [
    ("assignment_logic", "VARCHAR", "'MANUAL'"),
    ("auto_reassign_minutes", "INTEGER", "120"),
    ("assignment_active", "BOOLEAN", "FALSE"),
    ("marketing_config", "JSONB", "'{}'"),
]

with engine.connect() as conn:
    print("\nChecking 'stores' table columns...")
    for col_name, col_type, default_val in stores_columns:
        try:
            # Check if column exists
            check_sql = text(f"SELECT 1 FROM information_schema.columns WHERE table_name='stores' AND column_name='{col_name}'")
            result = conn.execute(check_sql).fetchone()
            
            if not result:
                print(f"Adding missing column: {col_name} ({col_type})")
                alter_sql = text(f"ALTER TABLE stores ADD COLUMN {col_name} {col_type} DEFAULT {default_val}")
                conn.execute(alter_sql)
                conn.commit()
                print(f"Column {col_name} added successfully.")
            else:
                print(f"Column {col_name} already exists.")
        except Exception as e:
            print(f"Error processing {col_name}: {e}")

print("\nDatabase update complete for 'stores' table.")
