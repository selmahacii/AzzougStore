"""funnel_rollups NULL-safe unique index

Found by a real end-to-end test (seed real Upstash keys across two
separate flush cycles, verify Postgres accumulates additively): Postgres
treats NULL as DISTINCT from NULL in a plain UNIQUE constraint, so any
event without lp_id/product_id/campaign_id/adset_id/ad_id (all nullable —
e.g. a generic store-level PageView not tied to a specific landing page)
never actually conflicted on the second flush cycle onward. Each flush
silently INSERTed a brand new row instead of UPDATEing the existing one —
directly defeating the "bounded Postgres writes" property this whole
design was benchmarked and built around.

Fix: a unique index on COALESCE(col, '') for the nullable dimensions
instead of the raw columns — canonicalizes NULL to '' for comparison
purposes only (the stored value stays NULL, so the lp_id/FK column is
untouched and its foreign key to landing_pages still enforces real
values when present). Portable to any Postgres version, unlike NULLS NOT
DISTINCT (15+ only) — not verified whether production is on 15+ vs older.

Revision ID: c850bf4710be
Revises: 99364b45d3de
Create Date: 2026-07-24

"""
from alembic import op

revision = 'c850bf4710be'
down_revision = '99364b45d3de'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('uq_funnel_rollup_bucket', 'funnel_rollups', type_='unique')
    op.execute("""
        CREATE UNIQUE INDEX uq_funnel_rollup_bucket_nullsafe ON funnel_rollups (
            store_id,
            COALESCE(lp_id, ''),
            COALESCE(product_id, ''),
            COALESCE(campaign_id, ''),
            COALESCE(adset_id, ''),
            COALESCE(ad_id, ''),
            event_name,
            day,
            hour
        )
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS uq_funnel_rollup_bucket_nullsafe")
    op.create_unique_constraint(
        'uq_funnel_rollup_bucket', 'funnel_rollups',
        ['store_id', 'lp_id', 'product_id', 'campaign_id', 'adset_id', 'ad_id', 'event_name', 'day', 'hour'],
    )
