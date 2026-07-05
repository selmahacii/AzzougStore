# -*- coding: utf-8 -*-
"""payroll_records_timestamps

Fixes a production bug: PayrollRecord (like every model) inherits
created_at/updated_at from db.base_class.Base, but the original
add_payroll_records migration (p3q4r5s6t7u8) never created these two
columns on the table. Every ORM SELECT against PayrollRecord includes them,
so any query (e.g. the monthly payroll reminder scan) crashes with
psycopg2.errors.UndefinedColumn on production databases that only ever ran
that original migration.

Idempotent and purely additive.

Revision ID: v9w0x1y2z3a4
Revises: u8v9w0x1y2z3
Create Date: 2026-07-06
"""

from alembic import op
import sqlalchemy as sa

revision = 'v9w0x1y2z3a4'
down_revision = 'u8v9w0x1y2z3'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('payroll_records')}

    if 'created_at' not in cols:
        op.add_column(
            'payroll_records',
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        )
    if 'updated_at' not in cols:
        op.add_column(
            'payroll_records',
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        )


def downgrade():
    op.drop_column('payroll_records', 'updated_at')
    op.drop_column('payroll_records', 'created_at')
