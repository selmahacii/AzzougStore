# -*- coding: utf-8 -*-
"""order_ad_journey_fields

Enterprise Meta attribution chain — Phase 1 (schema + capture only, no
CAPI funnel events yet). Adds the readable names alongside the existing
IDs (campaign_id/adset_id/ad_id) plus the 2 remaining REAL Meta dynamic
URL macros: placement and site_source_name.

Deliberately does NOT add "creative_id" or "device_platform" columns —
these are not real Meta ad URL macros (Meta only exposes exactly 8:
campaign.name/id, adset.name/id, ad.name/id, placement, site_source_name
— facebook.com/business/help/2360940870872492). Adding columns for
fields Meta never actually sends would be fabricated data, which this
migration explicitly avoids.

Idempotent and purely additive — orders.py's create-order payload
already forwards every schema field via **order_data with no whitelist,
so no other backend code changes are required for these to start being
captured once this migration runs.

Revision ID: n8o9p0q1r2s3
Revises: 4c86dd8457a4
Create Date: 2026-07-21
"""

from alembic import op
import sqlalchemy as sa

revision = 'n8o9p0q1r2s3'
down_revision = '4c86dd8457a4'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('orders')}

    if 'campaign_name' not in cols:
        op.add_column('orders', sa.Column('campaign_name', sa.String(), nullable=True))
    if 'adset_name' not in cols:
        op.add_column('orders', sa.Column('adset_name', sa.String(), nullable=True))
    if 'ad_name' not in cols:
        op.add_column('orders', sa.Column('ad_name', sa.String(), nullable=True))
    if 'placement' not in cols:
        op.add_column('orders', sa.Column('placement', sa.String(), nullable=True))
    if 'site_source_name' not in cols:
        op.add_column('orders', sa.Column('site_source_name', sa.String(), nullable=True))


def downgrade():
    op.drop_column('orders', 'site_source_name')
    op.drop_column('orders', 'placement')
    op.drop_column('orders', 'ad_name')
    op.drop_column('orders', 'adset_name')
    op.drop_column('orders', 'campaign_name')
