import asyncio
import httpx
from sqlalchemy.orm import Session
import os
import sys

# Add backend directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../../Downloads/azzougshop/backend")))

from app.db.session import SessionLocal
from app.models.delivery_partner import DeliveryPartner
from app.core.encryption import decrypt_dict

async def main():
    db = SessionLocal()
    try:
        partner = db.query(DeliveryPartner).filter(
            DeliveryPartner.carrier_id == "noest",
            DeliveryPartner.is_active == True
        ).first()
        
        if not partner:
            print("Noest partner not found.")
            return

        cfg = decrypt_dict(partner.api_config_encrypted or "")
        token = cfg.get("api_token") or cfg.get("token") or ""
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            endpoints = [
                "/api/public/get/wilayas",
                "/api/public/get/communes?wilaya_id=16",
                "/api/public/get/stations",
                "/api/public/get/stations?wilaya_id=16",
                "/api/public/get/bureaux",
                "/api/public/get/stopdesks",
                "/api/public/get/centers",
            ]
            
            for endpoint in endpoints:
                print(f"\n--- Testing {endpoint} ---")
                try:
                    r = await client.get(f"https://app.noest-dz.com{endpoint}", headers=headers)
                    print(f"Status: {r.status_code}")
                    if r.status_code == 200:
                        data = r.json()
                        if isinstance(data, list):
                            print(f"List of {len(data)} items. First 3:")
                            print(data[:3])
                        elif isinstance(data, dict):
                            print(f"Dict with keys: {list(data.keys())}")
                            if "data" in data and isinstance(data["data"], list):
                                print(f"Data list of {len(data['data'])} items. First 3:")
                                print(data["data"][:3])
                            else:
                                print(str(data)[:200])
                    else:
                        print(f"Error: {r.text[:200]}")
                except Exception as e:
                    print(f"Exception: {e}")

    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(main())
