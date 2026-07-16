# -*- coding: utf-8 -*-
"""meta_capi_drop_redundant_indexes

Index audit findings (grep-verified against every query in app/, not
assumed):

- ix_meta_capi_logs_id: redundant — `id` is already the primary key, which
  Postgres already backs with a unique btree index (meta_capi_logs_pkey).
  A second non-unique index on the exact same single column gives zero
  query benefit and pays write/vacuum overhead on every INSERT/UPDATE.
- ix_meta_capi_logs_error_category: `error_category` is never used in a
  WHERE/filter anywhere in the codebase (only ever written, read via
  SELECT *) — a pure write-cost index with no read ever hitting it.
- ix_meta_capi_logs_next_retry_at: was useful before this session's
  durable-queue work, but every current query filters `next_retry_at`
  together with `status` (see meta_capi.py's sweep query), which the new
  composite ix_meta_capi_logs_status_next_retry (added in
  f6a7b8c9d0e1) already covers. No query filters on next_retry_at alone.

Dropping these three cuts write-side overhead (every meta_capi_logs INSERT/
UPDATE currently maintains 9 indexes; this brings it to 6) with zero
measured read-path impact — verified by grepping every ORM filter/where
clause referencing these columns before writing this migration.

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-07-16
"""

from alembic import op

revision = 'g7b8c9d0e1f2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_index('ix_meta_capi_logs_id', table_name='meta_capi_logs', if_exists=True)
    op.drop_index('ix_meta_capi_logs_error_category', table_name='meta_capi_logs', if_exists=True)
    op.drop_index('ix_meta_capi_logs_next_retry_at', table_name='meta_capi_logs', if_exists=True)


def downgrade():
    op.create_index('ix_meta_capi_logs_next_retry_at', 'meta_capi_logs', ['next_retry_at'])
    op.create_index('ix_meta_capi_logs_error_category', 'meta_capi_logs', ['error_category'])
    op.create_index('ix_meta_capi_logs_id', 'meta_capi_logs', ['id'])
