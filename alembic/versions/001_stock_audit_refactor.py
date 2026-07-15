"""Add stock audit fields and fix event schema

Revision ID: 001_stock_audit_refactor
Revises: (latest head)
Create Date: 2026-05-07

Changes:
  - stock_movements: add created_at timestamp, actor FK
  - order_events: rename scheduled_at → scheduled_callback_at, add actor FK, add created_at
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = '001_stock_audit_refactor'
down_revision = 'i5j6k7l8m9n0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── stock_movements: add created_at ───────────────────────────────────────
    # Check if column already exists before adding (idempotent)
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    sm_cols = {c['name'] for c in inspector.get_columns('stock_movements')}
    oe_cols = {c['name'] for c in inspector.get_columns('order_events')}

    if 'created_at' not in sm_cols:
        op.add_column(
            'stock_movements',
            sa.Column(
                'created_at',
                sa.DateTime(timezone=True),
                server_default=sa.text('now()'),
                nullable=False,
            ),
        )
        op.create_index('ix_stock_movements_created_at', 'stock_movements', ['created_at'])

    # ── stock_movements: ensure actor_id has FK constraint ────────────────────
    # (the column exists but may be missing FK)
    # We alter it safely by checking constraints
    existing_fks = {fk['name'] for fk in inspector.get_foreign_keys('stock_movements')}
    if 'fk_stock_movements_actor_id' not in existing_fks:
        op.create_foreign_key(
            'fk_stock_movements_actor_id',
            'stock_movements', 'users',
            ['actor_id'], ['id'],
            ondelete='SET NULL',
        )

    # ── order_events: add created_at ─────────────────────────────────────────
    if 'created_at' not in oe_cols:
        op.add_column(
            'order_events',
            sa.Column(
                'created_at',
                sa.DateTime(timezone=True),
                server_default=sa.text('now()'),
                nullable=False,
            ),
        )
        op.create_index('ix_order_events_created_at', 'order_events', ['created_at'])

    # ── order_events: rename scheduled_at → scheduled_callback_at ────────────
    if 'scheduled_at' in oe_cols and 'scheduled_callback_at' not in oe_cols:
        op.alter_column(
            'order_events',
            'scheduled_at',
            new_column_name='scheduled_callback_at',
        )
    elif 'scheduled_callback_at' not in oe_cols:
        op.add_column(
            'order_events',
            sa.Column('scheduled_callback_at', sa.DateTime(timezone=True), nullable=True),
        )

    # ── order_events: add actor_id FK if missing ─────────────────────────────
    try:
        op.create_foreign_key(
            'fk_order_events_actor_id',
            'order_events', 'users',
            ['actor_id'], ['id'],
            ondelete='SET NULL',
        )
    except Exception:
        pass  # FK may already exist


def downgrade() -> None:
    # Reverse created_at on order_events
    try:
        op.drop_index('ix_order_events_created_at', table_name='order_events')
        op.drop_column('order_events', 'created_at')
    except Exception:
        pass

    # Rename scheduled_callback_at back to scheduled_at
    try:
        op.alter_column('order_events', 'scheduled_callback_at', new_column_name='scheduled_at')
    except Exception:
        pass

    # Drop FK on order_events.actor_id
    try:
        op.drop_constraint('fk_order_events_actor_id', 'order_events', type_='foreignkey')
    except Exception:
        pass

    # Reverse created_at on stock_movements
    try:
        op.drop_index('ix_stock_movements_created_at', table_name='stock_movements')
        op.drop_column('stock_movements', 'created_at')
    except Exception:
        pass

    # Drop FK on stock_movements.actor_id
    try:
        op.drop_constraint('fk_stock_movements_actor_id', 'stock_movements', type_='foreignkey')
    except Exception:
        pass
