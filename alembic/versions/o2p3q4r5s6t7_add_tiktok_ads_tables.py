# -*- coding: utf-8 -*-
"""add_tiktok_ads_tables

Creates per-store TikTok Ads integration tables, mirroring the Meta Ads ones:
- tiktok_ads_configs: one row per store (advertiser_id, access_token, pixel...)
- tiktok_ads_campaigns: synced campaign insights

Purely additive — no existing data is modified.

Revision ID: o2p3q4r5s6t7
Revises: n1o2p3q4r5s6
Create Date: 2026-07-04
"""

from alembic import op
import sqlalchemy as sa

revision = 'o2p3q4r5s6t7'
down_revision = 'n1o2p3q4r5s6'
branch_labels = None
depends_on = None


def upgrade():
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
    )
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
    )


def downgrade():
    op.drop_table('tiktok_ads_campaigns')
    op.drop_table('tiktok_ads_configs')
