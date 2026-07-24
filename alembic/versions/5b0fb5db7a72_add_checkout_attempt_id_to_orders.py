"""add checkout_attempt_id to orders

Revision ID: 5b0fb5db7a72
Revises: c850bf4710be
Create Date: 2026-07-24 22:30:51.546951

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5b0fb5db7a72'
down_revision: Union[str, Sequence[str], None] = 'c850bf4710be'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('orders', sa.Column('checkout_attempt_id', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('orders', 'checkout_attempt_id')
