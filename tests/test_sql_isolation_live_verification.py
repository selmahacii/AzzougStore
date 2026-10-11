"""
Tests de vérification formelle de l'isolation SQL en direct (Phase 3A.8) :
1. Prouve que SessionLocal() se connecte physiquement à la base éphémère via SELECT current_database().
2. Prouve que la dépendance FastAPI get_db() se connecte physiquement à la base éphémère.
3. Prouve que le moteur global app.db.session.engine se connecte physiquement à la base éphémère.
4. Prouve que toute tentative de connexion à 'azzougshop' est interceptée et bloquée au niveau du Pool.
"""
import pytest
from sqlalchemy import text, create_engine
from app.db.session import SessionLocal, engine, get_db
from app.core.config import settings


def test_sessionlocal_executes_on_ephemeral_database():
    """Vérifie via SELECT current_database() que SessionLocal() est physiquement sur la base éphémère."""
    db = SessionLocal()
    try:
        active_db = db.execute(text("SELECT current_database()")).scalar()
        assert active_db is not None
        assert active_db.startswith("test_ephemeral_runner_"), f"Attendu test_ephemeral_runner_*, obtenu: {active_db}"
        assert active_db not in ("azzougshop", "postgres", "production", "staging")
    finally:
        db.close()


def test_fastapi_get_db_executes_on_ephemeral_database():
    """Vérifie que la dépendance get_db injectée dans les routes FastAPI utilise la base éphémère."""
    gen = get_db()
    db = next(gen)
    try:
        active_db = db.execute(text("SELECT current_database()")).scalar()
        assert active_db is not None
        assert active_db.startswith("test_ephemeral_runner_"), f"Attendu test_ephemeral_runner_*, obtenu: {active_db}"
        assert active_db not in ("azzougshop", "postgres", "production", "staging")
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def test_app_engine_executes_on_ephemeral_database():
    """Vérifie que engine.connect() utilise physiquement la base éphémère."""
    with engine.connect() as conn:
        active_db = conn.execute(text("SELECT current_database()")).scalar()
        assert active_db is not None
        assert active_db.startswith("test_ephemeral_runner_"), f"Attendu test_ephemeral_runner_*, obtenu: {active_db}"
        assert active_db not in ("azzougshop", "postgres", "production", "staging")


def test_pool_guardrail_blocks_connection_to_persistent_azzougshop():
    """Vérifie qu'un moteur tentant de se connecter à 'azzougshop' est immédiatement bloqué."""
    bad_engine = create_engine("postgresql://postgres:postgres@localhost:5432/azzougshop")
    with pytest.raises(RuntimeError, match="FATAL SECURITY GUARDRAIL:"):
        with bad_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    bad_engine.dispose()


def test_direct_psycopg2_connect_blocked_to_persistent_azzougshop():
    """Vérifie qu'un appel direct psycopg2.connect() vers 'azzougshop' est intercepté et bloqué."""
    import psycopg2
    with pytest.raises(RuntimeError, match="FATAL SECURITY GUARDRAIL: Direct psycopg2.connect attempt to persistent database 'azzougshop' blocked!"):
        psycopg2.connect("postgresql://postgres:postgres@localhost:5432/azzougshop")

