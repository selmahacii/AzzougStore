# -*- coding: utf-8 -*-
"""order_items_missing_indexes

Production-audit finding (EXPLAIN-verified, not assumed): order_items had
NO index on order_id or product_id at all — every single order-detail load
(order.items relationship, used by send_purchase_for_order/
build_purchase_event, every order view in the app) and the new landing-page
tracking-quality endpoint were doing a full Seq Scan on order_items.

At today's ~1000 rows this costs ~50ms of planner cost (cheap), but it is
an O(n) scan on every single order-items lookup in the entire app, and it
was flagged explicitly during this audit ("aucun scan complet évitable").
Confirmed via EXPLAIN before writing this migration:

    Seq Scan on order_items  (cost=0.00..49.19 rows=1 width=0)
      Filter: ((order_id)::text = ...)

Revision ID: h8c9d0e1f2g3
Revises: g7b8c9d0e1f2
Create Date: 2026-07-16
"""

from alembic import op
import sqlalchemy as sa

revision = 'h8c9d0e1f2g3'
down_revision = 'g7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    indexes = {i['name'] for i in inspector.get_indexes('order_items')}
    if 'ix_order_items_order_id' not in indexes:
        op.create_index('ix_order_items_order_id', 'order_items', ['order_id'])
    if 'ix_order_items_product_id' not in indexes:
        op.create_index('ix_order_items_product_id', 'order_items', ['product_id'])


def downgrade():
    op.drop_index('ix_order_items_product_id', table_name='order_items')
    op.drop_index('ix_order_items_order_id', table_name='order_items')
