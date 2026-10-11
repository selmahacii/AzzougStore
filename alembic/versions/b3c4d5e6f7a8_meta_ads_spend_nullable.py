"""meta_ads_spend_nullable

Revision ID: b3c4d5e6f7a8
Revises: a819cd3e5f20
Create Date: 2026-10-11 15:00:00.000000

Ensures spend column in meta_ads_campaigns and meta_ads_daily_insights
is explicitly NULLABLE and has no server_default forcing 0.0 on insert,
allowing unconverted foreign spends (where no exchange rate exists) to be stored as NULL
without distorting reporting or ROAS with fake 0 DZD amounts.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'a819cd3e5f20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    tables = insp.get_table_names()

    # 1. meta_ads_campaigns: allow NULL spend, drop server_default
    if 'meta_ads_campaigns' in tables:
        op.alter_column(
            'meta_ads_campaigns',
            'spend',
            existing_type=sa.Float(),
            nullable=True,
            server_default=None
        )

    # 2. meta_ads_daily_insights: allow NULL spend, drop server_default
    if 'meta_ads_daily_insights' in tables:
        op.alter_column(
            'meta_ads_daily_insights',
            'spend',
            existing_type=sa.Float(),
            nullable=True,
            server_default=None
        )


def downgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    tables = insp.get_table_names()

    # Safety Guardrail: Prevent silent irreversible data loss!
    # If there are rows where spend IS NULL, automatically converting them to 0.0
    # permanently erases the semantic difference between "unconverted foreign currency spend"
    # and "zero spend (free traffic)", distorting ROAS calculations to infinity.
    # The downgrade must explicitly REFUSE to proceed if NULL spend rows exist,
    # requiring explicit manual operator intervention or restoration from backup.
    violations = []
    if 'meta_ads_campaigns' in tables:
        camp_nulls = conn.execute(sa.text("SELECT COUNT(*) FROM meta_ads_campaigns WHERE spend IS NULL")).scalar() or 0
        if camp_nulls > 0:
            violations.append(f"meta_ads_campaigns ({camp_nulls} rows with spend IS NULL)")

    if 'meta_ads_daily_insights' in tables:
        daily_nulls = conn.execute(sa.text("SELECT COUNT(*) FROM meta_ads_daily_insights WHERE spend IS NULL")).scalar() or 0
        if daily_nulls > 0:
            violations.append(f"meta_ads_daily_insights ({daily_nulls} rows with spend IS NULL)")

    if violations:
        msg = (
            "DANGER: Downgrade rejected to protect data integrity. "
            f"The following tables contain NULL spend values that would be irreversibly overwritten with 0.0: {', '.join(violations)}. "
            "Converting unknown/unrated foreign spends to 0.0 falsifies financial and ROAS reporting. "
            "Downgrade requires manual data remediation or restoring from backup before reverting schema."
        )
        raise RuntimeError(msg)

    # Safe downgrade when no NULL spend rows exist
    if 'meta_ads_campaigns' in tables:
        op.alter_column(
            'meta_ads_campaigns',
            'spend',
            existing_type=sa.Float(),
            nullable=True,
            server_default=sa.text("'0.0'")
        )

    if 'meta_ads_daily_insights' in tables:
        op.alter_column(
            'meta_ads_daily_insights',
            'spend',
            existing_type=sa.Float(),
            nullable=True,
            server_default=sa.text("'0.0'")
        )
