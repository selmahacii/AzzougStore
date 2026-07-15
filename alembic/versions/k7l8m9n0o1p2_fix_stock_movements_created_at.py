"""Fix stock_movements created_at missing DEFAULT NOW()

Revision ID: k7l8m9n0o1p2
Revises: j6k7l8m9n0o1
Branch Labels: None
Depends On: None
"""
from alembic import op
import sqlalchemy as sa

revision = 'k7l8m9n0o1p2'
down_revision = 'j6k7l8m9n0o1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Set DEFAULT NOW() on created_at if missing
    conn.execute(sa.text(
        "ALTER TABLE stock_movements "
        "ALTER COLUMN created_at SET DEFAULT NOW()"
    ))

    # Backfill any existing NULL values
    conn.execute(sa.text(
        "UPDATE stock_movements SET created_at = NOW() WHERE created_at IS NULL"
    ))

    # Ensure NOT NULL constraint
    conn.execute(sa.text(
        "ALTER TABLE stock_movements "
        "ALTER COLUMN created_at SET NOT NULL"
    ))

    # Add updated_at if missing
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_name='stock_movements' AND column_name='updated_at')"
    ))
    if not result.scalar():
        conn.execute(sa.text(
            "ALTER TABLE stock_movements ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()"
        ))


def downgrade() -> None:
    pass
