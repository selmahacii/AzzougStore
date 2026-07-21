# -*- coding: utf-8 -*-
"""assignment_rules_updated_at

Bug found via the Meta Ads audit (2026-07-21) — the first time this
session's local Postgres was actually reachable to run the full test
suite: assignment_rules was created via a raw op.create_table() that
listed only the columns the feature explicitly needed, forgetting that
every model inheriting app.db.base_class.Base also declares `updated_at`
(nullable=False, onupdate=func.now()) — the ORM issued SELECT/INSERT
statements referencing assignment_rules.updated_at, which never existed,
so EVERY query against this table raised UndefinedColumn. The
resolve_assignment_rule / resolve_courier_rule call sites already catch
and roll back on any query exception (defensive, added the same day), so
this degraded silently to "no rules ever match" rather than crashing
order creation — but silently non-functional is still a bug, not
acceptable behavior for a shipped feature.

Purely additive — ADD COLUMN only, backfilled via server_default so
existing rows (there are none yet in production, this table is brand
new) get a valid value instead of erroring.

Revision ID: x8y9z0a1b2c3
Revises: w7x8y9z0a1b2
Create Date: 2026-07-21
"""

from alembic import op
import sqlalchemy as sa

revision = 'x8y9z0a1b2c3'
down_revision = 'w7x8y9z0a1b2'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('assignment_rules')}
    if 'updated_at' not in cols:
        op.add_column(
            'assignment_rules',
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )


def downgrade():
    op.drop_column('assignment_rules', 'updated_at')
