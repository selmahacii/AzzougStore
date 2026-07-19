"""
Tests for the Marketing Event Engine core (event_store.py, dispatcher.py,
engine.py, providers/base.py, providers/meta/adapter.py).

Split in two groups:
- Pure unit tests (no DB): event_id determinism, dedup_hash stability,
  signal-quality weighting, canonical-payload extraction. These never touch
  the network or the database and always run.
- DB-backed integration tests (local dev Postgres, NOT Supabase
  production — see settings.DATABASE_URL): event_store CRUD/claim/replay/
  cancel, dispatcher provider discovery + mapping resolution, and
  engine.emit_business_event() end-to-end including the ORDER_MERGED
  cancellation path (the actual bug fix this whole engine exists for).

The engine is NOT wired into order_service.py/orders.py yet — nothing here
exercises that integration; it only proves the engine itself is correct in
isolation, per the phased rollout plan.
"""
import os
import sys
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.marketing_engine.engine import (
    BusinessEvent,
    build_canonical_payload,
    build_event_id,
    compute_dedup_hash,
    emit_business_event,
    score_signal_quality,
    SIGNAL_QUALITY_WEIGHTS,
)
from app.services.marketing_engine.dispatcher import (
    discover_providers,
    resolve_mappings,
    dispatch_mappings_for_event,
)
from app.services.marketing_engine.event_store import MarketingEventStore
from app.services.marketing_engine.providers.meta.adapter import PROVIDER as META_PROVIDER
from app.services.marketing_engine.providers.base import MarketingProvider


# ─── Pure unit tests — no DB, no network ──────────────────────────────────

def _fake_order(**overrides):
    defaults = dict(
        id=str(uuid.uuid4()), order_number="ORD-TEST-0001", store_id=str(uuid.uuid4()),
        total=1800, customer_email=None, customer_phone="0555000000",
        client_ip="1.2.3.4", client_user_agent="pytest-agent",
        fbp=None, fbc=None, fbclid=None,
        utm_source=None, utm_medium=None, utm_campaign=None, utm_content=None, utm_term=None,
        campaign_id=None, adset_id=None, ad_id=None,
        event_source_url=None, referrer=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        items=[],
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_build_event_id_is_deterministic():
    a = build_event_id("ORDER_CONFIRMED", "order-1", "meta")
    b = build_event_id("ORDER_CONFIRMED", "order-1", "meta")
    assert a == b
    assert a == "ORDER_CONFIRMED-order-1-meta-v1"


def test_build_event_id_differs_by_provider_and_business_event():
    base = build_event_id("ORDER_CONFIRMED", "order-1", "meta")
    other_provider = build_event_id("ORDER_CONFIRMED", "order-1", "tiktok")
    other_event = build_event_id("ORDER_DELIVERED", "order-1", "meta")
    assert base != other_provider
    assert base != other_event


def test_dedup_hash_stable_for_identical_input():
    payload = {"value": 1800.0, "currency": "DZD"}
    h1 = compute_dedup_hash("ORDER_CONFIRMED", "meta", "order-1", payload)
    h2 = compute_dedup_hash("ORDER_CONFIRMED", "meta", "order-1", payload)
    assert h1 == h2
    assert len(h1) == 64  # sha256 hex digest


def test_dedup_hash_changes_when_value_changes():
    h1 = compute_dedup_hash("ORDER_CONFIRMED", "meta", "order-1", {"value": 1800.0, "currency": "DZD"})
    h2 = compute_dedup_hash("ORDER_CONFIRMED", "meta", "order-1", {"value": 2000.0, "currency": "DZD"})
    assert h1 != h2


def test_signal_quality_full_payload_scores_100():
    payload = {field: "x" for field in SIGNAL_QUALITY_WEIGHTS}
    score, detail = score_signal_quality(payload)
    assert score == 100.0
    assert detail["missing"] == []


def test_signal_quality_empty_payload_scores_zero_and_lists_every_field():
    score, detail = score_signal_quality({})
    assert score == 0.0
    assert set(detail["missing"]) == set(SIGNAL_QUALITY_WEIGHTS)


def test_signal_quality_missing_fields_sorted_by_weight_lost():
    # Only "email" (weight 3.0, the heaviest) present — every other field
    # missing, and "phone" (also 3.0) must still lead the missing list
    # since it ties for heaviest and comes right after email is excluded.
    payload = {"email": "a@b.com"}
    score, detail = score_signal_quality(payload)
    assert detail["missing"][0] in ("phone",)  # heaviest still-missing field
    assert "email" not in detail["missing"]


def test_build_canonical_payload_extracts_order_fields():
    order = _fake_order(total=2500, customer_phone="0666111222", fbp="fb.1.111")
    payload = build_canonical_payload(order, BusinessEvent.ORDER_CONFIRMED)
    assert payload["order_id"] == order.id
    assert payload["value"] == 2500.0
    assert payload["phone"] == "0666111222"
    assert payload["fbp"] == "fb.1.111"
    assert payload["business_event"] == "ORDER_CONFIRMED"
    assert payload["currency"] == "DZD"


def test_build_canonical_payload_future_fields_default_none():
    # ttclid/gclid/msclkid have no Order column yet — must not raise, must
    # default to None so a future TikTok/Google Ads column addition needs
    # zero change here (the "compatibilité future" requirement).
    order = _fake_order()
    payload = build_canonical_payload(order, BusinessEvent.ORDER_CREATED)
    assert payload["ttclid"] is None
    assert payload["gclid"] is None
    assert payload["msclkid"] is None


def test_emit_business_event_rejects_non_business_event_enum():
    with pytest.raises(ValueError):
        emit_business_event(db=None, order=_fake_order(), business_event="ORDER_CONFIRMED")  # type: ignore[arg-type]


def test_emit_business_event_rejects_order_without_id():
    with pytest.raises(ValueError):
        emit_business_event(db=None, order=_fake_order(id=None), business_event=BusinessEvent.ORDER_CONFIRMED)


def test_meta_provider_satisfies_marketing_provider_protocol():
    # runtime_checkable Protocol — proves the adapter actually implements
    # every method the engine/dispatcher rely on, not just some of them.
    assert isinstance(META_PROVIDER, MarketingProvider)
    assert META_PROVIDER.name == "meta"


def test_meta_provider_resolve_config_returns_none_without_db_row():
    # No DB call actually needed here since we pass a store_id that can't
    # possibly have a config row in a query against a real session — but to
    # keep this test DB-free, it's covered instead by the DB-backed group
    # below (test_meta_provider_resolve_config_none_when_unconfigured).
    pass


# ─── DB-backed integration tests (local dev Postgres) ─────────────────────

from app.db.session import SessionLocal
from app.models.user import User
from app.models.store import Store
from app.models.order import Order
from app.models.marketing_event import ProviderEventMapping, MarketingEvent
from app.core.security import get_password_hash


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def store(db):
    owner = User(
        id=str(uuid.uuid4()), email=f"me-test-{uuid.uuid4().hex[:8]}@azzougshop.test",
        name="ME Test Owner", hashed_password=get_password_hash("test-only"), role="SUPER_ADMIN",
    )
    db.add(owner)
    db.flush()
    s = Store(
        id=str(uuid.uuid4()), name="ME Test Store", slug=f"me-test-{uuid.uuid4().hex[:8]}",
        owner_id=owner.id,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    yield s
    # Cleanup: this store's rows only, never a broad delete.
    db.query(MarketingEvent).filter(MarketingEvent.store_id == s.id).delete()
    db.query(ProviderEventMapping).filter(ProviderEventMapping.store_id == s.id).delete()
    db.query(Order).filter(Order.store_id == s.id).delete()
    db.query(Store).filter(Store.id == s.id).delete()
    db.query(User).filter(User.id == owner.id).delete()
    db.commit()


@pytest.fixture
def order(db, store):
    o = Order(
        id=str(uuid.uuid4()), store_id=store.id, order_number=f"ORD-ME-{uuid.uuid4().hex[:8]}",
        customer_name="Test Client", customer_phone="0555123456",
        customer_address="1 Rue Test", customer_wilaya="Alger",
        total=1800, subtotal=1800, status="NEW",
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


def test_discover_providers_finds_meta():
    providers = discover_providers(force_reload=True)
    assert "meta" in providers
    assert providers["meta"].name == "meta"


def test_meta_provider_resolve_config_none_when_unconfigured(db, store):
    config = META_PROVIDER.resolve_config(db, store.id)
    assert config is None  # no MetaAdsConfig row for this fresh store


def test_resolve_mappings_default_row_applies_to_every_store(db, store):
    default_mapping = ProviderEventMapping(
        id=str(uuid.uuid4()), store_id=None, provider="meta",
        business_event="ORDER_CONFIRMED", provider_event="Purchase",
    )
    db.add(default_mapping)
    db.commit()
    try:
        mappings = resolve_mappings(db, store_id=store.id, business_event="ORDER_CONFIRMED")
        assert len(mappings) == 1
        assert mappings[0].provider == "meta"
        assert mappings[0].provider_event == "Purchase"
    finally:
        db.delete(default_mapping)
        db.commit()


def test_resolve_mappings_store_override_wins_over_default(db, store):
    default_mapping = ProviderEventMapping(
        id=str(uuid.uuid4()), store_id=None, provider="meta",
        business_event="ORDER_CONFIRMED", provider_event="Purchase",
    )
    override = ProviderEventMapping(
        id=str(uuid.uuid4()), store_id=store.id, provider="meta",
        business_event="ORDER_CONFIRMED", provider_event="Purchase_Override",
    )
    db.add_all([default_mapping, override])
    db.commit()
    try:
        mappings = resolve_mappings(db, store_id=store.id, business_event="ORDER_CONFIRMED")
        assert len(mappings) == 1
        assert mappings[0].provider_event == "Purchase_Override"
    finally:
        db.delete(default_mapping)
        db.delete(override)
        db.commit()


def test_dispatch_mappings_skips_unregistered_provider(db, store):
    ghost_mapping = ProviderEventMapping(
        id=str(uuid.uuid4()), store_id=store.id, provider="does_not_exist",
        business_event="ORDER_CONFIRMED", provider_event="Purchase",
    )
    db.add(ghost_mapping)
    db.commit()
    try:
        result = dispatch_mappings_for_event(db, store_id=store.id, business_event="ORDER_CONFIRMED")
        assert result == []  # unregistered provider silently skipped, not raised
    finally:
        db.delete(ghost_mapping)
        db.commit()


def test_event_store_create_is_idempotent(db, store, order):
    store_repo = MarketingEventStore(db)
    kwargs = dict(
        event_id=f"TEST-{order.id}", business_event="ORDER_CONFIRMED", provider="meta",
        provider_event="Purchase", order_id=order.id, store_id=store.id,
        canonical_payload={"value": 1800}, raw_payload={}, dedup_hash="abc123",
    )
    first = store_repo.create(**kwargs)
    second = store_repo.create(**kwargs)
    assert first is not None
    assert second is None  # idempotent no-op, not a duplicate row nor an exception
    rows, total = store_repo.search(order_id=order.id)
    assert total == 1


def test_event_store_claim_batch_locks_and_marks_processing(db, store, order):
    store_repo = MarketingEventStore(db)
    row = store_repo.create(
        event_id=f"CLAIM-{order.id}", business_event="ORDER_CONFIRMED", provider="meta",
        provider_event="Purchase", order_id=order.id, store_id=store.id,
        canonical_payload={"value": 1800}, raw_payload={}, dedup_hash="claim-hash",
    )
    assert row.status == "pending"

    claimed = store_repo.claim_batch(worker_id="pytest-worker", limit=10, store_id=store.id)
    assert len(claimed) == 1
    assert claimed[0].id == row.id
    assert claimed[0].status == "processing"
    assert claimed[0].processing_worker == "pytest-worker"

    # A second claim right after must find nothing left to claim — it's
    # already 'processing', not 'pending'/'retry' anymore.
    claimed_again = store_repo.claim_batch(worker_id="pytest-worker-2", limit=10, store_id=store.id)
    assert claimed_again == []


def test_event_store_mark_sent_and_mark_failed_or_retry(db, store, order):
    store_repo = MarketingEventStore(db)
    row = store_repo.create(
        event_id=f"LIFECYCLE-{order.id}", business_event="ORDER_CONFIRMED", provider="meta",
        provider_event="Purchase", order_id=order.id, store_id=store.id,
        canonical_payload={}, raw_payload={}, dedup_hash="lifecycle-hash",
    )
    store_repo.claim_batch(worker_id="w1", limit=10, store_id=store.id)
    db.refresh(row)

    store_repo.mark_sent(row, api_response={"fbtrace_id": "abc"})
    db.refresh(row)
    assert row.status == "sent"
    assert row.attempt_count == 1
    assert row.processed_at is not None

    row2 = store_repo.create(
        event_id=f"LIFECYCLE2-{order.id}", business_event="ORDER_CONFIRMED", provider="meta",
        provider_event="Purchase", order_id=order.id, store_id=store.id,
        canonical_payload={}, raw_payload={}, dedup_hash="lifecycle2-hash",
    )
    store_repo.mark_failed_or_retry(row2, error_message="timeout", retryable=True)
    db.refresh(row2)
    assert row2.status == "retry"
    assert row2.retry_at is not None

    store_repo.mark_failed_or_retry(row2, error_message="4xx", retryable=False)
    db.refresh(row2)
    assert row2.status == "failed"
    assert row2.failed_at is not None


def test_event_store_cancel_for_order_only_touches_pending_and_retry(db, store, order):
    store_repo = MarketingEventStore(db)
    # Created (and thus claimed, claim_batch orders by created_at asc) BEFORE
    # "pending" so the limit=1 claim below grabs only this one, leaving
    # "pending" genuinely untouched at status='pending' for the assertion.
    sent = store_repo.create(
        event_id=f"CANCEL-SENT-{order.id}", business_event="ORDER_DELIVERED", provider="meta",
        provider_event="Purchase", order_id=order.id, store_id=store.id,
        canonical_payload={}, raw_payload={}, dedup_hash="cancel-sent",
    )
    pending = store_repo.create(
        event_id=f"CANCEL-PENDING-{order.id}", business_event="ORDER_CONFIRMED", provider="meta",
        provider_event="Purchase", order_id=order.id, store_id=store.id,
        canonical_payload={}, raw_payload={}, dedup_hash="cancel-pending",
    )
    store_repo.claim_batch(worker_id="w1", limit=1, store_id=store.id)
    db.refresh(sent)
    assert sent.status == "processing"  # sanity: the claim grabbed "sent", not "pending"
    store_repo.mark_sent(sent)

    cancelled_count = store_repo.cancel_for_order(order.id, reason="ORDER_MERGED")
    db.refresh(pending)
    db.refresh(sent)
    assert cancelled_count == 1
    assert pending.status == "cancelled"
    assert sent.status == "sent"  # never touched — this is the "already sent" edge case, logged not clobbered


def test_event_store_replay_creates_new_row_without_touching_original(db, store, order):
    store_repo = MarketingEventStore(db)
    original = store_repo.create(
        event_id=f"REPLAY-{order.id}", business_event="ORDER_CONFIRMED", provider="meta",
        provider_event="Purchase", order_id=order.id, store_id=store.id,
        canonical_payload={"value": 1800}, raw_payload={}, dedup_hash="replay-hash",
    )
    store_repo.claim_batch(worker_id="w1", limit=10, store_id=store.id)
    db.refresh(original)
    store_repo.mark_sent(original, api_response={"fbtrace_id": "original-trace"})
    db.refresh(original)

    replayed = store_repo.replay(original)
    assert replayed.id != original.id
    assert replayed.replayed_from == original.id
    assert replayed.status == "pending"
    assert replayed.canonical_payload == original.canonical_payload

    db.refresh(original)
    assert original.status == "sent"  # untouched by the replay


def test_emit_business_event_creates_shadow_event_without_provider_config(db, store, order):
    default_mapping = ProviderEventMapping(
        id=str(uuid.uuid4()), store_id=None, provider="meta",
        business_event="ORDER_CONFIRMED", provider_event="Purchase",
    )
    db.add(default_mapping)
    db.commit()
    try:
        created = emit_business_event(db, order=order, business_event=BusinessEvent.ORDER_CONFIRMED)
        assert len(created) == 1
        row = created[0]
        assert row.shadow is True
        assert row.status == "pending"
        assert row.provider == "meta"
        assert row.provider_payload is None  # no MetaAdsConfig for this fresh store — left null, not an error
        assert row.signal_quality_score is not None
    finally:
        db.delete(default_mapping)
        db.commit()


def test_emit_business_event_is_idempotent_across_two_calls(db, store, order):
    default_mapping = ProviderEventMapping(
        id=str(uuid.uuid4()), store_id=None, provider="meta",
        business_event="ORDER_CONFIRMED", provider_event="Purchase",
    )
    db.add(default_mapping)
    db.commit()
    try:
        first = emit_business_event(db, order=order, business_event=BusinessEvent.ORDER_CONFIRMED)
        second = emit_business_event(db, order=order, business_event=BusinessEvent.ORDER_CONFIRMED)
        assert len(first) == 1
        assert len(second) == 0  # already emitted — idempotent no-op, not a duplicate row

        store_repo = MarketingEventStore(db)
        _, total = store_repo.search(order_id=order.id, business_event="ORDER_CONFIRMED")
        assert total == 1
    finally:
        db.delete(default_mapping)
        db.commit()


def test_emit_business_event_order_merged_cancels_pending_event_never_creates_one():
    """
    THE regression test for the bug that started this whole project: a
    duplicate order that gets merged must never let a pending Purchase-
    equivalent event reach a provider. ORDER_MERGED must return an empty
    list (it never creates events) and must cancel whatever was pending.
    """
    db = SessionLocal()
    try:
        owner = User(
            id=str(uuid.uuid4()), email=f"merge-test-{uuid.uuid4().hex[:8]}@azzougshop.test",
            name="Merge Test Owner", hashed_password=get_password_hash("test-only"), role="SUPER_ADMIN",
        )
        db.add(owner)
        db.flush()
        s = Store(id=str(uuid.uuid4()), name="Merge Test Store", slug=f"merge-test-{uuid.uuid4().hex[:8]}", owner_id=owner.id)
        db.add(s)
        db.flush()
        o = Order(
            id=str(uuid.uuid4()), store_id=s.id, order_number=f"ORD-MERGE-{uuid.uuid4().hex[:8]}",
            customer_name="Dup Client", customer_phone="0555999888",
            customer_address="1 Rue Dup", customer_wilaya="Alger",
            total=1800, subtotal=1800, status="NEW",
        )
        db.add(o)
        default_mapping = ProviderEventMapping(
            id=str(uuid.uuid4()), store_id=None, provider="meta",
            business_event="ORDER_CONFIRMED", provider_event="Purchase",
        )
        db.add(default_mapping)
        db.commit()

        created = emit_business_event(db, order=o, business_event=BusinessEvent.ORDER_CONFIRMED)
        assert len(created) == 1
        pending_event_id = created[0].id

        merged_result = emit_business_event(db, order=o, business_event=BusinessEvent.ORDER_MERGED)
        assert merged_result == []  # ORDER_MERGED never creates a new event

        store_repo = MarketingEventStore(db)
        row = store_repo.get_by_id(pending_event_id)
        assert row.status == "cancelled"  # the Purchase-equivalent event never reaches Meta
    finally:
        db.query(MarketingEvent).filter(MarketingEvent.order_id == o.id).delete()
        db.query(ProviderEventMapping).filter(ProviderEventMapping.id == default_mapping.id).delete()
        db.query(Order).filter(Order.id == o.id).delete()
        db.query(Store).filter(Store.id == s.id).delete()
        db.query(User).filter(User.id == owner.id).delete()
        db.commit()
        db.close()
