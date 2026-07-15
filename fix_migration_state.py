"""
Initialize alembic_version table and set to known revision.
Run: python init_alembic.py
"""
import sys
sys.path.insert(0, '.')

from app.db.session import engine
from sqlalchemy import text

with engine.connect() as conn:
    # Create alembic_version table
    conn.execute(text(
        "CREATE TABLE IF NOT EXISTS alembic_version "
        "(version_num VARCHAR(32) NOT NULL, "
        " CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
    ))

    # Check if already has an entry
    result = conn.execute(text("SELECT COUNT(*) FROM alembic_version"))
    count = result.scalar()

    if count == 0:
        conn.execute(text(
            "INSERT INTO alembic_version (version_num) VALUES ('3937f0809508')"
        ))
        print("Created alembic_version and set to 3937f0809508")
    else:
        result2 = conn.execute(text("SELECT version_num FROM alembic_version"))
        val = result2.scalar()
        print(f"alembic_version already has: {val}")
        if val != '3937f0809508':
            conn.execute(text("UPDATE alembic_version SET version_num = '3937f0809508'"))
            print("Updated to 3937f0809508")

    conn.commit()

print("Now run: python -m alembic upgrade head")
