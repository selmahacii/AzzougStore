"""merge heads

Revision ID: 6e53c68d4928
Revises: f5b290e70af1, m0n1o2p3q4r5
Create Date: 2026-06-30 02:21:16.870212

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6e53c68d4928'
down_revision: Union[str, Sequence[str], None] = ('f5b290e70af1', 'm0n1o2p3q4r5')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
