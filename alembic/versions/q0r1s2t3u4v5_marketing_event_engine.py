# -*- coding: utf-8 -*-
"""marketing_event_engine

Foundation tables for the provider-agnostic Marketing Event Engine
(replaces per-provider ad-hoc queues like meta_capi_logs going forward —
meta_capi_logs stays untouched here, purely additive, read-only migration
path handled in a later phase once shadow-mode parity is confirmed):

- provider_event_mappings: data-driven business_event -> provider_event
  mapping, editable without a deploy (store_id=NULL row = default, a
  store-specific row overrides it).
- marketing_events: append-only event store (source of truth for what
  the ERP decided to tell ad platforms), the durable Postgres-only queue
  (status pending/processing/sent/failed/retry/cancelled, consumed via
  SELECT ... FOR UPDATE SKIP LOCKED — no Redis/Kafka/SQS).
- marketing_event_attempts: one row per delivery attempt, never
  overwritten — full audit trail (latency, http status, raw API
  response, worker) survives every retry instead of being clobbered by
  the last attempt like a naive queue table would.

Idempotent and purely additive. No existing table (orders, meta_capi_logs,
order_events, meta_ads_configs...) is modified — zero risk to the current
Meta CAPI flow, auto_merge_duplicates, dashboards, or carrier sync while
this migration lands. The engine only starts writing here once code in a
later commit calls it, and only in 'shadow' mode by default.

Revision ID: q0r1s2t3u4v5
Revises: p9q0r1s2t3u4
Create Date: 2026-07-19
"""

from alembic import op
import sqlalchemy as sa

revision = 'q0r1s2t3u4v5'
down_revision = 'p9q0r1s2t3u4'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    tables = inspector.get_table_names()

    if 'provider_event_mappings' not in tables:
        op.create_table(
            'provider_event_mappings',
            sa.Column('id', sa.String(), primary_key=True, index=True),
            # NULL = default mapping applied to every store; a non-null row
            # for the same (provider, business_event) overrides it for that
            # store only — lets one store disable/retarget a provider event
            # without touching the global default.
            sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=True, index=True),
            sa.Column('provider', sa.String(), nullable=False, index=True),
            sa.Column('business_event', sa.String(), nullable=False, index=True),
            sa.Column('provider_event', sa.String(), nullable=False),
            # immediate | on_confirmed | on_delivery — when the mapping
            # actually fires relative to the business event's own timing;
            # COD ROAS strategy lives here, not hardcoded per provider.
            sa.Column('strategy', sa.String(), nullable=False, server_default='immediate'),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.text('true')),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
            sa.UniqueConstraint('store_id', 'provider', 'business_event', name='uq_provider_event_mapping'),
        )

    if 'marketing_events' not in tables:
        op.create_table(
            'marketing_events',
            sa.Column('id', sa.String(), primary_key=True, index=True),
            # Deterministic: f"{business_event}-{order_id}-{provider}-{payload_version}"
            # — the real dedup guarantee is the UNIQUE constraint below, not
            # this being merely "usually unique" like a random uuid would be.
            sa.Column('event_id', sa.String(), nullable=False),
            sa.Column('business_event', sa.String(), nullable=False, index=True),
            sa.Column('provider', sa.String(), nullable=False, index=True),
            sa.Column('provider_event', sa.String(), nullable=False),
            sa.Column('order_id', sa.String(), sa.ForeignKey('orders.id'), nullable=False, index=True),
            sa.Column('customer_id', sa.String(), nullable=True),
            sa.Column('session_id', sa.String(), nullable=True),
            sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=False, index=True),

            # Event Sourcing / audit: three payload stages kept distinct so a
            # replay years later can reproduce EXACTLY what was decided, what
            # was normalized, and what actually left the building — not a
            # single mutable blob that later code could silently reinterpret.
            sa.Column('raw_payload', sa.JSON(), nullable=False),
            sa.Column('canonical_payload', sa.JSON(), nullable=False),
            sa.Column('provider_payload', sa.JSON(), nullable=True),  # filled once built, may be null while still 'pending'

            sa.Column('payload_version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('provider_version', sa.String(), nullable=True),  # e.g. "meta_capi_v1"
            sa.Column('api_version', sa.String(), nullable=True),       # e.g. Graph API "v19.0"
            sa.Column('schema_version', sa.Integer(), nullable=False, server_default='1'),

            # Which exact provider config (pixel/advertiser_id/token) was
            # live when this fired — a replay years later must reuse THIS,
            # not whatever config happens to be configured today.
            sa.Column('provider_config_snapshot', sa.JSON(), nullable=True),

            # Dedup level 3 (content hash) + level 4 (time-window check done
            # in application code against this column) — catches accidental
            # duplicates that would still pass the event_id unique
            # constraint if event_id generation ever regresses.
            sa.Column('dedup_hash', sa.String(), nullable=False, index=True),

            sa.Column('signal_quality_score', sa.Float(), nullable=True),
            sa.Column('signal_quality_detail', sa.JSON(), nullable=True),

            sa.Column('status', sa.String(), nullable=False, server_default='pending', index=True),
            sa.Column('attempt_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('retry_at', sa.DateTime(), nullable=True, index=True),
            sa.Column('processed_at', sa.DateTime(), nullable=True),
            sa.Column('failed_at', sa.DateTime(), nullable=True),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('api_response', sa.JSON(), nullable=True),

            # Claim pattern identical to meta_capi_logs' proven durable-queue
            # design — reused, not reinvented.
            sa.Column('processing_worker', sa.String(), nullable=True),
            sa.Column('processing_started_at', sa.DateTime(), nullable=True),

            # Replay engine: points at the original event; the replay itself
            # is a brand-new row (own event_id, own attempts) so replaying
            # never mutates or re-triggers business data — pure read of the
            # original's frozen payload/config snapshot.
            sa.Column('replayed_from', sa.String(), sa.ForeignKey('marketing_events.id'), nullable=True, index=True),

            # true while the engine runs alongside the legacy per-provider
            # flow (e.g. meta_capi.py) for comparison — shadow rows never
            # feed existing dashboards, never get treated as duplicates of
            # the legacy send, and are excluded from real send accounting.
            sa.Column('shadow', sa.Boolean(), nullable=False, server_default=sa.text('false')),

            sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),

            sa.UniqueConstraint('event_id', name='uq_marketing_event_id'),
        )
        op.create_index(
            'idx_marketing_events_claim', 'marketing_events',
            ['status', 'store_id', 'retry_at'], unique=False,
        )
        op.create_index(
            'idx_marketing_events_order', 'marketing_events', ['order_id'], unique=False,
        )
        op.create_index(
            'idx_marketing_events_store_provider', 'marketing_events',
            ['store_id', 'provider', 'created_at'], unique=False,
        )

    if 'marketing_event_attempts' not in tables:
        op.create_table(
            'marketing_event_attempts',
            sa.Column('id', sa.String(), primary_key=True, index=True),
            sa.Column('marketing_event_id', sa.String(), sa.ForeignKey('marketing_events.id'), nullable=False, index=True),
            sa.Column('attempt_number', sa.Integer(), nullable=False),
            sa.Column('started_at', sa.DateTime(), nullable=False),
            sa.Column('finished_at', sa.DateTime(), nullable=True),
            sa.Column('latency_ms', sa.Integer(), nullable=True),
            sa.Column('http_status', sa.Integer(), nullable=True),
            sa.Column('api_response', sa.JSON(), nullable=True),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('error_category', sa.String(), nullable=True),
            sa.Column('processing_worker', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
            sa.UniqueConstraint('marketing_event_id', 'attempt_number', name='uq_marketing_event_attempt'),
        )


def downgrade():
    op.drop_table('marketing_event_attempts')
    op.drop_index('idx_marketing_events_store_provider', table_name='marketing_events')
    op.drop_index('idx_marketing_events_order', table_name='marketing_events')
    op.drop_index('idx_marketing_events_claim', table_name='marketing_events')
    op.drop_table('marketing_events')
    op.drop_table('provider_event_mappings')
