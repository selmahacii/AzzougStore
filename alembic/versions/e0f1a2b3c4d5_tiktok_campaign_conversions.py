# -*- coding: utf-8 -*-
"""tiktok_campaign_conversions

Same fix as d9e0f1a2b3c4 for Meta Ads, applied to TikTok Ads: adds
tiktok_conversions / tiktok_conversion_value to tiktok_ads_campaigns so the
sync can pull TikTok's own reported conversions (Reporting API "conversion"
metric) and the dashboard can show them side by side with our own
utm_campaign-matched order count instead of only ever showing ours.

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = 'e0f1a2b3c4d5'
down_revision = 'd9e0f1a2b3c4'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('tiktok_ads_campaigns')}

    if 'tiktok_conversions' not in cols:
        op.add_column('tiktok_ads_campaigns', sa.Column('tiktok_conversions', sa.Integer(), nullable=True, server_default='0'))
    if 'tiktok_conversion_value' not in cols:
        op.add_column('tiktok_ads_campaigns', sa.Column('tiktok_conversion_value', sa.Float(), nullable=True, server_default='0'))


def downgrade():
    op.drop_column('tiktok_ads_campaigns', 'tiktok_conversion_value')
    op.drop_column('tiktok_ads_campaigns', 'tiktok_conversions')
