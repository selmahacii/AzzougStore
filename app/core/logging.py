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
    Prints full order details for EVERY order (Normal Orders and Abandoned Cart Drafts).
    """
    if not order:
        return

    is_abandoned = bool(getattr(order, "is_abandoned_cart", False)) or str(getattr(order, "status", "")) == "ABANDONED"
    badge = "🟧 PANIER ABANDONNÉ" if is_abandoned else "🟦 COMMANDE NORMALE"
    seq = getattr(order, "store_sequence_number", "—") or "—"
    num = getattr(order, "order_number", "—") or "—"
    name = getattr(order, "customer_name", "Inconnu") or "Inconnu"
    phone = getattr(order, "customer_phone", "Inconnu") or "Inconnu"
    wilaya = getattr(order, "customer_wilaya", "—") or "—"
    commune = getattr(order, "customer_commune", "—") or "—"
    amount = getattr(order, "total_amount", 0.0) or 0.0
    source = getattr(order, "source", "—") or "—"
    campaign = getattr(order, "utm_campaign", "—") or "—"
    content = getattr(order, "utm_content", "—") or "—"
    fbclid = getattr(order, "fbclid", None)
    
    order_logger = logging.getLogger("app.orders")
    order_logger.info(
        "\n========================================================================================\n"
        "📦 [ORDER & META EVENT] %s | %s | N°%s | %s\n"
        "   👤 Client       : %s (%s)\n"
        "   📍 Localisation : %s (%s)\n"
        "   💰 Montant      : %s DA | Statut: %s\n"
        "   📣 Attribution  : Source=%s | Campagne=%s | Content=%s | MetaAd?=%s\n"
        "   📝 Détails/Note : %s\n"
        "========================================================================================",
        event_type, badge, seq, num,
        name, phone,
        wilaya, commune,
        amount, getattr(order, "status", "NEW"),
        source, campaign, content, ("OUI (fbclid)" if fbclid else "NON"),
        note or "Événement commande enregistré avec succès"
    )
