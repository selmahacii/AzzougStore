# -*- coding: utf-8 -*-
"""add_payroll_records

Frozen monthly payroll entries (one per employee per YYYY-MM period).
Purely additive — no existing data is modified.

Revision ID: p3q4r5s6t7u8
Revises: o2p3q4r5s6t7
Create Date: 2026-07-04
"""

from alembic import op
import sqlalchemy as sa

revision = 'p3q4r5s6t7u8'
down_revision = 'o2p3q4r5s6t7'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'payroll_records',
        sa.Column('id', sa.String(), primary_key=True, index=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('period', sa.String(), nullable=False, index=True),
        sa.Column('payment_type', sa.String(), nullable=True),
        sa.Column('base_salary', sa.Float(), default=0.0),
        sa.Column('bonus', sa.Float(), default=0.0),
        sa.Column('total', sa.Float(), default=0.0),
        sa.Column('delivered_count', sa.Integer(), default=0),
        sa.Column('recovered_count', sa.Integer(), default=0),
        sa.Column('breakdown', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(), default='PENDING'),
        sa.Column('generated_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('generated_by', sa.String(), nullable=True),
        sa.Column('paid_at', sa.DateTime(), nullable=True),
        sa.Column('paid_by', sa.String(), nullable=True),
        sa.UniqueConstraint('user_id', 'period', name='uq_payroll_user_period'),
    )


def downgrade():
    op.drop_table('payroll_records')
