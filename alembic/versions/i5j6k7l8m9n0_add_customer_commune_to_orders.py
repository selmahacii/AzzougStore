"""add customer_commune to orders table

Revision ID: i5j6k7l8m9n0
Revises: h4i5j6k7l8m9
Branch_labels: None
Depends_on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'i5j6k7l8m9n0'
down_revision = 'h4i5j6k7l8m9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    for col_name, col_def in [
        ("customer_commune", "VARCHAR"),
        ("delivery_type",    "VARCHAR DEFAULT 'HOME'"),
    ]:
        result = conn.execute(sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name='orders' AND column_name=:col)"
        ), {"col": col_name})
        if not result.scalar():
            conn.execute(sa.text(
                f"ALTER TABLE orders ADD COLUMN {col_name} {col_def}"
            ))


def downgrade() -> None:
    op.drop_column('orders', 'customer_commune')
    op.drop_column('orders', 'delivery_type')
