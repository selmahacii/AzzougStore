"""add main_image to products

Revision ID: c7d8e9f0a1b2
Revises: b1c2d3e4f5a6
Create Date: 2026-04-23 00:00:00.000000

Description:
    Adds the `main_image` column to the `products` table.
    This is the primary display image URL shown in admin and storefront.
    Previously only `images` (JSON array) was stored.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = 'c7d8e9f0a1b2'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'products',
        sa.Column('main_image', sa.String(), nullable=True)
    )

    # No backfill needed — main_image defaults to NULL for existing rows


def downgrade() -> None:
    op.drop_column('products', 'main_image')
