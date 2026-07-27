"""Add marketplace commission system

Revision ID: 09f6d7c4de85
Revises: 5b0fb5db7a72
Create Date: 2026-07-27 02:01:36.882563

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '09f6d7c4de85'
down_revision: Union[str, Sequence[str], None] = '5b0fb5db7a72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('orders', sa.Column('commission_marketplace_rate', sa.Integer(), nullable=True))
    op.add_column('orders', sa.Column('is_marketplace_upsell', sa.Boolean(), nullable=True))
    op.add_column('users', sa.Column('payment_marketplace_upsell_only', sa.Integer(), nullable=True))
    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'payment_marketplace_upsell_only')
    op.drop_column('orders', 'is_marketplace_upsell')
    op.drop_column('orders', 'commission_marketplace_rate')
