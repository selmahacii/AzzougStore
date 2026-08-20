"""add_meta_campaign_id_to_landing_pages

Revision ID: 7bec1a7e91ad
Revises: 09f6d7c4de85
Create Date: 2026-08-20 15:11:56.331926

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7bec1a7e91ad'
down_revision: Union[str, Sequence[str], None] = '09f6d7c4de85'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('landing_pages', sa.Column('meta_campaign_id', sa.String(), nullable=True))
    op.create_index(op.f('ix_landing_pages_meta_campaign_id'), 'landing_pages', ['meta_campaign_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_landing_pages_meta_campaign_id'), table_name='landing_pages')
    op.drop_column('landing_pages', 'meta_campaign_id')
