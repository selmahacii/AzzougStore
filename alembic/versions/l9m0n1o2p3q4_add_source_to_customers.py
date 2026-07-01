"""Add missing columns to customers table

Revision ID: l9m0n1o2p3q4
Revises: k7l8m9n0o1p2
Create Date: 2026-05-21 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'l9m0n1o2p3q4'
down_revision: Union[str, Sequence[str], None] = 'k7l8m9n0o1p2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('customers')]
    
    # Add source column conditionally
    if 'source' not in columns:
        op.add_column('customers', sa.Column('source', sa.String(), nullable=True, server_default='MANUAL'))
    
    # Add is_guest column conditionally
    if 'is_guest' not in columns:
        op.add_column('customers', sa.Column('is_guest', sa.Boolean(), nullable=True, server_default=sa.text('false')))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('customers', 'source')
    op.drop_column('customers', 'is_guest')
