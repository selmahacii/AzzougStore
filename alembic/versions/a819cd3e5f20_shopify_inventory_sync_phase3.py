"""shopify_inventory_sync_phase3

Revision ID: a819cd3e5f20
Revises: f793bd1e31d4
Create Date: 2026-10-11 14:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a819cd3e5f20'
down_revision: Union[str, Sequence[str], None] = 'f793bd1e31d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create durable outbound queue table for Shopify inventory level synchronization."""
    op.create_table(
        'shopify_inventory_sync_queue',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id', ondelete='CASCADE'), nullable=False),
        sa.Column('product_id', sa.String(), sa.ForeignKey('products.id', ondelete='CASCADE'), nullable=False),
        sa.Column('variant_sku', sa.String(), nullable=True),
        sa.Column('variant_str', sa.String(), nullable=True),
        sa.Column('shopify_inventory_item_id', sa.String(), nullable=True),
        sa.Column('shopify_location_id', sa.String(), nullable=True),
        sa.Column('target_quantity', sa.Integer(), nullable=False),
        sa.Column('previous_quantity', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='PENDING'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('max_attempts', sa.Integer(), nullable=False, server_default='5'),
        sa.Column('next_retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('idempotency_key', sa.String(), nullable=False),
        sa.Column('stock_revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('idx_shopify_inv_queue_poll', 'shopify_inventory_sync_queue', ['status', 'next_retry_at', 'created_at'])
    op.create_index('idx_shopify_inv_queue_store_item', 'shopify_inventory_sync_queue', ['store_id', 'product_id', 'variant_sku'])
    op.create_index('idx_shopify_inv_queue_idemp', 'shopify_inventory_sync_queue', ['idempotency_key'])
    op.create_index('idx_shopify_inv_queue_status', 'shopify_inventory_sync_queue', ['status'])


def downgrade() -> None:
    """Revert shopify_inventory_sync_queue table."""
    op.drop_index('idx_shopify_inv_queue_status', table_name='shopify_inventory_sync_queue')
    op.drop_index('idx_shopify_inv_queue_idemp', table_name='shopify_inventory_sync_queue')
    op.drop_index('idx_shopify_inv_queue_store_item', table_name='shopify_inventory_sync_queue')
    op.drop_index('idx_shopify_inv_queue_poll', table_name='shopify_inventory_sync_queue')
    op.drop_table('shopify_inventory_sync_queue')
