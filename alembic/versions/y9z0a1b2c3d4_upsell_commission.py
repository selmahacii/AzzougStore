# -*- coding: utf-8 -*-
"""upsell_commission

Upsell bonus (2026-07-22, Selma-requested): a confirmatrice who adds an
extra product on-call (Order.is_upsell) earns a bonus once that order
reaches DELIVERED — same "delivered-only" rule as every other commission
in salary_service.py, same historical-freeze pattern as recovered-cart/
lost-cart (see w7x8y9z0a1b2_order_commission_snapshot):

- users.payment_upsell: admin-configured DA rate per delivered upsell
  order (default 0 — no bonus unless explicitly set, matching
  payment_recovered_cart/payment_lost_cart's own defaults).
- orders.commission_upsell_rate: the employee's payment_upsell rate AT
  THE MOMENT snapshot_commission() ran — a later rate change never
  rewrites already-frozen commissions.

Historical orders (created before this migration) have
commission_upsell_rate NULL — compute_salary() falls back to the
employee's current payment_upsell for those, exactly matching every
other commission column's existing fallback behavior. Purely additive —
ADD COLUMN only, no data migration, no existing column touched.

Revision ID: y9z0a1b2c3d4
Revises: x8y9z0a1b2c3
Create Date: 2026-07-22
"""

from alembic import op
import sqlalchemy as sa

revision = 'y9z0a1b2c3d4'
down_revision = 'x8y9z0a1b2c3'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())

    user_cols = {c['name'] for c in inspector.get_columns('users')}
    if 'payment_upsell' not in user_cols:
        op.add_column('users', sa.Column('payment_upsell', sa.Integer(), nullable=True, server_default='0'))

    order_cols = {c['name'] for c in inspector.get_columns('orders')}
    if 'commission_upsell_rate' not in order_cols:
        op.add_column('orders', sa.Column('commission_upsell_rate', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('orders', 'commission_upsell_rate')
    op.drop_column('users', 'payment_upsell')
