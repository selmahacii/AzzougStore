"""
Regression test for _record_delivery_payment idempotency (2026-08-23).
Ensures that calling _record_delivery_payment multiple times for the same order
(e.g., when an order is updated or marked DELIVERED multiple times) skips creating duplicate
financial transaction references (COD-{order_number} and FEE-{order_number})
and does NOT raise a psycopg2 UniqueViolation / IntegrityError.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.models.user import User
from app.models.store import Store
from app.models.order import Order
from app.models.finance import FinancialTransaction
from app.services.order_service import order_service


def test_record_delivery_payment_is_idempotent():
    db = SessionLocal()
    suffix = str(uuid.uuid4())[:8]
    try:
        user = User(
            id=str(uuid.uuid4()),
            email=f"owner-{suffix}@test.com",
            name="Owner User",
            hashed_password="fakehash",
            role="ADMIN",
        )
        db.add(user)
        db.flush()

        store = Store(
            id=str(uuid.uuid4()),
            name=f"Idempotent Test Store {suffix}",
            slug=f"idempotent-test-store-{suffix}",
            domain=f"idempotent-test-store-{suffix}.com",
            template_id="modern",
            owner_id=user.id,
        )
        db.add(store)
        db.flush()

        order_number = f"ABN-20260818-{suffix.upper()}"
        order = Order(
            id=str(uuid.uuid4()),
            store_id=store.id,
            order_number=order_number,
            customer_name="Test Customer",
            customer_phone="0550000000",
            customer_wilaya="16",
            customer_commune="Algiers",
            customer_address="Test address",
            total=5000.0,
            status="DELIVERED",
            is_abandoned_cart=True,
            abandoned_cart_recovery_fee=500.0,
        )
        db.add(order)
        db.commit()
        db.refresh(order)

        # Call _record_delivery_payment first time
        order_service._record_delivery_payment(db, order)
        db.flush()

        # Check transactions created
        cod_ref = f"COD-{order_number}"
        fee_ref = f"FEE-{order_number}"

        cod_txs = (
            db.query(FinancialTransaction)
            .filter(FinancialTransaction.reference == cod_ref)
            .all()
        )
        fee_txs = (
            db.query(FinancialTransaction)
            .filter(FinancialTransaction.reference == fee_ref)
            .all()
        )

        assert len(cod_txs) == 1, "Should create exactly 1 COD transaction on first call"
        assert len(fee_txs) == 1, "Should create exactly 1 FEE transaction on first call"

        # Call _record_delivery_payment a second time (Simulate duplicate status event / re-processing)
        order_service._record_delivery_payment(db, order)
        db.flush()

        # Verify no duplicate transactions were added and no IntegrityError occurred
        cod_txs_after = (
            db.query(FinancialTransaction)
            .filter(FinancialTransaction.reference == cod_ref)
            .all()
        )
        fee_txs_after = (
            db.query(FinancialTransaction)
            .filter(FinancialTransaction.reference == fee_ref)
            .all()
        )

        assert len(cod_txs_after) == 1, "Should remain 1 COD transaction after second call"
        assert len(fee_txs_after) == 1, "Should remain 1 FEE transaction after second call"

    finally:
        db.rollback()
        db.close()
