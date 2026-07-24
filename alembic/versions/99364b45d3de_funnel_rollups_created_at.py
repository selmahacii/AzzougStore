"""funnel_rollups missing created_at

Every model implicitly inherits created_at from app.db.base_class.Base, but
the original funnel_rollups migration (7b5de7cdac19) only created
updated_at — found by a real end-to-end test (seed real Upstash keys, run
the actual flush, verify Postgres) run against this migration after it had
already been applied in production, so this is a follow-up ALTER rather
than an edit to the already-applied migration.

Revision ID: 99364b45d3de
Revises: 7b5de7cdac19
Create Date: 2026-07-24

"""
from alembic import op
import sqlalchemy as sa

revision = '99364b45d3de'
down_revision = '7b5de7cdac19'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('funnel_rollups', sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))


def downgrade():
    op.drop_column('funnel_rollups', 'created_at')
