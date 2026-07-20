# -*- coding: utf-8 -*-
"""tiktok_catalog_feed_enterprise

TikTok Catalog Feed Enterprise (2026-07-20): closes the last identified
parity gap vs Meta Ads (which has GET /meta-ads/catalog-feed but no
equivalent existed for TikTok). Adds:

- tiktok_ads_configs.catalog_id: TikTok Catalog Manager's catalog
  identifier, required by the Catalog API (product/create,update,delete)
  to know which catalog to push into — distinct from advertiser_id/pixel_id.
- tiktok_catalog_sync_logs: durable per-product sync queue, same contract
  as tiktok_capi_logs (queued/processing/retry/pending_retry/success/
  failed/skipped) — powers incremental sync, retry, and the Catalog
  Health dashboard (products synced, errors, refused, sync latency,
  success rate).

Idempotent and purely additive.

Revision ID: 4c86dd8457a4
Revises: 081b8153f753
Create Date: 2026-07-20
"""

from alembic import op
import sqlalchemy as sa

revision = '4c86dd8457a4'
down_revision = '081b8153f753'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())

    cols = {c['name'] for c in inspector.get_columns('tiktok_ads_configs')}
    if 'catalog_id' not in cols:
        op.add_column('tiktok_ads_configs', sa.Column('catalog_id', sa.String(), nullable=True))

    if 'tiktok_catalog_sync_logs' not in inspector.get_table_names():
        op.create_table(
            'tiktok_catalog_sync_logs',
            sa.Column('id', sa.String(), primary_key=True),
            sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=False),
            sa.Column('product_id', sa.String(), sa.ForeignKey('products.id'), nullable=False),
            sa.Column('tiktok_item_id', sa.String(), nullable=True),
            sa.Column('action', sa.String(), nullable=False),
            sa.Column('status', sa.String(), nullable=False),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('error_category', sa.String(), nullable=True),
            sa.Column('payload', sa.JSON(), nullable=True),
            sa.Column('retry_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('next_retry_at', sa.DateTime(), nullable=True),
            sa.Column('latency_ms', sa.Integer(), nullable=True),
            sa.Column('processing_started_at', sa.DateTime(), nullable=True),
            sa.Column('completed_at', sa.DateTime(), nullable=True),
            sa.Column('last_http_status', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index('ix_tiktok_catalog_sync_logs_id', 'tiktok_catalog_sync_logs', ['id'])
        op.create_index('ix_tiktok_catalog_sync_logs_store_id', 'tiktok_catalog_sync_logs', ['store_id'])
        op.create_index('ix_tiktok_catalog_sync_logs_product_id', 'tiktok_catalog_sync_logs', ['product_id'])
        op.create_index('ix_tiktok_catalog_sync_logs_tiktok_item_id', 'tiktok_catalog_sync_logs', ['tiktok_item_id'])
        op.create_index('ix_tiktok_catalog_sync_logs_status', 'tiktok_catalog_sync_logs', ['status'])
        op.create_index('ix_tiktok_catalog_sync_logs_error_category', 'tiktok_catalog_sync_logs', ['error_category'])
        op.create_index('ix_tiktok_catalog_sync_logs_next_retry_at', 'tiktok_catalog_sync_logs', ['next_retry_at'])
        op.create_index(
            'ix_tiktok_catalog_sync_store_product', 'tiktok_catalog_sync_logs', ['store_id', 'product_id'],
        )


def downgrade():
    op.drop_table('tiktok_catalog_sync_logs')
    op.drop_column('tiktok_ads_configs', 'catalog_id')
