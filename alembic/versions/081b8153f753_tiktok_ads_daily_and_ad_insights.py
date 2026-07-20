# -*- coding: utf-8 -*-
"""tiktok_ads_daily_and_ad_insights

TikTok Ads Enterprise production audit (2026-07-20): comparing every
TikTok endpoint against its Meta equivalent found TikTok's sync only ever
pulled CAMPAIGN-level totals, while Meta pulls campaign + daily + per-ad
(Ad Group/Ad) breakdowns (see z-series meta migrations). Two tables added
here, direct twins of meta_ads_daily_insights / meta_ads_ad_insights:

- tiktok_ads_daily_insights: one row per campaign per calendar day.
- tiktok_ads_ad_insights: one row per individual ad (covers both "Ad
  Groups" and "Ads" from the audit — TikTok's Reporting API returns
  adgroup_id/adgroup_name alongside ad_id/ad_name at AUCTION_AD level).

Idempotent and purely additive.

Revision ID: 081b8153f753
Revises: b9f144d96c03
Create Date: 2026-07-20
"""

from alembic import op
import sqlalchemy as sa

revision = '081b8153f753'
down_revision = 'b9f144d96c03'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if 'tiktok_ads_daily_insights' not in existing_tables:
        op.create_table(
            'tiktok_ads_daily_insights',
            sa.Column('id', sa.String(), primary_key=True),
            sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=False),
            sa.Column('campaign_id', sa.String(), nullable=False),
            sa.Column('date', sa.Date(), nullable=False),
            sa.Column('spend', sa.Float(), server_default='0.0'),
            sa.Column('raw_spend', sa.Float(), server_default='0.0'),
            sa.Column('impressions', sa.Integer(), server_default='0'),
            sa.Column('clicks', sa.Integer(), server_default='0'),
            sa.Column('reach', sa.Integer(), server_default='0'),
            sa.Column('tiktok_conversions', sa.Integer(), server_default='0'),
            sa.Column('tiktok_conversion_value', sa.Float(), server_default='0.0'),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint('campaign_id', 'date', name='uq_tiktok_daily_campaign_date'),
        )
        op.create_index('ix_tiktok_ads_daily_insights_id', 'tiktok_ads_daily_insights', ['id'])
        op.create_index('ix_tiktok_ads_daily_insights_store_id', 'tiktok_ads_daily_insights', ['store_id'])
        op.create_index('ix_tiktok_ads_daily_insights_campaign_id', 'tiktok_ads_daily_insights', ['campaign_id'])
        op.create_index('ix_tiktok_ads_daily_insights_date', 'tiktok_ads_daily_insights', ['date'])

    if 'tiktok_ads_ad_insights' not in existing_tables:
        op.create_table(
            'tiktok_ads_ad_insights',
            sa.Column('id', sa.String(), primary_key=True),
            sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=False),
            sa.Column('campaign_id', sa.String(), nullable=False),
            sa.Column('ad_id', sa.String(), nullable=False),
            sa.Column('ad_name', sa.String(), nullable=False),
            sa.Column('adgroup_id', sa.String(), nullable=True),
            sa.Column('adgroup_name', sa.String(), nullable=True),
            sa.Column('spend', sa.Float(), server_default='0.0'),
            sa.Column('raw_spend', sa.Float(), server_default='0.0'),
            sa.Column('currency', sa.String(), server_default='USD'),
            sa.Column('impressions', sa.Integer(), server_default='0'),
            sa.Column('clicks', sa.Integer(), server_default='0'),
            sa.Column('reach', sa.Integer(), server_default='0'),
            sa.Column('tiktok_conversions', sa.Integer(), server_default='0'),
            sa.Column('tiktok_conversion_value', sa.Float(), server_default='0.0'),
            sa.Column('date_start', sa.DateTime(), nullable=True),
            sa.Column('date_end', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint('ad_id', name='uq_tiktok_ad_insight_ad_id'),
        )
        op.create_index('ix_tiktok_ads_ad_insights_id', 'tiktok_ads_ad_insights', ['id'])
        op.create_index('ix_tiktok_ads_ad_insights_store_id', 'tiktok_ads_ad_insights', ['store_id'])
        op.create_index('ix_tiktok_ads_ad_insights_campaign_id', 'tiktok_ads_ad_insights', ['campaign_id'])
        op.create_index('ix_tiktok_ads_ad_insights_ad_id', 'tiktok_ads_ad_insights', ['ad_id'])
        op.create_index('ix_tiktok_ads_ad_insights_adgroup_id', 'tiktok_ads_ad_insights', ['adgroup_id'])


def downgrade():
    op.drop_table('tiktok_ads_ad_insights')
    op.drop_table('tiktok_ads_daily_insights')
