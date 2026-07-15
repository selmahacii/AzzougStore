
import psycopg2
from psycopg2.extras import RealDictCursor

try:
    conn = psycopg2.connect("postgresql://postgres:password@localhost:5444/azzougshop")
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    print("Checking for 'orders' and 'order_items' tables in all schemas...")
    cur.execute("SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN ('orders', 'order_items')")
    tables = cur.fetchall()
    
    for t in tables:
        schema = t['table_schema']
        print(f"\n--- Columns in {schema}.orders ---")
        cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_schema = '{schema}' AND table_name = 'orders' ORDER BY column_name")
        cols = cur.fetchall()
        for col in cols:
            print(col['column_name'])
            
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
