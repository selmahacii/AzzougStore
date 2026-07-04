#!/bin/bash
set -e

echo "===== Application Startup at $(date -u '+%Y-%m-%d %H:%M:%S') ====="
echo "--- AzzougShop Backend Booting ---"

# Wait for Postgres to be ready using Python + SQLAlchemy (works with any DATABASE_URL incl. Neon)
until python -c "
import os, sys
url = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL_NON_POOLING') or os.environ.get('POSTGRES_URL')
if not url:
    print('No DATABASE_URL set', file=sys.stderr)
    sys.exit(1)
if url.startswith('postgres://'):
    url = url.replace('postgres://', 'postgresql://', 1)
from sqlalchemy import create_engine, text
try:
    engine = create_engine(url, connect_args={'connect_timeout': 5})
    with engine.connect() as conn:
        conn.execute(text('SELECT 1'))
    sys.exit(0)
except Exception as e:
    print(e, file=sys.stderr)
    sys.exit(1)
" 2>/dev/null; do
  echo "Database is unavailable - waiting..."
  sleep 3
done

echo "Database is UP"

# Check schema state via Python (avoids hardcoded psql -h db)
SCHEMA_STATE=$(python -c "
import os, sys
url = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL_NON_POOLING') or os.environ.get('POSTGRES_URL', '')
if url.startswith('postgres://'):
    url = url.replace('postgres://', 'postgresql://', 1)
from sqlalchemy import create_engine, text
engine = create_engine(url)
with engine.connect() as conn:
    has_alembic = conn.execute(text(
        \"SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='alembic_version')\"
    )).scalar()
    has_users = conn.execute(text(
        \"SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users')\"
    )).scalar()
if has_alembic:
    print('has_alembic')
elif has_users:
    print('has_users')
else:
    print('fresh')
")

echo "Schema state: $SCHEMA_STATE"

if [ "$SCHEMA_STATE" = "has_alembic" ]; then
  echo "Existing database detected - running pending migrations..."
  alembic upgrade head
  echo "Migrations complete."
elif [ "$SCHEMA_STATE" = "has_users" ]; then
  echo "Pre-hydrated database detected (Prisma initialized). Stamping Alembic to head..."
  alembic stamp head
  echo "Alembic stamped successfully."
else
  echo "Fresh database detected - creating full schema from SQLAlchemy models..."
  python -c "
from app.db.session import engine
from app.db.base_class import Base
import app.models  # noqa: F401
Base.metadata.create_all(bind=engine)
print('Schema created successfully')
"
  echo "Stamping Alembic to current migration head..."
  alembic stamp head
  echo "Schema ready."
fi

echo "Starting FastAPI server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
