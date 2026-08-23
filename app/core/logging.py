import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

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
    Prints full real-time details matching the Administrator Order Modal for:
    - 🟢 [COMMANDE NORMALE] (Normal Orders)
    - 🟠 [PANIER ABANDONNÉ] (Abandoned Carts / Drafts)
    Includes Meta Ads detection status (Pixel / CAPI / UTM matching).
    """
    if not order:
        return

    is_abandoned = bool(getattr(order, "is_abandoned_cart", False)) or str(getattr(order, "status", "")) == "ABANDONED"
    badge = "🟠 [PANIER ABANDONNÉ]" if is_abandoned else "🟢 [COMMANDE NORMALE]"
    
    seq = getattr(order, "store_sequence_number", "—") or "—"
    num = getattr(order, "order_number", "—") or "—"
    order_id = getattr(order, "id", "—") or "—"

    # Client Info (Modale Admin)
    name = getattr(order, "customer_name", "Inconnu") or "Inconnu"
    phone = getattr(order, "customer_phone", "Inconnu") or "Inconnu"
    phone2 = getattr(order, "customer_phone2", None)
    phone_display = f"{phone} / {phone2}" if phone2 else phone
    email = getattr(order, "customer_email", None) or "Non renseigné"

    # Localisation & Livraison (Modale Admin)
    wilaya = getattr(order, "customer_wilaya", "—") or "—"
    commune = getattr(order, "customer_commune", "—") or "—"
    address = getattr(order, "customer_address", "—") or "—"
    del_type = str(getattr(order, "delivery_type", "HOME") or "HOME").upper()
    del_type_label = "À DOMICILE" if del_type == "HOME" else ("AU BUREAU / STOP DESK" if del_type in ("OFFICE", "STOP_DESK") else del_type)

    # Finances (Modale Admin)
    subtotal = getattr(order, "subtotal", 0.0) or 0.0
    discount = getattr(order, "discount", 0.0) or 0.0
    delivery_fee = getattr(order, "delivery_fee", 0.0) or 0.0
    amount = getattr(order, "total", None) if getattr(order, "total", None) is not None else (getattr(order, "total_amount", 0.0) or 0.0)
    promo_code = getattr(order, "promo_code", None) or "Aucun"
    status = str(getattr(order, "status", "NEW"))
    recovery_fee = getattr(order, "abandoned_cart_recovery_fee", 0.0) or 0.0

    # Assignation & Suivi Logistique (Modale Admin)
    assigned_agent = getattr(order, "assigned_to", None) or "Non assigné"
    livreur_id = getattr(order, "livreur_id", None) or "Non assigné"
    carrier_id = getattr(order, "carrier_id", None) or "Interne"
    tracking_no = getattr(order, "tracking_number", None) or "Non généré"
    carrier_stage = getattr(order, "carrier_stage_label", None) or getattr(order, "carrier_stage", None) or "En attente"

    # Items / Articles (Modale Admin)
    items = getattr(order, "items", []) or []
    items_lines = []
    if items:
        for idx, item in enumerate(items, 1):
            pname = getattr(item, "product_name", None) or getattr(item, "name", "Produit") or "Produit"
            qty = getattr(item, "quantity", 1) or 1
            price = getattr(item, "unit_price", None) or getattr(item, "price", 0.0) or 0.0
            line_total = qty * price
            variant = getattr(item, "variant_details", None)
            vstr = f" [Variante: {variant}]" if variant else ""
            sku = getattr(item, "sku", None)
            skustr = f" (SKU: {sku})" if sku else ""
            items_lines.append(f"      • Art #{idx}: {qty}x {pname}{skustr}{vstr} @ {price} DA = {line_total} DA")
    items_formatted = "\n".join(items_lines) if items_lines else "      • Aucun article enregistré"

    # Détection Meta Ads / Pixel / CAPI / UTM
    fbclid = getattr(order, "fbclid", None)
    fbp = getattr(order, "fbp", None)
    fbc = getattr(order, "fbc", None)
    utm_src = getattr(order, "utm_source", None) or getattr(order, "source", None) or ""
    utm_camp = getattr(order, "utm_campaign", None) or ""
    utm_content = getattr(order, "utm_content", None) or ""
    utm_medium = getattr(order, "utm_medium", None) or ""
    camp_id = getattr(order, "campaign_id", None) or ""
    ad_id = getattr(order, "ad_id", None) or ""

    is_meta_detected = bool(
        fbclid or fbp or fbc or 
        camp_id or ad_id or
        "facebook" in str(utm_src).lower() or 
        "instagram" in str(utm_src).lower() or 
        "meta" in str(utm_src).lower()
    )

    if is_meta_detected:
        meta_badge = "🎯 DÉTECTÉ PAR META ADS (Pixel/CAPI/UTM activement associé)"
        meta_details = f"FBCLID={'Détecté (' + str(fbclid)[:15] + '...)' if fbclid else 'Non'} | FBP={'Détecté' if fbp else 'Non'} | FBC={'Détecté' if fbc else 'Non'} | Campaign_ID={camp_id or 'N/A'}"
    else:
        meta_badge = "⚪ NON DÉTECTÉ PAR META (Accès Direct / Vente Organique / Sans Tracking Ads)"
        meta_details = "Aucun paramètre FBCLID/FBP/FBC ou identifiant de campagne Meta associé"

    source = getattr(order, "source", "—") or "—"
    source_lp = getattr(order, "landing_page_slug", None) or getattr(order, "landing_page_id", None) or getattr(order, "landing_url", "—") or "—"

    store_id = getattr(order, "store_id", "—") or "—"
    created_at = getattr(order, "created_at", None)
    time_str = created_at.strftime("%Y-%m-%d %H:%M:%S UTC") if hasattr(created_at, "strftime") else "En temps réel"

    order_logger = logging.getLogger("app.orders")
    
    if is_abandoned:
        order_logger.info(
            "\n========================================================================================\n"
            "🟠 %s | Événement: %s | Réf: N° %s (ID: %s | Seq: %s)\n"
            "   ⏰ HORODATAGE TEMPS RÉEL : %s | Store ID: %s\n"
            "   ------------------------------------------------------------------------------------\n"
            "   👤 INFORMATIONS CLIENT (Modale Admin) :\n"
            "      • Nom Client      : %s\n"
            "      • Téléphone(s)    : %s\n"
            "      • Email           : %s\n"
            "   📍 ADRESSE ET LIVRAISON :\n"
            "      • Localisation    : Wilaya: %s | Commune: %s\n"
            "      • Adresse Complète: %s\n"
            "      • Mode Livraison  : %s\n"
            "   🛒 DÉTAILS PANIER ABANDONNÉ & FINANCES :\n"
            "      • Montant Total   : %s DA (Sous-total: %s DA | Remise: %s DA | Frais Livr: %s DA)\n"
            "      • Code Promo      : %s\n"
            "      • Comm. Récupér.  : %s DA\n"
            "      • Statut Actuel   : %s\n"
            "   📦 ARTICLES DU PANIER :\n"
            "%s\n"
            "   👤 ASSIGNATION & SUIVI :\n"
            "      • Agent Confirm.  : %s | Livreur: %s | Transporteur: %s\n"
            "   📣 DÉTECTION META ADS & ATTRIBUTION :\n"
            "      • Statut Meta     : %s\n"
            "      • Signal Tracking : %s\n"
            "      • Source / LP     : Source=%s | LP=%s | Campagne=%s | Content=%s\n"
            "   📝 NOTE LOG          : %s\n"
            "========================================================================================",
            badge, event_type, num, order_id, seq,
            time_str, store_id,
            name, phone_display, email,
            wilaya, commune, address, del_type_label,
            amount, subtotal, discount, delivery_fee, promo_code, recovery_fee, status,
            items_formatted,
            assigned_agent, livreur_id, carrier_id,
            meta_badge, meta_details,
            source, source_lp, utm_camp or "—", utm_content or "—",
            note or "Panier abandonné capturé en temps réel"
        )
    else:
        order_logger.info(
            "\n========================================================================================\n"
            "🟢 %s | Événement: %s | Réf: N° %s (Seq #%s | ID: %s)\n"
            "   ⏰ HORODATAGE TEMPS RÉEL : %s | Store ID: %s\n"
            "   ------------------------------------------------------------------------------------\n"
            "   👤 INFORMATIONS CLIENT (Modale Admin) :\n"
            "      • Nom Client      : %s\n"
            "      • Téléphone(s)    : %s\n"
            "      • Email           : %s\n"
            "   📍 ADRESSE ET LIVRAISON :\n"
            "      • Localisation    : Wilaya: %s | Commune: %s\n"
            "      • Adresse Complète: %s\n"
            "      • Mode Livraison  : %s\n"
            "   💰 DÉTAILS FINANCIERS :\n"
            "      • Montant Total   : %s DA (Sous-total: %s DA | Remise: %s DA | Frais Livr: %s DA)\n"
            "      • Code Promo      : %s\n"
            "      • Statut Commande : %s\n"
            "   📦 ARTICLES EN COMMANDE :\n"
            "%s\n"
            "   🚚 ASSIGNATION & SUIVI LOGISTIQUE :\n"
            "      • Agent Confirm.  : %s | Livreur: %s\n"
            "      • Transporteur    : %s | Tracking: %s | Étape: %s\n"
            "   📣 DÉTECTION META ADS & ATTRIBUTION :\n"
            "      • Statut Meta     : %s\n"
            "      • Signal Tracking : %s\n"
            "      • Source / LP     : Source=%s | LP=%s | Campagne=%s | Content=%s\n"
            "   📝 NOTE LOG          : %s\n"
            "========================================================================================",
            badge, event_type, num, seq, order_id,
            time_str, store_id,
            name, phone_display, email,
            wilaya, commune, address, del_type_label,
            amount, subtotal, discount, delivery_fee, promo_code, status,
            items_formatted,
            assigned_agent, livreur_id,
            carrier_id, tracking_no, carrier_stage,
            meta_badge, meta_details,
            source, source_lp, utm_camp or "—", utm_content or "—",
            note or "Nouvelle commande reçue en temps réel"
        )


def log_landing_page_diagnostic(
    lp: Any,
    health_score: int,
    health_badge: str,
    overview_kpis: Dict[str, Any],
    meta_data: Dict[str, Any],
    quality_data: Dict[str, Any],
    smart_alerts: List[Dict[str, Any]],
    period_str: str = "7 derniers jours",
) -> None:
    """
    High-visibility structured diagnostic log with emoji badges highlighting:
    - Overall Landing Page Health Score & Performance
    - Exact tracking status (Pixel, CAPI, Meta campaign matching)
    - Detailed anomalies, root causes & concrete corrective actions to fix the landing page.
    """
    if not lp:
        return

    lp_logger = logging.getLogger("app.landing_pages")

    # Determine Badge Severity
    has_critical = any(str(a.get("severity", "")).lower() == "critical" for a in smart_alerts)
    has_warning = any(str(a.get("severity", "")).lower() == "warning" for a in smart_alerts)

    if has_critical or health_score < 50:
        badge_header = "🔴 [DIAGNOSTIC CRITIQUE LANDING PAGE]"
        badge_icon = "🔴"
    elif has_warning or health_score < 75:
        badge_header = "🟠 [DIAGNOSTIC ATTENTION LANDING PAGE]"
        badge_icon = "🟠"
    elif health_score < 85:
        badge_header = "🟡 [DIAGNOSTIC MODÉRÉ LANDING PAGE]"
        badge_icon = "🟡"
    else:
        badge_header = "🟢 [DIAGNOSTIC OPTIMAL LANDING PAGE]"
        badge_icon = "🟢"

    lp_name = getattr(lp, "headline", None) or getattr(lp, "product_name", None) or getattr(lp, "slug", "Landing Page")
    slug = getattr(lp, "slug", "—")
    lp_id = getattr(lp, "id", "—")
    store_id = getattr(lp, "store_id", "—")
    is_active = getattr(lp, "is_active", True)
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # KPI extracts
    orders_info = overview_kpis.get("orders", {})
    cr_info = overview_kpis.get("conversion_rate", {})
    recovered_info = overview_kpis.get("recovered_carts", {})
    delivered_info = overview_kpis.get("delivered", {})
    returned_info = overview_kpis.get("returned", {})
    shipped_info = overview_kpis.get("shipped", {})

    total_orders = orders_info.get("value", 0)
    sessions = cr_info.get("sessions_count", 0)
    cr_str = cr_info.get("formatted", "—")
    recovered_count = recovered_info.get("recovered_count", 0)
    abandoned_count = recovered_info.get("abandoned_count", 0)
    rec_rate_str = recovered_info.get("formatted_rate", "—")

    shipped_count = shipped_info.get("shipped_count", 0)
    with_tracking = shipped_info.get("with_tracking_count", 0)
    delivered_count = delivered_info.get("value", 0)
    returned_count = returned_info.get("value", 0)

    # Tracking & Meta Status
    tracking_status = quality_data.get("tracking_status", {})
    pixel_configured = bool(tracking_status.get("meta_pixel_active") or tracking_status.get("meta_pixel_configured"))
    pixel_id = tracking_status.get("meta_pixel_id")
    capi_active = bool(tracking_status.get("meta_capi_active"))

    pixel_display = f"✅ Configuré (ID: {pixel_id})" if (pixel_configured and pixel_id) else ("✅ Configuré" if pixel_configured else "❌ Non configuré")
    capi_display = "✅ Actif (Conversions API Connectée)" if capi_active else "❌ Inactif / Token non renseigné"

    if meta_data.get("is_available"):
        meta_display = f"✅ Liée déterministe ({meta_data.get('campaign_name')} | {meta_data.get('purchases', 0)} achats déclarés Meta)"
    else:
        meta_display = f"⚠️ {meta_data.get('reason', 'Campagne non liée')}"

    # Build Diagnostic lines
    alert_lines = []
    if not is_active:
        alert_lines.append(
            "      🔴 [PAGE DÉSACTIVÉE] La Landing Page est hors-ligne\n"
            "         ↳ 🔍 Cause Détectée  : is_active=False — Aucun acheteur ne peut accéder au tunnel d'achat.\n"
            "         ↳ 🛠️ Action à Poser  : Réactiver la landing page depuis le tableau de bord Admin."
        )

    if smart_alerts:
        for alert in smart_alerts:
            icon = alert.get("icon", "⚠️")
            sev = str(alert.get("severity", "warning")).upper()
            title = alert.get("title", "")
            desc = alert.get("description", "")
            action = alert.get("action", "")
            alert_lines.append(
                f"      {icon} [{sev}] {title}\n"
                f"         ↳ 🔍 Cause Détectée  : {desc}\n"
                f"         ↳ 🛠️ Action à Poser  : {action}"
            )
    elif is_active:
        alert_lines.append(
            "      ✅ [STATUT OPTIMAL] Aucun problème détecté sur cette Landing Page.\n"
            "         ↳ Tous les indicateurs de conversion, tracking CAPI et logistique sont équilibrés."
        )

    alerts_formatted = "\n\n".join(alert_lines)

    recom_count = len(smart_alerts) + (1 if not is_active else 0)
    if recom_count > 0:
        recom_text = f"⚠️ {recom_count} action(s) corrective(s) nécessaire(s) pour maximiser le ROI et la délivrabilité."
    else:
        recom_text = "✨ Performance optimale — La landing page convertit et transmet les données correctement."

    sep = "=" * 88
    sub_sep = "-" * 84

    diagnostic_msg = (
        f"\n{sep}\n"
        f"🏷️ 📊 {badge_header} | « {lp_name} » (Slug: /{slug})\n"
        f"   ⏰ HORODATAGE TEMPS RÉEL : {now_str} | ID: {lp_id} | Store: {store_id}\n"
        f"   🏆 HEALTH SCORE : {badge_icon} {health_score}/100 ({health_badge}) | Période: {period_str}\n"
        f"   {sub_sep}\n"
        f"   📈 ACTIVITÉ & CONVERSION FIRST-PARTY ERP :\n"
        f"      • 👥 Sessions Qualifiées (LP) : {sessions} visiteurs\n"
        f"      • 🛒 Commandes Totales        : {total_orders} commandes (Taux de conversion: {cr_str})\n"
        f"      • 🔄 Paniers Récupérés (CRM)  : {recovered_count} / {abandoned_count} abandonnés (Taux récup.: {rec_rate_str})\n"
        f"      • 🚚 Flux Logistique Expédition: {shipped_count} expédiées (dont {with_tracking} avec N° Noest) | {delivered_count} livrées | {returned_count} retours\n"
        f"   {sub_sep}\n"
        f"   🔍 ÉTAT DU TRACKING & CONNEXIONS MARKETING :\n"
        f"      • 🌐 Meta Pixel ID            : {pixel_display}\n"
        f"      • 🔌 Meta Conversions API     : {capi_display}\n"
        f"      • 📣 Attribution Campagne Meta: {meta_display}\n"
        f"   {sub_sep}\n"
        f"   🚨 DIAGNOSTIC DES ANOMALIES & RAISONS DE CORRECTION :\n"
        f"{alerts_formatted}\n"
        f"   {sub_sep}\n"
        f"   💡 RECOMMANDATION GLOBALE : {recom_text}\n"
        f"{sep}"
    )

    if has_critical or health_score < 50:
        lp_logger.warning(diagnostic_msg)
    else:
        lp_logger.info(diagnostic_msg)



