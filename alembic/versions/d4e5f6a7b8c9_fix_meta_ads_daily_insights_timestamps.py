"""fix_meta_ads_daily_insights_timestamps

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-15 21:15:00.000000

The original migration (b2c3d4e5f6a7) built meta_ads_daily_insights with a
raw op.create_table() that forgot created_at/updated_at — every model in
this app inherits them automatically from db.base_class.Base, so the ORM
always SELECTs those two columns for ANY query against this table. Every
attempt to read or upsert a daily insight row crashed with
psycopg2.errors.UndefinedColumn: column meta_ads_daily_insights.created_at
does not exist, silently swallowed by the sync's non-blocking try/except
(logged as "[Meta Ads Sync] Échec insights quotidiens (non bloquant)") —
meaning the whole per-day insights feature never worked, on Neon or
Supabase, since this table was introduced.
"""
from alembic import op
import sqlalchemy as sa

revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('meta_ads_daily_insights')}
    if 'created_at' not in cols:
        op.add_column(
            'meta_ads_daily_insights',
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
    if 'updated_at' not in cols:
        op.add_column(
            'meta_ads_daily_insights',
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )


def downgrade():
    op.drop_column('meta_ads_daily_insights', 'updated_at')
    op.drop_column('meta_ads_daily_insights', 'created_at')
