import logging
import sys
from typing import Any

from app.core.config import settings

def setup_logging() -> None:
    """
    Sets up industrial-grade logging with stdout and stderr handling.
    Suppresses verbose external loggers so the HuggingFace terminal stream
    contains ONLY high-priority Meta, Order, and Action events.
    """
    logging_level = logging.INFO
    
    # Configure root logger
    logging.basicConfig(
        level=logging_level,
        format="%(asctime)s - %(levelname)s - %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )

    # Suppress verbose loggers (HTTP request noise, internal polling, ORM queries)
    for verbose_name in [
        "uvicorn.access", "uvicorn.error", "httpx", "httpcore", 
        "sqlalchemy.engine", "urllib3", "access", "asyncio"
    ]:
        logging.getLogger(verbose_name).setLevel(logging.WARNING)

logger = logging.getLogger(settings.PROJECT_NAME)


def log_order_event(event_type: str, order: Any, note: str = "") -> None:
    """
    High-visibility structured log line specifically formatted for HuggingFace terminal stream.
    Prints full real-time details for EVERY order (Normal Orders 🟢 and Abandoned Carts 🟠).
    """
    if not order:
        return

    is_abandoned = bool(getattr(order, "is_abandoned_cart", False)) or str(getattr(order, "status", "")) == "ABANDONED"
    badge = "🟠 [PANIER ABANDONNÉ]" if is_abandoned else "🟢 [COMMANDE NORMALE]"
    
    seq = getattr(order, "store_sequence_number", "—") or "—"
    num = getattr(order, "order_number", "—") or "—"
    name = getattr(order, "customer_name", "Inconnu") or "Inconnu"
    phone = getattr(order, "customer_phone", "Inconnu") or "Inconnu"
    phone2 = getattr(order, "customer_phone2", None)
    phone_display = f"{phone} / {phone2}" if phone2 else phone

    wilaya = getattr(order, "customer_wilaya", "—") or "—"
    commune = getattr(order, "customer_commune", "—") or "—"
    address = getattr(order, "customer_address", "—") or "—"

    subtotal = getattr(order, "subtotal", 0.0) or 0.0
    discount = getattr(order, "discount", 0.0) or 0.0
    delivery_fee = getattr(order, "delivery_fee", 0.0) or 0.0
    amount = getattr(order, "total", None) if getattr(order, "total", None) is not None else (getattr(order, "total_amount", 0.0) or 0.0)
    status = str(getattr(order, "status", "NEW"))
    recovery_fee = getattr(order, "abandoned_cart_recovery_fee", 0.0) or 0.0

    # Items / Articles summary
    items = getattr(order, "items", []) or []
    items_summary = []
    if items:
        for item in items:
            pname = getattr(item, "product_name", None) or getattr(item, "name", "Produit") or "Produit"
            qty = getattr(item, "quantity", 1) or 1
            price = getattr(item, "unit_price", None) or getattr(item, "price", 0.0) or 0.0
            variant = getattr(item, "variant_details", None)
            vstr = f" ({variant})" if variant else ""
            items_summary.append(f"{qty}x {pname}{vstr} @ {price} DA")
    items_str = " | ".join(items_summary) if items_summary else "Aucun article enregistré"

    # Attribution marketing
    source = getattr(order, "source", "—") or "—"
    campaign = getattr(order, "utm_campaign", "—") or "—"
    content = getattr(order, "utm_content", "—") or "—"
    source_lp = getattr(order, "landing_page_slug", None) or getattr(order, "landing_page_id", "—") or "—"
    fbclid = getattr(order, "fbclid", None)
    meta_tag = "OUI (fbclid)" if fbclid else "NON"

    store_id = getattr(order, "store_id", "—") or "—"
    created_at = getattr(order, "created_at", None)
    time_str = created_at.strftime("%Y-%m-%d %H:%M:%S UTC") if hasattr(created_at, "strftime") else "En temps réel"

    order_logger = logging.getLogger("app.orders")
    
    if is_abandoned:
        order_logger.info(
            "\n========================================================================================\n"
            "🟠 %s | Événement: %s | Ref: N°%s (Seq: %s)\n"
            "   ⏰ Temps réel : %s | Boutique Store_ID: %s\n"
            "   👤 Client     : %s (%s)\n"
            "   📍 Localisat. : Wilaya: %s | Commune: %s | Adresse: %s\n"
            "   🛒 Panier DA  : Total = %s DA (Sous-Total: %s DA | Remise: %s DA | Livr: %s DA)\n"
            "   📦 Articles   : %s\n"
            "   💸 Commission : %s DA | Statut: %s\n"
            "   📣 Marketing  : Source=%s | LP=%s | Campagne=%s | MetaAd?=%s\n"
            "   📝 Note Log   : %s\n"
            "========================================================================================",
            badge, event_type, num, seq,
            time_str, store_id,
            name, phone_display,
            wilaya, commune, address,
            amount, subtotal, discount, delivery_fee,
            items_str,
            recovery_fee, status,
            source, source_lp, campaign, meta_tag,
            note or "Panier abandonné capturé en temps réel"
        )
    else:
        order_logger.info(
            "\n========================================================================================\n"
            "🟢 %s | Événement: %s | Ref: N°%s (Seq #%s)\n"
            "   ⏰ Temps réel : %s | Boutique Store_ID: %s\n"
            "   👤 Client     : %s (%s)\n"
            "   📍 Localisat. : Wilaya: %s | Commune: %s | Adresse: %s\n"
            "   💰 Montant    : Total = %s DA (Sous-Total: %s DA | Remise: %s DA | Livr: %s DA)\n"
            "   📦 Articles   : %s\n"
            "   🚚 Statut Commande: %s\n"
            "   📣 Marketing  : Source=%s | LP=%s | Campagne=%s | MetaAd?=%s\n"
            "   📝 Note Log   : %s\n"
            "========================================================================================",
            badge, event_type, num, seq,
            time_str, store_id,
            name, phone_display,
            wilaya, commune, address,
            amount, subtotal, discount, delivery_fee,
            items_str,
            status,
            source, source_lp, campaign, meta_tag,
            note or "Nouvelle commande reçue en temps réel"
        )

