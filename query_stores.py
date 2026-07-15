import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    res = conn.execute(text("SELECT id, name, slug FROM stores"))
    stores = res.fetchall()
    print("Found stores:")
    for s in stores:
        print(f"ID: {s[0]}, Name: {s[1]}, Slug: {s[2]}")
