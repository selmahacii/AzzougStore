
import psycopg2
from psycopg2.extras import RealDictCursor

try:
    conn = psycopg2.connect("postgresql://postgres:password@localhost:5444/azzougshop")
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    cur.execute("SELECT table_schema, table_name FROM information_schema.tables WHERE table_name ILIKE 'orders' OR table_name ILIKE 'order_items'")
    tables = cur.fetchall()
    
    for t in tables:
        print(f"Schema: {t['table_schema']}, Name: {t['table_name']}")
        
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
