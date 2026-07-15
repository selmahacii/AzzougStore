import sys
import os
sys.path.append("/app")
from app.db.session import SessionLocal
from app.models.store import DeliveryPartner
from app.api.carriers.noest import _creds, _headers, PROD_BASE
import httpx
import uuid

db = SessionLocal()
partner = db.query(DeliveryPartner).filter(DeliveryPartner.store_id == "2f47870d-b0ef-48b3-a16e-4286cb9588e2", DeliveryPartner.carrier_id == "NOEST").first()

token, guid, base = _creds(partner)

body = {
    "user_guid":  guid,
    "reference":  str(uuid.uuid4())[:8],
    "client":     "TEST USER",
    "phone":      "0555555555",
    "adresse":    "Alger",
    "wilaya_id":  17,  # Djelfa
    "commune":    "Djelfa",
    "montant":    1000,
    "produit":    "TEST",
    "type_id":    1,
    "stop_desk":  0,
    "poids":      0,
    "can_open":   0,
}

r = httpx.post(f"{base}/api/public/create/order", headers=_headers(token), json=body)
print(r.status_code)
print(r.json())
