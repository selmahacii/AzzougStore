import sys
sys.path.append('.')
from app.db.session import SessionLocal
from app.models.marketing import MetaAdsDailyInsight, MetaAdsCampaign

db = SessionLocal()

print("Checking MetaAdsCampaigns...")
campaigns = db.query(MetaAdsCampaign).limit(5).all()
for c in campaigns:
    print(f"Camp: {c.campaign_name} - Product: {c.product_id} - Reach: {c.reach}")

print("\nChecking MetaAdsDailyInsights...")
insights = db.query(MetaAdsDailyInsight).limit(5).all()
for r in insights:
    print(f"Date: {r.date} (Type: {type(r.date)}) - Reach: {r.reach}")
