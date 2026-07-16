# -*- coding: utf-8 -*-
"""meta_capi_durable_queue

Turns meta_capi_logs into a real durable job queue so a Purchase event can
survive a HuggingFace container restart between "order committed" and
"background task executed" — the gap that let 22 real ORD-* orders (29 Jun -
7 Jul) get zero CAPI attempt, not even a failed one, because no row existed
for them yet when the process died.

New statuses used by app.services.meta_capi going forward: 'queued' (row
written in the SAME transaction as the order, before the background task is
even scheduled), 'processing' (claimed by a worker), 'retry' (failed but
still eligible), 'failed' (exhausted). 'success' and legacy 'pending_retry'/
'error' values from before this migration are left as-is (no backfill: they
describe already-finished sends the new pipeline doesn't need to touch).

New columns are purely additive:
- processing_started_at: when a worker claimed the row — used to detect a
  worker that died mid-send (stuck 'processing' beyond 15 minutes).
- completed_at: when the row reached success/failed.
- last_http_status: raw Meta/relay HTTP status code (the old schema only
  had a coarse error_category bucket, not the actual code).
- processing_worker: hostname:pid of whichever process handled the attempt
  — useful when several HF replicas exist, purely diagnostic.

Deliberately NOT added (reusing existing columns instead, to avoid
duplicate-meaning columns per the request's own "no N+1 / minimal traffic"
goal): attempt_count -> retry_count (already tracks attempts across
sweeps), processing_duration_ms -> latency_ms (already the send-duration
column), last_error -> error_message (already exists).

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-07-16
"""

from alembic import op
import sqlalchemy as sa

revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('meta_capi_logs')}
    indexes = {i['name'] for i in inspector.get_indexes('meta_capi_logs')}

    if 'processing_started_at' not in cols:
        op.add_column('meta_capi_logs', sa.Column('processing_started_at', sa.DateTime(), nullable=True))
    if 'completed_at' not in cols:
        op.add_column('meta_capi_logs', sa.Column('completed_at', sa.DateTime(), nullable=True))
    if 'last_http_status' not in cols:
        op.add_column('meta_capi_logs', sa.Column('last_http_status', sa.Integer(), nullable=True))
    if 'processing_worker' not in cols:
        op.add_column('meta_capi_logs', sa.Column('processing_worker', sa.String(), nullable=True))

    # The sweep's core query is `WHERE status IN (...) AND next_retry_at <= now()`
    # (or the stuck-processing scan `WHERE status='processing' AND
    # processing_started_at < cutoff`) — a composite index lets both run as a
    # single index range scan instead of a status-index lookup + row filter.
    if 'ix_meta_capi_logs_status_next_retry' not in indexes:
        op.create_index(
            'ix_meta_capi_logs_status_next_retry', 'meta_capi_logs',
            ['status', 'next_retry_at'],
        )
    if 'ix_meta_capi_logs_status_processing_started' not in indexes:
        op.create_index(
            'ix_meta_capi_logs_status_processing_started', 'meta_capi_logs',
            ['status', 'processing_started_at'],
        )


def downgrade():
    op.drop_index('ix_meta_capi_logs_status_processing_started', table_name='meta_capi_logs')
    op.drop_index('ix_meta_capi_logs_status_next_retry', table_name='meta_capi_logs')
    op.drop_column('meta_capi_logs', 'processing_worker')
    op.drop_column('meta_capi_logs', 'last_http_status')
    op.drop_column('meta_capi_logs', 'completed_at')
    op.drop_column('meta_capi_logs', 'processing_started_at')
