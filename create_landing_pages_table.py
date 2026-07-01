"""Run once to create the landing_pages table."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.db.session import engine
from app.models.landing_page import LandingPage
from app.db.base_class import Base

Base.metadata.create_all(bind=engine, tables=[LandingPage.__table__])
print("✅ landing_pages table created")
