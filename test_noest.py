import sys
import os
sys.path.append("/app")
from app.db.session import SessionLocal
from app.models.delivery import DeliveryPartner
from app.api.carriers.noest import _creds, _headers, PROD_BASE
import httpx

db = SessionLocal()
partner = db.query(DeliveryPartner).filter(DeliveryPartner.store_id == "2f47870d-b0ef-48b3-a16e-4286cb9588e2", DeliveryPartner.carrier_id == "NOEST").first()
if not partner:
    print("Partner not found")
    sys.exit(1)

token, guid, base = _creds(partner)
r = httpx.get(f"{PROD_BASE}/api/public/get/wilayas", headers=_headers(token))
print(r.json())
