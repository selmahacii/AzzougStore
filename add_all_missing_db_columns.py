import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

# We can also load from the parent folder .env if it is in backend folder
if not os.getenv("DATABASE_URL"):
    load_dotenv("../.env")

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("DATABASE_URL not found in environment or .env")
    exit(1)

print(f"Connecting to database...")
engine = create_engine(DATABASE_URL)

columns_by_table = {
    "products": [
        ("delivery_fees", "JSON", "NULL"),
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
    ],
    "orders": [
        ("delivery_type", "VARCHAR", "'HOME'"),
        ("delivery_fee", "INTEGER", "0"),
        ("tracking_number", "VARCHAR", "NULL"),
        ("carrier_id", "VARCHAR", "NULL"),
        ("subtotal", "INTEGER", "0"),
        ("discount", "INTEGER", "0"),
        ("total", "INTEGER", "0"),
        ("promo_code", "VARCHAR", "NULL"),
        ("status", "VARCHAR", "'NEW'"),
        ("assigned_to", "VARCHAR", "NULL"),
        ("customer_id", "VARCHAR", "NULL"),
        ("source", "VARCHAR", "NULL"),
        ("notes", "TEXT", "NULL"),
        ("is_deleted", "BOOLEAN", "FALSE"),
        ("deleted_at", "TIMESTAMP", "NULL"),
        ("is_pack", "BOOLEAN", "FALSE"),
        ("is_upsell", "BOOLEAN", "FALSE"),
        ("is_abandoned_cart", "BOOLEAN", "FALSE"),
        ("abandoned_cart_recovery_fee", "INTEGER", "0"),
        ("is_duplicate", "BOOLEAN", "FALSE"),
        ("confirmation_start_time", "TIMESTAMP", "NULL"),
        ("nrp_count", "INTEGER", "0"),
        ("next_callback_time", "TIMESTAMP", "NULL"),
        ("commission_store_pickup_rate", "INTEGER", "NULL"),
        ("commission_recovered_store_pickup_rate", "INTEGER", "NULL"),
    ],
    "users": [
        ("payment_store_pickup", "INTEGER", "100"),
        ("payment_recovered_store_pickup", "INTEGER", "150"),
    ],
    "order_items": [
        ("product_name", "VARCHAR", "''"),
        ("quantity", "INTEGER", "1"),
        ("unit_price", "INTEGER", "0"),
        ("variant_details", "JSON", "NULL"),
        ("image_url", "VARCHAR", "NULL"),
    ]
}

with engine.connect() as conn:
    for table_name, cols in columns_by_table.items():
        print(f"\n--- Checking table: {table_name} ---")
        for col_name, col_type, default_val in cols:
            try:
                # Check if column exists
                check_sql = text(f"SELECT 1 FROM information_schema.columns WHERE table_name='{table_name}' AND column_name='{col_name}'")
                exists = conn.execute(check_sql).fetchone()
                
                if not exists:
                    print(f"Adding column {col_name} ({col_type}) to table {table_name}...")
                    alter_sql = text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type} DEFAULT {default_val}")
                    conn.execute(alter_sql)
                    conn.commit()
                    print(f"Column {col_name} added successfully.")
                else:
                    print(f"Column {col_name} already exists.")
            except Exception as e:
                print(f"Error checking/adding {col_name} on table {table_name}: {e}")
                try:
                    conn.rollback()
                except:
                    pass

print("\nAll checks completed!")
