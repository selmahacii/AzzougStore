# -*- coding: utf-8 -*-
"""add_order_merge_columns

Adds duplicate-merge tracking columns to the orders table:
- parent_order_id: the surviving order this duplicate was merged into
- merged_by: user id who performed the merge
- merged_at: timestamp of the merge
- status_before_merge: original status, kept for full traceability

Purely additive — no existing data is modified or deleted.

Revision ID: n1o2p3q4r5s6
Revises: m0n1o2p3q4r5
Create Date: 2026-07-04
"""

from alembic import op
import sqlalchemy as sa

revision = 'n1o2p3q4r5s6'
down_revision = 'm0n1o2p3q4r5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('orders', sa.Column('parent_order_id', sa.String(), nullable=True))
    op.add_column('orders', sa.Column('merged_by', sa.String(), nullable=True))
    op.add_column('orders', sa.Column('merged_at', sa.DateTime(), nullable=True))
    op.add_column('orders', sa.Column('status_before_merge', sa.String(), nullable=True))
    op.create_index('idx_order_parent', 'orders', ['parent_order_id'])


def downgrade():
    op.drop_index('idx_order_parent', table_name='orders')
    op.drop_column('orders', 'status_before_merge')
    op.drop_column('orders', 'merged_at')
    op.drop_column('orders', 'merged_by')
    op.drop_column('orders', 'parent_order_id')
