"""
Regression test for the livreur pay model (2026-07-21): a livreur is paid a
fixed salary, never a per-basket/per-delivery commission. Before this fix,
compute_salary() fell back to PER_DELIVERED_ORDER (with a nonzero default
rate) for ANY employee whose payment_type was never configured — including
a freshly-created livreur, silently paying him a commission he was never
meant to get. An unconfigured livreur must now compute as MONTHLY_SALARY
(0 DA until an admin sets payment_amount), while an explicit
PER_DELIVERED_ORDER choice (if an admin ever picks it) is still honored.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.models.user import User
from app.core.security import get_password_hash
from app.services.salary_service import compute_salary


def test_unconfigured_livreur_defaults_to_monthly_salary_not_commission():
    db = SessionLocal()
    suffix = str(uuid.uuid4())[:8]
    livreur = User(
        id=str(uuid.uuid4()), email=f"livreur-salary-{suffix}@test.com", name="Test Livreur Salary",
        hashed_password=get_password_hash("test-only-password"), role="LIVREUR",
        is_active=True, payment_type=None, payment_amount=None,
    )
    db.add(livreur)
    db.commit()
    try:
        result = compute_salary(db, livreur)
        assert result["payment_type"] == "MONTHLY_SALARY"
        assert result["salary"] == 0
    finally:
        db.query(User).filter(User.id == livreur.id).delete()
        db.commit()
        db.close()


def test_confirmatrice_without_payment_type_still_falls_back_to_per_delivered_order():
    """Unrelated roles keep the pre-existing fallback behavior — only
    LIVREUR's default changed."""
    db = SessionLocal()
    suffix = str(uuid.uuid4())[:8]
    agent = User(
        id=str(uuid.uuid4()), email=f"confirmatrice-salary-{suffix}@test.com", name="Test Confirmatrice Salary",
        hashed_password=get_password_hash("test-only-password"), role="CONFIRMATEUR",
        is_active=True, payment_type=None, payment_amount=None,
    )
    db.add(agent)
    db.commit()
    try:
        result = compute_salary(db, agent)
        assert result["payment_type"] == "PER_DELIVERED_ORDER"
    finally:
        db.query(User).filter(User.id == agent.id).delete()
        db.commit()
        db.close()
