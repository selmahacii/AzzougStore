"""shopify_api_version_2026_10

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-10-11 16:00:00.000000

Updates default Shopify API version to 2026-10 and safely upgrades
obsolete versions (2024-01, 2024-04, 2024-07, 2024-10) without
overwriting explicitly configured valid modern versions.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    tables = insp.get_table_names()

    if 'shopify_connections' in tables:
        # 1. Update server default to '2026-10'
        op.alter_column(
            'shopify_connections',
            'api_version',
            server_default='2026-10',
            existing_type=sa.String(),
            existing_nullable=False,
        )

        # 2. Safely upgrade obsolete versions without touching custom valid modern versions
        op.execute(
            """
            UPDATE shopify_connections
            SET api_version = '2026-10', updated_at = NOW()
            WHERE api_version IN ('2024-01', '2024-04', '2024-07', '2024-10', '2025-01')
               OR api_version IS NULL
               OR api_version = ''
            """
        )


def downgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    tables = insp.get_table_names()

    if 'shopify_connections' in tables:
        op.alter_column(
            'shopify_connections',
            'api_version',
            server_default='2024-04',
            existing_type=sa.String(),
            existing_nullable=False,
        )
