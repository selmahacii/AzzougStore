"""shopify_orders_phase2

Revision ID: f793bd1e31d4
Revises: e582ac9d20c3
Create Date: 2026-10-11 13:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f793bd1e31d4'
down_revision: Union[str, Sequence[str], None] = 'e582ac9d20c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add Shopify external origin attributes and uniqueness constraint to orders."""
    op.add_column('orders', sa.Column('shopify_order_id', sa.String(), nullable=True))
    op.add_column('orders', sa.Column('shopify_order_number', sa.String(), nullable=True))
    op.add_column('orders', sa.Column('shopify_financial_status', sa.String(), nullable=True))
    op.add_column('orders', sa.Column('shopify_fulfillment_status', sa.String(), nullable=True))

    op.create_index('idx_order_store_shopify_id', 'orders', ['store_id', 'shopify_order_id'])
    op.create_unique_constraint('uq_order_store_shopify_id', 'orders', ['store_id', 'shopify_order_id'])


def downgrade() -> None:
    """Revert Shopify order columns and constraints."""
    op.drop_constraint('uq_order_store_shopify_id', 'orders', type_='unique')
    op.drop_index('idx_order_store_shopify_id', table_name='orders')

    op.drop_column('orders', 'shopify_fulfillment_status')
    op.drop_column('orders', 'shopify_financial_status')
    op.drop_column('orders', 'shopify_order_number')
    op.drop_column('orders', 'shopify_order_id')
