import psycopg2

# Database URL from .env
DB_URL = "postgresql://postgres:password@localhost:5440/azzougshop"

def fix_table(cur, table, columns_to_add):
    print(f"Checking table: {table}")
    cur.execute(f"SELECT exists (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '{table}')")
    if not cur.fetchone()[0]:
        print(f"  Table {table} does not exist, skipping.")
        return

    for col, col_type in columns_to_add.items():
        cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '{table}' AND column_name = '{col}'")
        if not cur.fetchone():
            print(f"  Adding {col} to {table}")
            cur.execute(f'ALTER TABLE "{table}" ADD COLUMN {col} {col_type}')
        else:
            print(f"  Column {col} already exists in {table}")

try:
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    # 1. Fix order_events
    fix_table(cur, 'order_events', {
        'call_result': 'VARCHAR',
        'call_attempt': 'INTEGER DEFAULT 1',
        'scheduled_callback_at': 'TIMESTAMP',
        'updated_at': 'TIMESTAMP DEFAULT NOW()',
        'note': 'TEXT'
    })

    # 2. Fix stores
    fix_table(cur, 'stores', {
        'template_id': "VARCHAR DEFAULT 'modern'",
        'banner_url': 'VARCHAR',
        'assignment_logic': "VARCHAR DEFAULT 'MANUAL'",
        'auto_reassign_minutes': 'INTEGER DEFAULT 120',
        'assignment_active': 'BOOLEAN DEFAULT FALSE',
        'marketing_config': "JSONB DEFAULT '{}'"
    })

    # 3. delivery_partners — add FastAPI-required columns missing from Prisma schema
    fix_table(cur, 'delivery_partners', {
        'api_config_encrypted': 'TEXT',
        'fee_home':  'FLOAT DEFAULT 0.0',
        'fee_relay': 'FLOAT DEFAULT 0.0',
        'free_shipping_threshold': 'FLOAT',
        'is_sandbox':   'BOOLEAN DEFAULT TRUE',
        'webhook_url':  'VARCHAR',
        'last_test_at': 'TIMESTAMP',
        'last_test_ok': 'BOOLEAN',
    })

    # 4. products — ensure reserved_stock and production/allowed_carriers columns exist
    fix_table(cur, 'products', {
        'reserved_stock': 'INTEGER DEFAULT 0',
        'production_source': "VARCHAR DEFAULT 'imported'",
        'prod_supplier_name': 'VARCHAR',
        'prod_batch_qty': 'INTEGER DEFAULT 1',
        'prod_fabric_cost': 'INTEGER DEFAULT 0',
        'prod_fabric_supplier': 'VARCHAR',
        'prod_accessories_cost': 'INTEGER DEFAULT 0',
        'prod_accessories_supplier': 'VARCHAR',
        'prod_labor_cut_cost': 'INTEGER DEFAULT 0',
        'prod_labor_cut_supplier': 'VARCHAR',
        'prod_labor_sew_cost': 'INTEGER DEFAULT 0',
        'prod_labor_sew_supplier': 'VARCHAR',
        'prod_labor_finish_cost': 'INTEGER DEFAULT 0',
        'prod_labor_finish_supplier': 'VARCHAR',
        'prod_packaging_cost': 'INTEGER DEFAULT 0',
        'prod_packaging_supplier': 'VARCHAR',
        'prod_transport_cost': 'INTEGER DEFAULT 0',
        'prod_transport_supplier': 'VARCHAR',
        'prod_other_cost': 'INTEGER DEFAULT 0',
        'prod_other_supplier': 'VARCHAR',
        'prod_notes': 'VARCHAR',
        'allowed_carriers': "JSONB DEFAULT '[]'",
    })

    # 5. orders — ensure is_deleted exists (FastAPI filters on it)
    fix_table(cur, 'orders', {
        'is_deleted': 'BOOLEAN DEFAULT FALSE',
    })

    # 5b. users — ensure assignment fields exist
    fix_table(cur, 'users', {
        'assigned_store_scope': "VARCHAR DEFAULT 'ALL'",
        'assigned_store_ids': "JSONB DEFAULT '[]'",
        'assigned_product_ids': "JSONB DEFAULT '[]'",
    })

    # 5c. meta_ads_configs — add new fields for storefront tracking
    fix_table(cur, 'meta_ads_configs', {
        'pixel_id': 'VARCHAR',
        'domain_verification_tag': 'VARCHAR'
    })


    # 6. Ensure created_at/updated_at on all major tables
    for table in ['orders', 'order_items', 'stores', 'products', 'users', 'customers',
                  'order_events', 'delivery_partners', 'stock_movements']:
        fix_table(cur, table, {
            'created_at': 'TIMESTAMP DEFAULT NOW()',
            'updated_at': 'TIMESTAMP DEFAULT NOW()',
        })

    print("\nSuccess! Database schema is now in sync.")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
