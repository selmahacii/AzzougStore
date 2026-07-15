"""Fix delivery_partners missing columns and create delivery_fee_grids

Revision ID: j6k7l8m9n0o1
Revises: 001_stock_audit_refactor
Branch Labels: None
Depends On: None

Ensures all FastAPI-required columns exist on delivery_partners
(these were originally created by Prisma without these fields).
Also creates delivery_fee_grids and product_delivery_partners if missing.
"""
from alembic import op
import sqlalchemy as sa

revision = 'j6k7l8m9n0o1'
down_revision = '001_stock_audit_refactor'
branch_labels = None
depends_on = None


def _col_exists(conn, table, column):
    r = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=:t AND column_name=:c)"
    ), {"t": table, "c": column})
    return r.scalar()


def _table_exists(conn, table):
    r = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name=:t)"
    ), {"t": table})
    return r.scalar()


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. delivery_partners — add columns missing from Prisma schema ────────
    if _table_exists(conn, 'delivery_partners'):
        extra_cols = [
            ('api_config_encrypted', 'TEXT'),
            ('fee_home',             'FLOAT DEFAULT 0.0'),
            ('fee_relay',            'FLOAT DEFAULT 0.0'),
            ('free_shipping_threshold', 'FLOAT'),
            ('is_sandbox',           'BOOLEAN DEFAULT TRUE'),
            ('webhook_url',          'VARCHAR'),
            ('last_test_at',         'TIMESTAMP'),
            ('last_test_ok',         'BOOLEAN'),
            ('configured_by',        'VARCHAR'),
            ('logo_url',             'VARCHAR'),
            ('created_at',           'TIMESTAMP DEFAULT NOW()'),
            ('updated_at',           'TIMESTAMP DEFAULT NOW()'),
        ]
        for col, defn in extra_cols:
            if not _col_exists(conn, 'delivery_partners', col):
                conn.execute(sa.text(f'ALTER TABLE delivery_partners ADD COLUMN {col} {defn}'))

    # ── 2. delivery_fee_grids ────────────────────────────────────────────────
    if not _table_exists(conn, 'delivery_fee_grids'):
        op.create_table(
            'delivery_fee_grids',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('partner_id', sa.String(),
                      sa.ForeignKey('delivery_partners.id', ondelete='CASCADE'), nullable=False),
            sa.Column('wilaya_id', sa.Integer(), nullable=False),
            sa.Column('home_fee', sa.Integer(), server_default='0'),
            sa.Column('office_fee', sa.Integer(), server_default='0'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_delivery_fee_grids_partner', 'delivery_fee_grids', ['partner_id'])

    # ── 3. product_delivery_partners ────────────────────────────────────────
    if not _table_exists(conn, 'product_delivery_partners'):
        op.create_table(
            'product_delivery_partners',
            sa.Column('product_id', sa.String(),
                      sa.ForeignKey('products.id', ondelete='CASCADE'), nullable=False, primary_key=True),
            sa.Column('partner_id', sa.String(),
                      sa.ForeignKey('delivery_partners.id', ondelete='CASCADE'), nullable=False, primary_key=True),
        )


def downgrade() -> None:
    pass  # intentionally non-destructive
