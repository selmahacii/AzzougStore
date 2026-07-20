# -*- coding: utf-8 -*-
"""tiktok_capi_logs

TikTok Ads Enterprise integration, Phase 1: durable queue table for the
TikTok Events API (server-side), mirroring meta_capi_logs' proven schema
(see z3a4b5c6d7e8_meta_capi_retry_queue.py) — same durable-queue contract
(queued/processing/retry/pending_retry/success/failed/skipped), same dual
role (diagnostics dashboard + persistent retry queue).

Unlike meta_capi_logs, the composite (store_id, event_name, created_at)
index and the event_id index are created HERE, from day 1 — the
2026-07-20 Meta pre-deploy audit found both missing from meta_capi_logs
only after years of production data had already accumulated without them
(see 03d1936fa9f8_meta_capi_logs_query_indexes.py, prepared the same day).

Idempotent and purely additive.

Revision ID: b9f144d96c03
Revises: 03d1936fa9f8
Create Date: 2026-07-20
"""

from alembic import op
import sqlalchemy as sa

revision = 'b9f144d96c03'
down_revision = '03d1936fa9f8'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if 'tiktok_capi_logs' in inspector.get_table_names():
        return

    op.create_table(
        'tiktok_capi_logs',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=True),
        sa.Column('order_id', sa.String(), nullable=True),
        sa.Column('event_name', sa.String(), nullable=False),
        sa.Column('event_id', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('error_category', sa.String(), nullable=True),
        sa.Column('events_received', sa.Integer(), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('retry_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('next_retry_at', sa.DateTime(), nullable=True),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('processing_started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('last_http_status', sa.Integer(), nullable=True),
        sa.Column('processing_worker', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_tiktok_capi_logs_id', 'tiktok_capi_logs', ['id'])
    op.create_index('ix_tiktok_capi_logs_store_id', 'tiktok_capi_logs', ['store_id'])
    op.create_index('ix_tiktok_capi_logs_order_id', 'tiktok_capi_logs', ['order_id'])
    op.create_index('ix_tiktok_capi_logs_event_name', 'tiktok_capi_logs', ['event_name'])
    op.create_index('ix_tiktok_capi_logs_event_id', 'tiktok_capi_logs', ['event_id'])
    op.create_index('ix_tiktok_capi_logs_status', 'tiktok_capi_logs', ['status'])
    op.create_index('ix_tiktok_capi_logs_error_category', 'tiktok_capi_logs', ['error_category'])
    op.create_index('ix_tiktok_capi_logs_next_retry_at', 'tiktok_capi_logs', ['next_retry_at'])
    op.create_index(
        'ix_tiktok_capi_logs_store_event_created',
        'tiktok_capi_logs',
        ['store_id', 'event_name', 'created_at'],
    )


def downgrade():
    op.drop_table('tiktok_capi_logs')
