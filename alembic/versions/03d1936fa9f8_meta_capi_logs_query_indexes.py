# -*- coding: utf-8 -*-
"""meta_capi_logs_query_indexes

Performance finding from the 2026-07-20 Meta Ads pre-deploy audit:
meta_capi_logs.created_at has NO index (inherited un-indexed from the
declarative Base — see app/db/base_class.py), yet it is the single most
filtered column in the entire Meta Ads backend: every dashboard/diagnostic
now goes through resolve_metrics_time_window() -> compute_meta_metrics(),
whose base_filters ALWAYS include
`created_at >= effective_since AND created_at <= until` combined with
store_id/event_name/status. Without a covering index, Postgres falls back
to bitmap-combining the separate single-column indexes on store_id/
event_name/status (or a sequential scan once the table is large), which
gets materially slower as meta_capi_logs grows — this table gets one row
per Purchase/PageView/ViewContent/AddToCart/InitiateCheckout event, so it
is one of the highest-write-volume tables in the schema.

event_id also has no index despite being read in every dedup-count query
(the timing/dedup section of compute_meta_metrics groups by event_id) and
in idempotency lookups.

Adds:
- ix_meta_capi_logs_store_event_created: composite (store_id, event_name,
  created_at) — covers the compute_meta_metrics base_filters exactly,
  in the order Postgres can use for both equality and range predicates.
- ix_meta_capi_logs_event_id: plain index for dedup/idempotency lookups.

Purely additive — no column changes, no data migration, safe to run
against a live table (CREATE INDEX; use CONCURRENTLY when applying to
production to avoid locking writes on a large table — see downgrade()
for the corresponding DROP INDEX).

Revision ID: 03d1936fa9f8
Revises: r1s2t3u4v5w6
Create Date: 2026-07-20
"""

from alembic import op
import sqlalchemy as sa

revision = '03d1936fa9f8'
down_revision = 'r1s2t3u4v5w6'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    existing = {ix['name'] for ix in inspector.get_indexes('meta_capi_logs')}

    if 'ix_meta_capi_logs_store_event_created' not in existing:
        op.create_index(
            'ix_meta_capi_logs_store_event_created',
            'meta_capi_logs',
            ['store_id', 'event_name', 'created_at'],
        )
    if 'ix_meta_capi_logs_event_id' not in existing:
        op.create_index('ix_meta_capi_logs_event_id', 'meta_capi_logs', ['event_id'])


def downgrade():
    op.drop_index('ix_meta_capi_logs_event_id', table_name='meta_capi_logs')
    op.drop_index('ix_meta_capi_logs_store_event_created', table_name='meta_capi_logs')
