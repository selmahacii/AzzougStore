import logging
import uuid
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Optional, Dict, Any, List, Tuple

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func

from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.customer import Customer
from app.models.store import Store
from app.models.events import OrderEvent
from app.models.shopify import ShopifyMapping
from app.services.inventory_service import inventory_service

logger = logging.getLogger("app.shopify.order_service")


# ─── Specialized Exceptions ──────────────────────────────────────────────────

class ShopifyOrderError(Exception):
    """Base exception for Shopify order operations."""
    pass


class ShopifyOrderValidationError(ShopifyOrderError):
    """Payload fails schema, structural, or business validation."""
    pass


class ShopifyUnmappedVariantError(ShopifyOrderError):
    """A Shopify variant in line_items has no cross-reference mapping."""
    pass


class ShopifyProductNotFoundError(ShopifyOrderError):
    """Mapped internal product does not exist in the store catalog."""
    pass


class ShopifyUnsupportedCurrencyError(ShopifyOrderError):
    """Order currency does not match store currency configuration."""
    pass


class ShopifyMonetaryValidationError(ShopifyOrderError):
    """Monetary amounts have unsupported fractional denominations or formats."""
    pass


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _parse_shopify_amount(value: Any, field_name: str, currency: str = "DZD") -> int:
    """
    Parses and validates monetary amounts from Shopify strings/numbers.
    For DZD (and integer-denominated ERP currencies), checks that fractional
    cents are not being silently truncated, preventing accounting corruption.
    """
    if value is None or value == "":
        return 0

    try:
        dec = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise ShopifyMonetaryValidationError(
            f"Montant invalide pour '{field_name}': '{value}' n'est pas un nombre valide."
        )

    if dec < 0:
        raise ShopifyMonetaryValidationError(
            f"Montant invalide pour '{field_name}': '{value}' ne peut pas être négatif."
        )

    # In DZD, verify that no non-zero fractional cents exist
    if currency.upper() == "DZD":
        # e.g., 3500.00 is fine, 3500.75 would be an implicit loss/gain
        if dec % Decimal("1") != Decimal("0"):
            raise ShopifyMonetaryValidationError(
                f"Montant invalide pour '{field_name}' ({value} {currency}): "
                "Les centimes fractionnaires ne sont pas supportés en DZD. "
                "Aucun arrondi implicite n'est appliqué."
            )

    return int(dec)


def _upsert_shopify_customer(
    db: Session,
    store_id: str,
    name: str,
    phone: str,
    email: Optional[str],
    wilaya: Optional[str],
    address: Optional[str],
) -> Optional[Customer]:
    """
    Finds or creates a Customer record for the order.
    Does NOT throw on customer creation errors; falls back gracefully.
    """
    clean_phone = phone.strip() if phone else ""
    if not clean_phone and not email:
        return None

    try:
        customer = None
        if clean_phone:
            customer = (
                db.query(Customer)
                .filter(Customer.store_id == store_id, Customer.phone == clean_phone)
                .first()
            )
        if not customer and email:
            customer = (
                db.query(Customer)
                .filter(Customer.store_id == store_id, Customer.email == email.strip().lower())
                .first()
            )

        if customer:
            if name and not customer.name:
                customer.name = name
            if email and not customer.email:
                customer.email = email.strip().lower()
            if wilaya and not customer.wilaya:
                customer.wilaya = wilaya
            if address and not customer.address:
                customer.address = address
            customer.total_orders = (customer.total_orders or 0) + 1
            customer.last_order_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.add(customer)
            return customer
        else:
            new_cust = Customer(
                id=str(uuid.uuid4()),
                store_id=store_id,
                phone=clean_phone or "0000000000",
                name=name or "Client Shopify",
                email=email.strip().lower() if email else None,
                wilaya=wilaya,
                address=address,
                source="SHOPIFY",
                total_orders=1,
                last_order_at=datetime.now(timezone.utc).replace(tzinfo=None),
            )
            db.add(new_cust)
            return new_cust
    except Exception as exc:
        logger.warning(f"[ShopifyOrder] Erreur upsert client: {exc}")
        return None


# ─── Core Ingestion Service ──────────────────────────────────────────────────

class ShopifyOrderService:
    """
    Dedicated transactional order ingestion service for Shopify orders.
    Enforces idempotency, currency matching, variant resolution, stock reservation,
    and preserves AzzougShop operational rules.
    """

    @staticmethod
    def import_shopify_order(
        db: Session,
        store_id: str,
        payload: Dict[str, Any],
        delivery_id: Optional[str] = None,
    ) -> Order:
        """
        Atomically imports a Shopify order into AzzougShop ERP.
        Guarantees:
          1. Idempotency on shopify_order_id (returns existing order if already imported).
          2. Zero auto-merge on phone with COD or other orders.
          3. Exact currency matching (no implicit conversion).
          4. Resolution of line items via shopify_mappings.
          5. Transactional stock reservation (SELECT FOR UPDATE).
        """
        # 1. Validate payload structure
        if not isinstance(payload, dict):
            raise ShopifyOrderValidationError("Payload de commande invalide (doit être un dictionnaire).")

        raw_shopify_id = payload.get("id")
        if not raw_shopify_id:
            raise ShopifyOrderValidationError("Payload de commande invalide: champ 'id' Shopify manquant.")

        shopify_order_id = str(raw_shopify_id).strip()
        shopify_order_number = str(payload.get("order_number") or payload.get("name") or "").strip()
        financial_status = str(payload.get("financial_status") or "pending").lower().strip()
        fulfillment_status = str(payload.get("fulfillment_status") or "unfulfilled").lower().strip()

        # 2. Check Store & Currency
        store = db.query(Store).filter(Store.id == store_id).first()
        if not store:
            raise ShopifyOrderValidationError(f"Boutique '{store_id}' introuvable.")

        order_currency = str(payload.get("currency") or "").strip().upper()
        store_currency = str(getattr(store, "currency", "DZD") or "DZD").strip().upper()

        if not order_currency:
            raise ShopifyOrderValidationError("Devise manquante dans la commande Shopify.")

        if order_currency != store_currency:
            raise ShopifyUnsupportedCurrencyError(
                f"Devise non supportée: la commande Shopify est en '{order_currency}', "
                f"mais la boutique '{store.name}' utilise '{store_currency}'. "
                "Aucun taux de change implicite ni conversion hasardeuse n'est appliqué."
            )

        # 3. Idempotency Check — Check if order is already imported
        # A: Direct check on orders.shopify_order_id
        existing_order = (
            db.query(Order)
            .filter(
                Order.store_id == store_id,
                Order.shopify_order_id == shopify_order_id,
            )
            .first()
        )
        if existing_order:
            logger.info(
                f"[ShopifyOrder] Commande Shopify {shopify_order_id} déjà importée "
                f"(ID interne: {existing_order.id}, Numéro: {existing_order.order_number}). Idempotence garantie."
            )
            return existing_order

        # B: Check on shopify_mappings
        existing_mapping = (
            db.query(ShopifyMapping)
            .filter(
                ShopifyMapping.store_id == store_id,
                ShopifyMapping.entity_type == "ORDER",
                ShopifyMapping.shopify_id == shopify_order_id,
            )
            .first()
        )
        if existing_mapping:
            ord_from_map = db.query(Order).filter(Order.id == existing_mapping.internal_id).first()
            if ord_from_map:
                logger.info(
                    f"[ShopifyOrder] Commande Shopify {shopify_order_id} trouvée via mapping "
                    f"({ord_from_map.order_number}). Idempotence garantie."
                )
                return ord_from_map

        # 4. Parse Monetary Amounts
        total = _parse_shopify_amount(payload.get("total_price"), "total_price", store_currency)
        subtotal = _parse_shopify_amount(payload.get("subtotal_price"), "subtotal_price", store_currency)
        discount = _parse_shopify_amount(payload.get("total_discounts") or 0, "total_discounts", store_currency)

        # Shipping fee from shipping_lines
        shipping_fee = sum(
            _parse_shopify_amount(s.get("price") or 0, "shipping_price", store_currency)
            for s in payload.get("shipping_lines", [])
        )

        # 5. Resolve Line Items via ShopifyMapping
        raw_items = payload.get("line_items") or []
        if not raw_items:
            raise ShopifyOrderValidationError("La commande Shopify ne contient aucun article (line_items vide).")

        resolved_items = []
        for idx, item in enumerate(raw_items):
            item_qty = int(item.get("quantity") or 0)
            if item_qty <= 0:
                raise ShopifyOrderValidationError(
                    f"Quantité invalide ({item_qty}) pour l'article '{item.get('title')}'."
                )

            item_price = _parse_shopify_amount(item.get("price"), f"item[{idx}].price", store_currency)
            raw_var_id = item.get("variant_id")
            raw_prod_id = item.get("product_id")

            mapping = None
            # 1. Try resolving by VARIANT mapping
            if raw_var_id:
                shopify_var_id_str = str(raw_var_id).strip()
                mapping = (
                    db.query(ShopifyMapping)
                    .filter(
                        ShopifyMapping.store_id == store_id,
                        ShopifyMapping.entity_type == "VARIANT",
                        ShopifyMapping.shopify_id == shopify_var_id_str,
                    )
                    .first()
                )

            # 2. Try resolving by PRODUCT mapping if variant mapping not found
            if not mapping and raw_prod_id:
                shopify_prod_id_str = str(raw_prod_id).strip()
                mapping = (
                    db.query(ShopifyMapping)
                    .filter(
                        ShopifyMapping.store_id == store_id,
                        ShopifyMapping.entity_type == "PRODUCT",
                        ShopifyMapping.shopify_id == shopify_prod_id_str,
                    )
                    .first()
                )

            # 3. If NO mapping found, raise actionable error
            if not mapping:
                var_desc = f"variant_id='{raw_var_id}'" if raw_var_id else f"product_id='{raw_prod_id}'"
                title_desc = f"'{item.get('title')}' ({item.get('variant_title') or 'Sans variante'})"
                raise ShopifyUnmappedVariantError(
                    f"Article Shopify non mappé: {var_desc}, titre={title_desc}. "
                    "Veuillez créer la correspondance dans les mappings Shopify de l'ERP pour permettre l'importation."
                )

            # Extract internal product ID and variant details from mapping
            internal_product_id = (
                mapping.extra_data.get("product_id")
                or (mapping.internal_id.split(":")[0] if ":" in mapping.internal_id else mapping.internal_id)
            )

            # Variant details
            variant_sku = mapping.extra_data.get("sku")
            variant_details = mapping.extra_data.get("variant_details")
            if not variant_details and variant_sku:
                variant_details = {"sku": variant_sku, "variant": item.get("variant_title") or ""}
            elif not variant_details and item.get("variant_title"):
                variant_details = {"variant": item.get("variant_title")}

            # Verify product exists in database for this store
            product = (
                db.query(Product)
                .filter(Product.id == internal_product_id, Product.store_id == store_id)
                .first()
            )
            if not product:
                raise ShopifyProductNotFoundError(
                    f"Le produit interne '{internal_product_id}' mappé pour l'article Shopify '{item.get('title')}' "
                    f"n'existe pas dans la boutique '{store.name}'."
                )

            resolved_items.append({
                "product": product,
                "quantity": item_qty,
                "unit_price": item_price,
                "variant_details": variant_details,
                "product_name": item.get("title") or product.name,
                "image_url": item.get("image", {}).get("src") if isinstance(item.get("image"), dict) else None,
            })

        # 6. Customer & Address Details
        customer_info = payload.get("customer") or {}
        shipping_addr = payload.get("shipping_address") or payload.get("billing_address") or {}

        first_name = (shipping_addr.get("first_name") or customer_info.get("first_name") or "").strip()
        last_name = (shipping_addr.get("last_name") or customer_info.get("last_name") or "").strip()
        customer_name = f"{first_name} {last_name}".strip() or customer_info.get("name") or "Client Shopify"

        phone = (
            shipping_addr.get("phone")
            or customer_info.get("phone")
            or payload.get("phone")
            or ""
        ).strip()

        email = (customer_info.get("email") or payload.get("email") or "").strip() or None

        addr1 = (shipping_addr.get("address1") or "").strip()
        addr2 = (shipping_addr.get("address2") or "").strip()
        address = f"{addr1} {addr2}".strip() or "Adresse non spécifiée"

        wilaya = (shipping_addr.get("province") or shipping_addr.get("city") or "Inconnue").strip()
        commune = (shipping_addr.get("city") or "").strip() or None

        # Upsert local customer record
        customer = _upsert_shopify_customer(
            db, store_id=store_id, name=customer_name, phone=phone,
            email=email, wilaya=wilaya, address=address,
        )

        # 7. Generate Sequence Number with Store Lock
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        order_number = f"ORD-{now.strftime('%Y%m%d')}-SHP{uuid.uuid4().hex[:6].upper()}"

        # Serialize sequence number per store
        db.query(Store.id).filter(Store.id == store_id).with_for_update().first()
        max_seq = db.query(func.max(Order.store_sequence_number)).filter(
            Order.store_id == store_id,
            Order.is_deleted == False,
            Order.status != "MERGED",
        ).scalar()
        store_sequence_number = (max_seq or 0) + 1

        # 8. Operational Status Mapping
        # COD (pending) orders enter standard operational verification: NEW
        # Paid orders are marked with shopify_financial_status="paid" and enter NEW
        operational_status = "NEW"

        # 9. Create Order Instance
        order = Order(
            id=str(uuid.uuid4()),
            store_id=store_id,
            order_number=order_number,
            store_sequence_number=store_sequence_number,
            customer_name=customer_name,
            customer_phone=phone or "0000000000",
            customer_email=email,
            customer_address=address,
            customer_wilaya=wilaya,
            customer_commune=commune,
            customer_id=customer.id if customer else None,
            delivery_type="HOME",
            delivery_fee=shipping_fee,
            subtotal=subtotal,
            discount=discount,
            total=total,
            status=operational_status,
            source="shopify",
            shopify_order_id=shopify_order_id,
            shopify_order_number=shopify_order_number,
            shopify_financial_status=financial_status,
            shopify_fulfillment_status=fulfillment_status,
            is_abandoned_cart=False,
            is_duplicate=False,
            parent_order_id=None,
        )
        try:
            db.add(order)
            db.flush()
        except IntegrityError as integ_err:
            db.rollback()
            logger.info(
                f"[ShopifyOrder] Course concurrente d'insertion interceptée lors du flush pour {shopify_order_id}: {integ_err}"
            )
            existing = (
                db.query(Order)
                .filter(Order.store_id == store_id, Order.shopify_order_id == shopify_order_id)
                .first()
            )
            if existing:
                return existing
            raise

        # 10. Reserve Stock and Create OrderItems
        for ri in resolved_items:
            prod = ri["product"]
            qty = ri["quantity"]
            var_det = ri["variant_details"]

            try:
                inventory_service.reserve_stock(
                    db,
                    product_id=prod.id,
                    quantity=qty,
                    order_id=order.id,
                    variant_details=var_det,
                    allow_out_of_stock=True,
                )
            except Exception as stock_err:
                logger.warning(
                    f"[ShopifyOrder] Avertissement réservation stock produit {prod.id} (commande {order.id}): {stock_err}"
                )

            order_item = OrderItem(
                id=str(uuid.uuid4()),
                order_id=order.id,
                product_id=prod.id,
                product_name=ri["product_name"],
                quantity=qty,
                unit_price=ri["unit_price"],
                variant_details=var_det,
                image_url=ri["image_url"],
            )
            db.add(order_item)

        # 11. Create Cross-Reference Mapping for Order
        order_mapping = ShopifyMapping(
            id=str(uuid.uuid4()),
            store_id=store_id,
            entity_type="ORDER",
            internal_id=order.id,
            shopify_id=shopify_order_id,
            shopify_secondary_id=shopify_order_number,
            extra_data={
                "order_number": order.order_number,
                "shopify_number": shopify_order_number,
                "financial_status": financial_status,
                "imported_at": now.isoformat(),
            },
        )
        db.add(order_mapping)

        # 12. Create Traceability OrderEvent
        event_note = (
            f"Commande Shopify #{shopify_order_number} (ID: {shopify_order_id}) importée avec succès. "
            f"Statut financier: {financial_status}, Articles: {len(resolved_items)}."
        )
        order_event = OrderEvent(
            id=str(uuid.uuid4()),
            order_id=order.id,
            from_status=None,
            to_status=operational_status,
            note=event_note,
        )
        db.add(order_event)

        # 13. Commit Transaction
        try:
            db.commit()
            db.refresh(order)
            logger.info(
                f"[ShopifyOrder] Commande Shopify {shopify_order_id} ({shopify_order_number}) "
                f"importée avec succès en tant que {order.order_number} (Total: {order.total} {store_currency})."
            )
            return order

        except IntegrityError as integ_err:
            # Concurrent parallel delivery race condition
            db.rollback()
            logger.warning(
                f"[ShopifyOrder] Course concurrente d'insertion interceptée pour Shopify ID {shopify_order_id}: {integ_err}"
            )
            existing = (
                db.query(Order)
                .filter(Order.store_id == store_id, Order.shopify_order_id == shopify_order_id)
                .first()
            )
            if existing:
                return existing
            raise
