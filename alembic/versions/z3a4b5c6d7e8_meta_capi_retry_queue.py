# -*- coding: utf-8 -*-
"""meta_capi_retry_queue

Hardening the Meta Conversions API integration: SSL handshake timeouts and
other transient network failures were previously permanent — a failed event
was logged as 'error' and never retried, silently losing conversion data.

Adds a persistent retry queue on meta_capi_logs:
- payload: the full event JSON, so a failed send can be reconstructed and
  retried later without needing the order to still exist / be re-queried.
- retry_count: attempts made so far (capped in application code).
- next_retry_at: when the background sweep should try again
  (exponential backoff with jitter, computed in app.services.meta_capi).
- pixel_id / access_token_ref: which config to resend with (the token
  itself is looked up fresh from MetaAdsConfig by store_id at retry time —
  never persisted in the log table).

status now also takes the values 'pending_retry' (queued, not yet given up)
and 'failed' (max retries exhausted — logged, not silently dropped).

Idempotent and purely additive.

Revision ID: z3a4b5c6d7e8
Revises: y2z3a4b5c6d7
Create Date: 2026-07-06
"""

from alembic import op
import sqlalchemy as sa

revision = 'z3a4b5c6d7e8'
down_revision = 'y2z3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('meta_capi_logs')}

    if 'payload' not in cols:
        op.add_column('meta_capi_logs', sa.Column('payload', sa.JSON(), nullable=True))
    if 'retry_count' not in cols:
        op.add_column('meta_capi_logs', sa.Column('retry_count', sa.Integer(), nullable=False, server_default='0'))
    if 'next_retry_at' not in cols:
        op.add_column('meta_capi_logs', sa.Column('next_retry_at', sa.DateTime(), nullable=True))
        op.create_index('ix_meta_capi_logs_next_retry_at', 'meta_capi_logs', ['next_retry_at'])
    if 'latency_ms' not in cols:
        op.add_column('meta_capi_logs', sa.Column('latency_ms', sa.Integer(), nullable=True))


def downgrade():
    op.drop_index('ix_meta_capi_logs_next_retry_at', table_name='meta_capi_logs')
    op.drop_column('meta_capi_logs', 'latency_ms')
    op.drop_column('meta_capi_logs', 'next_retry_at')
    op.drop_column('meta_capi_logs', 'retry_count')
    op.drop_column('meta_capi_logs', 'payload')
