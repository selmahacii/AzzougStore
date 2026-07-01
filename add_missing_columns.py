import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("DATABASE_URL not found in .env")
    exit(1)

engine = create_engine(DATABASE_URL)

columns_to_add = [
    ("production_source", "VARCHAR", "'imported'"),
    ("prod_supplier_name", "VARCHAR", "NULL"),
    ("prod_batch_qty", "INTEGER", "1"),
    ("prod_fabric_cost", "INTEGER", "0"),
    ("prod_accessories_cost", "INTEGER", "0"),
    ("prod_labor_cut_cost", "INTEGER", "0"),
    ("prod_labor_sew_cost", "INTEGER", "0"),
    ("prod_labor_finish_cost", "INTEGER", "0"),
    ("prod_packaging_cost", "INTEGER", "0"),
    ("prod_transport_cost", "INTEGER", "0"),
    ("prod_other_cost", "INTEGER", "0"),
    ("prod_notes", "VARCHAR", "NULL"),
    ("allowed_carriers", "JSON", "'[]'"),
    ("prod_custom_charges", "JSON", "'[]'"),
]

with engine.connect() as conn:
    for col_name, col_type, default_val in columns_to_add:
        try:
            print(f"Adding column {col_name}...")
            # Check if column exists first
            check_sql = text(f"SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='{col_name}'")
            exists = conn.execute(check_sql).fetchone()
            
            if not exists:
                alter_sql = text(f"ALTER TABLE products ADD COLUMN {col_name} {col_type} DEFAULT {default_val}")
                conn.execute(alter_sql)
                conn.commit()
                print(f"Column {col_name} added successfully.")
            else:
                print(f"Column {col_name} already exists.")
        except Exception as e:
            print(f"Error adding {col_name}: {e}")

print("Database update complete.")
