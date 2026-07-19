"""
Regression test for the "Meta counts more Purchases than the ERP has
orders" production bug.

Root cause (see the audit in scripts/meta_capi_audit.sql /
scripts/meta_capi_audit.py): the storefront used to fire Purchase to Meta
(Pixel + CAPI relay) immediately on order creation, before the backend had
any chance to decide the submission was a duplicate of an existing order
(auto_merge_duplicates only ran later, on a status transition). A duplicate
that got merged a few seconds/minutes later had already been permanently
counted as a Purchase by Meta.

Fix applied this session:
1. src/components/storefront/checkout-form.tsx no longer fires Purchase at
   all — the frontend is not exercised by this backend test, but its
   removal is the actual fix for the frontend half of the race.
2. The backend's OWN path (orders.py's POST / handler) already ran
   auto_merge_duplicates synchronously, committed, before enqueuing the
   Purchase — this test proves that chain end-to-end using the real
   functions (order_service.create_order, auto_merge_duplicates,
   enqueue_purchase_for_order, _claim_queue_row) with only the network call
   itself mocked, so a regression in any of those functions — not just the
   removed frontend call — would be caught here.

No network calls are made: app.services.meta_capi.send_events is
monkeypatched to a stub that records whether it was ever invoked.
"""
import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.models.user import User
from app.models.store import Store
from app.models.order import Order
from app.models.marketing import MetaAdsConfig, MetaCapiLog
from app.core.security import get_password_hash
from app.services.order_service import order_service, auto_merge_duplicates
from app.services import meta_capi


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def store_with_meta_config(db):
    owner = User(
        id=str(uuid.uuid4()), email=f"regress-test-{uuid.uuid4().hex[:8]}@azzougshop.test",
        name="Regress Test Owner", hashed_password=get_password_hash("test-only"), role="SUPER_ADMIN",
    )
    db.add(owner)
    db.flush()
    s = Store(
        id=str(uuid.uuid4()), name="Regress Test Store",
        slug=f"regress-test-{uuid.uuid4().hex[:8]}", owner_id=owner.id,
    )
    db.add(s)
    db.flush()
    config = MetaAdsConfig(
        id=str(uuid.uuid4()), store_id=s.id,
        pixel_id="123456789", access_token="a" * 40,
        currency="DZD", exchange_rate=1.0, is_connected=True,
    )
    db.add(config)
    db.commit()
    db.refresh(s)
    yield s
    # Teardown only — best-effort, wrapped so a cleanup gap in this local
    # dev-DB fixture can never be mistaken for a failure of the actual
    # regression assertions above (pytest already reports those
    # separately). Order matches the FK graph: events/notifications/
    # customers reference orders/stores before orders/stores can be deleted.
    try:
        from app.models.events import OrderEvent
        from app.models.notification import Notification
        from app.models.customer import Customer
        order_ids = [o.id for o in db.query(Order.id).filter(Order.store_id == s.id).all()]
        if order_ids:
            db.query(OrderEvent).filter(OrderEvent.order_id.in_(order_ids)).delete(synchronize_session=False)
            db.query(Notification).filter(Notification.order_id.in_(order_ids)).delete(synchronize_session=False)
        db.query(MetaCapiLog).filter(MetaCapiLog.store_id == s.id).delete()
        db.query(Order).filter(Order.store_id == s.id).delete()
        db.query(Customer).filter(Customer.store_id == s.id).delete()
        db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == s.id).delete()
        db.query(Store).filter(Store.id == s.id).delete()
        db.query(User).filter(User.id == owner.id).delete()
        db.commit()
    except Exception:
        db.rollback()


def test_duplicate_order_is_merged_before_purchase_would_ever_send(db, store_with_meta_config, monkeypatch):
    """
    THE regression test: create order A, then a same-phone duplicate order
    B while A is still in a mergeable state (mirrors the real production
    scenario — a double-submit / page-refresh a few seconds apart).
    Reproduces orders.py's POST / sequence exactly (create_order ->
    auto_merge_duplicates -> enqueue_purchase_for_order -> the queue's own
    claim+send), with send_events mocked so no network call happens, and
    asserts B never reaches the point of calling Meta's API at all.
    """
    sent_orders: list[str] = []

    def _fake_send_events(pixel_id, access_token, events, **kwargs):
        # build_purchase_event keys custom_data.order_id by order_NUMBER,
        # not the UUID primary key (see meta_capi.build_purchase_event's own
        # comment on why — Pixel/CAPI dedup depends on it) — match that here.
        sent_orders.append(events[0]["custom_data"]["order_id"])
        return {
            "success": True, "events_received": 1, "error": None,
            "fbtrace_id": "fake-trace", "retryable": False,
            "latency_ms": 1, "http_status": 200,
        }

    monkeypatch.setattr(meta_capi, "send_events", _fake_send_events)

    phone = "0555000111"
    order_data_base = dict(
        store_id=store_with_meta_config.id, customer_name="Regress Client",
        customer_phone=phone, customer_address="1 Rue Regress", customer_wilaya="Alger",
        delivery_type="HOME", delivery_fee=0, subtotal=1800, discount=0, total=1800, source=None,
    )

    order_a = order_service.create_order(db, order_data=dict(order_data_base), items_data=[], actor_id=None)
    db.commit()
    db.refresh(order_a)
    assert order_a.status != "MERGED"

    order_b = order_service.create_order(db, order_data=dict(order_data_base), items_data=[], actor_id=None)
    db.commit()
    db.refresh(order_b)

    # Exact sequence orders.py's POST / handler runs, in order:
    merged_count = auto_merge_duplicates(db, order_b, actor_id=None)
    db.commit()
    db.refresh(order_b)

    assert merged_count == 1, "order_b should have been detected as a same-phone duplicate and merged"
    assert order_b.status == "MERGED", "the actual bug fix: order_b must be MERGED before any Purchase is ever attempted for it"

    # enqueue_purchase_for_order does not itself check status (documented
    # behavior — see its docstring) — it always writes a 'queued' row. The
    # real protection is _handle_claimed_row re-reading status at send
    # time, exercised below via the real send_purchase_for_order path.
    log_id_a = meta_capi.enqueue_purchase_for_order(db, order_a)
    log_id_b = meta_capi.enqueue_purchase_for_order(db, order_b)
    db.commit()
    assert log_id_a is not None
    assert log_id_b is not None  # a row IS queued...

    # ...but the actual send must never call Meta for order_b.
    meta_capi.send_purchase_for_order(order_id=order_b.id, client_ip=None, user_agent=None)
    meta_capi.send_purchase_for_order(order_id=order_a.id, client_ip=None, user_agent=None)

    assert order_b.order_number not in sent_orders, "order_b (MERGED duplicate) must NEVER reach Meta — this is the exact production bug"
    assert order_a.order_number in sent_orders, "order_a (the real, still-standalone order) must still send normally"

    row_b = db.query(MetaCapiLog).filter(MetaCapiLog.id == log_id_b).first()
    db.refresh(row_b)
    assert row_b.status == "skipped"
    assert "MERGED" in (row_b.error_message or "")

    row_a = db.query(MetaCapiLog).filter(MetaCapiLog.id == log_id_a).first()
    db.refresh(row_a)
    assert row_a.status == "success"


def test_audit_script_reports_zero_gap_for_this_scenario(db, store_with_meta_config, monkeypatch):
    """
    End-to-end proof that scripts/meta_capi_audit.py's reconciliation
    number is exactly 0 for a store where the fix is in effect: after the
    same create-duplicate-merge-send sequence as the test above, ERP real
    orders and Meta-still-valid Purchases must match exactly — the
    requested "tests proving ERP = Meta = Pixel = CAPI after correction".
    """
    def _fake_send_events(pixel_id, access_token, events, **kwargs):
        return {
            "success": True, "events_received": 1, "error": None,
            "fbtrace_id": "fake-trace", "retryable": False,
            "latency_ms": 1, "http_status": 200,
        }
    monkeypatch.setattr(meta_capi, "send_events", _fake_send_events)

    phone = "0555000222"
    order_data_base = dict(
        store_id=store_with_meta_config.id, customer_name="Regress Client 2",
        customer_phone=phone, customer_address="1 Rue Regress", customer_wilaya="Alger",
        delivery_type="HOME", delivery_fee=0, subtotal=1800, discount=0, total=1800, source=None,
    )

    order_a = order_service.create_order(db, order_data=dict(order_data_base), items_data=[], actor_id=None)
    db.commit(); db.refresh(order_a)
    order_b = order_service.create_order(db, order_data=dict(order_data_base), items_data=[], actor_id=None)
    db.commit(); db.refresh(order_b)
    auto_merge_duplicates(db, order_b, actor_id=None)
    db.commit(); db.refresh(order_b)

    meta_capi.enqueue_purchase_for_order(db, order_a)
    meta_capi.enqueue_purchase_for_order(db, order_b)
    db.commit()
    meta_capi.send_purchase_for_order(order_id=order_a.id, client_ip=None, user_agent=None)
    meta_capi.send_purchase_for_order(order_id=order_b.id, client_ip=None, user_agent=None)

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    from meta_capi_audit import run_audit

    result = run_audit(store_with_meta_config.id, "2020-01-01", "2030-01-01")
    assert result.erp_real_orders == 1  # only order_a still exists as a standalone order
    assert result.meta_purchase_sent_success == 1  # only order_a's Purchase actually reached "Meta"
    assert result.meta_overcounted_via_merged_duplicates == 0  # order_b's send was skipped, never counted
    assert result.remaining_unexplained_gap == 0  # ERP and "Meta" fully reconciled
