"""
Regression tests for app/services/conversion_optimization_engine.py.

Uses a minimal in-memory SQLite database with the real models (no live
Postgres available). Focus: every number here must come from real rows —
these tests plant specific counts and assert the engine reproduces the
exact arithmetic, and that empty-data cases return None (not a fabricated
0/100%) rather than presenting "no data" as "bad data".
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.base_class import Base
from app.models.marketing import MetaCapiLog
from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.audit import AuditLog
from app.services import conversion_optimization_engine as engine


@pytest.fixture()
def db_session():
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng, tables=[
        MetaCapiLog.__table__, Order.__table__, OrderItem.__table__, Product.__table__, AuditLog.__table__,
    ])
    Session = sessionmaker(bind=eng)
    session = Session()
    yield session
    session.close()


def _log(store_id, event_name, created_at, event_id=None):
    return MetaCapiLog(
        id=str(uuid.uuid4()), store_id=store_id, event_name=event_name,
        status="success", event_id=event_id or str(uuid.uuid4()), created_at=created_at,
    )


def test_conversion_overview_rate_and_none_when_no_pageviews(db_session):
    store_id = "s1"
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    # 10 PageView, 2 Purchase within the last 30 days -> 20% conversion.
    for _ in range(10):
        db_session.add(_log(store_id, "PageView", now - timedelta(days=1)))
    for _ in range(2):
        db_session.add(_log(store_id, "Purchase", now - timedelta(days=1)))
    db_session.commit()

    overview = engine.compute_conversion_overview(db_session, store_id, now=now)
    assert overview["windows"]["days_30"]["conversion_rate"] == 20.0
    assert overview["windows"]["days_30"]["purchases"] == 2
    assert overview["windows"]["days_30"]["pageviews"] == 10

    # A store with zero PageView must get None, never a fabricated 0%.
    empty_overview = engine.compute_conversion_overview(db_session, "empty-store", now=now)
    assert empty_overview["windows"]["days_30"]["conversion_rate"] is None


def test_funnel_bottleneck_detection_picks_worst_stage(db_session):
    store_id = "s2"
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    since = now - timedelta(days=7)
    # 100 PageView -> 80 ViewContent -> 10 AddToCart (huge drop here) -> 8 InitiateCheckout -> 7 Purchase
    counts = {"PageView": 100, "ViewContent": 80, "AddToCart": 10, "InitiateCheckout": 8, "Purchase": 7}
    for stage, n in counts.items():
        for _ in range(n):
            db_session.add(_log(store_id, stage, now - timedelta(hours=1)))
    db_session.commit()

    funnel = engine.compute_conversion_funnel(db_session, store_id, since, now)
    stage_by_name = {s["stage"]: s for s in funnel["stages"]}
    assert stage_by_name["AddToCart"]["volume"] == 10
    # 10/80 = 12.5% rate from ViewContent -> AddToCart, loss = 87.5% -- the worst drop.
    assert funnel["primary_bottleneck"]["stage"] == "AddToCart"
    assert "AddToCart" in funnel["primary_bottleneck"]["message"] or "Ajout Panier" in funnel["primary_bottleneck"]["message"]


def test_product_conversion_analysis_real_revenue_and_tags(db_session):
    store_id = "s3"
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    since = now - timedelta(days=30)

    product = Product(
        id=str(uuid.uuid4()), store_id=store_id, name="T-Shirt", slug="t-shirt",
        sku="TS-1", price=2000, cost_price=800, is_upsell_only=False, main_image="https://x/img.jpg",
    )
    db_session.add(product)
    db_session.commit()

    order = Order(
        id=str(uuid.uuid4()), store_id=store_id, order_number="ORD-1", status="DELIVERED",
        total=4000, subtotal=4000, customer_name="Test", customer_phone="0555000000",
        customer_wilaya="Alger", customer_commune="Alger Centre", customer_address="rue test",
        created_at=now - timedelta(days=1),
    )
    db_session.add(order)
    db_session.add(OrderItem(
        id=str(uuid.uuid4()), order_id=order.id, product_id=product.id,
        product_name="T-Shirt", quantity=2, unit_price=2000,
    ))
    db_session.commit()

    products = engine.compute_product_conversion_analysis(db_session, store_id, since, now)
    assert len(products) == 1
    p = products[0]
    assert p["purchases"] == 2
    assert p["revenue"] == 4000
    assert p["cost"] == 1600  # 2 * 800
    assert p["profit"] == 2400
    assert p["margin_pct"] == 60.0


def test_opportunity_score_no_gain_when_no_better_period_exists(db_session):
    """
    A single flat period with no historical variation must report
    "no gain to estimate" rather than invent a potential uplift.
    """
    store_id = "s4"
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    since = now - timedelta(days=30)

    result = engine.compute_opportunity_score(db_session, store_id, since, now)
    assert result["current_conversion_rate"] is None
    assert result["estimated_extra_revenue"] is None


def test_action_priorities_derive_from_bottlenecks_not_invented(db_session):
    bottlenecks = [
        {"id": "low_emq", "severity": "high", "confidence": "high", "impact": "EMQ faible", "explanation": "...", "fix": "..."},
        {"id": "missing_photos", "severity": "medium", "confidence": "high", "impact": "Photos manquantes", "explanation": "...", "fix": "..."},
    ]
    actions = engine.compute_action_priorities(bottlenecks)
    assert len(actions) == 2
    # low_emq: impact 5 stars, effort 2 -> priority 8; missing_photos: impact 3, effort 1 -> priority 5.
    assert actions[0]["id"] == "low_emq"
    assert actions[0]["priority_score"] > actions[1]["priority_score"]


def test_benchmark_never_fabricates_sector_average(db_session):
    store_id = "s5"
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    since = now - timedelta(days=30)
    benchmark = engine.compute_benchmark(db_session, store_id, since, now)
    assert benchmark["sector_average"] is None
    assert "non disponible" in benchmark["sector_average_note"].lower() or "Non disponible" in benchmark["sector_average_note"]


def test_funnel_flags_incoherence_when_a_stage_exceeds_the_previous_one(db_session):
    """
    A funnel stage can never legitimately exceed the stage before it. If it
    does (tracking gap, duplicated event under a different event_id), the
    engine must surface it as an explicit anomaly rather than silently
    display a nonsensical tunnel or a fabricated negative loss.
    """
    store_id = "s6"
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    since = now - timedelta(days=7)
    # PageView under-tracked (5) while ViewContent (20) fires correctly -- impossible in a sane funnel.
    for _ in range(5):
        db_session.add(_log(store_id, "PageView", now - timedelta(hours=1)))
    for _ in range(20):
        db_session.add(_log(store_id, "ViewContent", now - timedelta(hours=1)))
    db_session.commit()

    funnel = engine.compute_conversion_funnel(db_session, store_id, since, now)
    assert len(funnel["coherence_issues"]) == 1
    assert funnel["coherence_issues"][0]["stage"] == "ViewContent"
    assert funnel["coherence_issues"][0]["stage_volume"] == 20
    assert funnel["coherence_issues"][0]["previous_stage_volume"] == 5

    bottlenecks = engine.detect_bottlenecks(db_session, store_id, since, now)
    assert any(b["id"] == "funnel_incoherence" for b in bottlenecks)
