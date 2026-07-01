import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("DATABASE_URL not found in .env")
    exit(1)

engine = create_engine(DATABASE_URL)

configs_columns = [
    ("exchange_rate", "DOUBLE PRECISION", "1.0"),
    ("currency", "VARCHAR", "'USD'"),
]

campaigns_columns = [
    ("raw_spend", "DOUBLE PRECISION", "0.0"),
    ("currency", "VARCHAR", "'USD'"),
]

with engine.connect() as conn:
    # 1. Update meta_ads_configs
    for col_name, col_type, default_val in configs_columns:
        try:
            print(f"Checking column {col_name} on meta_ads_configs...")
            check_sql = text(f"SELECT 1 FROM information_schema.columns WHERE table_name='meta_ads_configs' AND column_name='{col_name}'")
            exists = conn.execute(check_sql).fetchone()
            if not exists:
                print(f"Adding column {col_name} to meta_ads_configs...")
                alter_sql = text(f"ALTER TABLE meta_ads_configs ADD COLUMN {col_name} {col_type} DEFAULT {default_val}")
                conn.execute(alter_sql)
                conn.commit()
                print("Added.")
            else:
                print("Already exists.")
        except Exception as e:
            print(f"Error: {e}")

    # 2. Update meta_ads_campaigns
    for col_name, col_type, default_val in campaigns_columns:
        try:
            print(f"Checking column {col_name} on meta_ads_campaigns...")
            check_sql = text(f"SELECT 1 FROM information_schema.columns WHERE table_name='meta_ads_campaigns' AND column_name='{col_name}'")
            exists = conn.execute(check_sql).fetchone()
            if not exists:
                print(f"Adding column {col_name} to meta_ads_campaigns...")
                alter_sql = text(f"ALTER TABLE meta_ads_campaigns ADD COLUMN {col_name} {col_type} DEFAULT {default_val}")
                conn.execute(alter_sql)
                conn.commit()
                print("Added.")
            else:
                print("Already exists.")
        except Exception as e:
            print(f"Error: {e}")

print("Database update complete.")
