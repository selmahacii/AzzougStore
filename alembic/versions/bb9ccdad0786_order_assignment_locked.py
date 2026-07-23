# -*- coding: utf-8 -*-
"""order_assignment_locked

Explicit admin/manager assignment override (2026-07-23, reported live):
a PRODUCT-level Assignment Rule always wins over Order.assigned_to — the
correct fix for a STALE snapshot left over from before the rule existed.
But it also silently undid a deliberate, one-off administrative
reassignment: an admin manually handing one specific order to an agent
(e.g. she already has a relationship with that customer) got overridden
the moment the general PRODUCT rule was re-checked, even though the
admin's action was explicit and current, not stale.

orders.assignment_locked: when True, Order.assigned_to is authoritative
for THIS order and the Assignment Rule Engine must never override it.
Only set by an explicit ADMIN/SUPER_ADMIN/MANAGER reassignment (see
order_service.update_order) — never by auto-assign at creation, and never
by a confirmatrice's own "claim on action". Purely additive — ADD COLUMN
only, no data migration, no existing column touched. Defaults False, so
every existing order keeps today's behavior (rule engine governs) unless
an admin explicitly locks it going forward.

Revision ID: bb9ccdad0786
Revises: y9z0a1b2c3d4
Create Date: 2026-07-23
"""

from alembic import op
import sqlalchemy as sa

revision = 'bb9ccdad0786'
down_revision = 'y9z0a1b2c3d4'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    order_cols = {c['name'] for c in inspector.get_columns('orders')}
    if 'assignment_locked' not in order_cols:
        op.add_column(
            'orders',
            sa.Column('assignment_locked', sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade():
    op.drop_column('orders', 'assignment_locked')
