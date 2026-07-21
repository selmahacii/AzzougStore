# -*- coding: utf-8 -*-
"""meta_capi_logs_store_created_index

Production audit finding (2026-07-21, Event Registry): the existing
composite index ix_meta_capi_logs_store_event_created is (store_id,
event_name, created_at) — usable for the sort-by-created_at ONLY when
event_name is also constrained to a single value. The Event Registry's
default view ("Tous les évènements", no event_name filter) sorts by
created_at DESC across every event type for a store, which this composite
index cannot fully satisfy: Postgres can use the store_id prefix to filter
but must still sort the result set separately.

Adds a plain (store_id, created_at) composite index covering exactly that
query shape, so ORDER BY created_at DESC stays index-backed at hundreds of
thousands of rows regardless of whether event_name is filtered.

Purely additive — no column changes, no data migration, safe on a live
table (CREATE INDEX; use CONCURRENTLY when applying directly against
production outside of this app's migration runner for a very large table).

Revision ID: t4u5v6w7x8y9
Revises: n8o9p0q1r2s3
Create Date: 2026-07-21
"""

from alembic import op
import sqlalchemy as sa

revision = 't4u5v6w7x8y9'
down_revision = 'n8o9p0q1r2s3'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    existing = {ix['name'] for ix in inspector.get_indexes('meta_capi_logs')}
    if 'ix_meta_capi_logs_store_created' not in existing:
        op.create_index(
            'ix_meta_capi_logs_store_created',
            'meta_capi_logs',
            ['store_id', 'created_at'],
        )


def downgrade():
    op.drop_index('ix_meta_capi_logs_store_created', table_name='meta_capi_logs')
