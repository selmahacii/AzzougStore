# ═══════════════════════════════════════════════════════════════
# AzzougShop — Stock Router (Refactored)
# Manual inventory operations: RESTOCK, MANUAL_ADJUSTMENT.
# ORDER_* movements are handled automatically by order_service.
# ═══════════════════════════════════════════════════════════════

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func as sqlfunc, case, and_, false as sql_false
from sqlalchemy.orm import Session, joinedload

from app.api import deps
from app.core.exceptions import (
    PermissionError,
    ProductNotFoundError,
    ValidationError,
)
from app.core.store_access import assert_store_access, user_accessible_store_ids
from app.db.session import get_db
from app.models.product import Product
from app.models.stock import StockMovement
from app.models.order import OrderItem
from app.models.user import User
from app.schemas.stock import (
    MovementPagination,
    StockMovementCreate,
    StockSummary,
)
from app.services.inventory_service import inventory_service

router = APIRouter()
logger = logging.getLogger("app.stock")

# Movement types that can be created manually via this endpoint
_MANUAL_TYPES = {"RESTOCK", "MANUAL_ADJUSTMENT"}


# ─── GET /stock/ — List movements ────────────────────────────────────────────

@router.get("/", response_model=MovementPagination)
def list_movements(
    store_id: Optional[str] = None,
    product_id: Optional[str] = None,
    movement_type: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    actor_id: Optional[str] = None,
    order_id: Optional[str] = None,
    batch_id: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """Paginated stock movement log, optionally filtered — powers the
    inventory 'Historique' / 'Timeline' views (traçabilité complète : qui,
    quand, depuis quelle commande, quel entrepôt)."""
    db.info["skip_tenant_isolation"] = True
    from app.core.dates import parse_local_date_filter

    query = db.query(StockMovement)
    product_joined = False

    if product_id:
        query = query.filter(StockMovement.product_id == product_id)
    if store_id:
        assert_store_access(current_user, store_id)
        query = query.join(Product).filter(Product.store_id == store_id)
        product_joined = True
    else:
        # Unscoped call — restrict to this user's accessible stores instead
        # of silently returning every store's movement ledger (a
        # confirmatrice/livreur has no business seeing another store's
        # stock history just by omitting store_id).
        accessible = user_accessible_store_ids(current_user)
        if accessible is not None:
            query = query.join(Product).filter(Product.store_id.in_(accessible)) if accessible else query.filter(sql_false())
            product_joined = True
    if search:
        if not product_joined:
            query = query.join(Product)
        like = f"%{search.strip()}%"
        query = query.filter(
            (Product.name.ilike(like))
            | (StockMovement.reason.ilike(like))
            | (StockMovement.batch_id.ilike(like))
        )
    if movement_type:
        query = query.filter(StockMovement.type == movement_type)
    if warehouse_id:
        query = query.filter(StockMovement.warehouse_id == warehouse_id)
    if actor_id:
        query = query.filter(StockMovement.actor_id == actor_id)
    if order_id:
        query = query.filter(StockMovement.order_id == order_id)
    if batch_id:
        query = query.filter(StockMovement.batch_id == batch_id)
    if date_from:
        try:
            query = query.filter(StockMovement.created_at >= parse_local_date_filter(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(StockMovement.created_at <= parse_local_date_filter(date_to))
        except ValueError:
            pass

    query = query.options(joinedload(StockMovement.actor))

    total = query.count()
    movements = (
        query
        .order_by(desc(StockMovement.created_at))
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all()
    )

    # Enrich with human-readable labels (order number, warehouse name,
    # product name) in 3 grouped lookups for the whole page — never a
    # query per row — so the UI never has to show a raw order_id/UUID.
    order_ids = {m.order_id for m in movements if m.order_id}
    warehouse_ids = {m.warehouse_id for m in movements if m.warehouse_id}
    product_ids = {m.product_id for m in movements if m.product_id}

    order_numbers = {}
    if order_ids:
        from app.models.order import Order
        order_numbers = dict(db.query(Order.id, Order.order_number).filter(Order.id.in_(order_ids)).all())

    warehouse_names = {}
    if warehouse_ids:
        from app.models.warehouse import Warehouse
        warehouse_names = dict(db.query(Warehouse.id, Warehouse.name).filter(Warehouse.id.in_(warehouse_ids)).all())

    product_names = {}
    if product_ids:
        product_names = dict(db.query(Product.id, Product.name).filter(Product.id.in_(product_ids)).all())

    for m in movements:
        m.order_number = order_numbers.get(m.order_id)
        m.warehouse_name = warehouse_names.get(m.warehouse_id)
        m.product_name = product_names.get(m.product_id)

    return {
        "success": True,
        "data": movements,
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "totalPages": (total + pageSize - 1) // pageSize,
    }


# ─── GET /stock/dashboard — ERP-style Surveillance dashboard ────────────────

@router.get("/dashboard", response_model=dict)
def get_stock_dashboard(
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Section "Surveillance" du centre de pilotage stock. Chaque chiffre est
    soit calculé depuis les colonnes réelles de Product/StockMovement, soit
    marqué explicitement `null` avec `tracked: false` quand la donnée
    n'existe structurellement pas encore (bloqué/endommagé/expiré/réception
    en attente — aucun type de mouvement ou statut dédié ne les distingue
    aujourd'hui d'un retour normal). Jamais de chiffre inventé.
    """
    from datetime import datetime, timedelta, timezone
    from app.models.order import Order

    db.info["skip_tenant_isolation"] = True
    assert_store_access(current_user, store_id)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    d7 = today_start - timedelta(days=7)
    d30 = today_start - timedelta(days=30)

    products = db.query(Product).filter(Product.store_id == store_id, Product.is_active == True).all()

    from app.services.inventory_service import product_stock_status

    stock_total = sum(p.stock or 0 for p in products)
    valeur_totale = sum((p.stock or 0) * (p.cost_price or 0) for p in products)
    reserved_total = sum(p.reserved_stock or 0 for p in products)
    disponible_total = sum(max(0, (p.stock or 0) - (p.reserved_stock or 0)) for p in products)
    # Single source of truth for the low-stock/out-of-stock/overstock
    # classification (product_stock_status, inventory_service.py) — this
    # used to compare raw Product.stock directly, ignoring reservations and
    # variants, while /stock/summary and /stock/alerts already used the
    # reservation- and variant-aware calculation below. Aligned so every
    # tab agrees on what "low stock" means for the same product.
    _statuses = [product_stock_status(p) for p in products]
    sans_stock = sum(1 for s in _statuses if s == "OUT")
    sous_seuil = sum(1 for s in _statuses if s == "LOW")
    surstock = sum(1 for s in _statuses if s == "OVERSTOCK")

    # ── Mouvements sur les 3 fenêtres (aujourd'hui/7j/30j) ──
    def _movement_totals(since):
        row = (
            db.query(
                sqlfunc.count(StockMovement.id),
                sqlfunc.coalesce(sqlfunc.sum(case((StockMovement.quantity > 0, StockMovement.quantity), else_=0)), 0),
                sqlfunc.coalesce(sqlfunc.sum(case((StockMovement.quantity < 0, -StockMovement.quantity), else_=0)), 0),
            )
            .join(Product, Product.id == StockMovement.product_id)
            .filter(Product.store_id == store_id, StockMovement.created_at >= since)
            .first()
        )
        return {"mouvements": int(row[0] or 0), "qty_entrees": int(row[1] or 0), "qty_sorties": int(row[2] or 0)}

    evolution = {"aujourd_hui": _movement_totals(today_start), "sept_jours": _movement_totals(d7), "trente_jours": _movement_totals(d30)}

    # ── Valeurs entrées/sorties/retours (30 derniers jours, coût produit actuel) ──
    value_rows = (
        db.query(StockMovement.type, StockMovement.quantity, Product.cost_price)
        .join(Product, Product.id == StockMovement.product_id)
        .filter(Product.store_id == store_id, StockMovement.created_at >= d30)
        .all()
    )
    valeur_entrees = sum(r.quantity * (r.cost_price or 0) for r in value_rows if r.quantity > 0)
    valeur_sorties = sum(-r.quantity * (r.cost_price or 0) for r in value_rows if r.quantity < 0 and r.type != "RETURN_RESTOCK")
    valeur_retours = sum(r.quantity * (r.cost_price or 0) for r in value_rows if r.type == "RETURN_RESTOCK")

    # ── Rotation moyenne : quantité sortie (vente) / stock moyen sur 30j ──
    qty_vendue_30j = sum(-r.quantity for r in value_rows if r.type == "ORDER_CONFIRM")
    rotation_moyenne = round(qty_vendue_30j / stock_total, 2) if stock_total > 0 else 0.0

    # ── Retournés / réintégrés aujourd'hui (même mouvement, deux angles) ──
    retournes_today = (
        db.query(sqlfunc.count(sqlfunc.distinct(StockMovement.order_id)))
        .join(Product, Product.id == StockMovement.product_id)
        .filter(Product.store_id == store_id, StockMovement.type == "RETURN_RESTOCK", StockMovement.created_at >= today_start)
        .scalar() or 0
    )

    # ── Widgets top produits ──
    def _top_by_type(mv_type, limit=5, positive=False):
        q = (
            db.query(Product.id, Product.name, sqlfunc.sum(sqlfunc.abs(StockMovement.quantity)).label("qty"))
            .join(StockMovement, StockMovement.product_id == Product.id)
            .filter(Product.store_id == store_id, StockMovement.type == mv_type, StockMovement.created_at >= d30)
            .group_by(Product.id, Product.name)
            .order_by(sqlfunc.sum(sqlfunc.abs(StockMovement.quantity)).desc())
            .limit(limit)
            .all()
        )
        return [{"product_id": r[0], "product_name": r[1], "quantity": int(r[2])} for r in q]

    top_vendus = _top_by_type("ORDER_CONFIRM")
    top_retournes = _top_by_type("RETURN_RESTOCK")

    # Annulés = commandes CANCELLED (par produit), pas un StockMovement dédié
    top_annules = [
        {"product_id": r[0], "product_name": r[1], "quantity": int(r[2])}
        for r in (
            db.query(Product.id, Product.name, sqlfunc.count(OrderItem.id).label("cnt"))
            .join(OrderItem, OrderItem.product_id == Product.id)
            .join(Order, Order.id == OrderItem.order_id)
            .filter(Product.store_id == store_id, Order.status == "CANCELLED", Order.created_at >= d30)
            .group_by(Product.id, Product.name)
            .order_by(sqlfunc.count(OrderItem.id).desc())
            .limit(5)
            .all()
        )
    ]

    # Récupérés = commandes issues d'un panier abandonné qui ont abouti
    top_recuperes = [
        {"product_id": r[0], "product_name": r[1], "quantity": int(r[2])}
        for r in (
            db.query(Product.id, Product.name, sqlfunc.count(OrderItem.id).label("cnt"))
            .join(OrderItem, OrderItem.product_id == Product.id)
            .join(Order, Order.id == OrderItem.order_id)
            .filter(Product.store_id == store_id, Order.recovered_at.isnot(None), Order.created_at >= d30)
            .group_by(Product.id, Product.name)
            .order_by(sqlfunc.count(OrderItem.id).desc())
            .limit(5)
            .all()
        )
    ]

    # Sans mouvement depuis 30j (produits actifs, aucune ligne StockMovement récente)
    moved_ids = {
        r[0] for r in db.query(sqlfunc.distinct(StockMovement.product_id))
        .join(Product, Product.id == StockMovement.product_id)
        .filter(Product.store_id == store_id, StockMovement.created_at >= d30).all()
    }
    top_sans_mouvement = [
        {"product_id": p.id, "product_name": p.name, "quantity": p.stock or 0}
        for p in products if p.id not in moved_ids
    ][:10]

    # À réapprovisionner : sous le seuil (LOW ou OUT), triés par urgence (stock le plus bas)
    top_a_reappro = sorted(
        [{"product_id": p.id, "product_name": p.name, "quantity": p.stock or 0, "seuil": p.low_stock_threshold or 5}
         for p, s in zip(products, _statuses) if s in ("LOW", "OUT")],
        key=lambda x: x["quantity"],
    )[:10]

    # ── Graphique : entrées/sorties/retours par jour (30j) ──
    day = sqlfunc.date(StockMovement.created_at)
    chart_rows = (
        db.query(
            day.label("day"),
            sqlfunc.coalesce(sqlfunc.sum(case((StockMovement.quantity > 0, StockMovement.quantity), else_=0)), 0).label("entrees"),
            sqlfunc.coalesce(sqlfunc.sum(case((and_(StockMovement.quantity < 0, StockMovement.type != "RETURN_RESTOCK"), -StockMovement.quantity), else_=0)), 0).label("sorties"),
            sqlfunc.coalesce(sqlfunc.sum(case((StockMovement.type == "RETURN_RESTOCK", StockMovement.quantity), else_=0)), 0).label("retours"),
        )
        .join(Product, Product.id == StockMovement.product_id)
        .filter(Product.store_id == store_id, StockMovement.created_at >= d30)
        .group_by(day)
        .order_by(day)
        .all()
    )
    chart = [{"day": str(r.day), "entrees": int(r.entrees), "sorties": int(r.sorties), "retours": int(r.retours)} for r in chart_rows]

    return {
        "success": True,
        "data": {
            "kpis": {
                "stock_total": stock_total,
                "valeur_totale": valeur_totale,
                "produits_actifs": len(products),
                "sans_stock": sans_stock,
                "sous_seuil": sous_seuil,
                "surstock": surstock,
                "reserves": reserved_total,
                "disponible": disponible_total,
                "retournes_aujourd_hui": retournes_today,
                "reintegres_aujourd_hui": retournes_today,
                # Non trackés structurellement — pas de type de mouvement ou
                # de statut dédié aujourd'hui. Affichés explicitement plutôt
                # que masqués, pour que l'écart avec le cahier des charges
                # reste visible et honnête.
                "bloques": {"value": None, "tracked": False},
                "endommages": {"value": None, "tracked": False},
                "expires": {"value": None, "tracked": False},
                "en_attente_reception": {"value": None, "tracked": False},
            },
            "evolution": evolution,
            "rotation_moyenne": rotation_moyenne,
            "valeur_entrees_30j": valeur_entrees,
            "valeur_sorties_30j": valeur_sorties,
            "valeur_retours_30j": valeur_retours,
            "valeur_pertes_30j": {"value": None, "tracked": False},
            "widgets": {
                "top_vendus": top_vendus,
                "top_retournes": top_retournes,
                "top_annules": top_annules,
                "top_recuperes": top_recuperes,
                "top_sans_mouvement": top_sans_mouvement,
                "top_a_reapprovisionner": top_a_reappro,
            },
            "chart_30j": chart,
        },
    }


# ─── GET /stock/livreurs — per-courier inventory comparison ─────────────────

@router.get("/livreurs", response_model=dict)
def get_livreur_inventory(
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Section "Inventaire des livreurs". AzzougShop's livreurs are internal
    users assigned to an order (Order.livreur_id), not a separate stock
    ledger — there is no dedicated "stock handed to courier" movement type
    yet (that's a real gap, flagged below rather than faked). So this is
    built honestly from what IS provable: orders currently assigned to each
    livreur (stock physically in their possession right now), delivered
    (sold), and returned — each a single grouped query, no N+1.
    """
    from app.models.order import Order

    db.info["skip_tenant_isolation"] = True
    assert_store_access(current_user, store_id)

    _IN_HAND = ["ASSIGNED", "CALLED", "IN_PROGRESS", "RESCHEDULED", "CONFIRMED", "SHIPPED"]

    rows = (
        db.query(
            User.id, User.name,
            sqlfunc.count(sqlfunc.distinct(Order.id)).label("total_orders"),
            sqlfunc.coalesce(sqlfunc.sum(case((Order.status.in_(_IN_HAND), 1), else_=0)), 0).label("in_hand"),
            sqlfunc.coalesce(sqlfunc.sum(case((Order.status == "DELIVERED", 1), else_=0)), 0).label("delivered"),
            sqlfunc.coalesce(sqlfunc.sum(case((Order.status == "RETURNED", 1), else_=0)), 0).label("returned"),
            sqlfunc.coalesce(sqlfunc.sum(case((Order.status.in_(_IN_HAND), Order.total), else_=0)), 0).label("value_in_hand"),
            sqlfunc.coalesce(sqlfunc.sum(case((Order.status == "DELIVERED", Order.total), else_=0)), 0).label("value_delivered"),
            sqlfunc.coalesce(sqlfunc.sum(case((Order.status == "RETURNED", Order.total), else_=0)), 0).label("value_returned"),
        )
        .join(Order, Order.livreur_id == User.id)
        .filter(Order.store_id == store_id, Order.is_deleted == False)
        .group_by(User.id, User.name)
        .order_by(sqlfunc.count(sqlfunc.distinct(Order.id)).desc())
        .all()
    )

    return {
        "success": True,
        "data": [
            {
                "livreur_id": r[0], "name": r[1],
                "total_orders": int(r[2]), "stock_en_main": int(r[3]),
                "stock_vendu": int(r[4]), "stock_retourne": int(r[5]),
                "valeur_en_main": float(r[6]), "valeur_vendue": float(r[7]), "valeur_retournee": float(r[8]),
                # Honest placeholders: no movement type distinguishes casse/perte
                # from a normal return today, so these are not computable —
                # showing a fabricated number would be worse than admitting the gap.
                "produits_perdus": None, "produits_casses": None,
            }
            for r in rows
        ],
        "note": "Casse/perte non trackées séparément — aucun type de mouvement dédié n'existe encore pour les distinguer d'un retour normal.",
    }


# ─── GET /stock/discrepancies — automated anomaly detection ────────────────

@router.get("/discrepancies", response_model=dict)
def get_stock_discrepancies(
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Section "Analyse des écarts". Every check below is a provable SQL
    signature (existence/non-existence of a movement row), the same pattern
    already used by /orders/returns/audit — never a heuristic guess.
    """
    from sqlalchemy import exists as sa_exists
    from app.models.order import Order

    db.info["skip_tenant_isolation"] = True
    assert_store_access(current_user, store_id)

    findings = []

    # 1. Stock négatif — jamais censé arriver, signe d'une race condition
    #    ou d'un ajustement manuel erroné.
    negative = (
        db.query(Product.id, Product.name, Product.stock)
        .filter(Product.store_id == store_id, Product.stock < 0)
        .limit(50).all()
    )
    for p in negative:
        findings.append({"type": "STOCK_NEGATIF", "severity": "high", "product_id": p.id, "product_name": p.name, "detail": f"Stock = {p.stock}"})

    # 2. Commande livrée sans sortie de stock (aucun mouvement ORDER_CONFIRM)
    confirm_exists = sa_exists().where(StockMovement.order_id == Order.id, StockMovement.type == "ORDER_CONFIRM")
    delivered_no_exit = (
        db.query(Order.id, Order.order_number)
        .filter(Order.store_id == store_id, Order.status == "DELIVERED", Order.is_deleted == False, ~confirm_exists)
        .limit(50).all()
    )
    for o in delivered_no_exit:
        findings.append({"type": "LIVREE_SANS_SORTIE_STOCK", "severity": "high", "order_id": o.id, "order_number": o.order_number, "detail": "Livrée sans mouvement ORDER_CONFIRM"})

    # 3. Commande retournée sans réintégration (même signature que /orders/returns/audit)
    restock_exists = sa_exists().where(StockMovement.order_id == Order.id, StockMovement.type == "RETURN_RESTOCK")
    returned_no_restock = (
        db.query(Order.id, Order.order_number)
        .filter(Order.store_id == store_id, Order.status == "RETURNED", Order.is_deleted == False, confirm_exists, ~restock_exists)
        .limit(50).all()
    )
    for o in returned_no_restock:
        findings.append({"type": "RETOUR_SANS_REINTEGRATION", "severity": "high", "order_id": o.id, "order_number": o.order_number, "detail": "Retournée mais jamais réintégrée en stock"})

    # 4. Retour de stock sans commande associée (order_id NULL sur un RETURN_RESTOCK)
    orphan_restock = (
        db.query(sqlfunc.count(StockMovement.id))
        .join(Product, Product.id == StockMovement.product_id)
        .filter(Product.store_id == store_id, StockMovement.type == "RETURN_RESTOCK", StockMovement.order_id.is_(None))
        .scalar() or 0
    )
    if orphan_restock > 0:
        findings.append({"type": "REINTEGRATION_SANS_COMMANDE", "severity": "medium", "detail": f"{orphan_restock} mouvement(s) RETURN_RESTOCK sans commande liée"})

    # 5. Double confirmation — plus d'un ORDER_CONFIRM pour la même commande
    #    (signature exacte d'une double déduction de stock pour un seul achat)
    dup_confirms = (
        db.query(StockMovement.order_id, sqlfunc.count(StockMovement.id).label("cnt"))
        .join(Product, Product.id == StockMovement.product_id)
        .filter(Product.store_id == store_id, StockMovement.type == "ORDER_CONFIRM", StockMovement.order_id.isnot(None))
        .group_by(StockMovement.order_id, StockMovement.product_id)
        .having(sqlfunc.count(StockMovement.id) > 1)
        .limit(50).all()
    )
    order_ids_dup = list({r[0] for r in dup_confirms})
    dup_numbers = {}
    if order_ids_dup:
        dup_numbers = dict(db.query(Order.id, Order.order_number).filter(Order.id.in_(order_ids_dup)).all())
    for r in dup_confirms:
        findings.append({"type": "DOUBLE_MOUVEMENT", "severity": "high", "order_id": r[0], "order_number": dup_numbers.get(r[0]), "detail": f"{r[1]} sorties ORDER_CONFIRM pour la même commande/produit"})

    # 6. Produit orphelin — mouvement référençant un produit qui n'existe plus
    orphan_products = (
        db.query(sqlfunc.count(StockMovement.id))
        .filter(~sa_exists().where(Product.id == StockMovement.product_id))
        .scalar() or 0
    )
    if orphan_products > 0:
        findings.append({"type": "PRODUIT_ORPHELIN", "severity": "medium", "detail": f"{orphan_products} mouvement(s) référencent un produit supprimé"})

    return {
        "success": True,
        "data": findings,
        "total": len(findings),
        "high_severity": len([f for f in findings if f["severity"] == "high"]),
    }


# ─── GET /stock/lots — Section 4 "Suivi des lots" ───────────────────────────
# Aucun modèle Lot dédié n'existe — batch_id/expiration_date sont déjà des
# colonnes de StockMovement (réutilisées, pas de migration). Un "lot" est
# donc l'ensemble des mouvements partageant le même batch_id.

@router.get("/lots", response_model=dict)
def list_lots(
    store_id: str,
    product_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    db.info["skip_tenant_isolation"] = True
    assert_store_access(current_user, store_id)

    rows = (
        db.query(
            StockMovement.batch_id,
            StockMovement.product_id,
            Product.name,
            sqlfunc.min(StockMovement.expiration_date).label("expiration_date"),
            sqlfunc.coalesce(sqlfunc.sum(StockMovement.quantity), 0).label("balance"),
            sqlfunc.count(StockMovement.id).label("movements"),
            sqlfunc.min(StockMovement.created_at).label("received_at"),
            sqlfunc.max(StockMovement.warehouse_id).label("warehouse_id"),
        )
        .join(Product, Product.id == StockMovement.product_id)
        .filter(Product.store_id == store_id, StockMovement.batch_id.isnot(None))
        .group_by(StockMovement.batch_id, StockMovement.product_id, Product.name)
    )
    if product_id:
        rows = rows.filter(StockMovement.product_id == product_id)
    rows = rows.order_by(sqlfunc.min(StockMovement.created_at).desc()).limit(200).all()

    warehouse_ids = {r.warehouse_id for r in rows if r.warehouse_id}
    warehouse_names = {}
    if warehouse_ids:
        from app.models.warehouse import Warehouse
        warehouse_names = dict(db.query(Warehouse.id, Warehouse.name).filter(Warehouse.id.in_(warehouse_ids)).all())

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    data = []
    for r in rows:
        etat = "actif"
        if r.balance <= 0:
            etat = "épuisé"
        elif r.expiration_date:
            try:
                exp = datetime.fromisoformat(r.expiration_date).replace(tzinfo=timezone.utc)
                if exp < now:
                    etat = "expiré"
                elif (exp - now).days <= 7:
                    etat = "expire bientôt"
            except (ValueError, TypeError):
                pass
        data.append({
            "batch_id": r.batch_id, "product_id": r.product_id, "product_name": r.name,
            "expiration_date": r.expiration_date, "balance": max(0, int(r.balance)),
            "movements": int(r.movements), "received_at": r.received_at.isoformat() if r.received_at else None,
            "warehouse_name": warehouse_names.get(r.warehouse_id), "etat": etat,
            # Non tracké : le lot n'a pas de lien direct vers son
            # fournisseur/commande d'achat d'origine (batch_id est saisi
            # librement lors d'un réappro, PurchaseItem n'a pas de batch_id).
            "fournisseur": {"value": None, "tracked": False},
            "commande_fournisseur": {"value": None, "tracked": False},
        })

    return {"success": True, "data": data}


@router.get("/lots/{batch_id}/history", response_model=dict)
def get_lot_history(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """Historique complet d'un lot + toutes les commandes clients qui l'ont utilisé."""
    from app.models.order import Order

    movements = (
        db.query(StockMovement)
        .options(joinedload(StockMovement.actor))
        .filter(StockMovement.batch_id == batch_id)
        .order_by(StockMovement.created_at.asc())
        .all()
    )
    order_ids = {m.order_id for m in movements if m.order_id}
    orders = {}
    if order_ids:
        orders = dict(db.query(Order.id, Order.order_number).filter(Order.id.in_(order_ids)).all())

    return {
        "success": True,
        "data": {
            "movements": [
                {
                    "id": m.id, "type": m.type, "quantity": m.quantity, "reason": m.reason,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                    "actor": m.actor.name if m.actor else None,
                    "order_number": orders.get(m.order_id),
                }
                for m in movements
            ],
            "orders_using_this_lot": sorted(set(orders.values())),
        },
    }


# ─── GET /stock/alerts-engine — Section 5 "Alertes" moteur intelligent ─────
# Distinct de /stock/alerts (liste simple sous-seuil, existant) : ici chaque
# ligne porte priorité + action recommandée + horodatage, couvrant tous les
# types demandés que les données permettent de calculer honnêtement.

@router.get("/alerts-engine", response_model=dict)
def get_alerts_engine(
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    from datetime import datetime, timedelta, timezone
    from app.models.order import Order

    db.info["skip_tenant_isolation"] = True
    assert_store_access(current_user, store_id)
    now = datetime.now(timezone.utc)
    d30 = now.replace(tzinfo=None) - timedelta(days=30)

    from app.services.inventory_service import product_stock_status

    products = db.query(Product).filter(Product.store_id == store_id, Product.is_active == True).all()
    alerts = []

    # Stock faible / rupture — see product_stock_status (inventory_service.py)
    # for why this must be the shared classification, not a re-derived one.
    for p in products:
        status = product_stock_status(p)
        if status == "OUT":
            alerts.append({"type": "STOCK_FAIBLE", "priority": "high", "product_id": p.id, "product_name": p.name,
                            "detail": "Rupture de stock", "action": "Réapprovisionner en urgence"})
        elif status == "LOW":
            alerts.append({"type": "STOCK_FAIBLE", "priority": "medium", "product_id": p.id, "product_name": p.name,
                            "detail": f"Stock = {p.stock} (seuil {p.low_stock_threshold or 5})", "action": "Planifier un réapprovisionnement"})
        elif status == "OVERSTOCK":
            alerts.append({"type": "SURSTOCK", "priority": "low", "product_id": p.id, "product_name": p.name,
                            "detail": f"Stock = {p.stock}, très au-dessus du seuil habituel", "action": "Vérifier la rotation, envisager une promotion"})

    # Aucun mouvement depuis 30j
    moved_ids = {
        r[0] for r in db.query(sqlfunc.distinct(StockMovement.product_id))
        .join(Product, Product.id == StockMovement.product_id)
        .filter(Product.store_id == store_id, StockMovement.created_at >= d30).all()
    }
    for p in products:
        if p.id not in moved_ids and (p.stock or 0) > 0:
            alerts.append({"type": "AUCUN_MOUVEMENT", "priority": "low", "product_id": p.id, "product_name": p.name,
                            "detail": "Aucun mouvement depuis 30 jours", "action": "Vérifier si le produit est toujours en vente"})

    # Expiration (lots)
    expiring = (
        db.query(StockMovement.batch_id, StockMovement.product_id, Product.name, sqlfunc.min(StockMovement.expiration_date))
        .join(Product, Product.id == StockMovement.product_id)
        .filter(Product.store_id == store_id, StockMovement.batch_id.isnot(None), StockMovement.expiration_date.isnot(None))
        .group_by(StockMovement.batch_id, StockMovement.product_id, Product.name)
        .all()
    )
    for batch_id, pid, pname, exp_str in expiring:
        try:
            exp = datetime.fromisoformat(exp_str)
            days_left = (exp.replace(tzinfo=None) - now.replace(tzinfo=None)).days
            if days_left <= 7:
                alerts.append({"type": "EXPIRATION", "priority": "high" if days_left <= 0 else "medium",
                                "product_id": pid, "product_name": pname, "batch_id": batch_id,
                                "detail": f"Lot {batch_id[:8]} expire dans {days_left}j" if days_left >= 0 else f"Lot {batch_id[:8]} expiré depuis {-days_left}j",
                                "action": "Écouler en priorité ou retirer du stock"})
        except (ValueError, TypeError):
            pass

    # Taux de retour élevé + annulations élevées, par produit (30j)
    return_counts = dict(
        db.query(StockMovement.product_id, sqlfunc.count(StockMovement.id))
        .join(Product, Product.id == StockMovement.product_id)
        .filter(Product.store_id == store_id, StockMovement.type == "RETURN_RESTOCK", StockMovement.created_at >= d30)
        .group_by(StockMovement.product_id).all()
    )
    sold_counts = dict(
        db.query(StockMovement.product_id, sqlfunc.count(StockMovement.id))
        .join(Product, Product.id == StockMovement.product_id)
        .filter(Product.store_id == store_id, StockMovement.type == "ORDER_CONFIRM", StockMovement.created_at >= d30)
        .group_by(StockMovement.product_id).all()
    )
    pname_by_id = {p.id: p.name for p in products}
    for pid, returns in return_counts.items():
        sold = sold_counts.get(pid, 0)
        if sold >= 5:
            rate = returns / sold * 100
            if rate >= 30:
                alerts.append({"type": "TAUX_RETOUR_ELEVE", "priority": "high" if rate >= 50 else "medium",
                                "product_id": pid, "product_name": pname_by_id.get(pid, pid),
                                "detail": f"Taux de retour {rate:.0f}% ({returns}/{sold} ventes, 30j)",
                                "action": "Investiguer la cause (qualité, description, taille)"})

    cancel_rows = (
        db.query(Product.id, Product.name, sqlfunc.count(OrderItem.id))
        .join(OrderItem, OrderItem.product_id == Product.id)
        .join(Order, Order.id == OrderItem.order_id)
        .filter(Product.store_id == store_id, Order.status == "CANCELLED", Order.created_at >= d30)
        .group_by(Product.id, Product.name)
        .having(sqlfunc.count(OrderItem.id) >= 5)
        .all()
    )
    for pid, pname, cnt in cancel_rows:
        alerts.append({"type": "ANNULATIONS_ELEVEES", "priority": "medium", "product_id": pid, "product_name": pname,
                        "detail": f"{cnt} commande(s) annulée(s) en 30j", "action": "Vérifier disponibilité réelle / description produit"})

    # Erreurs / différences d'inventaire — réutilise la détection d'écarts
    discrepancies = get_stock_discrepancies(store_id=store_id, db=db, current_user=current_user)
    for f in discrepancies["data"]:
        alerts.append({"type": f["type"], "priority": "high" if f["severity"] == "high" else "medium",
                        "product_id": f.get("product_id"), "product_name": f.get("product_name"),
                        "order_id": f.get("order_id"), "order_number": f.get("order_number"),
                        "detail": f["detail"], "action": "Corriger via la section Écarts"})

    priority_order = {"high": 0, "medium": 1, "low": 2}
    alerts.sort(key=lambda a: priority_order.get(a["priority"], 3))

    return {
        "success": True,
        "data": alerts,
        "total": len(alerts),
        "by_priority": {
            "high": len([a for a in alerts if a["priority"] == "high"]),
            "medium": len([a for a in alerts if a["priority"] == "medium"]),
            "low": len([a for a in alerts if a["priority"] == "low"]),
        },
    }


# ─── GET /stock/product/{id}/breakdown — Section 3 "Gestion Stock" enrichie ─

@router.get("/returns-by-variant", response_model=dict)
def get_returns_by_variant(
    store_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Réapprovisionnement issu des RETOURS (RETURN_RESTOCK), ventilé PAR
    VARIANTE pour chaque produit de la boutique — pas seulement le total
    produit (déjà couvert par stock_retourne dans /product/{id}/breakdown).
    Sert l'indicateur "combien de retours par variante" de l'inventaire.

    variant_details n'est pas une colonne structurée sur StockMovement —
    inventory_service.return_restock encode systématiquement le nom de la
    variante à la fin du texte `reason`, au format "... (VariantName)" (ou
    "... (Général)" pour un produit sans variantes) ; on le réextrait ici
    plutôt que d'ajouter une migration pour un besoin d'affichage seul.
    One query for the whole store — the frontend calls this once and
    matches product_id + variant string locally, instead of one request
    per product row.
    """
    db.info["skip_tenant_isolation"] = True
    assert_store_access(current_user, store_id)

    import re
    rows = (
        db.query(StockMovement.product_id, StockMovement.quantity, StockMovement.reason)
        .join(Product, Product.id == StockMovement.product_id)
        .filter(Product.store_id == store_id, StockMovement.type == "RETURN_RESTOCK")
        .all()
    )
    _variant_re = re.compile(r"\(([^()]*)\)\s*$")
    by_product: dict = {}
    for product_id, quantity, reason in rows:
        variant_name = "Général"
        if reason:
            m = _variant_re.search(reason)
            if m and m.group(1):
                variant_name = m.group(1)
        bucket = by_product.setdefault(product_id, {})
        bucket[variant_name] = bucket.get(variant_name, 0) + (quantity or 0)
    return {"success": True, "data": by_product}


@router.get("/product/{product_id}/breakdown", response_model=dict)
def get_product_stock_breakdown(
    product_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Toutes les quantités demandées pour un produit — calculées, jamais
    stockées en double. Ce qui n'a structurellement aucune source de
    données (stock max/sécurité/moyen, FIFO/LIFO, stock fournisseur) est
    renvoyé avec tracked=false plutôt qu'une valeur inventée.
    """
    from app.models.purchase import PurchaseItem, Purchase

    db.info["skip_tenant_isolation"] = True
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    assert_store_access(current_user, p.store_id)

    physique = p.stock or 0
    reserve = p.reserved_stock or 0
    disponible = max(0, physique - reserve)

    en_commande = (
        db.query(sqlfunc.coalesce(sqlfunc.sum(PurchaseItem.quantity - PurchaseItem.received_quantity), 0))
        .join(Purchase, Purchase.id == PurchaseItem.purchase_id)
        .filter(PurchaseItem.product_id == product_id, Purchase.reception_status != "RECEIVED")
        .scalar() or 0
    )

    retourne = db.query(sqlfunc.coalesce(sqlfunc.sum(StockMovement.quantity), 0)).filter(
        StockMovement.product_id == product_id, StockMovement.type == "RETURN_RESTOCK"
    ).scalar() or 0

    en_transfert = db.query(sqlfunc.coalesce(sqlfunc.sum(sqlfunc.abs(StockMovement.quantity)), 0)).filter(
        StockMovement.product_id == product_id, StockMovement.type.in_(("TRANSFER_OUT", "TRANSFER_IN")),
    ).scalar() or 0

    from datetime import datetime, timedelta, timezone
    d30 = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
    qty_vendue_30j = db.query(sqlfunc.coalesce(sqlfunc.sum(-StockMovement.quantity), 0)).filter(
        StockMovement.product_id == product_id, StockMovement.type == "ORDER_CONFIRM", StockMovement.created_at >= d30,
    ).scalar() or 0
    rotation = round(int(qty_vendue_30j) / physique, 2) if physique > 0 else 0.0

    return {
        "success": True,
        "data": {
            "product_id": p.id, "product_name": p.name,
            "stock_physique": physique,
            "stock_reserve": reserve,
            "stock_disponible": disponible,
            "stock_en_commande": int(en_commande),
            "stock_retourne": int(retourne),
            "stock_en_transfert": int(en_transfert),
            "stock_minimum": p.low_stock_threshold or 5,
            "valeur": physique * (p.cost_price or 0),
            "cout_moyen": p.cost_price or 0,
            "dernier_cout": p.cost_price or 0,
            "rotation_30j": rotation,
            # Structurellement non trackés — nécessitent soit une nouvelle
            # colonne (max/sécurité), soit un historique de niveau de stock
            # dans le temps (moyen), soit une distinction lot-par-lot du
            # coût d'achat (FIFO/LIFO) qui n'existe pas aujourd'hui.
            "stock_maximum": {"value": None, "tracked": False},
            "stock_securite": {"value": None, "tracked": False},
            "stock_moyen": {"value": None, "tracked": False},
            "stock_fournisseur": {"value": None, "tracked": False},
            "stock_casse": {"value": None, "tracked": False},
            "stock_perdu": {"value": None, "tracked": False},
            "stock_expire": {"value": None, "tracked": False},
            "stock_bloque": {"value": None, "tracked": False},
            "fifo_lifo": {"value": None, "tracked": False},
        },
    }


# ─── GET /stock/summary ───────────────────────────────────────────────────────

@router.get("/summary", response_model=dict)
def get_stock_summary(
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Aggregate stock KPIs for a store:
    - Total active products
    - Total stock value (cost_price × available units)
    - Low-stock count (0 < stock <= low_stock_threshold)
    - Out-of-stock count (stock <= 0)
    - Total available units (stock - reserved_stock)
    """
    db.info["skip_tenant_isolation"] = True
    assert_store_access(current_user, store_id)

    logger.info(f"Fetching stock summary for store_id: {store_id}")

    products = (
        db.query(Product)
        .filter(Product.store_id == store_id, Product.is_active == True)
        .all()
    )
    logger.info(f"Active products found for summary: {len(products)}")

    from app.services.inventory_service import product_stock_status

    total_value = 0
    low_stock = 0
    out_of_stock = 0
    total_available = 0

    for p in products:
        available = max(0, (p.stock if p.stock is not None else 0) - (p.reserved_stock if p.reserved_stock is not None else 0))
        total_available += available
        total_value += available * (p.cost_price or 0)

        status = product_stock_status(p)
        if status == "OUT":
            out_of_stock += 1
        elif status == "LOW":
            low_stock += 1

    return {
        "success": True,
        "data": {
            "totalProducts": len(products),
            "totalStockValue": total_value,
            "lowStockCount": low_stock,
            "outOfStockCount": out_of_stock,
            "totalAvailableStock": total_available,
        },
    }


# ─── GET /stock/alerts ────────────────────────────────────────────────────────

@router.get("/alerts", response_model=dict)
def get_stock_alerts(
    store_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """Return products that are at or below their low_stock_threshold, considering variant stocks."""
    db.info["skip_tenant_isolation"] = True
    from app.services.inventory_service import product_available_stock, product_stock_status

    query = db.query(Product).filter(Product.is_active == True)
    if store_id:
        assert_store_access(current_user, store_id)
        query = query.filter(Product.store_id == store_id)
    else:
        # No store specified — scope to whatever this user may see instead
        # of silently returning every store's alerts. Admins are
        # unrestricted (accessible=None) by design.
        accessible = user_accessible_store_ids(current_user)
        if accessible is not None:
            query = query.filter(Product.store_id.in_(accessible)) if accessible else query.filter(sql_false())

    products = query.all()
    threshold = lambda p: p.low_stock_threshold if p.low_stock_threshold is not None else 5

    alerts = []
    for p in products:
        if product_stock_status(p) in ("OUT", "LOW"):
            alerts.append((p, product_available_stock(p)))

    # Sort by lowest stock
    alerts_sorted = sorted(alerts, key=lambda item: item[1])

    data = [
        {
            "id": str(p.id),
            "name": p.name if not p.variants else f"{p.name} (Variantes)",
            "stock": lowest_stock,
            "low_stock_threshold": threshold(p),
            "main_image": p.main_image,
            "sku": p.sku,
            "store_id": str(p.store_id) if p.store_id else None,
        }
        for p, lowest_stock in alerts_sorted
    ]

    return {"success": True, "data": data, "total": len(data)}


# ─── POST /stock/ — Manual movement ──────────────────────────────────────────

@router.post("/", response_model=dict, status_code=201)
def create_movement(
    movement: StockMovementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Create a manual stock movement (RESTOCK or MANUAL_ADJUSTMENT).

    ORDER_* movements are NOT accepted here — they are created automatically
    by order_service during order status transitions.

    RESTOCK: quantity must be > 0.
    MANUAL_ADJUSTMENT: quantity can be negative (shrinkage, loss).
    """
    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER", "LIVREUR", "CONFIRMATEUR"):
        raise PermissionError(message="Seul un gestionnaire peut effectuer des ajustements de stock.")

    if movement.type not in _MANUAL_TYPES:
        raise ValidationError(
            message=f"Type de mouvement manuel invalide: '{movement.type}'. "
                    f"Autorisés: {', '.join(_MANUAL_TYPES)}. "
                    f"Les mouvements ORDER_* sont gérés automatiquement."
        )

    # This endpoint enforces store ownership itself (the LIVREUR / CONFIRMATEUR
    # scope checks below), so bypass the SELECT tenant auto-filter for the
    # product lookup. Otherwise the product is hidden (→ 404 "produit
    # introuvable") whenever the request's X-Store-Id header doesn't happen to
    # match the product's store — which silently stopped a livreur from
    # restocking their own store's products.
    db.info["skip_tenant_isolation"] = True

    # Validate product belongs to specified store
    product = db.query(Product).filter(Product.id == movement.product_id).first()
    if not product:
        raise ProductNotFoundError()
    if movement.store_id and product.store_id != movement.store_id:
        raise PermissionError(message="Le produit n'appartient pas à la boutique spécifiée.")

    # Store-scoped employees only manage stock for stores they're actually
    # scoped to. LIVREUR is single-store (employee_store_id). CONFIRMATEUR
    # uses assigned_store_scope/assigned_store_ids instead — the same fields
    # orders.py's RBAC scoping already checks — a confirmatrice managing
    # several stores has assigned_store_scope="SPECIFIC" with her stores in
    # assigned_store_ids, while employee_store_id may be unset or only her
    # primary store; checking employee_store_id alone wrongly 403'd her for
    # every other store she's legitimately assigned to.
    # LIVREUR has cross-store parity here (one delivery agent serves every
    # store in this deployment and must be able to restock any of them — see
    # the livreur dashboard's "full visibility" design). CONFIRMATEUR stays
    # limited to the stores explicitly assigned to them.
    if current_user.role == "CONFIRMATEUR":
        scope = getattr(current_user, "assigned_store_scope", "ALL")
        if scope == "SPECIFIC":
            raw_stores = getattr(current_user, "assigned_store_ids", None)
            scoped_stores = raw_stores if isinstance(raw_stores, list) else []
            if str(product.store_id) not in {str(s) for s in scoped_stores}:
                raise PermissionError(message="Vous ne pouvez ajuster le stock que des boutiques qui vous sont assignées.")

    stock_before = product.stock or 0

    try:
        if movement.type == "RESTOCK":
            if movement.quantity <= 0:
                raise ValidationError(message="La quantité de réapprovisionnement doit être positive.")
            inventory_service.restock(
                db,
                product_id=movement.product_id,
                quantity=movement.quantity,
                actor_id=current_user.id,
                warehouse_id=movement.warehouse_id,
                reason=movement.reason,
                variant_details=movement.variant_details,
            )
        elif movement.type == "MANUAL_ADJUSTMENT":
            inventory_service.manual_adjustment(
                db,
                product_id=movement.product_id,
                quantity=movement.quantity,
                actor_id=current_user.id,
                reason=movement.reason or "Ajustement manuel",
                variant_details=movement.variant_details,
            )

        # Central audit trail (same journal as stores/payroll/landing pages),
        # in addition to the StockMovement row created by inventory_service.
        from app.services.audit_service import audit_service
        audit_service.record_change(
            db,
            actor_id=current_user.id,
            entity_name="stock",
            entity_id=movement.product_id,
            action=movement.type,
            before={"stock": stock_before},
            after={"stock": product.stock, "reason": movement.reason},
        )

        db.commit()
        db.refresh(product)

        logger.info(
            "Manual stock movement: product=%s type=%s qty=%+d actor=%s",
            movement.product_id, movement.type, movement.quantity, current_user.id,
        )

        return {
            "success": True,
            "data": {
                "id": product.id,
                "stock": product.stock,
                "reserved_stock": product.reserved_stock,
                "available_stock": max(0, product.stock - product.reserved_stock),
            },
        }
    except Exception as e:
        db.rollback()
        logger.error("Error executing manual stock movement: %s", e, exc_info=True)
        from fastapi import HTTPException
        from app.core.exceptions import InsufficientStockError
        if isinstance(e, (InsufficientStockError, ValidationError, ProductNotFoundError, PermissionError)):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))
