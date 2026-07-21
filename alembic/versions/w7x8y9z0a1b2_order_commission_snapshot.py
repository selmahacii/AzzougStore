# -*- coding: utf-8 -*-
"""order_commission_snapshot

Commission historical freeze (2026-07-21, Selma-requested — chantier #2 of
the assignment engine rework): commissions were previously recomputed
LIVE from Order.assigned_to (current) and the employee's CURRENT
payment_type/payment_amount every time a payroll report ran — a rate
change today silently rewrote every past commission for that employee,
including already-paid ones.

Adds a frozen snapshot on the order itself, captured at the exact moment
assigned_to is written (creation or reassignment — see
_snapshot_commission() in app/services/order_service.py):
- commission_agent_id: who the commission belongs to (mirrors assigned_to
  at snapshot time, kept separate so a LATER unrelated assigned_to change
  — e.g. re-running auto-assign — can't accidentally alter whose
  commission this is without an explicit new snapshot).
- commission_payment_type / commission_payment_amount /
  commission_recovered_rate / commission_lost_rate: the employee's pay
  settings AT THAT MOMENT.
- commission_snapshot_at: when the freeze happened, for auditability.

Historical orders (created before this migration) have all commission_*
columns NULL — compute_salary() falls back to the employee's current
settings for those, exactly matching pre-existing behavior, so nothing
retroactively changes for orders that already existed. Purely additive —
ADD COLUMN only, no data migration, no existing column touched.

Revision ID: w7x8y9z0a1b2
Revises: v6w7x8y9z0a1
Create Date: 2026-07-21
"""

from alembic import op
import sqlalchemy as sa

revision = 'w7x8y9z0a1b2'
down_revision = 'v6w7x8y9z0a1'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('orders')}

    if 'commission_agent_id' not in cols:
        op.add_column('orders', sa.Column('commission_agent_id', sa.String(), nullable=True))
    if 'commission_payment_type' not in cols:
        op.add_column('orders', sa.Column('commission_payment_type', sa.String(), nullable=True))
    if 'commission_payment_amount' not in cols:
        op.add_column('orders', sa.Column('commission_payment_amount', sa.Integer(), nullable=True))
    if 'commission_recovered_rate' not in cols:
        op.add_column('orders', sa.Column('commission_recovered_rate', sa.Integer(), nullable=True))
    if 'commission_lost_rate' not in cols:
        op.add_column('orders', sa.Column('commission_lost_rate', sa.Integer(), nullable=True))
    if 'commission_snapshot_at' not in cols:
        op.add_column('orders', sa.Column('commission_snapshot_at', sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column('orders', 'commission_snapshot_at')
    op.drop_column('orders', 'commission_lost_rate')
    op.drop_column('orders', 'commission_recovered_rate')
    op.drop_column('orders', 'commission_payment_amount')
    op.drop_column('orders', 'commission_payment_type')
    op.drop_column('orders', 'commission_agent_id')
