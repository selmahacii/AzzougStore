"""add payday to users (per-employee salary reminder day)

Revision ID: b6c7d8e9f0a1
Revises: a4b5c6d7e8f9
Create Date: 2026-07-10 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b6c7d8e9f0a1'
down_revision = 'a4b5c6d7e8f9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('payday', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'payday')
