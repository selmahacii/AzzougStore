from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db.session import get_db
from app.models.warehouse import Warehouse
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
    return {"success": True, "data": warehouses}

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
