# -*- coding: utf-8 -*-
"""ensure_tiktok_ads_tables

The production DB was previously stamped to head by the start.sh fallback,
which skipped o2p3q4r5s6t7 — so tiktok_ads_configs / tiktok_ads_campaigns
never got created and every /api/v1/tiktok-ads/* request 500s with
UndefinedTable. This revision re-creates them idempotently: tables are
only created if missing, and the created_at/updated_at columns required
by the Base model are added if a table exists without them.

Purely additive — no existing data is modified.

Revision ID: q4r5s6t7u8v9
Revises: p3q4r5s6t7u8
Create Date: 2026-07-04
"""

from alembic import op
import sqlalchemy as sa

revision = 'q4r5s6t7u8v9'
down_revision = 'p3q4r5s6t7u8'
branch_labels = None
depends_on = None


def _ensure_timestamps(inspector, table_name):
    cols = {c['name'] for c in inspector.get_columns(table_name)}
    for col in ('created_at', 'updated_at'):
        if col not in cols:
            op.add_column(table_name, sa.Column(
                col, sa.DateTime(), server_default=sa.text('now()'), nullable=False
            ))


def upgrade():
    inspector = sa.inspect(op.get_bind())
    tables = inspector.get_table_names()

    if 'tiktok_ads_configs' not in tables:
        op.create_table(
            'tiktok_ads_configs',
            sa.Column('id', sa.String(), primary_key=True, index=True),
            sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=False, unique=True, index=True),
            sa.Column('access_token', sa.Text(), nullable=True),
            sa.Column('advertiser_id', sa.String(), nullable=True),
            sa.Column('pixel_id', sa.String(), nullable=True),
            sa.Column('app_id', sa.String(), nullable=True),
            sa.Column('is_connected', sa.Boolean(), default=False),
            sa.Column('exchange_rate', sa.Float(), default=1.0, nullable=True),
            sa.Column('currency', sa.String(), default='USD', nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        )
    else:
        _ensure_timestamps(inspector, 'tiktok_ads_configs')

    if 'tiktok_ads_campaigns' not in tables:
        op.create_table(
            'tiktok_ads_campaigns',
            sa.Column('id', sa.String(), primary_key=True, index=True),
            sa.Column('campaign_id', sa.String(), unique=True, index=True, nullable=False),
            sa.Column('campaign_name', sa.String(), nullable=False),
            sa.Column('spend', sa.Float(), default=0.0),
            sa.Column('raw_spend', sa.Float(), default=0.0, nullable=True),
            sa.Column('currency', sa.String(), default='USD', nullable=True),
            sa.Column('impressions', sa.Integer(), default=0),
            sa.Column('clicks', sa.Integer(), default=0),
            sa.Column('reach', sa.Integer(), default=0),
            sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=False, index=True),
            sa.Column('date_start', sa.DateTime(), nullable=True),
            sa.Column('date_end', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        )
    else:
        _ensure_timestamps(inspector, 'tiktok_ads_campaigns')


def downgrade():
    # No-op: tables may pre-date this revision (created by o2p3q4r5s6t7),
    # so dropping them here could destroy data on downgrade.
    pass
