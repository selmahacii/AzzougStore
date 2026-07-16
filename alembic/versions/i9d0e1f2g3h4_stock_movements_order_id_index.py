# -*- coding: utf-8 -*-
"""stock_movements_order_id_index

Return-reintegration audit needs `WHERE order_id = X` / `EXISTS (... WHERE
sm.order_id = o.id AND sm.type = ...)` lookups against stock_movements
(9582 rows in production today, growing) — there was no index on order_id
at all, only on `type` and the PK. Same redundant-index finding as the
earlier meta_capi_logs audit: `ix_stock_movements_id` duplicates the
primary key's own unique index for zero benefit, dropped here too.

Revision ID: i9d0e1f2g3h4
Revises: h8c9d0e1f2g3
Create Date: 2026-07-16
"""

from alembic import op
import sqlalchemy as sa

revision = 'i9d0e1f2g3h4'
down_revision = 'h8c9d0e1f2g3'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    indexes = {i['name'] for i in inspector.get_indexes('stock_movements')}
    if 'ix_stock_movements_order_id' not in indexes:
        op.create_index('ix_stock_movements_order_id', 'stock_movements', ['order_id'])
    if 'ix_stock_movements_id' in indexes:
        op.drop_index('ix_stock_movements_id', table_name='stock_movements')


def downgrade():
    op.create_index('ix_stock_movements_id', 'stock_movements', ['id'])
    op.drop_index('ix_stock_movements_order_id', table_name='stock_movements')
