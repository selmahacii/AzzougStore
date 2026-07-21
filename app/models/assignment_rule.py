"""
Assignment Rule Engine — confirmatrice auto-assignment.

Generic priority hierarchy: PRODUCT > STORE > CATEGORY > BRAND > default
pool (the pre-existing _auto_assign specialist/store/least-loaded logic in
app/services/order_service.py, kept as the ultimate fallback so a store
with zero configured rules behaves exactly as before this feature).

A rule targets one entity (a product, a store, a category, a brand — new
rule_type values can be added later without a schema change, it's just a
string) and assigns it to one agent. `is_exclusion=True` means the OPPOSITE:
this agent is explicitly NOT responsible for this target, even though a
broader (lower-priority) rule of theirs would otherwise cover it — e.g.
Lyna owns the whole ChicOutfit store (a STORE rule) except one product
(a PRODUCT exclusion rule for that same agent+product), so that one
product falls through to whatever rule/pool would apply next instead of
defaulting to Lyna.

Conflict prevention ("one active rule per target"): a partial unique index
enforces at most one ACTIVE, NON-EXCLUSION rule per (rule_type, target_id)
— two different agents can never both "own" the same product/store at the
same specificity level. Exclusions are per (agent, target) and don't
conflict with each other or with the positive rule they modify.
"""
from sqlalchemy import Boolean, Column, ForeignKey, Index, String

from app.db.base_class import Base

# Priority order, most specific first — resolve_assignment_rule() (confirmatrice
# engine, order_service.py) walks this list.
RULE_TYPE_PRIORITY = ["PRODUCT", "STORE", "CATEGORY", "BRAND"]

# Same table, same conflict-prevention mechanism, DIFFERENT consumer:
# resolve_courier_rule() (order_service.py) — direct livreur auto-assignment
# by delivery destination, bypassing the confirmatrice workflow entirely.
# COMMUNE beats WILAYA (most specific wins, same philosophy as above).
COURIER_RULE_TYPE_PRIORITY = ["COMMUNE", "WILAYA"]


class AssignmentRule(Base):
    __tablename__ = "assignment_rules"

    id = Column(String, primary_key=True, index=True)
    rule_type = Column(String, nullable=False, index=True)  # PRODUCT | STORE | CATEGORY | BRAND
    target_id = Column(String, nullable=False, index=True)  # product_id / store_id / category id / brand id
    agent_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    is_exclusion = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    notes = Column(String, nullable=True)

    __table_args__ = (
        # Application-level equivalent enforced again at the DB layer via a
        # partial unique index created in the migration (Postgres supports
        # partial indexes; SQLAlchemy Column-level uniqueness can't express
        # the "only when is_exclusion=false" condition, so the migration
        # creates it directly with op.create_index(..., postgresql_where=...)).
        Index("ix_assignment_rules_type_target_agent", "rule_type", "target_id", "agent_id"),
    )
