"""meta_ads_ad_insights

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-15 22:00:00.000000

Per-ad breakdown (Campaign > Ad Set > Ad) — MetaAdsCampaign only stores one
combined row per campaign, hiding individual ad performance (real case:
"tyara"/"vd jdid"/"vd jdida"/"vd ai" split-tested under one campaign, each
with wildly different achats). Purely additive.

Includes created_at/updated_at explicitly this time — the previous
meta_ads_daily_insights migration (b2c3d4e5f6a7) omitted them and every
model inherits them from db.base_class.Base, breaking every ORM query
against that table (fixed in d4e5f6a7b8c9).
"""
from alembic import op
import sqlalchemy as sa

revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if 'meta_ads_ad_insights' in inspector.get_table_names():
        return
    op.create_table(
        'meta_ads_ad_insights',
        sa.Column('id', sa.String(), primary_key=True, index=True),
        sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=False, index=True),
        sa.Column('campaign_id', sa.String(), nullable=False, index=True),
        sa.Column('ad_id', sa.String(), nullable=False, index=True),
        sa.Column('ad_name', sa.String(), nullable=False),
        sa.Column('adset_id', sa.String(), nullable=True, index=True),
        sa.Column('adset_name', sa.String(), nullable=True),
        sa.Column('spend', sa.Float(), server_default='0'),
        sa.Column('raw_spend', sa.Float(), server_default='0'),
        sa.Column('currency', sa.String(), server_default='USD'),
        sa.Column('impressions', sa.Integer(), server_default='0'),
        sa.Column('clicks', sa.Integer(), server_default='0'),
        sa.Column('reach', sa.Integer(), server_default='0'),
        sa.Column('meta_purchases', sa.Integer(), server_default='0'),
        sa.Column('meta_purchase_value', sa.Float(), server_default='0'),
        sa.Column('date_start', sa.DateTime(), nullable=True),
        sa.Column('date_end', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('ad_id', name='uq_meta_ad_insight_ad_id'),
    )


def downgrade():
    inspector = sa.inspect(op.get_bind())
    if 'meta_ads_ad_insights' in inspector.get_table_names():
        op.drop_table('meta_ads_ad_insights')
