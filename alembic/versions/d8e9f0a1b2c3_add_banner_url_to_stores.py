"""add banner_url to stores

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-04-26 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'd8e9f0a1b2c3'
down_revision = 'c7d8e9f0a1b2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('stores', sa.Column('banner_url', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('stores', 'banner_url')
