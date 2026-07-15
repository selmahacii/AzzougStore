# -*- coding: utf-8 -*-
"""recovered_at_and_livreur

- orders.recovered_at: business-origin marker set the first time an abandoned
  cart reaches CONFIRMED. The order TYPE (normal/abandoned/recovered) derives
  from is_abandoned_cart + recovered_at and never flips with status changes.
  Backfilled for carts already confirmed/shipped/delivered.
- orders.livreur_id: delivery agent (role LIVREUR) the confirmatrice hands
  the parcel to.

Idempotent and purely additive.

Revision ID: t7u8v9w0x1y2
Revises: s6t7u8v9w0x1
Create Date: 2026-07-04
"""

from alembic import op
import sqlalchemy as sa

revision = 't7u8v9w0x1y2'
down_revision = 's6t7u8v9w0x1'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    order_cols = {c['name'] for c in inspector.get_columns('orders')}

    if 'recovered_at' not in order_cols:
        op.add_column('orders', sa.Column('recovered_at', sa.DateTime(), nullable=True))
        # Backfill: carts already recovered keep their origin forever
        op.execute(
            "UPDATE orders SET recovered_at = COALESCE(updated_at, created_at) "
            "WHERE is_abandoned_cart = true "
            "AND status IN ('CONFIRMED', 'SHIPPED', 'DELIVERED') "
            "AND recovered_at IS NULL"
        )

    if 'livreur_id' not in order_cols:
        op.add_column('orders', sa.Column('livreur_id', sa.String(), sa.ForeignKey('users.id'), nullable=True))
        op.create_index('ix_orders_livreur_id', 'orders', ['livreur_id'])


def downgrade():
    op.drop_index('ix_orders_livreur_id', table_name='orders')
    op.drop_column('orders', 'livreur_id')
    op.drop_column('orders', 'recovered_at')
