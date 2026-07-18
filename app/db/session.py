from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from app.core.config import settings
from app.core.tenant import set_tenant_isolation_event

# Engine setup — adjusted for SQLite/PostgreSQL compatibility
_db_url: str = settings.DATABASE_URL or ""  # pyrefly: ignore[missing-attribute]
if _db_url.startswith("sqlite"):
    engine = create_engine(  # pyrefly: ignore[no-matching-overload]
        _db_url,
        connect_args={"check_same_thread": False}
    )
else:
    engine = create_engine(  # pyrefly: ignore[no-matching-overload]
        _db_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Apply global tenant filtering hook to Session
set_tenant_isolation_event(SessionLocal)

# ─── Per-request DB timing (Server-Timing "database" entry) ────────────────
# Hooks the actual cursor execute/finish, not just session open/close — this
# is real query+network time against Postgres, summed across every query the
# request makes, not a proxy measurement.
from sqlalchemy import event as _sa_event
import time as _time_mod


@_sa_event.listens_for(engine, "before_cursor_execute")
def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    context._query_start_time = _time_mod.perf_counter()


@_sa_event.listens_for(engine, "after_cursor_execute")
def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    start = getattr(context, "_query_start_time", None)
    if start is not None:
        from app.core import timing as _timing
        _timing.record("database", (_time_mod.perf_counter() - start) * 1000)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
