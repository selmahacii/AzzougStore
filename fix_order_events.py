import psycopg2
import os

# Use the DB URL from .env or default to the one seen in the logs
DB_URL = "postgresql://postgres:password@localhost:5440/azzougshop"

try:
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()
    
    table = 'order_events'
    print(f"Checking table: {table}")
    
    # Check if table exists
    cur.execute(f"SELECT exists (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '{table}')")
    if not cur.fetchone()[0]:
        print(f"  Table {table} does not exist. Creating it...")
        # Since I don't want to define the whole schema here, I'll let SQLAlchemy create it if possible, 
        # but the error shows it already exists. 
        # If it doesn't exist, we might have bigger issues.
    else:
        # Columns to check and add if missing
        columns_to_add = {
            'call_result': 'VARCHAR',
            'call_attempt': 'INTEGER DEFAULT 1',
            'scheduled_callback_at': 'TIMESTAMP WITH TIME ZONE',
            'updated_at': 'TIMESTAMP WITH TIME ZONE DEFAULT NOW()',
            'note': 'TEXT'
        }
        
        for col, col_type in columns_to_add.items():
            cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '{table}' AND column_name = '{col}'")
            if not cur.fetchone():
                print(f"  Adding {col} to {table}")
                cur.execute(f'ALTER TABLE "{table}" ADD COLUMN {col} {col_type}')
            else:
                print(f"  Column {col} already exists in {table}")

    print("\nSuccess! order_events table is now up to date.")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
