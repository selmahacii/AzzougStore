"""drop_funnel_rollups_lp_fk

Revision ID: d481fc9b10c2
Revises: 7bec1a7e91ad
Create Date: 2026-09-24 19:15:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd481fc9b10c2'
down_revision: Union[str, Sequence[str], None] = '7bec1a7e91ad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema - drop rigid FK on funnel_rollups.lp_id so deleted/draft LPs do not block analytics ingestion."""
    op.execute("ALTER TABLE funnel_rollups DROP CONSTRAINT IF EXISTS funnel_rollups_lp_id_fkey;")


def downgrade() -> None:
    """Downgrade schema."""
    op.create_foreign_key(
        'funnel_rollups_lp_id_fkey',
        'funnel_rollups',
        'landing_pages',
        ['lp_id'],
        ['id'],
        ondelete='SET NULL'
    )
