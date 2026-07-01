"""
ZR Express delivery carrier integration.
Docs: https://api.zrexpress.app
Auth: X-Api-Key + X-Tenant headers per store credentials.
"""
import httpx
from typing import Optional

ZR_BASE = "https://api.zrexpress.app/api/v1"


class ZRExpressClient:
    def __init__(self, secret_key: str, tenant_id: str):
        self.headers = {
            "X-Api-Key": secret_key,
            "X-Tenant": tenant_id,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _get(self, path: str, params: dict = None) -> dict:
        with httpx.Client(timeout=15) as client:
            r = client.get(f"{ZR_BASE}{path}", headers=self.headers, params=params or {})
            r.raise_for_status()
            return r.json()

    def _post(self, path: str, body: dict) -> dict:
        with httpx.Client(timeout=15) as client:
            r = client.post(f"{ZR_BASE}{path}", headers=self.headers, json=body)
            r.raise_for_status()
            return r.json()

    def _patch(self, path: str, body: dict) -> dict:
        with httpx.Client(timeout=15) as client:
            r = client.patch(f"{ZR_BASE}{path}", headers=self.headers, json=body)
            r.raise_for_status()
            return r.json()

    def _delete(self, path: str) -> dict:
        with httpx.Client(timeout=15) as client:
            r = client.delete(f"{ZR_BASE}{path}", headers=self.headers)
            r.raise_for_status()
            return r.json()

    # ── Parcels ───────────────────────────────────────────────

    def create_parcel(
        self,
        customer_name: str,
        customer_phone: str,
        customer_address: str,
        wilaya: str,
        commune: Optional[str],
        amount: float,
        product_name: str,
        quantity: int = 1,
        delivery_type: str = "home",
        notes: Optional[str] = None,
    ) -> dict:
        """Create a parcel in ZR Express and return the response (contains trackingNumber)."""
        body = {
            "customer": {
                "name": customer_name,
                "phone": customer_phone,
                "address": customer_address,
            },
            "deliveryAddress": {
                "wilaya": wilaya,
                "commune": commune or wilaya,
                "address": customer_address,
            },
            "products": [
                {
                    "name": product_name,
                    "quantity": quantity,
                    "unitPrice": int(amount),
                }
            ],
            "amount": int(amount),
            "deliveryType": delivery_type.upper(),
            "notes": notes or "",
        }
        return self._post("/parcels", body)

    def get_parcel_by_tracking(self, tracking_number: str) -> dict:
        return self._get(f"/parcels/{tracking_number}")

    def get_parcel(self, parcel_id: str) -> dict:
        return self._get(f"/parcels/{parcel_id}")

    def delete_parcel(self, parcel_id: str) -> dict:
        return self._delete(f"/parcels/{parcel_id}")

    def get_state_history(self, parcel_id: str) -> dict:
        return self._get(f"/parcels/{parcel_id}/state-history")

    # ── Rates ─────────────────────────────────────────────────

    def get_all_rates(self) -> dict:
        return self._get("/delivery-pricing/rates")

    def get_rate_for_territory(self, territory_id: str) -> dict:
        return self._get(f"/delivery-pricing/rates/{territory_id}")

    # ── Webhooks ──────────────────────────────────────────────

    def register_webhook(self, endpoint_url: str, description: str = "AzzougShop webhook") -> dict:
        return self._post("/webhooks/endpoints", {
            "url": endpoint_url,
            "description": description,
        })

    def list_webhooks(self) -> dict:
        return self._get("/webhooks/endpoints")

    def delete_webhook(self, endpoint_id: str) -> dict:
        return self._delete(f"/webhooks/endpoints/{endpoint_id}")

    # ── Test connection ───────────────────────────────────────

    def test_connection(self) -> dict:
        """Verify credentials by fetching current supplier profile."""
        try:
            data = self._get("/delivery-pricing/rates")
            return {"ok": True, "message": "Connexion ZR Express réussie", "data": data}
        except httpx.HTTPStatusError as e:
            return {"ok": False, "message": f"Erreur HTTP {e.response.status_code}: {e.response.text[:200]}"}
        except Exception as e:
            return {"ok": False, "message": str(e)}


def client_from_config(api_config: dict) -> ZRExpressClient:
    """Build a ZRExpressClient from the decrypted api_config dict."""
    secret_key = api_config.get("secret_key") or api_config.get("api_key") or ""
    tenant_id = api_config.get("tenant_id") or ""
    if not secret_key or not tenant_id:
        raise ValueError("ZR Express: secret_key et tenant_id requis dans api_config")
    return ZRExpressClient(secret_key=secret_key, tenant_id=tenant_id)


# Map ZR parcel states → our internal order statuses
ZR_STATUS_MAP = {
    "Livré": "DELIVERED",
    "En cours de livraison": "SHIPPED",
    "Retourné": "RETURNED",
    "Annulé": "CANCELLED",
    "En attente": "CONFIRMED",
    "Pris en charge": "PROCESSING",
    "Au dépôt": "PROCESSING",
}
