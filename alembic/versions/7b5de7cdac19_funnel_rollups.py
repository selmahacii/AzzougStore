"""funnel rollups

Revision ID: 7b5de7cdac19
Revises: b70f356e05ee
Create Date: 2026-07-24

"""
from alembic import op
import sqlalchemy as sa

revision = '7b5de7cdac19'
down_revision = 'b70f356e05ee'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'funnel_rollups',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('store_id', sa.String(), sa.ForeignKey('stores.id'), nullable=False),
        sa.Column('lp_id', sa.String(), sa.ForeignKey('landing_pages.id'), nullable=True),
        sa.Column('product_id', sa.String(), nullable=True),
        sa.Column('campaign_id', sa.String(), nullable=True),
        sa.Column('adset_id', sa.String(), nullable=True),
        sa.Column('ad_id', sa.String(), nullable=True),
        sa.Column('event_name', sa.String(), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('hour', sa.Integer(), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'store_id', 'lp_id', 'product_id', 'campaign_id', 'adset_id', 'ad_id',
            'event_name', 'day', 'hour',
            name='uq_funnel_rollup_bucket',
        ),
    )
    op.create_index('idx_funnel_rollup_store_day', 'funnel_rollups', ['store_id', 'day'])
    op.create_index('idx_funnel_rollup_lp_day', 'funnel_rollups', ['lp_id', 'day'])
    op.create_index(op.f('ix_funnel_rollups_store_id'), 'funnel_rollups', ['store_id'])
    op.create_index(op.f('ix_funnel_rollups_lp_id'), 'funnel_rollups', ['lp_id'])
    op.create_index(op.f('ix_funnel_rollups_product_id'), 'funnel_rollups', ['product_id'])


def downgrade():
    op.drop_index(op.f('ix_funnel_rollups_product_id'), table_name='funnel_rollups')
    op.drop_index(op.f('ix_funnel_rollups_lp_id'), table_name='funnel_rollups')
    op.drop_index(op.f('ix_funnel_rollups_store_id'), table_name='funnel_rollups')
    op.drop_index('idx_funnel_rollup_lp_day', table_name='funnel_rollups')
    op.drop_index('idx_funnel_rollup_store_day', table_name='funnel_rollups')
    op.drop_table('funnel_rollups')
