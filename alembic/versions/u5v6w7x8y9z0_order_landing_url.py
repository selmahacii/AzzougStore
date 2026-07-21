# -*- coding: utf-8 -*-
"""order_landing_url

Root-cause fix (2026-07-21): the storefront already captures the true
first-touch landing page URL client-side (src/lib/attribution.ts,
`landing_url` in localStorage) and already sends it on every order
submission via attributionPayload() — but no column ever existed to
receive it, so Pydantic silently dropped the field and the admin tracking
report ("Première page visitée") always showed "Non disponible" despite
the real data already arriving in the request body every time.

Purely additive — ADD COLUMN only, nullable, no backfill (historical
orders never had this field wired through, so there is nothing to
backfill from — it stays NULL for them, which is honest, not a defect).

Revision ID: u5v6w7x8y9z0
Revises: t4u5v6w7x8y9
Create Date: 2026-07-21
"""

from alembic import op
import sqlalchemy as sa

revision = 'u5v6w7x8y9z0'
down_revision = 't4u5v6w7x8y9'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('orders')}
    if 'landing_url' not in cols:
        op.add_column('orders', sa.Column('landing_url', sa.String(), nullable=True))


def downgrade():
    op.drop_column('orders', 'landing_url')
