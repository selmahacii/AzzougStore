# -*- coding: utf-8 -*-
"""product_store_active_created_idx

Every product list call (storefront + admin) filters by store_id/is_active
and orders by created_at desc — idx_product_store_active covers the filter
but not the sort, so Postgres still needs a separate sort/scan step for
every listing. Adds a covering composite index.

Revision ID: p9q0r1s2t3u4
Revises: o8p9q0r1s2t3
Create Date: 2026-07-18
"""

from alembic import op
import sqlalchemy as sa

revision = 'p9q0r1s2t3u4'
down_revision = 'o8p9q0r1s2t3'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    existing = {ix['name'] for ix in inspector.get_indexes('products')}
    if 'idx_product_store_active_created' not in existing:
        op.create_index(
            'idx_product_store_active_created', 'products',
            ['store_id', 'is_active', 'created_at'], unique=False,
        )


def downgrade():
    op.drop_index('idx_product_store_active_created', table_name='products')
