
import psycopg2

try:
    conn = psycopg2.connect("postgresql://postgres:password@localhost:5444/azzougshop")
    conn.autocommit = True
    cur = conn.cursor()
    
    tables = ['orders', 'order_items', 'stores', 'products', 'users', 'customers', 'inventory_items', 'warehouse_items', 'stock_movements']
    
    for table in tables:
        print(f"Checking table: {table}")
        
        # Check if table exists
        cur.execute(f"SELECT exists (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '{table}')")
        if not cur.fetchone()[0]:
            print(f"  Table {table} does not exist, skipping.")
            continue

        # Check for created_at
        cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '{table}' AND column_name = 'created_at'")
        if not cur.fetchone():
            # Try to rename from "createdAt" (case sensitive might be the issue)
            cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '{table}' AND column_name ILIKE 'createdAt'")
            match = cur.fetchone()
            if match:
                col_to_rename = match[0]
                print(f"  Renaming {col_to_rename} to created_at in {table}")
                cur.execute(f'ALTER TABLE "{table}" RENAME COLUMN "{col_to_rename}" TO created_at')
            else:
                print(f"  Adding created_at to {table}")
                cur.execute(f'ALTER TABLE "{table}" ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()')
        
        # Check for updated_at
        cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '{table}' AND column_name = 'updated_at'")
        if not cur.fetchone():
            cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '{table}' AND column_name ILIKE 'updatedAt'")
            match = cur.fetchone()
            if match:
                col_to_rename = match[0]
                print(f"  Renaming {col_to_rename} to updated_at in {table}")
                cur.execute(f'ALTER TABLE "{table}" RENAME COLUMN "{col_to_rename}" TO updated_at')
            else:
                print(f"  Adding updated_at to {table}")
                cur.execute(f'ALTER TABLE "{table}" ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()')

    print("\nSuccess! Database timestamps are now standardized to snake_case.")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
