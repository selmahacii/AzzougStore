"""
Conversion Optimization Center — canonical, real-data-only engine.

Hard rule (per spec): never fabricate a number. Every metric here is
computed from actual rows in Order/OrderItem/Product/MetaCapiLog/
MetaAdsCampaign. Where a requested sub-metric has no real data source in
this codebase (bounce rate, time-on-page, mobile/desktop split, sector
benchmark), it is explicitly OMITTED with a note rather than invented —
see the docstrings on compute_landing_page_scores() and
compute_benchmark() below for exactly what is and isn't available.

Reuses MetaAnalyticsEngine (app/services/conversion_optimization_engine
never recomputes EMQ/Learning Score/tracking coverage/dedup/attribution —
detect_bottlenecks() calls compute_meta_metrics() for all of those) per
the standing constraint: MetaAnalyticsEngine stays the single source of
truth for Meta CAPI health metrics.

Funnel data source: MetaCapiLog.event_name already carries PageView,
ViewContent, AddToCart, InitiateCheckout and Purchase (see
src/lib/meta-tracking.ts + src/store/cart-store.ts + checkout-form.tsx,
all relayed server-side via POST /meta-ads/events -> this same table).
"Visitors" below means PageView events specifically (not de-duplicated
unique sessions — MetaCapiLog has no reliable session key for PageView),
labeled honestly as such rather than claimed to be unique visitors.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.services.meta_analytics_engine import compute_meta_metrics, classify
from app.services.meta_capi import meta_health_label

_FUNNEL_STAGES = ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase"]
_FUNNEL_LABELS = {
    "PageView": "Visites", "ViewContent": "Vue Produit", "AddToCart": "Ajout Panier",
    "InitiateCheckout": "Début Checkout", "Purchase": "Achat",
}


def _funnel_counts(db: Session, store_id: str, since: datetime, until: datetime) -> Dict[str, int]:
    from app.models.marketing import MetaCapiLog
    rows = (
        db.query(MetaCapiLog.event_name, func.count(func.distinct(MetaCapiLog.event_id)))
        .filter(
            MetaCapiLog.store_id == store_id,
            MetaCapiLog.event_name.in_(_FUNNEL_STAGES),
            MetaCapiLog.created_at >= since, MetaCapiLog.created_at <= until,
        )
        .group_by(MetaCapiLog.event_name)
        .all()
    )
    counts = {name: count for name, count in rows}
    return {stage: counts.get(stage, 0) for stage in _FUNNEL_STAGES}


def _orders_summary(db: Session, store_id: str, since: datetime, until: datetime) -> Dict[str, Any]:
    from app.models.order import Order
    rows = (
        db.query(Order.status, func.count(Order.id), func.coalesce(func.sum(Order.total), 0))
        .filter(Order.store_id == store_id, Order.is_deleted == False,
                Order.status != "MERGED", Order.created_at >= since, Order.created_at <= until)
        .group_by(Order.status)
        .all()
    )
    by_status: Dict[str, int] = {}
    revenue_by_status: Dict[str, int] = {}
    for status, count, revenue in rows:
        by_status[status] = count
        revenue_by_status[status] = int(revenue or 0)
    total_orders = sum(by_status.values())
    delivered = by_status.get("DELIVERED", 0)
    cancelled = by_status.get("CANCELLED", 0)
    revenue = sum(v for k, v in revenue_by_status.items() if k not in ("CANCELLED",))
    return {"total_orders": total_orders, "delivered": delivered, "cancelled": cancelled, "revenue": revenue}


# ─────────────────────────────────────────────────────────────────────────
# 1. Conversion Overview
# ─────────────────────────────────────────────────────────────────────────

def compute_conversion_overview(db: Session, store_id: str, now: Optional[datetime] = None) -> Dict[str, Any]:
    """
    Conversion rate = Purchase events / PageView events, for the current
    period and each comparable prior period (7/30/90 days). Returns None
    (not 0%) when a period has zero PageView — no denominator, no rate.
    """
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)

    def _rate_for_window(days: int) -> Optional[float]:
        since = now - timedelta(days=days)
        counts = _funnel_counts(db, store_id, since, now)
        pv = counts["PageView"]
        return round(counts["Purchase"] / pv * 100, 2) if pv else None

    def _delta(current: Optional[float], previous: Optional[float]) -> Optional[float]:
        if current is None or previous is None or previous == 0:
            return None
        return round((current - previous) / previous * 100, 1)

    current_30 = _rate_for_window(30)

    windows = {}
    for days in (7, 30, 90):
        since = now - timedelta(days=days)
        prev_since = since - timedelta(days=days)
        cur_counts = _funnel_counts(db, store_id, since, now)
        prev_counts = _funnel_counts(db, store_id, prev_since, since)
        cur_rate = round(cur_counts["Purchase"] / cur_counts["PageView"] * 100, 2) if cur_counts["PageView"] else None
        prev_rate = round(prev_counts["Purchase"] / prev_counts["PageView"] * 100, 2) if prev_counts["PageView"] else None
        windows[f"days_{days}"] = {
            "conversion_rate": cur_rate,
            "previous_period_rate": prev_rate,
            "evolution_pct": _delta(cur_rate, prev_rate),
            "purchases": cur_counts["Purchase"], "pageviews": cur_counts["PageView"],
        }

    return {
        "current_conversion_rate": current_30,
        "windows": windows,
        "population": "Conversion rate = Purchase / PageView (MetaCapiLog), fenêtres glissantes.",
    }


# ─────────────────────────────────────────────────────────────────────────
# 2. Conversion Funnel Analyzer
# ─────────────────────────────────────────────────────────────────────────

def compute_conversion_funnel(db: Session, store_id: str, since: datetime, until: datetime) -> Dict[str, Any]:
    counts = _funnel_counts(db, store_id, since, until)
    period_length = until - since
    prev_since = since - period_length
    prev_counts = _funnel_counts(db, store_id, prev_since, since)

    stages = []
    worst_stage = None
    worst_loss_pct = -1.0
    for i, stage in enumerate(_FUNNEL_STAGES):
        volume = counts[stage]
        prev_volume = prev_counts[stage]
        if i == 0:
            stage_rate = 100.0 if volume else None
            loss_pct = None
        else:
            prev_stage_volume = counts[_FUNNEL_STAGES[i - 1]]
            stage_rate = round(volume / prev_stage_volume * 100, 1) if prev_stage_volume else None
            loss_pct = round(100 - stage_rate, 1) if stage_rate is not None else None
        vs_previous_period = round((volume - prev_volume) / prev_volume * 100, 1) if prev_volume else None
        stages.append({
            "stage": stage, "label": _FUNNEL_LABELS[stage],
            "volume": volume, "rate_from_previous_stage": stage_rate,
            "loss_pct": loss_pct, "vs_previous_period_pct": vs_previous_period,
        })
        if loss_pct is not None and loss_pct > worst_loss_pct:
            worst_loss_pct = loss_pct
            worst_stage = stage

    bottleneck_message = None
    if worst_stage:
        bottleneck_message = (
            f"La majorité des pertes proviennent de l'étape {_FUNNEL_LABELS[worst_stage]} "
            f"({worst_loss_pct}% de perte à cette étape)."
        )

    # Cohérence logique du tunnel — MAIS PageView n'est PAS comparable 1:1 à
    # ViewContent/AddToCart dans cette architecture : StorefrontIntegrations
    # déclenche PageView UNE SEULE FOIS par useEffect (dépendance
    # `[config?.pixel_id]`, qui ne change jamais pendant une session), alors
    # que le storefront est une SPA (navigation par état interne, aucune
    # balise <a href> sur les cartes produit — vérifié sur le code, pas une
    # supposition) : un visiteur qui consulte 3 produits dans la MÊME
    # session génère 1 PageView mais 3 ViewContent, LÉGITIMEMENT. Comparer
    # PageView à ViewContent/AddToCart revient donc à comparer "sessions" à
    # "produits consultés" — deux granularités différentes, pas une seule
    # population qui devrait être strictement décroissante. En revanche,
    # InitiateCheckout et Purchase restent des événements par TENTATIVE DE
    # COMMANDE (pas par session), donc réellement comparables entre eux et
    # à AddToCart — ce contrôle reste strict pour ces étapes-là.
    _SESSION_LEVEL_STAGES = {"PageView"}
    coherence_issues = []
    for i in range(1, len(_FUNNEL_STAGES)):
        prev_stage, stage = _FUNNEL_STAGES[i - 1], _FUNNEL_STAGES[i]
        if counts[stage] <= counts[prev_stage]:
            continue
        if prev_stage in _SESSION_LEVEL_STAGES:
            # Attendu dans une SPA : plusieurs produits vus par session — pas
            # une anomalie, une observation informative seulement.
            coherence_issues.append({
                "stage": stage, "previous_stage": prev_stage,
                "stage_volume": counts[stage], "previous_stage_volume": counts[prev_stage],
                "severity": "info",
                "message": f"{_FUNNEL_LABELS[stage]} ({counts[stage]}) dépasse {_FUNNEL_LABELS[prev_stage]} ({counts[prev_stage]}) — normal sur ce site (application monopage) : {_FUNNEL_LABELS[prev_stage]} compte les SESSIONS (une fois par visite), {_FUNNEL_LABELS[stage]} compte les PRODUITS consultés (plusieurs par session) ; ce n'est pas une perte négative réelle ni un défaut de tracking.",
            })
        else:
            coherence_issues.append({
                "stage": stage, "previous_stage": prev_stage,
                "stage_volume": counts[stage], "previous_stage_volume": counts[prev_stage],
                "severity": "anomaly",
                "message": f"{_FUNNEL_LABELS[stage]} ({counts[stage]}) dépasse {_FUNNEL_LABELS[prev_stage]} ({counts[prev_stage]}) — anomalie de tracking réelle (ces deux étapes sont censées être comparables 1:1), pas une perte négative.",
            })

    return {
        "stages": stages,
        "primary_bottleneck": {"stage": worst_stage, "loss_pct": worst_loss_pct if worst_stage else None, "message": bottleneck_message},
        "coherence_issues": coherence_issues,
        "population": f"{counts['PageView']} PageView, {counts['Purchase']} Purchase sur la période.",
    }


# ─────────────────────────────────────────────────────────────────────────
# 3. Automatic Bottleneck Detection — reuses compute_meta_metrics(), never
# recomputes EMQ/Learning Score/tracking coverage/dedup/attribution.
# ─────────────────────────────────────────────────────────────────────────

def detect_bottlenecks(db: Session, store_id: str, since: datetime, until: datetime) -> List[Dict[str, Any]]:
    from app.models.product import Product
    from app.models.order import Order

    m = compute_meta_metrics(db, store_id, since, until)
    funnel = compute_conversion_funnel(db, store_id, since, until)
    findings: List[Dict[str, Any]] = []

    def _add(id_, severity, confidence, impact, explanation, fix):
        findings.append({
            "id": id_, "severity": severity, "confidence": confidence,
            "impact": impact, "explanation": explanation, "fix": fix,
        })

    if m["event_match_quality"] is not None and m["event_match_quality"] < 60:
        _add("low_emq", "high", "high",
             f"EMQ à {m['event_match_quality']}%, sous le seuil Meta recommandé (~60%)",
             "Event Match Quality faible — Meta ne parvient pas à rapprocher la majorité des événements d'un profil utilisateur réel, ce qui dégrade l'optimisation publicitaire.",
             "Vérifier que email/téléphone/FBP/FBC/IP/user-agent sont transmis à chaque commande (voir Signal Quality Center > Couverture par champ).")

    if m["tracking_coverage"] is not None and m["tracking_coverage"] < 90:
        _add("low_tracking_coverage", "high", "high",
             f"{100 - m['tracking_coverage']}% des Purchase ne sont pas transmis à Meta",
             "Tracking Coverage faible — une part significative des ventes réelles n'est jamais rapportée à Meta, faussant le calcul du ROAS et l'optimisation des campagnes.",
             "Vérifier la file CAPI (Meta Queue) pour les échecs répétés et la configuration du Pixel.")

    if m["avg_latency_ms"] is not None and m["avg_latency_ms"] > 30000:
        _add("high_latency", "medium", "high",
             f"Latence moyenne de {round(m['avg_latency_ms']/1000, 1)}s",
             "Lenteur d'envoi CAPI — Meta reçoit les signaux d'achat trop tard pour optimiser efficacement la diffusion en cours.",
             "Vérifier la connectivité sortante du serveur (Santé du Pixel) et la charge de la file CAPI.")

    if m["backfill_pct"] is not None and m["backfill_pct"] > 30:
        _add("high_backfill", "medium", "medium",
             f"{m['backfill_pct']}% des Purchase envoyés en rattrapage",
             "Trop d'événements envoyés en rattrapage (backfill) plutôt qu'en temps réel — Meta apprend sur des signaux tardifs, moins utiles à l'algorithme.",
             "Fiabiliser le déclenchement temps réel de l'envoi CAPI (voir file d'attente).")

    if m["learning_score"]["score"] is not None and m["learning_score"]["score"] < 50:
        _add("low_learning_score", "high", "high",
             f"Learning Score à {m['learning_score']['score']}/100",
             "Le score de qualité de signal global est critique — Meta manque de données fiables pour optimiser la diffusion publicitaire.",
             "Voir le détail des composants du Learning Score (Signal Quality Center) pour identifier le composant le plus faible en priorité.")

    for issue in funnel.get("coherence_issues", []):
        # "info" (PageView dépassé par ViewContent/AddToCart) est normal sur
        # une SPA — voir compute_conversion_funnel — jamais remonté comme
        # bottleneck actionnable. Seul "anomaly" (étapes censées être
        # comparables 1:1, ex. InitiateCheckout/Purchase) l'est.
        if issue.get("severity") != "anomaly":
            continue
        _add("funnel_incoherence", "medium", "high",
             f"{issue['message']}",
             "Ces deux étapes sont censées être comparables 1:1 (une tentative de commande par événement) — ce dépassement signale un vrai problème de tracking, pas juste un chiffre à ignorer.",
             "Vérifier que le Pixel/CAPI se déclenche correctement à chaque étape, et que les event_id ne sont pas dupliqués entre deux event_name différents.")

    bottleneck = funnel["primary_bottleneck"]
    if bottleneck["stage"] and bottleneck["loss_pct"] and bottleneck["loss_pct"] > 50:
        stage_fixes = {
            "ViewContent": "Vérifier la vitesse de chargement des pages produit et la qualité des visuels/descriptions.",
            "AddToCart": "Revoir le prix affiché, les frais de livraison visibles trop tard, ou le manque de preuve sociale sur la fiche produit.",
            "InitiateCheckout": "Simplifier le formulaire de commande, vérifier les frais surprises et les options de livraison.",
            "Purchase": "Vérifier le flux de confirmation téléphonique (délai, taux de NRP) et la fiabilité de paiement/livraison.",
        }
        _add("funnel_bottleneck", "high", "high",
             f"{bottleneck['loss_pct']}% de perte à l'étape {_FUNNEL_LABELS.get(bottleneck['stage'], bottleneck['stage'])}",
             bottleneck["message"], stage_fixes.get(bottleneck["stage"], "Analyser cette étape du tunnel en détail."))

    # Manque de photos — vérifiable directement depuis Product, sans invention.
    no_photo_products = (
        db.query(func.count(Product.id))
        .filter(Product.store_id == store_id, Product.is_active == True, Product.is_upsell_only == False,
                func.coalesce(Product.main_image, "") == "")
        .scalar() or 0
    )
    if no_photo_products > 0:
        _add("missing_photos", "medium", "high",
             f"{no_photo_products} produit(s) actif(s) sans photo principale",
             "Un produit sans photo convertit structurellement moins bien — c'est un frein direct et vérifiable, pas une estimation.",
             "Ajouter une photo principale à chaque produit actif listé.")

    # Livraison — taux d'annulation/retour élevé, un vrai signal de problème opérationnel.
    orders = _orders_summary(db, store_id, since, until)
    if orders["total_orders"] >= 10 and orders["cancelled"] / orders["total_orders"] > 0.30:
        cancel_pct = round(orders["cancelled"] / orders["total_orders"] * 100, 1)
        _add("high_cancellation", "high", "high",
             f"{cancel_pct}% des commandes de la période sont annulées",
             "Taux d'annulation élevé — problème possible de qualité produit, de délai de livraison, ou de fiabilité du transporteur.",
             "Analyser les motifs d'annulation (module Retours & Stock) pour identifier la cause dominante.")

    severity_order = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: severity_order.get(f["severity"], 3))
    return findings


# ─────────────────────────────────────────────────────────────────────────
# 4. Product Conversion Analysis
# ─────────────────────────────────────────────────────────────────────────

def compute_product_conversion_analysis(db: Session, store_id: str, since: datetime, until: datetime) -> List[Dict[str, Any]]:
    from app.models.product import Product
    from app.models.order import Order, OrderItem
    from app.models.marketing import MetaCapiLog

    products = db.query(Product).filter(Product.store_id == store_id, Product.is_upsell_only == False).all()
    if not products:
        return []
    product_ids = [p.id for p in products]

    # Purchase revenue/quantity per product, from real order items on non-cancelled orders.
    item_rows = (
        db.query(OrderItem.product_id, func.sum(OrderItem.quantity), func.sum(OrderItem.quantity * OrderItem.unit_price))
        .join(Order, Order.id == OrderItem.order_id)
        .filter(Order.store_id == store_id, Order.is_deleted == False, Order.status != "CANCELLED", Order.status != "MERGED",
                Order.created_at >= since, Order.created_at <= until, OrderItem.product_id.in_(product_ids))
        .group_by(OrderItem.product_id)
        .all()
    )
    sales_by_product = {pid: {"quantity": qty or 0, "revenue": int(rev or 0)} for pid, qty, rev in item_rows}

    # ViewContent/AddToCart/InitiateCheckout counts per product, via
    # custom_data.content_ids (JSON array) — Postgres JSON containment; a
    # per-row Python scan is used for SQLite-test-compat, bounded to a
    # generous cap since this only runs over the CAPI event window.
    event_rows = (
        db.query(MetaCapiLog.event_name, MetaCapiLog.payload)
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.event_name.in_(["ViewContent", "AddToCart", "InitiateCheckout"]),
                MetaCapiLog.created_at >= since, MetaCapiLog.created_at <= until)
        .limit(20000)
        .all()
    )
    funnel_by_product: Dict[str, Dict[str, int]] = {pid: {"views": 0, "add_to_cart": 0, "checkout": 0} for pid in product_ids}
    _event_key = {"ViewContent": "views", "AddToCart": "add_to_cart", "InitiateCheckout": "checkout"}
    for event_name, payload in event_rows:
        content_ids = ((payload or {}).get("custom_data") or {}).get("content_ids") or []
        for cid in content_ids:
            if cid in funnel_by_product:
                funnel_by_product[cid][_event_key[event_name]] += 1

    results = []
    for p in products:
        sales = sales_by_product.get(p.id, {"quantity": 0, "revenue": 0})
        views = funnel_by_product[p.id]["views"]
        add_to_cart = funnel_by_product[p.id]["add_to_cart"]
        checkout = funnel_by_product[p.id]["checkout"]
        purchases = sales["quantity"]
        revenue = sales["revenue"]
        cost = (p.cost_price or 0) * purchases
        profit = revenue - cost
        margin_pct = round(profit / revenue * 100, 1) if revenue else None
        conversion_pct = round(purchases / views * 100, 1) if views else None

        tags = []
        if views >= 50 and (conversion_pct or 0) < 1.0:
            tags.append("popular_no_convert")
        if profit > 0 and margin_pct is not None and margin_pct >= 30:
            tags.append("profitable")
        if views < 10 and purchases == 0:
            tags.append("low_visibility")
        if views >= 30 and purchases == 0:
            tags.append("to_remove_candidate")
        if margin_pct is not None and margin_pct >= 40 and views < 30:
            tags.append("to_promote_candidate")

        results.append({
            "product_id": p.id, "name": p.name,
            "views": views, "add_to_cart": add_to_cart, "checkout": checkout, "purchases": purchases,
            "revenue": revenue, "cost": cost, "profit": profit, "margin_pct": margin_pct,
            "conversion_pct": conversion_pct, "tags": tags,
        })

    results.sort(key=lambda r: r["revenue"], reverse=True)
    return results


# ─────────────────────────────────────────────────────────────────────────
# 5. Landing Page Performance — ONLY what is genuinely tracked. Bounce
# rate, time-on-page and mobile/desktop split have NO real data source in
# this codebase (no session/pageview-duration tracking table exists) — they
# are intentionally absent here rather than fabricated. Reuses the funnel
# counts already computed per-page via landing_pages.py's own analytics
# endpoint (not duplicated here); this function only adds the composite
# score on top of numbers that endpoint already returns.
# ─────────────────────────────────────────────────────────────────────────

def compute_landing_page_score(orders: int, delivered: int, cancelled: int, meta_purchases: int) -> Dict[str, Any]:
    """
    Score /100 from 2 real, available signals: delivery rate (delivered /
    (delivered+cancelled)) and Meta/ERP tracking match ratio. Any other
    requested signal (bounce, time-on-page, device split) is NOT available
    — see module docstring — and is never approximated here.
    """
    settled = delivered + cancelled
    delivery_rate = (delivered / settled * 100) if settled else None
    tracking_match = min(100.0, meta_purchases / orders * 100) if orders else None
    components = [v for v in (delivery_rate, tracking_match) if v is not None]
    score = round(sum(components) / len(components), 1) if components else None
    return {**classify(score, meta_health_label), "delivery_rate": delivery_rate, "tracking_match_pct": tracking_match,
            "limitations": "Bounce rate, temps moyen et répartition mobile/desktop non disponibles — aucune donnée de session/durée de page n'est trackée dans cette base."}


# ─────────────────────────────────────────────────────────────────────────
# 6. Campaign Conversion Intelligence
# ─────────────────────────────────────────────────────────────────────────

def compute_campaign_conversion_intelligence(db: Session, store_id: str, since: datetime, until: datetime) -> List[Dict[str, Any]]:
    from app.models.marketing import MetaAdsCampaign
    from app.api.v1.meta_ads import _match_campaign_orders

    campaigns = db.query(MetaAdsCampaign).filter(MetaAdsCampaign.store_id == store_id, MetaAdsCampaign.spend > 0).all()
    results = []
    for camp in campaigns:
        orders, no_utm_count = _match_campaign_orders(db, store_id, camp, since=since, until=until)
        orders_count = len(orders)
        delivered = sum(1 for o in orders if o.status == "DELIVERED")
        cancelled = sum(1 for o in orders if o.status == "CANCELLED")
        revenue = sum(o.total or 0 for o in orders)
        ctr = round(camp.clicks / camp.impressions * 100, 2) if camp.impressions else None
        cvr = round(orders_count / camp.clicks * 100, 2) if camp.clicks else None
        roas = round(revenue / camp.spend, 2) if camp.spend else None

        # Fault attribution — each check independent, first genuine match wins,
        # never a guess when the signal isn't conclusive.
        fault = None
        if camp.impressions and ctr is not None and ctr < 1.0:
            fault = "publicite"  # weak ad creative/targeting: low CTR
        elif camp.clicks and cvr is not None and cvr < 1.0:
            fault = "landing_ou_checkout"  # clicks arrive but rarely become orders
        elif orders_count and delivered and cancelled / max(orders_count, 1) > 0.3:
            fault = "produit_ou_livraison"  # orders happen but a lot get cancelled

        results.append({
            "campaign_id": camp.campaign_id, "campaign_name": camp.campaign_name,
            "spend": camp.spend, "impressions": camp.impressions, "clicks": camp.clicks,
            "ctr": ctr, "orders_count": orders_count, "cvr": cvr, "revenue": revenue,
            "delivered": delivered, "cancelled": cancelled, "roas": roas,
            "fault_attribution": fault,
        })
    results.sort(key=lambda r: r["spend"], reverse=True)
    return results


# ─────────────────────────────────────────────────────────────────────────
# 7. Conversion Opportunity Score — current vs the store's OWN best
# historical period (never a fabricated/sector benchmark).
# ─────────────────────────────────────────────────────────────────────────

def compute_opportunity_score(db: Session, store_id: str, since: datetime, until: datetime) -> Dict[str, Any]:
    current_counts = _funnel_counts(db, store_id, since, until)
    current_rate = round(current_counts["Purchase"] / current_counts["PageView"] * 100, 2) if current_counts["PageView"] else None

    # Best historical 30-day window over the last 365 days, computed day-by-day
    # from the SAME real event counts — never invented.
    window_days = (until - since).days or 1
    scan_start = until - timedelta(days=365)
    best_rate = None
    best_window_start = None
    cursor = scan_start
    step = timedelta(days=max(window_days, 7))
    while cursor + timedelta(days=window_days) <= until:
        w_counts = _funnel_counts(db, store_id, cursor, cursor + timedelta(days=window_days))
        if w_counts["PageView"] >= 20:  # ignore near-empty windows — not a meaningful comparison
            rate = w_counts["Purchase"] / w_counts["PageView"] * 100
            if best_rate is None or rate > best_rate:
                best_rate = round(rate, 2)
                best_window_start = cursor
        cursor += step

    if current_rate is None or best_rate is None or best_rate <= current_rate:
        return {
            "current_conversion_rate": current_rate,
            "potential_conversion_rate": None,
            "gain_pct": None, "estimated_extra_orders": None, "estimated_extra_revenue": None,
            "explanation": "Aucune période historique meilleure que la période actuelle n'a été trouvée — pas de gain à estimer sans donnée réelle à comparer." if current_rate is not None else "PageView insuffisants sur la période pour calculer un taux de conversion.",
        }

    gain_pct = round((best_rate - current_rate) / current_rate * 100, 1)
    orders = _orders_summary(db, store_id, since, until)
    avg_order_value = orders["revenue"] / orders["total_orders"] if orders["total_orders"] else 0
    extra_orders = round(current_counts["PageView"] * (best_rate - current_rate) / 100)
    extra_revenue = round(extra_orders * avg_order_value)

    return {
        "current_conversion_rate": current_rate,
        "potential_conversion_rate": best_rate,
        "best_period_reference": best_window_start.isoformat() if best_window_start else None,
        "gain_pct": gain_pct,
        "estimated_extra_orders": extra_orders,
        "estimated_extra_revenue": extra_revenue,
        "explanation": f"Meilleure période historique (fenêtre de {window_days}j démarrant {best_window_start.date().isoformat() if best_window_start else '—'}) : {best_rate}% de conversion vs {current_rate}% actuellement. Estimation = PageView actuels × écart de taux × panier moyen réel de la période.",
    }


# ─────────────────────────────────────────────────────────────────────────
# 8. Action Prioritizer — derives priority from the bottleneck list already
# computed above; never invents a new score independent of real findings.
# ─────────────────────────────────────────────────────────────────────────

_EFFORT_BY_BOTTLENECK = {
    "low_emq": 2, "low_tracking_coverage": 2, "high_latency": 3, "high_backfill": 3,
    "low_learning_score": 2, "funnel_bottleneck": 4, "missing_photos": 1, "high_cancellation": 4,
}
_SEVERITY_STARS = {"high": 5, "medium": 3, "low": 1}


def compute_action_priorities(bottlenecks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    actions = []
    for b in bottlenecks:
        impact_stars = _SEVERITY_STARS.get(b["severity"], 1)
        effort_stars = _EFFORT_BY_BOTTLENECK.get(b["id"], 3)
        priority_score = impact_stars * 2 - effort_stars  # higher impact + lower effort = do first
        actions.append({
            "id": b["id"], "title": b["impact"], "explanation": b["explanation"], "fix": b["fix"],
            "impact_stars": impact_stars, "effort_stars": effort_stars,
            "priority_score": priority_score, "confidence": b["confidence"],
        })
    actions.sort(key=lambda a: a["priority_score"], reverse=True)
    return actions


# ─────────────────────────────────────────────────────────────────────────
# 9. Benchmark — store's own history only. Sector average is explicitly
# "non disponible" (no cross-tenant benchmark dataset exists) rather than
# invented, per instruction.
# ─────────────────────────────────────────────────────────────────────────

def compute_benchmark(db: Session, store_id: str, since: datetime, until: datetime) -> Dict[str, Any]:
    opportunity = compute_opportunity_score(db, store_id, since, until)
    return {
        "current_conversion_rate": opportunity["current_conversion_rate"],
        "store_best_period": {
            "conversion_rate": opportunity.get("potential_conversion_rate"),
            "period_start": opportunity.get("best_period_reference"),
        },
        "sector_average": None,
        "sector_average_note": "Non disponible — aucune donnée cross-boutique agrégée n'existe dans cette base ; jamais estimé.",
    }


# ─────────────────────────────────────────────────────────────────────────
# 10. Evolution History — daily conversion rate over the window, same
# per-day aggregation style as meta_ads.py's learning-history endpoint.
# ─────────────────────────────────────────────────────────────────────────

def compute_evolution_history(db: Session, store_id: str, since: datetime, until: datetime, granularity: str = "daily") -> List[Dict[str, Any]]:
    from app.models.marketing import MetaCapiLog

    rows = (
        db.query(func.date(MetaCapiLog.created_at), MetaCapiLog.event_name, func.count(func.distinct(MetaCapiLog.event_id)))
        .filter(MetaCapiLog.store_id == store_id, MetaCapiLog.event_name.in_(["PageView", "Purchase"]),
                MetaCapiLog.created_at >= since, MetaCapiLog.created_at <= until)
        .group_by(func.date(MetaCapiLog.created_at), MetaCapiLog.event_name)
        .all()
    )
    by_day: Dict[str, Dict[str, int]] = {}
    for d, event_name, count in rows:
        d_str = d.isoformat() if hasattr(d, "isoformat") else str(d)
        by_day.setdefault(d_str, {"PageView": 0, "Purchase": 0})[event_name] = count

    if granularity == "daily":
        buckets = {d: v for d, v in by_day.items()}
    else:
        buckets = {}
        for d_str, v in by_day.items():
            d = datetime.fromisoformat(d_str)
            key = d.strftime("%Y-W%W") if granularity == "weekly" else d.strftime("%Y-%m")
            bucket = buckets.setdefault(key, {"PageView": 0, "Purchase": 0})
            bucket["PageView"] += v["PageView"]
            bucket["Purchase"] += v["Purchase"]

    history = []
    for key in sorted(buckets.keys()):
        v = buckets[key]
        rate = round(v["Purchase"] / v["PageView"] * 100, 2) if v["PageView"] else None
        history.append({"period": key, "pageviews": v["PageView"], "purchases": v["Purchase"], "conversion_rate": rate})
    return history
