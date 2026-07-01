import sys
import os
import psycopg2
from psycopg2.extras import RealDictCursor

# Add backend directory to sys.path so we can import from app
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db.session import engine
from app.db.base_class import Base
# Import models to ensure they are registered on Base
from app.models import (
    User, Store, AuditLog, Product, Order, OrderItem, StockMovement,
    OrderEvent, Customer, Promotion, Wallet, FinancialTransaction, Review,
    Warehouse, OrderStatusConfig, Supplier, Purchase, PurchaseItem, Return,
    ReturnItem, Expense, WilayaDeliveryFee, PartnerApiKey, PartnerWebhook,
    DeliveryPartner, POSSale, MarketingChannel, MessageTemplate,
    MarketingAutomation, MarketingLog, MetaAdsConfig, MetaAdsCampaign,
    UpsellRule, UpsellOffer, UpsellCommission, InternalDelivery
)

DB_URL = "postgresql://postgres:password@localhost:5440/azzougshop"

def add_columns_if_missing():
    print("Connecting to database on port 5440...")
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # 1. Purchases table
    purchases_cols = {
        'bon_type': "VARCHAR DEFAULT 'PURCHASE_ORDER'",
        'photos': "JSONB DEFAULT '[]'",
        'validated_at': "TIMESTAMP",
        'validated_by': "VARCHAR REFERENCES users(id) ON DELETE SET NULL"
    }
    for col, col_def in purchases_cols.items():
        cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = 'purchases' AND column_name = '{col}'")
        if not cur.fetchone():
            print(f"Adding '{col}' to 'purchases'...")
            cur.execute(f"ALTER TABLE purchases ADD COLUMN {col} {col_def}")

    # 2. Delivery Partners table
    dp_cols = {
        'type': "VARCHAR DEFAULT 'EXTERNAL'",
        'commission_type': "VARCHAR DEFAULT 'FIXED'",
        'commission_value': "DOUBLE PRECISION DEFAULT 0.0",
        'performance_score': "DOUBLE PRECISION DEFAULT 100.0"
    }
    for col, col_def in dp_cols.items():
        cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = 'delivery_partners' AND column_name = '{col}'")
        if not cur.fetchone():
            print(f"Adding '{col}' to 'delivery_partners'...")
            cur.execute(f"ALTER TABLE delivery_partners ADD COLUMN {col} {col_def}")

    # 3. Products table
    prod_cols = {
        'pack_items': "JSONB DEFAULT '[]'",
        'pack_charges': "JSONB DEFAULT '[]'",
        'pack_margin': "DOUBLE PRECISION DEFAULT 0.0",
        'pack_options': "JSONB DEFAULT '[]'"
    }
    for col, col_def in prod_cols.items():
        cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = 'products' AND column_name = '{col}'")
        if not cur.fetchone():
            print(f"Adding '{col}' to 'products'...")
            cur.execute(f"ALTER TABLE products ADD COLUMN {col} {col_def}")

    # 4. Suppliers table
    sup_cols = {
        'custom_fields': "JSONB DEFAULT '{}'",
        'purchase_price': "INTEGER",
        'margin_percent': "DOUBLE PRECISION",
        'extra_charges': "JSONB DEFAULT '[]'"
    }
    for col, col_def in sup_cols.items():
        cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = 'suppliers' AND column_name = '{col}'")
        if not cur.fetchone():
            print(f"Adding '{col}' to 'suppliers'...")
            cur.execute(f"ALTER TABLE suppliers ADD COLUMN {col} {col_def}")

    cur.close()
    conn.close()
    print("New columns added successfully!")

def create_new_tables():
    print("Creating new Phase 2 tables via SQLAlchemy...")
    Base.metadata.create_all(bind=engine)
    print("New tables created successfully!")

if __name__ == "__main__":
    try:
        # Create tables first so foreign keys reference correctly
        create_new_tables()
        add_columns_if_missing()
        print("All database migrations completed successfully for Phase 2!")
    except Exception as e:
        print(f"Error migrating database: {e}")
        sys.exit(1)
