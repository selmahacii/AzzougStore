from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import List, Optional
from app.db.session import get_db
from app.models.warehouse import Warehouse
from app.models.stock import StockMovement
from app.models.product import Product
from app.schemas.warehouse import Warehouse as WarehouseSchema, WarehouseCreate, WarehouseUpdate, WarehouseListResponse
from app.api import deps
import uuid

router = APIRouter()

@router.get("/", response_model=WarehouseListResponse)
def get_warehouses(store_id: str, db: Session = Depends(get_db)):
    warehouses = db.query(Warehouse).filter(Warehouse.store_id == store_id).all()
    # Mocking products for now since we didn't build a joining table
    for w in warehouses:
        w.products = []

    # Real occupation — sum of every warehouse-scoped movement's signed
    # quantity, per warehouse. This is the actual event-sourced balance
    # (Product.stock is store-wide, not per-warehouse — the only place
    # warehouse-level stock exists is on StockMovement.warehouse_id).
    if warehouses:
        wh_ids = [w.id for w in warehouses]
        totals = dict(
            db.query(StockMovement.warehouse_id, sqlfunc.coalesce(sqlfunc.sum(StockMovement.quantity), 0))
            .filter(StockMovement.warehouse_id.in_(wh_ids))
            .group_by(StockMovement.warehouse_id)
            .all()
        )
        for w in warehouses:
            w.current_load = max(0, int(totals.get(w.id, 0) or 0))  # type: ignore[attr-defined]

    return {"success": True, "data": warehouses}


@router.get("/{warehouse_id}/detail", response_model=dict)
def get_warehouse_detail(
    warehouse_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(deps.get_current_active_user),
):
    """
    Section "Entrepôts" — fiche détaillée d'un entrepôt : occupation réelle,
    valeur du stock, nombre de produits/lots/mouvements, dernière activité,
    et le détail disponible/retour/transfert par produit. "Réservé/en
    attente/bloqué/endommagé" ne sont pas encore des notions par-entrepôt
    (réservé est stocké store-wide sur Product) — marqués non trackés
    plutôt qu'inventés.
    """
    wh = db.query(Warehouse).filter(Warehouse.id == warehouse_id).first()
    if not wh:
        raise HTTPException(status_code=404, detail="Entrepôt introuvable")

    rows = (
        db.query(
            StockMovement.product_id,
            Product.name,
            Product.cost_price,
            sqlfunc.coalesce(sqlfunc.sum(StockMovement.quantity), 0).label("balance"),
            sqlfunc.coalesce(sqlfunc.sum(sqlfunc.case((StockMovement.type == "RETURN_RESTOCK", StockMovement.quantity), else_=0)), 0).label("returned"),
            sqlfunc.coalesce(sqlfunc.sum(sqlfunc.case((StockMovement.type.in_(("TRANSFER_IN", "TRANSFER_OUT")), StockMovement.quantity), else_=0)), 0).label("transferred"),
            sqlfunc.count(sqlfunc.distinct(StockMovement.batch_id)).label("lots"),
            sqlfunc.count(StockMovement.id).label("movements"),
            sqlfunc.max(StockMovement.created_at).label("last_activity"),
        )
        .join(Product, Product.id == StockMovement.product_id)
        .filter(StockMovement.warehouse_id == warehouse_id)
        .group_by(StockMovement.product_id, Product.name, Product.cost_price)
        .all()
    )

    products = [
        {
            "product_id": r.product_id, "product_name": r.name,
            "disponible": max(0, int(r.balance)),
            "retourne": int(r.returned),
            "transfere": int(r.transferred),
            "lots": int(r.lots),
            "mouvements": int(r.movements),
            "reserve": {"value": None, "tracked": False},
            "en_attente": {"value": None, "tracked": False},
            "bloque": {"value": None, "tracked": False},
            "endommage": {"value": None, "tracked": False},
        }
        for r in rows
    ]

    valeur_stock = sum(max(0, r.balance) * (r.cost_price or 0) for r in rows)
    total_lots = db.query(sqlfunc.count(sqlfunc.distinct(StockMovement.batch_id))).filter(
        StockMovement.warehouse_id == warehouse_id, StockMovement.batch_id.isnot(None)
    ).scalar() or 0
    total_movements = db.query(sqlfunc.count(StockMovement.id)).filter(StockMovement.warehouse_id == warehouse_id).scalar() or 0
    last_activity = db.query(sqlfunc.max(StockMovement.created_at)).filter(StockMovement.warehouse_id == warehouse_id).scalar()

    occupation = sum(max(0, r.balance) for r in rows)
    taux_occupation = round((occupation / wh.capacity) * 100, 1) if wh.capacity else None

    return {
        "success": True,
        "data": {
            "warehouse": {
                "id": wh.id, "name": wh.name, "code": wh.code, "address": wh.address,
                "manager_name": wh.manager_name, "capacity": wh.capacity,
                "occupation_actuelle": occupation, "taux_occupation": taux_occupation,
                "valeur_stock": valeur_stock, "nombre_produits": len(products),
                "nombre_lots": total_lots, "nombre_mouvements": total_movements,
                "derniere_activite": last_activity.isoformat() if last_activity else None,
            },
            "products": products,
        },
    }


@router.post("/transfer", response_model=dict)
def transfer_stock(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    current_user = Depends(deps.get_current_active_user),
):
    """
    Transfert entre entrepôts — crée systématiquement DEUX mouvements liés
    (sortie à l'origine, entrée à la destination), jamais une modification
    directe. Transactionnel : tout ou rien.
    Payload: { product_id, quantity, from_warehouse_id, to_warehouse_id, reason? }
    """
    product_id = payload.get("product_id")
    quantity = payload.get("quantity")
    from_wh = payload.get("from_warehouse_id")
    to_wh = payload.get("to_warehouse_id")
    reason = payload.get("reason") or "Transfert entre entrepôts"

    if not all([product_id, quantity, from_wh, to_wh]) or int(quantity) <= 0:
        raise HTTPException(status_code=400, detail="product_id, quantity, from_warehouse_id, to_warehouse_id requis (quantity > 0)")
    if from_wh == to_wh:
        raise HTTPException(status_code=400, detail="Entrepôt source et destination identiques")

    quantity = int(quantity)
    try:
        balance = db.query(sqlfunc.coalesce(sqlfunc.sum(StockMovement.quantity), 0)).filter(
            StockMovement.product_id == product_id, StockMovement.warehouse_id == from_wh,
        ).scalar() or 0
        if balance < quantity:
            raise HTTPException(status_code=400, detail=f"Stock insuffisant dans l'entrepôt source (disponible: {balance})")

        transfer_ref = str(uuid.uuid4())[:8]
        db.add(StockMovement(
            id=str(uuid.uuid4()), product_id=product_id, type="TRANSFER_OUT", quantity=-quantity,
            warehouse_id=from_wh, actor_id=getattr(current_user, "id", None),
            reason=f"{reason} → {to_wh} (ref {transfer_ref})",
        ))
        db.add(StockMovement(
            id=str(uuid.uuid4()), product_id=product_id, type="TRANSFER_IN", quantity=quantity,
            warehouse_id=to_wh, actor_id=getattr(current_user, "id", None),
            reason=f"{reason} ← {from_wh} (ref {transfer_ref})",
        ))
        db.commit()
        return {"success": True, "message": f"{quantity} unité(s) transférée(s)", "transfer_ref": transfer_ref}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erreur de transfert : {str(e)}")

@router.post("/", response_model=WarehouseSchema)
def create_warehouse(
    warehouse_in: WarehouseCreate,
    db: Session = Depends(get_db),
    current_user = Depends(deps.get_current_active_user)
):
    db_warehouse = Warehouse(
        id=str(uuid.uuid4()),
        **warehouse_in.dict()
    )
    db.add(db_warehouse)
    db.commit()
    db.refresh(db_warehouse)
    db_warehouse.products = []
    return db_warehouse

@router.patch("/{warehouse_id}", response_model=WarehouseSchema)
def update_warehouse(
    warehouse_id: str,
    warehouse_in: WarehouseUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(deps.get_current_active_user)
):
    db_warehouse = db.query(Warehouse).filter(Warehouse.id == warehouse_id).first()
    if not db_warehouse:
        raise HTTPException(status_code=404, detail="Entrepôt introuvable")

    update_data = warehouse_in.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_warehouse, field, value)

    db.commit()
    db.refresh(db_warehouse)
    db_warehouse.products = []
    return db_warehouse

@router.delete("/{warehouse_id}")
def delete_warehouse(
    warehouse_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(deps.get_current_active_user)
):
    db_warehouse = db.query(Warehouse).filter(Warehouse.id == warehouse_id).first()
    if not db_warehouse:
        raise HTTPException(status_code=404, detail="Entrepôt introuvable")
        
    db.delete(db_warehouse)
    db.commit()
    return {"success": True, "message": "Entrepôt supprimé"}
