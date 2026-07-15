# -*- coding: utf-8 -*-
"""meta_ads_campaign_product_link

A store running several ad sets against the SAME product (common for
split-testing creatives) had no reliable way to attribute all of them to
that product in the "Produits Sponsorisés" panel: the attribution logic
only had two paths — match via UTM-tagged orders, or a fragile substring
match of the product's name/slug against the campaign's own name. Ad sets
named after internal codenames ("vd jdid", "tyara", "vd ai"...) never
contain the product name, so campaigns with real spend and real purchases
(confirmed in Meta's own app) silently contributed nothing to the product
breakdown whenever their orders hadn't captured a matching UTM.

Adds an explicit, manual campaign -> product link (nullable, purely
additive) so a store owner can assign a campaign to a product once,
independent of ad naming or UTM completeness — every ad set linked to a
product is then summed into that product's totals for good.

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-07-15
"""

from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('meta_ads_campaigns')}

    if 'product_id' not in cols:
        op.add_column('meta_ads_campaigns', sa.Column('product_id', sa.String(), nullable=True))
        op.create_index('ix_meta_ads_campaigns_product_id', 'meta_ads_campaigns', ['product_id'])


def downgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('meta_ads_campaigns')}
    if 'product_id' in cols:
        op.drop_index('ix_meta_ads_campaigns_product_id', table_name='meta_ads_campaigns')
        op.drop_column('meta_ads_campaigns', 'product_id')
