# -*- coding: utf-8 -*-
"""operations_config_and_notifications

- stores.operations_config: per-store business rules (max NRP attempts,
  callback delay, auto-merge duplicates toggle) — replaces hardcoded values.
- notifications: in-app notification feed (agents + admin broadcasts),
  with a channel column reserved for future email/push/whatsapp/sms.

Idempotent and purely additive.

Revision ID: r5s6t7u8v9w0
Revises: q4r5s6t7u8v9
Create Date: 2026-07-04
"""

from alembic import op
import sqlalchemy as sa

revision = 'r5s6t7u8v9w0'
down_revision = 'q4r5s6t7u8v9'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    tables = inspector.get_table_names()

    store_cols = {c['name'] for c in inspector.get_columns('stores')}
    if 'operations_config' not in store_cols:
        op.add_column('stores', sa.Column('operations_config', sa.JSON(), nullable=True))

    if 'notifications' not in tables:
        op.create_table(
            'notifications',
            sa.Column('id', sa.String(), primary_key=True, index=True),
            sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=True, index=True),
            sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=True, index=True),
            sa.Column('order_id', sa.String(), sa.ForeignKey('orders.id'), nullable=True, index=True),
            sa.Column('type', sa.String(), nullable=False, index=True),
            sa.Column('title', sa.String(), nullable=False),
            sa.Column('message', sa.Text(), nullable=True),
            sa.Column('channel', sa.String(), nullable=False, server_default='inapp'),
            sa.Column('is_read', sa.Boolean(), nullable=False, server_default=sa.text('false'), index=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        )


def downgrade():
    op.drop_table('notifications')
    op.drop_column('stores', 'operations_config')
