"""add internal_notes to orders

Revision ID: c8d9e0f1a2b3
Revises: b6c7d8e9f0a1
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = 'c8d9e0f1a2b3'
down_revision = 'b6c7d8e9f0a1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('orders', sa.Column('internal_notes', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('orders', 'internal_notes')
