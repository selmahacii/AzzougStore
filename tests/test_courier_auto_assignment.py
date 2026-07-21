"""
Regression tests for courier auto-assignment by destination (2026-07-21,
chantier #3): resolve_courier_rule() / _auto_assign_courier() in
app/services/order_service.py — Selma's exact example: Ahmed is
configured for communes Hussein Dey and Kouba (wilaya Alger) and orders
to those communes must resolve directly to him, COMMUNE beating a
broader WILAYA rule, bypassing the confirmatrice workflow entirely.

Same in-memory SQLite pattern as test_assignment_rule_engine.py — reuses
the SAME assignment_rules table (no new table, no duplication), just a
different rule_type ("COMMUNE"/"WILAYA") and a different consumer function.
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
from app.models.user import User
from app.services.order_service import resolve_courier_rule, _auto_assign_courier


@pytest.fixture()
def db_session():
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng, tables=[AssignmentRule.__table__, User.__table__])
    Session = sessionmaker(bind=eng)
    session = Session()
    yield session
    session.close()


def _rule(rule_type, target_id, agent_id, is_active=True):
    return AssignmentRule(
        id=str(uuid.uuid4()), rule_type=rule_type, target_id=target_id,
        agent_id=agent_id, is_exclusion=False, is_active=is_active,
    )


def _livreur(user_id=None, is_active=True):
    return User(
        id=user_id or str(uuid.uuid4()), email=f"{uuid.uuid4()}@test.com", name="Ahmed",
        hashed_password="x", role="LIVREUR", is_active=is_active,
    )


def test_commune_rule_resolves_directly(db_session):
    ahmed_id = "user-ahmed"
    db_session.add(_livreur(ahmed_id))
    db_session.add(_rule("COMMUNE", "Hussein Dey", ahmed_id))
    db_session.commit()

    resolved = resolve_courier_rule(db_session, "Alger", "Hussein Dey")
    assert resolved == ahmed_id


def test_commune_rule_covers_multiple_communes_for_the_same_courier(db_session):
    ahmed_id = "user-ahmed"
    db_session.add(_livreur(ahmed_id))
    db_session.add_all([
        _rule("COMMUNE", "Hussein Dey", ahmed_id),
        _rule("COMMUNE", "Kouba", ahmed_id),
    ])
    db_session.commit()

    assert resolve_courier_rule(db_session, "Alger", "Hussein Dey") == ahmed_id
    assert resolve_courier_rule(db_session, "Alger", "Kouba") == ahmed_id


def test_commune_beats_wilaya(db_session):
    """Selma's priority requirement: most specific (COMMUNE) wins over a
    broader WILAYA rule assigned to a different courier."""
    ahmed_id, karim_id = "user-ahmed", "user-karim"
    db_session.add_all([_livreur(ahmed_id), _livreur(karim_id)])
    db_session.add_all([
        _rule("WILAYA", "Alger", karim_id),
        _rule("COMMUNE", "Hussein Dey", ahmed_id),
    ])
    db_session.commit()

    assert resolve_courier_rule(db_session, "Alger", "Hussein Dey") == ahmed_id
    # A different commune in the same wilaya, with no COMMUNE-level rule,
    # falls through to the WILAYA rule instead.
    assert resolve_courier_rule(db_session, "Alger", "Bir Mourad Rais") == karim_id


def test_other_communes_are_unaffected_and_return_none(db_session):
    """Orders outside any configured commune/wilaya continue the normal
    workflow — resolve_courier_rule must return None, never guess."""
    db_session.add(_rule("COMMUNE", "Hussein Dey", "user-ahmed"))
    db_session.commit()

    assert resolve_courier_rule(db_session, "Oran", "Es Senia") is None


def test_inactive_livreur_falls_back_to_normal_workflow(db_session):
    """A rule pointing to a livreur who has since been deactivated must
    never silently assign the order to them — _auto_assign_courier (not
    the raw resolver) guards against this."""
    ahmed_id = "user-ahmed"
    db_session.add(_livreur(ahmed_id, is_active=False))
    db_session.add(_rule("COMMUNE", "Hussein Dey", ahmed_id))
    db_session.commit()

    # The raw resolver still returns the rule's agent (it doesn't check status)...
    assert resolve_courier_rule(db_session, "Alger", "Hussein Dey") == ahmed_id
    # ...but the guarded wrapper used by order creation correctly refuses it.
    assert _auto_assign_courier(db_session, "Alger", "Hussein Dey") is None


def test_no_rules_configured_returns_none(db_session):
    assert resolve_courier_rule(db_session, "Alger", "Hussein Dey") is None
    assert _auto_assign_courier(db_session, "Alger", "Hussein Dey") is None
