# -*- coding: utf-8 -*-
"""order_carrier_stage

Adds carrier_stage / carrier_stage_label to orders — Noest's own granular
courier-side stage (e.g. "fdr_activated" / "En livraison"), written on every
poll cycle regardless of whether it's terminal, so a confirmatrice can see
real-time carrier progress instead of only our coarse SHIPPED bucket.

Revision ID: f1a2b3c4d5e6
Revises: e0f1a2b3c4d5
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = 'f1a2b3c4d5e6'
down_revision = 'e0f1a2b3c4d5'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('orders')}

    if 'carrier_stage' not in cols:
        op.add_column('orders', sa.Column('carrier_stage', sa.String(), nullable=True))
    if 'carrier_stage_label' not in cols:
        op.add_column('orders', sa.Column('carrier_stage_label', sa.String(), nullable=True))


def downgrade():
    op.drop_column('orders', 'carrier_stage_label')
    op.drop_column('orders', 'carrier_stage')
