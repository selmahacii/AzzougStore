"""
Regression test for clear_orphaned_local_images() (app/api/v1/upload.py) —
clears Product/LandingPage/Store image references that point at this
backend's own ephemeral local-disk file server when the file is
CONFIRMED gone (typically a HuggingFace Space restart wiping local disk
between an upload and the Cloudinary migration sweep noticing it).

Must NEVER touch a Cloudinary URL or a local reference whose file still
exists — only a provably-missing local file gets cleared.
"""
import os
import sys
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.base_class import Base
from app.models.product import Product
from app.models.landing_page import LandingPage
from app.models.store import Store
from app.models.audit import AuditLog
from app.api.v1.upload import clear_orphaned_local_images, UPLOAD_DIR


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[
        Product.__table__, LandingPage.__table__, Store.__table__, AuditLog.__table__,
    ])
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


LOCAL_MARKER = "/api/v1/upload/files/"


def test_clears_only_confirmed_missing_local_files(db_session, tmp_path, monkeypatch):
    # Point UPLOAD_DIR at an isolated temp dir so this test never touches the real uploads/ folder.
    monkeypatch.setattr("app.api.v1.upload.UPLOAD_DIR", tmp_path)

    existing_file = tmp_path / "still-here.jpg"
    existing_file.write_bytes(b"fake")

    store = Store(id=str(uuid.uuid4()), name="Test Store", slug="test-store", owner_id=str(uuid.uuid4()),
                  logo_url=f"https://api.example.com{LOCAL_MARKER}gone-logo.jpg",
                  banner_url=f"https://api.example.com{LOCAL_MARKER}still-here.jpg")
    db_session.add(store)

    product = Product(
        id=str(uuid.uuid4()), store_id=store.id, name="Test Product", slug="test-product",
        sku="SKU-1", price=1000,
        main_image=f"https://api.example.com{LOCAL_MARKER}gone-main.jpg",
        images=[
            f"https://api.example.com{LOCAL_MARKER}still-here.jpg",
            f"https://api.example.com{LOCAL_MARKER}gone-gallery.jpg",
            "https://res.cloudinary.com/demo/image/upload/v1/real.jpg",
        ],
    )
    db_session.add(product)

    lp = LandingPage(
        id=str(uuid.uuid4()), store_id=store.id, product_id=product.id, slug="test-lp",
        image_url=f"https://api.example.com{LOCAL_MARKER}gone-hero.jpg",
        banner_image_url="https://res.cloudinary.com/demo/image/upload/v1/banner.jpg",
    )
    db_session.add(lp)
    db_session.commit()

    result = clear_orphaned_local_images(db_session)

    db_session.refresh(product)
    db_session.refresh(lp)
    db_session.refresh(store)

    # Confirmed-missing local files: cleared.
    assert product.main_image is None
    assert lp.image_url is None
    assert store.logo_url is None

    # Still-existing local file and any Cloudinary URL: untouched.
    assert f"{LOCAL_MARKER}still-here.jpg" in "".join(product.images)
    assert "res.cloudinary.com" in "".join(product.images)
    assert "gone-gallery.jpg" not in "".join(product.images)
    assert store.banner_url is not None and "still-here.jpg" in store.banner_url
    assert lp.banner_image_url is not None and "res.cloudinary.com" in lp.banner_image_url

    assert result["products_cleared"] == 1
    assert result["landing_pages_cleared"] == 1
    assert result["stores_cleared"] == 1
    assert result["total_references_removed"] >= 4

    audit_rows = db_session.query(AuditLog).filter(AuditLog.action == "clear_orphaned_images").all()
    assert len(audit_rows) == 1


def test_no_op_when_nothing_orphaned(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr("app.api.v1.upload.UPLOAD_DIR", tmp_path)
    result = clear_orphaned_local_images(db_session)
    assert result["total_references_removed"] == 0
    assert "Aucune référence" in result["message"]
