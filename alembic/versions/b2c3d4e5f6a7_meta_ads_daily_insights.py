# -*- coding: utf-8 -*-
"""meta_ads_daily_insights

MetaAdsCampaign holds a single running snapshot per campaign, overwritten on
every sync with whatever date range was requested — so "Achats déclarés par
Meta" could never be sliced by date and always disagreed with Ads Manager
whenever the ERP and Meta's UI were looking at different ranges (the exact
"décalage" reported). This table stores Meta's own per-day figures
(time_increment=1), upserted by (campaign_id, date), making Meta's numbers
filterable by any date range exactly like our own orders.

Purely additive.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-15
"""

from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if 'meta_ads_daily_insights' in inspector.get_table_names():
        return
    op.create_table(
        'meta_ads_daily_insights',
        sa.Column('id', sa.String(), primary_key=True, index=True),
        sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=False, index=True),
        sa.Column('campaign_id', sa.String(), nullable=False, index=True),
        sa.Column('date', sa.Date(), nullable=False, index=True),
        sa.Column('spend', sa.Float(), server_default='0'),
        sa.Column('raw_spend', sa.Float(), server_default='0'),
        sa.Column('impressions', sa.Integer(), server_default='0'),
        sa.Column('clicks', sa.Integer(), server_default='0'),
        sa.Column('reach', sa.Integer(), server_default='0'),
        sa.Column('meta_purchases', sa.Integer(), server_default='0'),
        sa.Column('meta_purchase_value', sa.Float(), server_default='0'),
        sa.UniqueConstraint('campaign_id', 'date', name='uq_meta_daily_campaign_date'),
    )


def downgrade():
    inspector = sa.inspect(op.get_bind())
    if 'meta_ads_daily_insights' in inspector.get_table_names():
        op.drop_table('meta_ads_daily_insights')
