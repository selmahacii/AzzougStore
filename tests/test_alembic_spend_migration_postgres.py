"""
Isolated PostgreSQL integration test for Alembic spend migration (b3c4d5e6f7a8):
- Strict guardrail refusing to run migration tests on persistent databases (e.g. azzougshop).
- Ephemeral PostgreSQL database fixture: creates a dedicated database, runs tests, and drops it.
- Verifies upgrade() sets nullable=True and drops server_default.
- Tests insert and persistence of converted (spend=2200.0) and unrated (spend=None) records.
- Verifies that downgrade() REFUSES to convert NULL spends to 0.0 and raises RuntimeError.
- Verifies that downgrade() succeeds cleanly once NULL records are resolved.
"""
import uuid
import pytest
from urllib.parse import urlparse, urlunparse
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from sqlalchemy import create_engine, text
from alembic import command
from alembic.config import Config
from app.core.config import settings


def assert_is_ephemeral_test_db(db_url: str) -> None:
    """
    Guardrail: Prevents running migration upgrade/downgrade cycles
    on persistent development, staging, or production databases.
    """
    parsed = urlparse(db_url)
    db_name = parsed.path.lstrip("/")
    if db_name in ("azzougshop", "postgres", "production", "staging"):
        raise RuntimeError(
            f"DANGER: Attempted to run migration test on persistent database '{db_name}'! "
            "Migration lifecycle tests MUST run exclusively against an ephemeral test database."
        )
    if not (db_name.startswith("test_") or "ephemeral" in db_name):
        raise RuntimeError(
            f"DANGER: Database '{db_name}' lacks test prefix ('test_' or 'ephemeral'). Aborting."
        )


@pytest.fixture(scope="module")
def ephemeral_pg_db():
    """
    Creates an ephemeral PostgreSQL database for the test module,
    and drops it unconditionally on teardown.
    """
    base_url = settings.DATABASE_URL
    parsed = urlparse(base_url)
    
    # Connect to maintenance db 'postgres' to create ephemeral database
    admin_url = urlunparse(parsed._replace(path="/postgres"))
    ephemeral_db_name = f"test_ephemeral_spend_{uuid.uuid4().hex[:8]}"
    ephemeral_url = urlunparse(parsed._replace(path=f"/{ephemeral_db_name}"))

    try:
        conn = psycopg2.connect(admin_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()
        cur.execute(f"CREATE DATABASE {ephemeral_db_name}")
        cur.close()
        conn.close()
    except Exception as e:
        pytest.skip(f"Could not connect to PostgreSQL to create ephemeral database: {e}")

    # Guardrail verification
    assert_is_ephemeral_test_db(ephemeral_url)

    yield ephemeral_url

    # Teardown: terminate connections and drop ephemeral database
    try:
        conn = psycopg2.connect(admin_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()
        cur.execute(f"""
            SELECT pg_terminate_backend(pid) 
            FROM pg_stat_activity 
            WHERE datname = '{ephemeral_db_name}' AND pid <> pg_backend_pid();
        """)
        cur.execute(f"DROP DATABASE IF EXISTS {ephemeral_db_name}")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Warning: Failed to drop ephemeral database {ephemeral_db_name}: {e}")


def test_guardrail_rejects_persistent_database():
    """Vérifie que le garde-fou bloque immédiatement toute cible persistante."""
    with pytest.raises(RuntimeError, match="DANGER: Attempted to run migration test on persistent database 'azzougshop'"):
        assert_is_ephemeral_test_db("postgresql://postgres:postgres@localhost:5432/azzougshop")

    with pytest.raises(RuntimeError, match="DANGER: Attempted to run migration test on persistent database 'production'"):
        assert_is_ephemeral_test_db("postgresql://user:pass@remote:5432/production")


def test_alembic_spend_migration_lifecycle_on_ephemeral_postgres(ephemeral_pg_db):
    """
    Exécute le cycle complet d'upgrade et downgrade sur une base éphémère isolée :
    1. spend est initialement NOT NULL avec son ancien défaut ('0.0'), vérifié par information_schema.
    2. L'upgrade (b3c4d5e6f7a8) rend la colonne nullable et retire le server_default attendu.
    3. Les données préexistantes restent intactes après l'upgrade.
    4. Une dépense étrangère non convertie peut être persistée avec spend = NULL.
    5. Le downgrade refuse d'écraser automatiquement les NULL en 0.0 et lève RuntimeError.
    6. Le rejet du downgrade laisse les données intactes sans aucune corruption.
    7. Le downgrade propre fonctionne lorsque ses préconditions sont satisfaites (0 NULL).
    """
    alembic_cfg = Config("alembic.ini")
    alembic_cfg.set_main_option("sqlalchemy.url", ephemeral_pg_db)

    engine = create_engine(ephemeral_pg_db)
    from app.db.base_class import Base
    import app.models  # noqa
    Base.metadata.create_all(bind=engine)

    # 1. Établissement et vérification formelle de l'état du schéma historique (pré-b3c4d5e6f7a8) :
    # La colonne spend doit être explicitement NOT NULL avec server_default '0.0'.
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE meta_ads_campaigns ALTER COLUMN spend SET NOT NULL;"))
        conn.execute(text("ALTER TABLE meta_ads_campaigns ALTER COLUMN spend SET DEFAULT '0.0';"))
        conn.execute(text("ALTER TABLE meta_ads_daily_insights ALTER COLUMN spend SET NOT NULL;"))
        conn.execute(text("ALTER TABLE meta_ads_daily_insights ALTER COLUMN spend SET DEFAULT '0.0';"))
        conn.commit()

        # Vérification des préconditions via information_schema.columns
        res_pre_c = conn.execute(text("""
            SELECT column_name, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'meta_ads_campaigns' AND column_name = 'spend'
        """)).fetchone()
        assert res_pre_c is not None
        assert res_pre_c[1] == "NO", "Précondition échouée: meta_ads_campaigns.spend doit initialement être NOT NULL"
        assert "0" in str(res_pre_c[2]), f"Précondition échouée: server_default doit être '0', obtenu: {res_pre_c[2]}"

        res_pre_d = conn.execute(text("""
            SELECT column_name, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'meta_ads_daily_insights' AND column_name = 'spend'
        """)).fetchone()
        assert res_pre_d is not None
        assert res_pre_d[1] == "NO", "Précondition échouée: meta_ads_daily_insights.spend doit initialement être NOT NULL"
        assert "0" in str(res_pre_d[2]), f"Précondition échouée: server_default doit être '0', obtenu: {res_pre_d[2]}"

    # 2. Enregistrement de la révision antérieure a819cd3e5f20
    command.stamp(alembic_cfg, "a819cd3e5f20")

    # 3. Insertion de données préexistantes sous l'ancien schéma (spend=1200.0 DZD)
    from sqlalchemy.orm import Session
    from app.models.user import User
    from app.models.store import Store

    with Session(engine) as session:
        test_user = User(
            id=str(uuid.uuid4()),
            email=f"ephemeral_{uuid.uuid4().hex[:6]}@test.dz",
            name="Ephemeral Tester",
            hashed_password="hash",
            role="SUPER_ADMIN",
        )
        test_store = Store(
            id=str(uuid.uuid4()),
            name="Ephemeral Store",
            slug=f"store-{uuid.uuid4().hex[:6]}",
            owner_id=test_user.id,
        )
        session.add(test_user)
        session.flush()
        session.add(test_store)
        session.commit()
        test_store_id = test_store.id

    camp_preexisting_id = f"camp_pre_{uuid.uuid4().hex[:8]}"
    with engine.connect() as conn:
        conn.execute(text("""
            INSERT INTO meta_ads_campaigns (id, campaign_id, campaign_name, store_id, spend, raw_spend, currency, impressions, clicks, created_at, updated_at)
            VALUES (:id, :camp_id, 'Campagne Preexistante', :store_id, 1200.0, 10.0, 'USD', 50, 5, NOW(), NOW())
        """), {"id": str(uuid.uuid4()), "camp_id": camp_preexisting_id, "store_id": test_store_id})
        conn.commit()

    # 4. Exécution de l'upgrade vers b3c4d5e6f7a8
    command.upgrade(alembic_cfg, "b3c4d5e6f7a8")

    # 5. Vérification du schéma post-upgrade via information_schema.columns
    with engine.connect() as conn:
        res_post_c = conn.execute(text("""
            SELECT column_name, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'meta_ads_campaigns' AND column_name = 'spend'
        """)).fetchone()
        assert res_post_c is not None
        assert res_post_c[1] == "YES", "Post-upgrade: meta_ads_campaigns.spend doit être devenu nullable (YES)"
        assert res_post_c[2] is None, f"Post-upgrade: server_default doit être supprimé (None), obtenu: {res_post_c[2]}"

        res_post_d = conn.execute(text("""
            SELECT column_name, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'meta_ads_daily_insights' AND column_name = 'spend'
        """)).fetchone()
        assert res_post_d is not None
        assert res_post_d[1] == "YES", "Post-upgrade: meta_ads_daily_insights.spend doit être devenu nullable (YES)"
        assert res_post_d[2] is None, f"Post-upgrade: server_default doit être supprimé (None), obtenu: {res_post_d[2]}"

        # Vérification de la préservation intégrale des données préexistantes
        row_pre = conn.execute(text("SELECT spend, raw_spend FROM meta_ads_campaigns WHERE campaign_id = :id"), {"id": camp_preexisting_id}).fetchone()
        assert row_pre[0] == 1200.0, "La dépense préexistante doit être strictement préservée"
        assert row_pre[1] == 10.0

        # 6. Insertion d'une dépense non convertie (spend=NULL, raw_spend=80.0 EUR)
        camp_unconv_id = f"camp_unconv_{uuid.uuid4().hex[:8]}"
        conn.execute(text("""
            INSERT INTO meta_ads_campaigns (id, campaign_id, campaign_name, store_id, spend, raw_spend, currency, impressions, clicks, created_at, updated_at)
            VALUES (:id, :camp_id, 'Campagne Non Convertie', :store_id, NULL, 80.0, 'EUR', 500, 25, NOW(), NOW())
        """), {"id": str(uuid.uuid4()), "camp_id": camp_unconv_id, "store_id": test_store_id})
        conn.commit()

        row_unconv = conn.execute(text("SELECT spend, raw_spend FROM meta_ads_campaigns WHERE campaign_id = :id"), {"id": camp_unconv_id}).fetchone()
        assert row_unconv[0] is None, "spend doit être persisté comme strictement NULL"
        assert row_unconv[1] == 80.0

    # 7. Tentative de Downgrade : DOIT ÉCHOUER car spend IS NULL est présent
    with pytest.raises(Exception) as exc_info:
        command.downgrade(alembic_cfg, "a819cd3e5f20")
    
    assert "DANGER: Downgrade rejected to protect data integrity" in str(exc_info.value)
    assert "meta_ads_campaigns (1 rows with spend IS NULL)" in str(exc_info.value)

    # 8. Vérifier que la donnée n'a PAS été corrompue lors de l'avortement du downgrade
    with engine.connect() as conn:
        row_unconv_check = conn.execute(text("SELECT spend, raw_spend FROM meta_ads_campaigns WHERE campaign_id = :id"), {"id": camp_unconv_id}).fetchone()
        assert row_unconv_check[0] is None, "spend doit rester strictement NULL après rejet du downgrade"

        # 9. Résolution explicite : suppression de la ligne avec spend NULL
        conn.execute(text("DELETE FROM meta_ads_campaigns WHERE campaign_id = :id"), {"id": camp_unconv_id})
        conn.commit()

    # 10. Maintenant que 0 NULL sont présents, le downgrade propre doit réussir en sécurité
    command.downgrade(alembic_cfg, "a819cd3e5f20")

    with engine.connect() as conn:
        res_down = conn.execute(text("""
            SELECT column_name, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'meta_ads_campaigns' AND column_name = 'spend'
        """)).fetchone()
        assert res_down is not None
        assert "0" in str(res_down[2]), f"Downgrade sécurisé doit restaurer default 0, obtenu: {res_down[2]}"

        # Vérification que la donnée préexistante est toujours intacte
        row_pre_down = conn.execute(text("SELECT spend, raw_spend FROM meta_ads_campaigns WHERE campaign_id = :id"), {"id": camp_preexisting_id}).fetchone()
        assert row_pre_down[0] == 1200.0, "La donnée préexistante doit rester intacte après downgrade"

    # 11. Re-upgrade vers head pour laisser la base dans un état nominal
    command.upgrade(alembic_cfg, "b3c4d5e6f7a8")
    engine.dispose()
