# -*- coding: utf-8 -*-
"""add_store_sequence_number_to_orders

Adds a per-store sequential integer (store_sequence_number) to the orders table.
This number is shown in admin/agent interfaces as "Commande N.X".
The ORD-XXXXXX order_number is preserved for customer-facing display.

Backfill: existing orders receive sequential numbers ordered by created_at within each store.

Revision ID: m0n1o2p3q4r5
Revises: l9m0n1o2p3q4
Create Date: 2026-06-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

revision = 'm0n1o2p3q4r5'
down_revision = 'l9m0n1o2p3q4'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Add the column (nullable=True so existing rows stay valid)
    op.add_column('orders', sa.Column('store_sequence_number', sa.Integer(), nullable=True))

    # 2. Create index for fast per-store lookups
    op.create_index('idx_order_store_sequence', 'orders', ['store_id', 'store_sequence_number'])

    # 3. Backfill existing orders with sequential numbers per store (ascending created_at)
    conn = op.get_bind()
    stores = conn.execute(text("SELECT DISTINCT store_id FROM orders WHERE store_id IS NOT NULL")).fetchall()

    for store_row in stores:
        store_id = store_row[0]
        orders = conn.execute(text(
            "SELECT id FROM orders WHERE store_id = :store_id ORDER BY created_at ASC NULLS LAST, id ASC"
        ), {"store_id": store_id}).fetchall()

        for seq, order_row in enumerate(orders, start=1):
            conn.execute(text(
                "UPDATE orders SET store_sequence_number = :seq WHERE id = :order_id"
            ), {"seq": seq, "order_id": order_row[0]})


def downgrade():
    op.drop_index('idx_order_store_sequence', table_name='orders')
    op.drop_column('orders', 'store_sequence_number')
