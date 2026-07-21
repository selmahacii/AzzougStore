# -*- coding: utf-8 -*-
"""assignment_rules

New Assignment Rule Engine for confirmatrice auto-assignment (2026-07-21,
Selma-requested architecture): PRODUCT > STORE > CATEGORY > BRAND priority,
with per-agent exclusions, replacing nothing — it's an ADDITIVE new table
that _auto_assign() (app/services/order_service.py) consults FIRST; when
no rule matches for a store, the existing specialist/store/least-loaded
logic runs completely unchanged, so a store with zero configured rules
behaves exactly as it did before this feature (100% backward compatible).

Conflict prevention ("one active rule per target"): a partial unique index
on (rule_type, target_id) WHERE is_exclusion = false AND is_active = true
makes it impossible to insert two different agents both "owning" the same
product/store/category/brand at the same time — the second insert fails
at the database level, not just in application code.

Purely additive — new table only, no existing column/table touched.

Revision ID: v6w7x8y9z0a1
Revises: u5v6w7x8y9z0
Create Date: 2026-07-21
"""

from alembic import op
import sqlalchemy as sa

revision = 'v6w7x8y9z0a1'
down_revision = 'u5v6w7x8y9z0'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if 'assignment_rules' not in existing_tables:
        op.create_table(
            'assignment_rules',
            sa.Column('id', sa.String(), primary_key=True, index=True),
            sa.Column('rule_type', sa.String(), nullable=False),
            sa.Column('target_id', sa.String(), nullable=False),
            sa.Column('agent_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('is_exclusion', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('notes', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index('ix_assignment_rules_rule_type', 'assignment_rules', ['rule_type'])
        op.create_index('ix_assignment_rules_target_id', 'assignment_rules', ['target_id'])
        op.create_index('ix_assignment_rules_agent_id', 'assignment_rules', ['agent_id'])
        op.create_index(
            'ix_assignment_rules_type_target_agent', 'assignment_rules',
            ['rule_type', 'target_id', 'agent_id'],
        )
        # Partial unique index — the actual conflict-prevention guarantee.
        op.create_index(
            'uq_assignment_rules_one_active_per_target',
            'assignment_rules',
            ['rule_type', 'target_id'],
            unique=True,
            postgresql_where=sa.text('is_exclusion = false AND is_active = true'),
        )


def downgrade():
    op.drop_index('uq_assignment_rules_one_active_per_target', table_name='assignment_rules')
    op.drop_index('ix_assignment_rules_type_target_agent', table_name='assignment_rules')
    op.drop_index('ix_assignment_rules_agent_id', table_name='assignment_rules')
    op.drop_index('ix_assignment_rules_target_id', table_name='assignment_rules')
    op.drop_index('ix_assignment_rules_rule_type', table_name='assignment_rules')
    op.drop_table('assignment_rules')
