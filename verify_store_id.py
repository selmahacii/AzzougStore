import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    res = conn.execute(text("SELECT id, name, slug FROM stores WHERE slug ILIKE '%trustshop%' OR name ILIKE '%trustshop%'"))
    stores = res.fetchall()
    print("Verification des boutiques 'TrustShop' :")
    for s in stores:
        print(f" - {s[1]} (Slug: {s[2]}) -> ID: {s[0]}")
    
    if not stores:
        print("Aucune boutique TrustShop trouvée !")
