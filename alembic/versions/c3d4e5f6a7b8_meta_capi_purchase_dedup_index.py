"""meta_capi_purchase_dedup_index

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-15 20:30:00.000000

DB-level defense in depth for send_purchase_for_order's idempotency guard:
the guard queries meta_capi_logs before sending, but two concurrent
requests for the same order (e.g. a race between the abandoned-cart
self-checkout trigger and a near-simultaneous confirmatrice PATCH) could
both pass that check before either writes a row. A partial unique index
on (order_id, event_name) for Purchase rows makes a second concurrent
INSERT fail at the database, not just rely on the earlier SELECT.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        'uq_meta_capi_purchase_per_order',
        'meta_capi_logs',
        ['order_id'],
        unique=True,
        postgresql_where=sa.text("event_name = 'Purchase' AND order_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('uq_meta_capi_purchase_per_order', table_name='meta_capi_logs')
