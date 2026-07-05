# -*- coding: utf-8 -*-
"""meta_capi_error_category

Adds meta_capi_logs.error_category so the diagnostics dashboard can split
"network is unreachable" (timeouts, DNS/TCP/TLS failures — infrastructure)
from "Meta rejected the request" (4xx/5xx — application/config) instead of
lumping everything into a single success/error rate.

Values: network_timeout | network_error | api_4xx | api_5xx | other | NULL
(NULL for rows logged before this migration).

Idempotent and purely additive.

Revision ID: a4b5c6d7e8f9
Revises: z3a4b5c6d7e8
Create Date: 2026-07-05
"""

from alembic import op
import sqlalchemy as sa

revision = 'a4b5c6d7e8f9'
down_revision = 'z3a4b5c6d7e8'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('meta_capi_logs')}
    if 'error_category' not in cols:
        op.add_column('meta_capi_logs', sa.Column('error_category', sa.String(), nullable=True))
        op.create_index('ix_meta_capi_logs_error_category', 'meta_capi_logs', ['error_category'])


def downgrade():
    op.drop_index('ix_meta_capi_logs_error_category', table_name='meta_capi_logs')
    op.drop_column('meta_capi_logs', 'error_category')
