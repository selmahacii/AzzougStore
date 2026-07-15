"""Add new product fields and unique constraints

Revision ID: b1c2d3e4f5a6
Revises: 3937f0809508
Create Date: 2026-04-20 21:38:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, Sequence[str], None] = '3937f0809508'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add new fields to products table:
    - external_id: for marketplace integrations
    - tags: JSON list for tagging
    - is_pack: bundle product flag
    - marketer_percentage: affiliate commission
    - shipping_model: flat/calculated/free
    - page_url: landing page URL
    - UniqueConstraint(store_id, slug): replace old index with named constraint
    """

    # Add new columns (using IF NOT EXISTS via try/except to be idempotent)
    new_columns = [
        ('external_id', sa.Column('external_id', sa.String(), nullable=True)),
        ('tags', sa.Column('tags', sa.JSON(), nullable=True)),
        ('is_pack', sa.Column('is_pack', sa.Boolean(), nullable=True, server_default='false')),
        ('marketer_percentage', sa.Column('marketer_percentage', sa.Float(), nullable=True)),
        ('shipping_model', sa.Column('shipping_model', sa.String(), nullable=True)),
        ('page_url', sa.Column('page_url', sa.String(), nullable=True)),
    ]

    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_columns = [col['name'] for col in inspector.get_columns('products')]

    for col_name, col_def in new_columns:
        if col_name not in existing_columns:
            op.add_column('products', col_def)

    # Add named unique constraint if not already present
    has_constraint = conn.execute(sa.text(
        "SELECT 1 FROM pg_class WHERE relname = 'uq_store_product_slug'"
    )).scalar()

    if not has_constraint:
        # Check if there's an anonymous constraint on (store_id, slug)
        # First check if the product_store_id_slug_unique index exists
        existing_indexes = [idx['name'] for idx in inspector.get_indexes('products')]
        if 'products_store_id_slug_key' in existing_indexes:
            op.drop_index('products_store_id_slug_key', table_name='products')

        op.create_unique_constraint(
            'uq_store_product_slug',
            'products',
            ['store_id', 'slug']
        )

    # Add deleted_at column to stores if missing
    existing_store_cols = [col['name'] for col in inspector.get_columns('stores')]
    if 'deleted_at' not in existing_store_cols:
        op.add_column('stores', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    if 'is_deleted' not in existing_store_cols:
        op.add_column('stores', sa.Column('is_deleted', sa.Boolean(), nullable=True, server_default='false'))


def downgrade() -> None:
    """Remove new product fields."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_columns = [col['name'] for col in inspector.get_columns('products')]

    cols_to_drop = ['external_id', 'tags', 'is_pack', 'marketer_percentage', 'shipping_model', 'page_url']
    for col in cols_to_drop:
        if col in existing_columns:
            op.drop_column('products', col)

    # Restore anonymous unique constraint
    try:
        op.drop_constraint('uq_store_product_slug', 'products', type_='unique')
        op.create_index('products_store_id_slug_key', 'products', ['store_id', 'slug'], unique=True)
    except Exception:
        pass
