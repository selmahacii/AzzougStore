"""
Regression tests for the Assignment Rule Engine (2026-07-21):
resolve_assignment_rule() in app/services/order_service.py, PRODUCT > STORE
priority with per-agent exclusions — Selma's exact examples:

- Ryma: owns the whole AzConfort store + the "Sac à main" product of
  ChicOutfit (a cross-store product override, resolved via PRODUCT priority
  even though the order's store belongs to a different agent).
- Lyna: owns every ChicOutfit product EXCEPT "Sac à main" — expressed as a
  STORE rule for Lyna + a PRODUCT-level exclusion for Lyna on that one
  product, which must NOT silently still resolve to her.

Uses a minimal in-memory SQLite database with the real models (no live
Postgres available) — same pattern as test_conversion_optimization_engine.py.
"""
import os
import sys
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.base_class import Base
from app.models.assignment_rule import AssignmentRule
from app.models.product import Product
from app.services.order_service import resolve_assignment_rule


@pytest.fixture()
def db_session():
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng, tables=[AssignmentRule.__table__, Product.__table__])
    Session = sessionmaker(bind=eng)
    session = Session()
    yield session
    session.close()


def _rule(rule_type, target_id, agent_id, is_exclusion=False, is_active=True):
    return AssignmentRule(
        id=str(uuid.uuid4()), rule_type=rule_type, target_id=target_id,
        agent_id=agent_id, is_exclusion=is_exclusion, is_active=is_active,
    )


def test_product_rule_wins_over_a_different_agents_store_rule(db_session):
    """Ryma's cross-store PRODUCT rule for 'Sac à main' must win even
    though the order's store (ChicOutfit) is Lyna's via a STORE rule."""
    chic_outfit_store_id = "store-chicoutfit"
    sac_a_main_id = "product-sac-a-main"
    ryma_id, lyna_id = "user-ryma", "user-lyna"

    db_session.add_all([
        _rule("STORE", chic_outfit_store_id, lyna_id),
        _rule("PRODUCT", sac_a_main_id, ryma_id),
    ])
    db_session.commit()

    resolved = resolve_assignment_rule(db_session, chic_outfit_store_id, [sac_a_main_id])
    assert resolved == ryma_id


def test_store_rule_applies_to_other_products_in_the_same_store(db_session):
    """A different ChicOutfit product (no PRODUCT-level rule) falls
    through to Lyna's STORE rule."""
    chic_outfit_store_id = "store-chicoutfit"
    other_product_id = "product-foulard"
    lyna_id = "user-lyna"

    db_session.add(_rule("STORE", chic_outfit_store_id, lyna_id))
    db_session.commit()

    resolved = resolve_assignment_rule(db_session, chic_outfit_store_id, [other_product_id])
    assert resolved == lyna_id


def test_product_exclusion_blocks_the_store_owner_for_that_product(db_session):
    """Lyna owns the whole store, but is explicitly excluded from
    'Sac à main' — and NO other agent has a PRODUCT rule for it — so
    resolution must return None (falls through to the default pool),
    never silently assign it to Lyna anyway."""
    chic_outfit_store_id = "store-chicoutfit"
    sac_a_main_id = "product-sac-a-main"
    lyna_id = "user-lyna"

    db_session.add_all([
        _rule("STORE", chic_outfit_store_id, lyna_id),
        _rule("PRODUCT", sac_a_main_id, lyna_id, is_exclusion=True),
    ])
    db_session.commit()

    resolved = resolve_assignment_rule(db_session, chic_outfit_store_id, [sac_a_main_id])
    assert resolved is None


def test_no_rules_configured_returns_none(db_session):
    """A store with zero configured rules must return None — the caller
    (_auto_assign) then falls through to the pre-existing pool logic
    unchanged, preserving 100% backward compatibility."""
    resolved = resolve_assignment_rule(db_session, "store-with-no-rules", ["some-product"])
    assert resolved is None


def test_inactive_rule_is_ignored(db_session):
    store_id, agent_id = "store-x", "user-y"
    db_session.add(_rule("STORE", store_id, agent_id, is_active=False))
    db_session.commit()

    resolved = resolve_assignment_rule(db_session, store_id, [])
    assert resolved is None


def test_category_and_brand_fallback_when_no_product_or_store_rule(db_session):
    """A product with a category-level rule (no direct PRODUCT or STORE
    rule) still resolves via CATEGORY, one priority level below STORE."""
    store_id = "store-z"
    product_id = "product-in-category"
    category = "Bagagerie"
    agent_id = "user-cat-specialist"

    db_session.add(Product(
        id=product_id, store_id=store_id, name="Test Product", slug="test-product",
        price=1000, stock=10, category=category, is_active=True,
    ))
    db_session.add(_rule("CATEGORY", category, agent_id))
    db_session.commit()

    resolved = resolve_assignment_rule(db_session, store_id, [product_id])
    assert resolved == agent_id
