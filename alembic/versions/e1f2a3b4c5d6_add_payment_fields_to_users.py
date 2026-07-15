"""add payment_type and payment_amount to users

Revision ID: e1f2a3b4c5d6
Revises: d8e9f0a1b2c3
Create Date: 2026-04-29 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'e1f2a3b4c5d6'
down_revision = 'd8e9f0a1b2c3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('payment_type',   sa.String(),  nullable=True))
    op.add_column('users', sa.Column('payment_amount', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'payment_amount')
    op.drop_column('users', 'payment_type')
