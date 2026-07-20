"""
Regression test for the exact historical bug root-caused this session:
auto_merge_duplicates() ran synchronously right before enqueue_purchase_for_order()
at order-creation time, so a just-merged duplicate could still get a Purchase
row queued for Meta — even though its value already lives on its active
parent. enqueue_purchase_for_order() now refuses outright for any order
whose status is already MERGED, before ever touching the database, so this
guard applies uniformly to every call site (order creation, abandoned-cart
recovery, confirmatrice confirmation, admin backfill) instead of relying on
each one remembering to check.

No DB fixture needed: the guard must short-circuit BEFORE any query, which
this test proves directly by asserting db.query is never called.
"""
from unittest.mock import MagicMock
from app.services.meta_capi import enqueue_purchase_for_order


class _FakeOrder:
    def __init__(self, status: str, order_id: str = "fake-order-id"):
        self.status = status
        self.id = order_id
        self.store_id = "fake-store-id"
        self.order_number = "ORD-FAKE-1"


def test_enqueue_refuses_merged_order_without_querying_db():
    db = MagicMock()
    order = _FakeOrder(status="MERGED")

    result = enqueue_purchase_for_order(db, order)

    assert result is None
    db.query.assert_not_called()
    db.add.assert_not_called()


def test_enqueue_proceeds_for_non_merged_order():
    db = MagicMock()
    # Simulate "no existing Purchase row for this order" (the idempotency check)
    db.query.return_value.filter.return_value.first.return_value = None
    order = _FakeOrder(status="NEW")

    result = enqueue_purchase_for_order(db, order)

    assert result is not None
    db.add.assert_called_once()
