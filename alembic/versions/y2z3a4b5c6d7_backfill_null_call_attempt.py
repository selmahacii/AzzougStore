# -*- coding: utf-8 -*-
"""backfill_null_call_attempt

The previous repair migration (x1y2z3a4b5c6) inserted order_events rows via
raw SQL without supplying call_attempt, leaving it NULL. OrderEventRead
required a non-optional int for that field, so any /orders response that
included one of these rows crashed with a 500 (ResponseValidationError).

The schema has been relaxed to Optional[int] (defensive, matches the
nullable DB column), and this migration backfills every existing NULL
call_attempt to 1 (the same default _log_event always uses) so the data is
clean regardless of which code path inserted it.

Idempotent (no-op once every row has a value).

Revision ID: y2z3a4b5c6d7
Revises: x1y2z3a4b5c6
Create Date: 2026-07-06
"""

from alembic import op
import sqlalchemy as sa

revision = 'y2z3a4b5c6d7'
down_revision = 'x1y2z3a4b5c6'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("UPDATE order_events SET call_attempt = 1 WHERE call_attempt IS NULL"))


def downgrade():
    pass
