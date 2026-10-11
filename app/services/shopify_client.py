import logging
import re
from typing import Optional, Dict, Any, List
import httpx

from app.models.shopify import ShopifyConnection

logger = logging.getLogger("app.shopify.client")


# ─── Specialized Exceptions ──────────────────────────────────────────────────

class ShopifyClientError(Exception):
    """Base exception for Shopify API operations."""
    pass


class ShopifyAuthError(ShopifyClientError):
    """Authentication or authorization failure (HTTP 401/403)."""
    pass


class ShopifyRateLimitError(ShopifyClientError):
    """Rate limit exceeded (HTTP 429)."""
    pass


class ShopifyTransientError(ShopifyClientError):
    """Temporary network or Shopify server error (HTTP 5xx, timeouts)."""
    pass


class ShopifyGraphQLError(ShopifyClientError):
    """GraphQL execution level error in 'errors' field."""
    pass


class ShopifyUserError(ShopifyClientError):
    """Business level error in 'userErrors' field."""
    def __init__(self, message: str, errors: Optional[List[Dict[str, Any]]] = None):
        super().__init__(message)
        self.errors = errors or []


class ShopifyCompareQuantityMismatchError(ShopifyUserError):
    """compareQuantity does not match current Shopify stock."""
    pass


# ─── Helpers ─────────────────────────────────────────────────────────────────

def ensure_gid(val: str, type_name: str) -> str:
    """Ensure value is a valid Shopify GraphQL Global ID (GID)."""
    s = str(val).strip()
    if s.startswith("gid://shopify/"):
        return s
    return f"gid://shopify/{type_name}/{s}"


def extract_numeric_id(val: str) -> str:
    """Extract raw numeric ID from a Shopify GID or numeric string."""
    s = str(val).strip()
    if "/" in s:
        return s.rsplit("/", 1)[-1]
    return s


# ─── Shopify GraphQL Client ──────────────────────────────────────────────────

class ShopifyGraphQLClient:
    """
    Shopify GraphQL Admin API Client.
    Safely executes queries, handles rate limits, masks access tokens in logs,
    and inspects userErrors even on HTTP 200 responses.
    """

    def __init__(
        self,
        shop_domain: str,
        access_token: str,
        api_version: str = "2026-10",
        timeout: float = 15.0,
    ):
        self.shop_domain = shop_domain.strip().lower()
        self._access_token = access_token.strip() if access_token else ""
        self.api_version = api_version.strip() or "2026-10"
        self.timeout = timeout
        self.endpoint = f"https://{self.shop_domain}/admin/api/{self.api_version}/graphql.json"
        self.last_api_version: Optional[str] = None

    @classmethod
    def from_connection(cls, conn: ShopifyConnection, timeout: float = 15.0) -> "ShopifyGraphQLClient":
        token = conn.get_access_token()
        if not token:
            raise ShopifyAuthError(f"Aucun jeton d'accès configuré pour '{conn.shop_domain}'.")
        return cls(
            shop_domain=conn.shop_domain,
            access_token=token,
            api_version=conn.api_version or "2026-10",
            timeout=timeout,
        )

    def _get_headers(self) -> Dict[str, str]:
        return {
            "X-Shopify-Access-Token": self._access_token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def execute_graphql(self, query: str, variables: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Executes a raw GraphQL operation against Shopify Admin API.
        Masks access tokens in logs.
        """
        payload = {"query": query, "variables": variables or {}}

        # Never log raw access token
        masked_headers = {"X-Shopify-Access-Token": "********", "Content-Type": "application/json"}
        logger.debug(
            "[ShopifyGraphQL] Exécution requête sur %s (headers: %s)",
            self.endpoint,
            masked_headers,
        )

        try:
            with httpx.Client(timeout=self.timeout) as http:
                response = http.post(
                    self.endpoint,
                    json=payload,
                    headers=self._get_headers(),
                )
        except httpx.TimeoutException as exc:
            raise ShopifyTransientError(f"Délai d'attente dépassé lors de l'appel à Shopify: {exc}")
        except httpx.RequestError as exc:
            raise ShopifyTransientError(f"Erreur réseau lors de l'appel à Shopify: {exc}")

        # HTTP error handling
        if response.status_code in (401, 403):
            raise ShopifyAuthError(
                f"Échec d'authentification Shopify ({response.status_code}): "
                "Jeton d'accès invalide ou permissions insuffisantes (write_inventory requise)."
            )
        elif response.status_code == 429:
            raise ShopifyRateLimitError("Limite de requêtes Shopify (rate limit 429) atteinte.")
        elif response.status_code >= 500:
            raise ShopifyTransientError(
                f"Erreur serveur Shopify ({response.status_code}): tentative ultérieure requise."
            )
        elif response.status_code != 200:
            raise ShopifyClientError(
                f"Réponse inattendue de Shopify ({response.status_code}): {response.text[:200]}"
            )

        try:
            data = response.json()
        except Exception as json_err:
            raise ShopifyClientError(f"Réponse JSON invalide de Shopify: {json_err}")

        # Track response header X-Shopify-API-Version to detect automatic fallbacks
        actual_api_ver = response.headers.get("X-Shopify-API-Version")
        self.last_api_version = actual_api_ver
        if actual_api_ver and actual_api_ver != self.api_version:
            logger.warning(
                "[ShopifyGraphQL] Discordance de version API: demandée=%s, reçue=%s (Shopify a basculé automatiquement)",
                self.api_version,
                actual_api_ver,
            )

        # Top-level GraphQL errors
        if "errors" in data and data["errors"]:
            error_msgs = [e.get("message", "Unknown error") for e in data["errors"]]
            combined = "; ".join(error_msgs)
            logger.error("[ShopifyGraphQL] Erreur GraphQL retournée: %s", combined)
            if any("throttled" in m.lower() for m in error_msgs):
                raise ShopifyRateLimitError(f"Throttled par Shopify: {combined}")
            raise ShopifyGraphQLError(f"Erreur GraphQL Shopify: {combined}")

        return data.get("data") or {}

    def set_inventory_quantities(
        self,
        inventory_item_id: str,
        location_id: str,
        quantity: int,
        compare_quantity: Optional[int] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Executes the official Shopify inventorySetQuantities GraphQL mutation.
        For version 2026-10 (and >= 2026-04), uses the mandatory @idempotent directive
        with $idempotencyKey variable.
        Validates target quantity is non-negative.
        Treats userErrors as failures even if HTTP 200.
        """
        if quantity < 0:
            raise ValueError(f"Quantité de stock cible invalide: {quantity} (doit être >= 0).")

        item_gid = ensure_gid(inventory_item_id, "InventoryItem")
        loc_gid = ensure_gid(location_id, "Location")

        use_idempotent_directive = (self.api_version >= "2026-04" or idempotency_key is not None)

        if use_idempotent_directive:
            mutation = """
            mutation inventorySetQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) @idempotent(key: $idempotencyKey) {
              inventorySetQuantities(input: $input) {
                inventoryAdjustmentGroup {
                  id
                  reason
                  changes {
                    name
                    delta
                    quantityAfterChange
                  }
                }
                userErrors {
                  code
                  field
                  message
                }
              }
            }
            """
        else:
            mutation = """
            mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
              inventorySetQuantities(input: $input) {
                inventoryAdjustmentGroup {
                  id
                  reason
                  changes {
                    name
                    delta
                    quantityAfterChange
                  }
                }
                userErrors {
                  code
                  field
                  message
                }
              }
            }
            """

        qty_input: Dict[str, Any] = {
            "inventoryItemId": item_gid,
            "locationId": loc_gid,
            "quantity": quantity,
        }
        if compare_quantity is not None:
            qty_input["compareQuantity"] = compare_quantity

        variables: Dict[str, Any] = {
            "input": {
                "name": "available",
                "reason": "cycle_count_available",
                "ignoreCompareQuantity": compare_quantity is None,
                "quantities": [qty_input],
            }
        }
        if use_idempotent_directive:
            variables["idempotencyKey"] = idempotency_key or str(uuid.uuid4())

        data = self.execute_graphql(mutation, variables)
        result = data.get("inventorySetQuantities") or {}
        user_errors = result.get("userErrors") or []

        if user_errors:
            error_details = []
            is_compare_mismatch = False
            for ue in user_errors:
                code = ue.get("code", "")
                msg = ue.get("message", "")
                field = ".".join(str(f) for f in (ue.get("field") or []))
                error_details.append(f"[{code}] {msg} (champ: {field})")
                if code == "COMPARE_QUANTITY_MISMATCH" or "compare quantity" in msg.lower():
                    is_compare_mismatch = True

            combined = "; ".join(error_details)
            logger.warning("[ShopifyGraphQL] userErrors lors de inventorySetQuantities: %s", combined)

            if is_compare_mismatch:
                raise ShopifyCompareQuantityMismatchError(
                    f"Conflit de version de stock: compareQuantity ({compare_quantity}) "
                    f"ne correspond pas à l'inventaire actuel Shopify: {combined}",
                    errors=user_errors,
                )
            raise ShopifyUserError(f"Échec de mise à jour de stock Shopify: {combined}", errors=user_errors)

        return result

    def get_inventory_level(
        self,
        inventory_item_id: str,
        location_id: str,
    ) -> Optional[int]:
        """
        Reads the current 'available' inventory level for an inventoryItem at a location.
        """
        item_gid = ensure_gid(inventory_item_id, "InventoryItem")
        loc_gid = ensure_gid(location_id, "Location")

        query = """
        query getInventoryItem($id: ID!) {
          inventoryItem(id: $id) {
            id
            inventoryLevels(first: 20) {
              nodes {
                location {
                  id
                }
                quantities(names: ["available"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
        """

        data = self.execute_graphql(query, {"id": item_gid})
        inv_item = data.get("inventoryItem")
        if not inv_item:
            return None

        levels = inv_item.get("inventoryLevels", {}).get("nodes", [])
        for level in levels:
            cur_loc_id = level.get("location", {}).get("id")
            if cur_loc_id == loc_gid or extract_numeric_id(cur_loc_id) == extract_numeric_id(loc_gid):
                for q in level.get("quantities", []):
                    if q.get("name") == "available":
                        return int(q.get("quantity") or 0)

        return None
