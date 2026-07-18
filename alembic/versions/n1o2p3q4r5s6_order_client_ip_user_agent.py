# -*- coding: utf-8 -*-
"""order_client_ip_user_agent

Persist the request's client_ip/user_agent on the Order row at creation
time. Before this, these two values only ever lived in the ephemeral
FastAPI request/background-task call for the ONE synchronous Purchase
send fired right at order creation — any later resend of the same
Purchase (retry_pending_events' retry loop, the nightly recovery sweep,
abandoned-cart recovery) had no way to recover them and permanently sent
client_ip_address/client_user_agent as empty, degrading Event Match
Quality specifically for the population that already needed a retry.

Purely additive, nullable, defaults to NULL for every existing order.

Revision ID: n1o2p3q4r5s6
Revises: k1f2g3h4i5j6
Create Date: 2026-07-18
"""

from alembic import op
import sqlalchemy as sa

revision = 'n1o2p3q4r5s6'
down_revision = 'k1f2g3h4i5j6'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    cols = {c['name'] for c in inspector.get_columns('orders')}
    if 'client_ip' not in cols:
        op.add_column('orders', sa.Column('client_ip', sa.String(), nullable=True))
    if 'client_user_agent' not in cols:
        op.add_column('orders', sa.Column('client_user_agent', sa.String(), nullable=True))


def downgrade():
    op.drop_column('orders', 'client_user_agent')
    op.drop_column('orders', 'client_ip')
