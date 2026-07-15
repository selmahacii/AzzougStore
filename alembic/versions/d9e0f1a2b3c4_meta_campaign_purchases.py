# -*- coding: utf-8 -*-
"""meta_campaign_purchases

Meta Ads Manager reports its own "Purchases" conversion count/value per
campaign, computed from its pixel/CAPI events with Meta's own attribution
window and dedup logic. Our dashboard instead recomputed "conversions" by
matching our own Order table on utm_campaign — a fundamentally different
methodology that will never exactly equal Meta's number (different
attribution windows, view-through vs click-through, events fired for carts
that never became a DB order, etc.).

Adds meta_purchases / meta_purchase_value to meta_ads_campaigns so the sync
can pull Meta's own reported conversions (via the Insights API's
actions/action_values) and the dashboard can show both numbers side by side
instead of pretending they're the same figure.

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = 'd9e0f1a2b3c4'
down_revision = 'c8d9e0f1a2b3'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('meta_ads_campaigns')}

    if 'meta_purchases' not in cols:
        op.add_column('meta_ads_campaigns', sa.Column('meta_purchases', sa.Integer(), nullable=True, server_default='0'))
    if 'meta_purchase_value' not in cols:
        op.add_column('meta_ads_campaigns', sa.Column('meta_purchase_value', sa.Float(), nullable=True, server_default='0'))


def downgrade():
    op.drop_column('meta_ads_campaigns', 'meta_purchase_value')
    op.drop_column('meta_ads_campaigns', 'meta_purchases')
