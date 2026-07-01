#!/bin/bash
set -e

echo "--- AzzougShop Backend Booting ---"

# Wait for Postgres to be ready
until PGPASSWORD=$POSTGRES_PASSWORD psql -h "db" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\q' 2>/dev/null; do
  echo "Database is unavailable - waiting..."
  sleep 2
done

echo "Database is UP"

# Check if alembic_version table exists → means DB was previously initialized by Alembic
HAS_ALEMBIC=$(PGPASSWORD=$POSTGRES_PASSWORD psql -h "db" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='alembic_version')" 2>/dev/null)

if [ "$HAS_ALEMBIC" = "f" ]; then
  # Check if database has been pre-hydrated by Prisma (e.g. table 'users' exists)
  HAS_USERS=$(PGPASSWORD=$POSTGRES_PASSWORD psql -h "db" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
    "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users')" 2>/dev/null)

  if [ "$HAS_USERS" = "t" ]; then
    echo "Pre-hydrated database detected (Prisma initialized). Stamping Alembic to head..."
    alembic stamp head
    echo "Alembic stamped successfully."
  else
    echo "Fresh database detected - creating full schema from SQLAlchemy models..."
    python -c "
from app.db.session import engine
from app.db.base_class import Base
# Import all models so metadata is populated
import app.models  # noqa: F401
Base.metadata.create_all(bind=engine)
print('Schema created successfully')
"
    echo "Stamping Alembic to current migration head..."
    alembic stamp head
    echo "Schema ready."
  fi
else
  echo "Existing database detected - running pending migrations..."
  alembic upgrade head
  echo "Migrations complete."
fi

echo "Starting FastAPI server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
