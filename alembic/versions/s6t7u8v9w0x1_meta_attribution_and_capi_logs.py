# -*- coding: utf-8 -*-
"""meta_attribution_and_capi_logs

- orders: full campaign attribution columns (utm_content/term, campaign_id,
  adset_id, ad_id, fbclid, fbp, fbc, referrer, event_source_url) so the admin
  can trace campaign → order → revenue, and the CAPI Purchase carries the
  browser identifiers Meta needs for maximum Event Match Quality.
- meta_capi_logs: one row per server-side Conversions API send, powering the
  diagnostics dashboard.

Idempotent and purely additive.

Revision ID: s6t7u8v9w0x1
Revises: r5s6t7u8v9w0
Create Date: 2026-07-04
"""

from alembic import op
import sqlalchemy as sa

revision = 's6t7u8v9w0x1'
down_revision = 'r5s6t7u8v9w0'
branch_labels = None
depends_on = None

_ORDER_COLUMNS = [
    ('utm_content', sa.String()),
    ('utm_term', sa.String()),
    ('campaign_id', sa.String()),
    ('adset_id', sa.String()),
    ('ad_id', sa.String()),
    ('fbclid', sa.String()),
    ('fbp', sa.String()),
    ('fbc', sa.String()),
    ('referrer', sa.String()),
    ('event_source_url', sa.String()),
]


def upgrade():
    inspector = sa.inspect(op.get_bind())
    tables = inspector.get_table_names()

    order_cols = {c['name'] for c in inspector.get_columns('orders')}
    for name, col_type in _ORDER_COLUMNS:
        if name not in order_cols:
            op.add_column('orders', sa.Column(name, col_type, nullable=True))
    if 'campaign_id' not in order_cols:
        op.create_index('ix_orders_campaign_id', 'orders', ['campaign_id'])

    if 'meta_capi_logs' not in tables:
        op.create_table(
            'meta_capi_logs',
            sa.Column('id', sa.String(), primary_key=True, index=True),
            sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=True, index=True),
            sa.Column('order_id', sa.String(), nullable=True, index=True),
            sa.Column('event_name', sa.String(), nullable=False, index=True),
            sa.Column('event_id', sa.String(), nullable=False),
            sa.Column('status', sa.String(), nullable=False, index=True),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('events_received', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        )


def downgrade():
    op.drop_table('meta_capi_logs')
    for name, _ in _ORDER_COLUMNS:
        op.drop_column('orders', name)
