
import psycopg2

try:
    conn = psycopg2.connect("postgresql://postgres:password@localhost:5444/azzougshop")
    conn.autocommit = True
    cur = conn.cursor()
    
    print("Forcing created_at on orders...")
    try:
        cur.execute('ALTER TABLE "orders" ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()')
        print("Success adding to orders")
    except Exception as e:
        print(f"Orders note: {e}")
        
    print("Forcing updated_at on orders...")
    try:
        cur.execute('ALTER TABLE "orders" ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()')
        print("Success adding updated_at to orders")
    except Exception as e:
        print(f"Orders note: {e}")

    cur.close()
    conn.close()
except Exception as e:
    print(f"Fatal error: {e}")
