# -*- coding: utf-8 -*-
"""marketer_tracking

- users.tracking_code: real affiliate tracking identifier (matched against
  Order.utm_source / Order.campaign_id) so marketer leads/ROAS are computed
  from actual attributed orders instead of fabricated numbers.
- users.marketing_budget: admin-configured budget in DA, used for real ROAS.

Idempotent and purely additive.

Revision ID: u8v9w0x1y2z3
Revises: t7u8v9w0x1y2
Create Date: 2026-07-05
"""

from alembic import op
import sqlalchemy as sa

revision = 'u8v9w0x1y2z3'
down_revision = 't7u8v9w0x1y2'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    user_cols = {c['name'] for c in inspector.get_columns('users')}

    if 'tracking_code' not in user_cols:
        op.add_column('users', sa.Column('tracking_code', sa.String(), nullable=True))
        op.create_index('ix_users_tracking_code', 'users', ['tracking_code'], unique=True)
    if 'marketing_budget' not in user_cols:
        op.add_column('users', sa.Column('marketing_budget', sa.Integer(), nullable=True))


def downgrade():
    op.drop_index('ix_users_tracking_code', table_name='users')
    op.drop_column('users', 'tracking_code')
    op.drop_column('users', 'marketing_budget')
