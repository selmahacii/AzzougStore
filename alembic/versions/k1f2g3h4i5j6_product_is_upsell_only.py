# -*- coding: utf-8 -*-
"""product_is_upsell_only

Independent upsell products: a product an admin creates SOLELY to be
offered as an upsell during order confirmation — never tied to a specific
main product's UpsellRule, never shown in the storefront catalogue, and
excluded from the confirmatrice's regular product pickers, only appearing
in the dedicated upsell-candidate list (GET /products?include_upsell_only=true).

Purely additive, defaults to False so every existing product keeps its
current visibility everywhere unchanged.

Revision ID: k1f2g3h4i5j6
Revises: j0e1f2g3h4i5
Create Date: 2026-07-17
"""

from alembic import op
import sqlalchemy as sa

revision = 'k1f2g3h4i5j6'
down_revision = 'j0e1f2g3h4i5'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('products')}
    if 'is_upsell_only' not in cols:
        op.add_column('products', sa.Column('is_upsell_only', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column('products', 'is_upsell_only')
