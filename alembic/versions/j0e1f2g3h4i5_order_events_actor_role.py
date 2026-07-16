# -*- coding: utf-8 -*-
"""order_events_actor_role

Livreur-role audit: OrderEvent had no way to record WHICH ROLE performed an
action (only actor_id, a live join to users.role that changes if the
person's role changes later). order_service.update_order() already
receives actor_role as a parameter but only used it to build a free-text
prefix inside order.notes — never persisted as its own field. Needed to
answer "depuis quel rôle" on the order history timeline, since a
confirmatrice and a livreur can both act on the same order.

Purely additive, nullable (existing rows have no actor_role — never
backfilled, since the role at the time of a historical action isn't
reconstructible from users.role today).

Revision ID: j0e1f2g3h4i5
Revises: i9d0e1f2g3h4
Create Date: 2026-07-16
"""

from alembic import op
import sqlalchemy as sa

revision = 'j0e1f2g3h4i5'
down_revision = 'i9d0e1f2g3h4'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('order_events')}
    if 'actor_role' not in cols:
        op.add_column('order_events', sa.Column('actor_role', sa.String(), nullable=True))


def downgrade():
    op.drop_column('order_events', 'actor_role')
