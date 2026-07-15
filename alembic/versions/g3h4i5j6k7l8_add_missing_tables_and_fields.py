"""add marketing_campaigns, expense_term_type, delivery_stats

Revision ID: g3h4i5j6k7l8
Revises: f2a3b4c5d6e7
Create Date: 2026-05-13

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'g3h4i5j6k7l8'
down_revision = 'f2a3b4c5d6e7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. marketing_campaigns ───────────────────────────────────
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'marketing_campaigns')"
    ))
    if not result.scalar():
        op.create_table(
            'marketing_campaigns',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('type', sa.String(), nullable=False),
            sa.Column('status', sa.String(), server_default='DRAFT', nullable=True),
            sa.Column('scheduled_at', sa.DateTime(), nullable=True),
            sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id', ondelete='CASCADE'), nullable=False),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_marketing_campaigns_store_id', 'marketing_campaigns', ['store_id'])

    # ── 2. expense term_type column (long/short term) ────────────
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='term_type')"
    ))
    if not result.scalar():
        op.add_column('expenses', sa.Column('term_type', sa.String(), server_default='SHORT_TERM', nullable=True))

    # ── 3. delivery_partner_stats table ─────────────────────────
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_partner_stats')"
    ))
    if not result.scalar():
        op.create_table(
            'delivery_partner_stats',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('partner_id', sa.String(), sa.ForeignKey('delivery_partners.id', ondelete='CASCADE'), nullable=False),
            sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id', ondelete='CASCADE'), nullable=False),
            sa.Column('date', sa.Date(), nullable=False),
            sa.Column('total_orders', sa.Integer(), server_default='0'),
            sa.Column('delivered', sa.Integer(), server_default='0'),
            sa.Column('returned', sa.Integer(), server_default='0'),
            sa.Column('pending', sa.Integer(), server_default='0'),
            sa.Column('avg_delivery_days', sa.Float(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_dp_stats_partner_date', 'delivery_partner_stats', ['partner_id', 'date'])
        op.create_index('ix_dp_stats_store_date', 'delivery_partner_stats', ['store_id', 'date'])

    # ── 4. api_keys table (for partner API key generation) ───────
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'api_keys')"
    ))
    if not result.scalar():
        op.create_table(
            'api_keys',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id', ondelete='CASCADE'), nullable=False),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('key_hash', sa.String(), nullable=False),
            sa.Column('key_prefix', sa.String(), nullable=False),
            sa.Column('permissions', sa.Text(), server_default='["read"]'),
            sa.Column('is_active', sa.Boolean(), server_default='true'),
            sa.Column('last_used_at', sa.DateTime(), nullable=True),
            sa.Column('expires_at', sa.DateTime(), nullable=True),
            sa.Column('created_by', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_api_keys_store_id', 'api_keys', ['store_id'])
        op.create_index('ix_api_keys_key_hash', 'api_keys', ['key_hash'], unique=True)

    # ── 5. marketing_campaigns updated_at column if missing ──────
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marketing_campaigns' AND column_name='updated_at')"
    ))
    if not result.scalar():
        op.add_column('marketing_campaigns', sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=True))

    # ── 6. message_templates — add missing columns ───────────────
    for col_name, col_def in [
        ('variables', "TEXT DEFAULT '[]'"),
        ('status', "VARCHAR DEFAULT 'ACTIVE'"),
        ('created_at', "TIMESTAMP DEFAULT NOW()"),
    ]:
        result = conn.execute(sa.text(
            f"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='message_templates' AND column_name='{col_name}')"
        ))
        if not result.scalar():
            conn.execute(sa.text(f"ALTER TABLE message_templates ADD COLUMN {col_name} {col_def}"))


def downgrade() -> None:
    op.drop_table('api_keys')
    op.drop_table('delivery_partner_stats')
    op.drop_column('expenses', 'term_type')
    op.drop_table('marketing_campaigns')
