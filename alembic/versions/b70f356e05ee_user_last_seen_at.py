"""user last_seen_at

Revision ID: b70f356e05ee
Revises: bb9ccdad0786
Create Date: 2026-07-24

"""
from alembic import op
import sqlalchemy as sa

revision = 'b70f356e05ee'
down_revision = 'bb9ccdad0786'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('last_seen_at', sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column('users', 'last_seen_at')
