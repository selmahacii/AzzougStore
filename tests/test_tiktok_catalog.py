"""
TikTok Catalog Feed Enterprise tests — app/services/tiktok_catalog.py.
Pure-function tests (mapping/validation) + DB-backed tests (health
aggregation, retry engine), no network, no mock catalog data (every test
uses a real Product row shape).
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.base_class import Base
from app.models.marketing import TikTokCatalogSyncLog
from app.models.product import Product
from app.services.tiktok_catalog import (
    build_catalog_item, validate_catalog_item, compute_catalog_health,
    _reclaim_stuck_processing, _STUCK_PROCESSING_MINUTES,
)


def _fake_product(**overrides):
    defaults = dict(
        id="prod-1", store_id="store-1", name="T-Shirt Bleu", slug="t-shirt-bleu",
        sku="TS-BLU-M", barcode=None, description="Un beau t-shirt bleu",
        price=2500, stock=10, reserved_stock=2,
        main_image="https://cdn.example.com/tshirt.jpg", images=["https://cdn.example.com/tshirt.jpg"],
        brand=None, category="Vêtements", is_active=True, is_upsell_only=False,
        updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_build_catalog_item_maps_erp_fields_to_tiktok_schema():
    product = _fake_product()
    item = build_catalog_item(product, base_url="https://boutique.dz", store_name="Ma Boutique")

    assert item["sku_id"] == "TS-BLU-M"  # uses SKU when set
    assert item["title"] == "T-Shirt Bleu"
    assert item["availability"] == "IN_STOCK"  # 10 - 2 = 8 available
    assert item["inventory"] == 8
    assert item["price"]["amount"] == "2500.00"
    assert item["price"]["currency"] == "DZD"
    assert item["link"] == "https://boutique.dz/?app=storefront&view=product&product=t-shirt-bleu"
    assert item["image_link"] == "https://cdn.example.com/tshirt.jpg"
    assert item["brand"] == "Ma Boutique"  # falls back to store name when product has none


def test_build_catalog_item_falls_back_to_product_id_when_no_sku():
    product = _fake_product(sku=None)
    item = build_catalog_item(product, base_url="https://boutique.dz", store_name="Ma Boutique")
    assert item["sku_id"] == "prod-1"


def test_build_catalog_item_out_of_stock_when_no_available_inventory():
    product = _fake_product(stock=2, reserved_stock=2)
    item = build_catalog_item(product, base_url="https://boutique.dz", store_name="Ma Boutique")
    assert item["availability"] == "OUT_OF_STOCK"
    assert item["inventory"] == 0


def test_build_catalog_item_never_fabricates_gtin():
    product = _fake_product(barcode=None)
    item = build_catalog_item(product, base_url="https://boutique.dz", store_name="Ma Boutique")
    assert item["gtin"] is None

    product_with_barcode = _fake_product(barcode="6111234567890")
    item2 = build_catalog_item(product_with_barcode, base_url="https://boutique.dz", store_name="Ma Boutique")
    assert item2["gtin"] == "6111234567890"


def test_validate_catalog_item_rejects_missing_image():
    item = build_catalog_item(_fake_product(main_image=None, images=[]), base_url="https://boutique.dz", store_name="X")
    is_valid, errors = validate_catalog_item(item)
    assert is_valid is False
    assert any("image_link" in e for e in errors)


def test_validate_catalog_item_rejects_zero_price():
    item = build_catalog_item(_fake_product(price=0), base_url="https://boutique.dz", store_name="X")
    is_valid, errors = validate_catalog_item(item)
    assert is_valid is False
    assert any("price" in e for e in errors)


def test_validate_catalog_item_accepts_complete_item():
    item = build_catalog_item(_fake_product(), base_url="https://boutique.dz", store_name="X")
    is_valid, errors = validate_catalog_item(item)
    assert is_valid is True
    assert errors == []


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[TikTokCatalogSyncLog.__table__])
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def _make_sync_log(store_id, product_id, status, error_category=None, latency_ms=None, completed_at=None, processing_started_at=None):
    return TikTokCatalogSyncLog(
        id=str(uuid.uuid4()), store_id=store_id, product_id=product_id, action="create",
        status=status, error_category=error_category, latency_ms=latency_ms,
        completed_at=completed_at, processing_started_at=processing_started_at,
    )


def test_catalog_health_empty_returns_none_success_rate_not_zero(db_session):
    health = compute_catalog_health(db_session, "store-empty")
    assert health["total_tracked"] == 0
    assert health["success_rate_pct"] is None  # no data, never a fabricated 0%


def test_catalog_health_aggregates_status_and_error_breakdown(db_session):
    store_id = "store-1"
    db_session.add(_make_sync_log(store_id, "p1", "success", latency_ms=200, completed_at=datetime.now(timezone.utc).replace(tzinfo=None)))
    db_session.add(_make_sync_log(store_id, "p2", "success", latency_ms=400, completed_at=datetime.now(timezone.utc).replace(tzinfo=None)))
    db_session.add(_make_sync_log(store_id, "p3", "failed", error_category="validation"))
    db_session.add(_make_sync_log(store_id, "p4", "pending_retry", error_category="network_timeout"))
    db_session.commit()

    health = compute_catalog_health(db_session, store_id)
    assert health["total_tracked"] == 4
    assert health["success"] == 2
    assert health["failed"] == 1
    assert health["pending"] == 1
    assert health["success_rate_pct"] == 50.0
    assert health["avg_latency_ms"] == 300.0
    assert health["errors_by_category"]["validation"] == 1
    assert health["errors_by_category"]["network_timeout"] == 1


def test_reclaim_stuck_processing_puts_dead_worker_rows_back_to_retry(db_session):
    store_id = "store-1"
    stuck_cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=_STUCK_PROCESSING_MINUTES + 5)
    row = _make_sync_log(store_id, "p1", "processing", processing_started_at=stuck_cutoff)
    db_session.add(row)
    db_session.commit()

    reclaimed = _reclaim_stuck_processing(db_session)
    assert reclaimed == 1
    db_session.refresh(row)
    assert row.status == "retry"
