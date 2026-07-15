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

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
