"""shopify_integrations_phase1

Revision ID: e582ac9d20c3
Revises: d481fc9b10c2
Create Date: 2026-10-11 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e582ac9d20c3'
down_revision: Union[str, Sequence[str], None] = 'd481fc9b10c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create Shopify connection, entity mappings, and durable webhook inbox tables."""
    # 1. shopify_connections
    op.create_table(
        'shopify_connections',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id', ondelete='CASCADE'), nullable=False),
        sa.Column('shop_domain', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='CONNECTED'),
        sa.Column('api_version', sa.String(), nullable=False, server_default='2024-04'),
        sa.Column('access_token_encrypted', sa.Text(), nullable=True),
        sa.Column('webhook_secret_encrypted', sa.Text(), nullable=True),
        sa.Column('sync_orders', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('sync_inventory', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('sync_products', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('settings', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('store_id', name='uq_shopify_connection_store'),
        sa.UniqueConstraint('shop_domain', name='uq_shopify_connection_domain'),
    )
    op.create_index('idx_shopify_conn_store', 'shopify_connections', ['store_id'])
    op.create_index('idx_shopify_conn_domain', 'shopify_connections', ['shop_domain'])

    # 2. shopify_mappings
    op.create_table(
        'shopify_mappings',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id', ondelete='CASCADE'), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('internal_id', sa.String(), nullable=False),
        sa.Column('shopify_id', sa.String(), nullable=False),
        sa.Column('shopify_secondary_id', sa.String(), nullable=True),
        sa.Column('extra_data', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('store_id', 'entity_type', 'shopify_id', name='uq_shopify_map_store_entity_shopify'),
        sa.UniqueConstraint('store_id', 'entity_type', 'internal_id', name='uq_shopify_map_store_entity_internal'),
    )
    op.create_index('idx_shopify_map_lookup', 'shopify_mappings', ['store_id', 'entity_type', 'shopify_id'])
    op.create_index('idx_shopify_map_reverse', 'shopify_mappings', ['store_id', 'entity_type', 'internal_id'])

    # 3. shopify_webhook_inbox
    op.create_table(
        'shopify_webhook_inbox',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('delivery_id', sa.String(), nullable=False),
        sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id', ondelete='CASCADE'), nullable=False),
        sa.Column('topic', sa.String(), nullable=False),
        sa.Column('shop_domain', sa.String(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='PENDING'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('max_attempts', sa.Integer(), nullable=False, server_default='5'),
        sa.Column('next_retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('delivery_id', name='uq_shopify_inbox_delivery_id'),
    )
    op.create_index('idx_shopify_inbox_queue', 'shopify_webhook_inbox', ['status', 'next_retry_at', 'created_at'])
    op.create_index('idx_shopify_inbox_store_topic', 'shopify_webhook_inbox', ['store_id', 'topic'])


def downgrade() -> None:
    """Drop Shopify integration tables."""
    op.drop_table('shopify_webhook_inbox')
    op.drop_table('shopify_mappings')
    op.drop_table('shopify_connections')
