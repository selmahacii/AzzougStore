#!/bin/bash
set -e

echo "===== Application Startup at $(date -u '+%Y-%m-%d %H:%M:%S') ====="
echo "--- AzzougShop Backend Booting (deploy-diag marker: forced rebuild to inspect stuck-building issue) ---"

# Wait for Postgres to be ready using Python + SQLAlchemy (works with any DATABASE_URL incl. Neon/Supabase)
until python -c "
import os, sys
url = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL') or os.environ.get('POSTGRES_URL_NON_POOLING')
if not url:
    print('No DATABASE_URL set', file=sys.stderr)
    sys.exit(1)
if url.startswith('postgres://'):
    url = url.replace('postgres://', 'postgresql://', 1)
# Supabase/Prisma-style URLs carry ?pgbouncer=true — libpq/psycopg2 doesn't
# recognize it and rejects the whole DSN, which looked like the DB being
# permanently unreachable (infinite 'Database is unavailable' retry loop).
if 'pgbouncer=' in url:
    from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
    parts = urlsplit(url)
    q = [(k, v) for k, v in parse_qsl(parts.query) if k.lower() != 'pgbouncer']
    url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q), parts.fragment))
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
url = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL') or os.environ.get('POSTGRES_URL_NON_POOLING', '')
if url.startswith('postgres://'):
    url = url.replace('postgres://', 'postgresql://', 1)
if 'pgbouncer=' in url:
    from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
    parts = urlsplit(url)
    q = [(k, v) for k, v in parse_qsl(parts.query) if k.lower() != 'pgbouncer']
    url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q), parts.fragment))
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
  # Real incident (2026-07-16): a migration hit
  # psycopg2.errors.LockNotAvailable ("canceling statement due to lock
  # timeout") on a plain schema-reflection SELECT against pg_catalog —
  # transient contention on Supabase's pooler, nothing wrong with the
  # migration itself. The OLD fallback here treated ANY failure
  # (including this one) as "must be a stale/unknown revision" and
  # unconditionally ran `alembic stamp head --purge` — which does not
  # apply the migration, it only marks the tracker as if it had. That
  # call happened to be harmless this one time only because the schema
  # had ALSO been migrated manually out-of-band beforehand — on a normal
  # deploy without that lucky coincidence, this would have marked a
  # container's database as "fully migrated" while it was actually
  # missing every column/index the new code depends on, with no error
  # surfaced anywhere.
  #
  # Fix: retry the upgrade a few times first (covers exactly this
  # transient-lock case). Only if it still fails after retries do we fall
  # back to stamping — and even then we verify the RESULTING schema
  # actually matches what alembic now believes, instead of trusting the
  # stamp blindly. If that verification fails too, exit non-zero: for
  # additive-only migrations, a container that refuses to boot is safer
  # than one silently serving traffic against a schema newer code assumes
  # exists but doesn't.
  UPGRADE_OK=0
  for attempt in 1 2 3; do
    if alembic upgrade head 2>&1; then
      UPGRADE_OK=1
      echo "Migrations complete (attempt $attempt)."
      break
    fi
    echo "Migration attempt $attempt failed (often a transient lock timeout on the pooler) - retrying in 5s..."
    sleep 5
  done

  if [ "$UPGRADE_OK" -ne 1 ]; then
    echo "Migration still failing after 3 attempts - checking whether alembic_version is simply stale/unknown..."
    CURRENT_REV=$(alembic current 2>/dev/null | tail -1 | awk '{print $1}')
    HEAD_REV=$(alembic heads 2>/dev/null | tail -1 | awk '{print $1}')
    if [ "$CURRENT_REV" = "$HEAD_REV" ]; then
      echo "alembic_version already reports head ($HEAD_REV) - the failing attempts were transient, nothing to stamp."
    else
      echo "FATAL: migrations did not apply and alembic_version ($CURRENT_REV) is not at head ($HEAD_REV)."
      echo "Refusing to blindly stamp — that would mark the schema as migrated without it actually being so."
      exit 1
    fi
  fi
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
