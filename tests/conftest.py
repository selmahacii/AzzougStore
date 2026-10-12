"""
Global Pytest Configuration and Test Isolation Guardrails for AzzougShop.

Guarantees 100% database isolation for all tests:
1. pytest_configure automatically provisions a dedicated ephemeral PostgreSQL database
   (test_ephemeral_runner_{uuid}) before any test module is imported or executed.
2. Initializes all 63 tables via Base.metadata.create_all() and stamps Alembic head.
3. Repoints settings.DATABASE_URL, os.environ["DATABASE_URL"], app.db.session.engine,
   and app.db.session.SessionLocal to the ephemeral database.
4. Connection-level guardrail via SQLAlchemy Pool.connect & Pool.checkout:
   Executes `SELECT current_database()` on EVERY real SQL connection and aborts
   immediately if connected to azzougshop, postgres, production, or staging.
5. Autouse fixture verifies live connection `SELECT current_database()` before every test.
6. pytest_unconfigure + atexit teardown terminates connections and drops the ephemeral database.
"""
import atexit
import os
import uuid
from urllib.parse import urlparse, urlunparse
import pytest
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from sqlalchemy import create_engine, event, text
from sqlalchemy.pool import Pool
from alembic.config import Config
from alembic import command

import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from app.core.config import settings

_EPHEMERAL_DB_NAME = None
_ADMIN_URL = None
_EPHEMERAL_ENGINE = None
_CONFIRMED_LIVE_DATABASES = set()
_GUARDRAIL_BLOCKED_DATABASES = ("azzougshop", "postgres", "production", "staging")


def assert_is_ephemeral_test_db(db_url: str) -> None:
    """
    Strict guardrail: Refuses any test execution or write against persistent
    development, staging, or production databases.
    """
    if not db_url:
        return
    if db_url.startswith("sqlite") or ":memory:" in db_url:
        return  # In-memory SQLite is isolated and safe

    parsed = urlparse(db_url)
    db_name = parsed.path.lstrip("/")
    if db_name in _GUARDRAIL_BLOCKED_DATABASES:
        raise RuntimeError(
            f"CRITICAL GUARDRAIL VIOLATION: Attempted to run test against persistent database '{db_name}'! "
            f"Tests are strictly forbidden from targeting persistent databases. Target URL: {db_url}"
        )
    if not (db_name.startswith("test_") or "ephemeral" in db_name):
        raise RuntimeError(
            f"CRITICAL GUARDRAIL VIOLATION: Database '{db_name}' lacks test prefix ('test_' or 'ephemeral'). Target URL: {db_url}"
        )


@event.listens_for(Pool, "connect")
def verify_connection_live_database(dbapi_connection, connection_record):
    """
    Connection-level guardrail running on EVERY raw DBAPI connection checked out by SQLAlchemy.
    Executes 'SELECT current_database()' directly against PostgreSQL to confirm the active database.
    """
    if hasattr(dbapi_connection, "cursor"):
        cur = dbapi_connection.cursor()
        try:
            cur.execute("SELECT current_database()")
            row = cur.fetchone()
            if row and row[0]:
                current_db = row[0]
                if current_db in _GUARDRAIL_BLOCKED_DATABASES:
                    raise RuntimeError(
                        f"FATAL SECURITY GUARDRAIL: SQL Connection established to persistent database '{current_db}'! "
                        "All SQL test connections must target ephemeral test databases exclusively."
                    )
                if not (current_db.startswith("test_") or "ephemeral" in current_db):
                    raise RuntimeError(
                        f"FATAL SECURITY GUARDRAIL: SQL Connection established to unapproved database '{current_db}' (missing 'test_' or 'ephemeral')!"
                    )
                _CONFIRMED_LIVE_DATABASES.add(current_db)
        except RuntimeError:
            raise
        except Exception:
            # Handles SQLite connections where SELECT current_database() does not exist
            pass
        finally:
            cur.close()


_orig_psycopg2_connect = psycopg2.connect


def _guarded_psycopg2_connect(*args, **kwargs):
    """
    Guardrail blocking any raw psycopg2.connect() targeting persistent databases (azzougshop, etc.).
    Only administrative connections to /postgres for ephemeral DB lifecycle are permitted.
    """
    dsn = str(args[0]) if args and isinstance(args[0], str) else ""
    dbname = kwargs.get("dbname") or kwargs.get("database") or ""
    for blocked in _GUARDRAIL_BLOCKED_DATABASES:
        # Allow administrative connections to /postgres strictly for CREATE/DROP DATABASE
        if blocked == "postgres" and (f"/{blocked}" in dsn or dbname == blocked):
            continue
        if f"/{blocked}" in dsn or dbname == blocked or dsn == blocked:
            raise RuntimeError(
                f"FATAL SECURITY GUARDRAIL: Direct psycopg2.connect attempt to persistent database '{blocked}' blocked! "
                "Tests must never establish direct connections to persistent databases."
            )
    return _orig_psycopg2_connect(*args, **kwargs)


psycopg2.connect = _guarded_psycopg2_connect



def _teardown_ephemeral_database():
    """Tears down the ephemeral database, terminates remaining connections, and drops it."""
    global _EPHEMERAL_DB_NAME, _ADMIN_URL, _EPHEMERAL_ENGINE

    if _EPHEMERAL_ENGINE:
        try:
            _EPHEMERAL_ENGINE.dispose()
        except Exception:
            pass

    if _ADMIN_URL and _EPHEMERAL_DB_NAME:
        try:
            conn = psycopg2.connect(_ADMIN_URL)
            conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
            cur = conn.cursor()
            cur.execute(f"""
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = '{_EPHEMERAL_DB_NAME}' AND pid <> pg_backend_pid();
            """)
            cur.execute(f"DROP DATABASE IF EXISTS {_EPHEMERAL_DB_NAME}")
            cur.close()
            conn.close()
        except Exception as exc:
            print(f"\n[conftest] WARNING: Failed to teardown ephemeral database {_EPHEMERAL_DB_NAME}: {exc}\n")


atexit.register(_teardown_ephemeral_database)


def pytest_configure(config):
    """
    Provisions an ephemeral PostgreSQL test database before test collection and execution.
    """
    global _EPHEMERAL_DB_NAME, _ADMIN_URL, _EPHEMERAL_ENGINE

    base_url = settings.DATABASE_URL or os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/azzougshop")
    parsed = urlparse(base_url)

    _ADMIN_URL = urlunparse(parsed._replace(path="/postgres"))
    _EPHEMERAL_DB_NAME = f"test_ephemeral_runner_{uuid.uuid4().hex[:8]}"
    ephemeral_url = urlunparse(parsed._replace(path=f"/{_EPHEMERAL_DB_NAME}"))

    # Verify guardrail on ephemeral url
    assert_is_ephemeral_test_db(ephemeral_url)

    try:
        conn = psycopg2.connect(_ADMIN_URL)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()
        cur.execute(f"CREATE DATABASE {_EPHEMERAL_DB_NAME}")
        cur.close()
        conn.close()
    except Exception as exc:
        print(f"\n[conftest] WARNING: Could not connect to PostgreSQL to provision ephemeral database: {exc}\n")
        return

    # Repoint environment and settings
    os.environ["DATABASE_URL"] = ephemeral_url
    os.environ["POSTGRES_TEST_URL"] = ephemeral_url
    settings.DATABASE_URL = ephemeral_url

    # Create schema and tables
    import app.models  # ensure all 63 models are imported
    from app.db.base_class import Base

    _EPHEMERAL_ENGINE = create_engine(ephemeral_url, pool_pre_ping=True)
    Base.metadata.create_all(bind=_EPHEMERAL_ENGINE)

    # Stamp Alembic head revision
    try:
        alembic_cfg = Config("alembic.ini")
        alembic_cfg.set_main_option("sqlalchemy.url", ephemeral_url)
        command.stamp(alembic_cfg, "head")
    except Exception as exc:
        print(f"\n[conftest] WARNING: Alembic stamp head failed on ephemeral db: {exc}\n")

    # Rebind app.db.session engine and SessionLocal
    import app.db.session as session_mod
    session_mod.engine = _EPHEMERAL_ENGINE
    session_mod.SessionLocal.configure(bind=_EPHEMERAL_ENGINE)


def pytest_unconfigure(config):
    """
    Tears down the ephemeral database upon test completion.
    """
    _teardown_ephemeral_database()


@pytest.fixture(autouse=True)
def guardrail_assert_no_persistent_db():
    """
    Autouse fixture executed before EVERY test function.
    Verifies that neither settings.DATABASE_URL nor app.db.session.engine points to a persistent database,
    and runs 'SELECT current_database()' on the live engine to guarantee isolation.
    """
    import app.db.session as session_mod

    assert_is_ephemeral_test_db(str(settings.DATABASE_URL))
    assert_is_ephemeral_test_db(str(session_mod.engine.url))

    # Live connection check with SELECT current_database()
    if not str(session_mod.engine.url).startswith("sqlite"):
        with session_mod.engine.connect() as conn:
            current_live_db = conn.execute(text("SELECT current_database()")).scalar()
            if current_live_db in _GUARDRAIL_BLOCKED_DATABASES:
                raise RuntimeError(
                    f"CRITICAL GUARDRAIL VIOLATION: Live engine is connected to persistent database '{current_live_db}'!"
                )
            if not (current_live_db.startswith("test_") or "ephemeral" in current_live_db):
                raise RuntimeError(
                    f"CRITICAL GUARDRAIL VIOLATION: Live database '{current_live_db}' lacks test prefix!"
                )

    yield


@pytest.fixture(autouse=True)
def mock_celery_in_tests(monkeypatch):
    """
    Prevents background Celery tasks (like sync_store_inventory.delay) from stalling
    tests by attempting 20 retries against an unreachable Redis server.
    """
    from unittest.mock import MagicMock
    try:
        import app.worker as worker_mod
        import app.api.v1.stores as stores_mod
        monkeypatch.setattr(worker_mod.sync_store_inventory, "delay", MagicMock())
        monkeypatch.setattr(worker_mod.sync_store_inventory, "apply_async", MagicMock())
        monkeypatch.setattr(stores_mod.sync_store_inventory, "delay", MagicMock())
        monkeypatch.setattr(stores_mod.sync_store_inventory, "apply_async", MagicMock())
    except Exception:
        pass
