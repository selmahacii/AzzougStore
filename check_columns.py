
import psycopg2
from psycopg2.extras import RealDictCursor

try:
    conn = psycopg2.connect("postgresql://postgres:password@localhost:5444/azzougshop")
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    tables = ['orders', 'order_items', 'stores', 'products', 'users']
    
    for table in tables:
        print(f"\n--- Columns in {table} ---")
        cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}' ORDER BY column_name")
        cols = cur.fetchall()
        for col in cols:
            print(col['column_name'])
            
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
