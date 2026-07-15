import asyncio
import httpx
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.delivery_partner import DeliveryPartner
from app.api.carriers.noest import _creds, _headers, PROD_BASE

async def fetch_communes():
    db = SessionLocal()
    partner = db.query(DeliveryPartner).filter(DeliveryPartner.carrier_id == 'noest', DeliveryPartner.is_active == True).first()
    if not partner:
        print("No active Noest partner found.")
        return
    token, guid, base = _creds(partner)
    
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{base}/api/public/communes/16", headers=_headers(token))
        print("Status:", r.status_code)
        if r.status_code == 200:
            data = r.json()
            for c in data:
                print(f"ID: {c.get('id')} - Name: {c.get('name')} - Code: {c.get('code')}")
        else:
            print(r.text)

if __name__ == "__main__":
    asyncio.run(fetch_communes())
