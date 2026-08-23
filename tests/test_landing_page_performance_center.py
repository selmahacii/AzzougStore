import pytest
from datetime import datetime, timedelta
from unittest.mock import MagicMock
from app.services.landing_page_analytics_service import LandingPageAnalyticsService


class DummyLandingPage:
    def __init__(self, id="lp-123", store_id="store-456", slug="coussin-voyage", headline="Coussin de Voyage", product_id="prod-789"):
        self.id = id
        self.store_id = store_id
        self.slug = slug
        self.headline = headline
        self.product_name = "Coussin de Voyage Ergonomique"
        self.product_id = product_id
        self.meta_campaign_id = "camp-111"
        self.views = 250
        self.is_active = True
        self.created_at = datetime.utcnow() - timedelta(days=60)
        self.updated_at = datetime.utcnow() - timedelta(days=1)
        self.product = MagicMock(name="Coussin de Voyage Ergonomique")


def test_compute_health_score_perfect():
    """Test health score when all signals are optimal"""
    lp = DummyLandingPage()
    db_mock = MagicMock()
    db_mock.query.return_value.filter.return_value.first.return_value = (50, 50, 0)
    totals = {
        "total_orders": 50,
        "delivered_orders": 42,
        "returned_orders": 3,
        "shipped_orders": 45,
        "shipped_with_tracking": 45,
    }
    funnel_counts = {"pageviews": 1000}
    meta_data = {"is_available": True}
    res = LandingPageAnalyticsService._compute_health_score(
        totals=totals,
        funnel_counts=funnel_counts,
        meta_data=meta_data,
        db=db_mock,
        lp=lp,
        d_start=datetime.utcnow() - timedelta(days=30),
        d_end=datetime.utcnow(),
    )
    assert res["score"] >= 80
    assert "Excellente" in res["badge"]
    assert res["color"] == "#00B894"
    assert res["breakdown"]["conversion_score"] == 30
    assert res["breakdown"]["tracking_quality_score"] == 25
    assert res["breakdown"]["tracking_completeness_score"] == 10
    assert res["breakdown"]["capi_reliability_score"] == 10


def test_compute_health_score_penalties():
    """Test health score penalties for poor conversion, tracking errors and returns"""
    lp = DummyLandingPage()
    db_mock = MagicMock()
    db_mock.query.return_value.filter.return_value.first.return_value = (30, 10, 15)
    totals = {
        "total_orders": 30,
        "delivered_orders": 5,
        "returned_orders": 12,
        "shipped_orders": 20,
        "shipped_with_tracking": 4,
    }
    funnel_counts = {"pageviews": 10000}  # low CR: 0.3%
    meta_data = {"is_available": True}
    res = LandingPageAnalyticsService._compute_health_score(
        totals=totals,
        funnel_counts=funnel_counts,
        meta_data=meta_data,
        db=db_mock,
        lp=lp,
        d_start=datetime.utcnow() - timedelta(days=30),
        d_end=datetime.utcnow(),
    )
    assert res["score"] < 60
    assert res["breakdown"]["conversion_score"] <= 10
    assert res["breakdown"]["tracking_quality_score"] < 15
    assert res["breakdown"]["tracking_completeness_score"] < 5


def test_detect_smart_alerts():
    """Test smart alerts generation when anomalies are present"""
    curr = {
        "total_orders": 10,
        "shipped_orders": 20,
        "shipped_with_tracking": 5,
        "returned_orders": 8,
        "delivered_orders": 4,
        "abandoned_carts": 30,
        "recovered_carts": 2,
    }
    prev = {
        "total_orders": 50,
        "shipped_orders": 28,
        "shipped_with_tracking": 28,
        "returned_orders": 2,
        "delivered_orders": 25,
        "abandoned_carts": 10,
        "recovered_carts": 6,
    }
    funnel = {"pageviews": 1000}
    meta_data = {"is_available": True}
    quality = {"tracking_status": {"meta_capi_active": True}}
    alerts = LandingPageAnalyticsService._detect_smart_alerts(
        curr=curr,
        prev=prev,
        funnel=funnel,
        meta_data=meta_data,
        quality=quality,
    )
    assert len(alerts) >= 2
    titles = [a["title"] for a in alerts]
    assert any("Chute importante" in t for t in titles)
    assert any("Numéros de suivi" in t for t in titles)


def test_build_meta_reconciliation():
    """Test Meta vs AzzougShop reconciliation data structure"""
    meta_data = {
        "is_available": True,
        "purchases": 45,
        "purchase_value_raw": 12500.0,
        "currency": "DZD",
    }
    totals = {
        "total_orders": 52,
        "revenue_dzd": 145000.0,
    }
    recon = LandingPageAnalyticsService._build_meta_reconciliation(
        totals=totals,
        meta_data=meta_data,
    )
    assert recon["is_comparable"] is True
    assert len(recon["metrics"]) == 2
    assert recon["metrics"][0]["name"] == "Achats / Commandes"
    assert recon["metrics"][0]["meta_value"] == 45
    assert recon["metrics"][0]["erp_value"] == 52
    assert recon["metrics"][0]["gap"] == "+7"


def test_get_performance_center_not_found():
    """Test that querying an invalid LP raises a 404 ValueError"""
    db_mock = MagicMock()
    db_mock.query.return_value.filter.return_value.first.return_value = None
    with pytest.raises(ValueError, match="introuvable"):
        LandingPageAnalyticsService.get_performance_center(db_mock, "non-existent-id")


def test_build_unified_funnel_with_comparisons():
    """Test multi-stage funnel calculation with previous period comparisons without dict shadowing bugs"""
    meta_curr = {"impressions": 10000, "clicks": 500}
    funnel_curr = {"pageviews": 450, "add_to_cart": 80, "initiate_checkout": 60}
    orders_curr = {"total_orders": 30, "shipped_orders": 25, "delivered_orders": 20}

    meta_prev = {"impressions": 8000, "clicks": 400}
    funnel_prev = {"pageviews": 380, "add_to_cart": 70, "initiate_checkout": 50}
    orders_prev = {"total_orders": 25, "shipped_orders": 20, "delivered_orders": 18}

    pipeline = LandingPageAnalyticsService._build_unified_funnel(
        meta_curr=meta_curr,
        funnel_curr=funnel_curr,
        orders_curr=orders_curr,
        meta_prev=meta_prev,
        funnel_prev=funnel_prev,
        orders_prev=orders_prev,
    )

    assert len(pipeline) == 8
    stage_names = [s["stage"] for s in pipeline]
    assert stage_names == [
        "Impressions",
        "Clics",
        "Visites Landing Page",
        "Ajouts Panier",
        "Checkout",
        "Commandes",
        "Expédiées",
        "Livrées",
    ]
    # Check that Commandes and subsequent steps correctly read from orders_prev dict
    orders_step = pipeline[5]
    assert orders_step["stage"] == "Commandes"
    assert orders_step["volume"] == 30
    assert orders_step["previous_volume"] == 25

    shipped_step = pipeline[6]
    assert shipped_step["stage"] == "Expédiées"
    assert shipped_step["volume"] == 25
    assert shipped_step["previous_volume"] == 20

    delivered_step = pipeline[7]
    assert delivered_step["stage"] == "Livrées"
    assert delivered_step["volume"] == 20
    assert delivered_step["previous_volume"] == 18

