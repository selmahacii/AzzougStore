from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List
import uuid

from app.api.deps import get_db
from app.models.status import OrderStatusConfig
from app.schemas.status import OrderStatusConfigCreate, OrderStatusConfigUpdate, OrderStatusConfigOut

router = APIRouter()

# Default system statuses
DEFAULT_STATUSES = [
    {"code": "NEW", "label": "Nouvelle", "color": "#fcd34d", "is_system": True, "order_index": 0},
    {"code": "ASSIGNED", "label": "Assignée", "color": "#f87171", "is_system": True, "order_index": 1},
    {"code": "CALLED", "label": "Appelée", "color": "#60a5fa", "is_system": True, "order_index": 2},
    {"code": "CONFIRMED", "label": "Confirmée", "color": "#34d399", "is_system": True, "order_index": 3},
    {"code": "SHIPPED", "label": "Expédiée", "color": "#a78bfa", "is_system": True, "order_index": 4},
    {"code": "DELIVERED", "label": "Livrée", "color": "#10b981", "is_system": True, "order_index": 5},
    {"code": "RETURNED", "label": "Retournée", "color": "#ef4444", "is_system": True, "order_index": 6},
    {"code": "CANCELED", "label": "Annulée", "color": "#94a3b8", "is_system": True, "order_index": 7},
]

@router.get("/", response_model=dict)
def get_statuses(store_id: str = Query(...), db: Session = Depends(get_db)):
    statuses = db.query(OrderStatusConfig).filter(OrderStatusConfig.store_id == store_id).order_by(OrderStatusConfig.order_index).all()
    
    if not statuses:
        # Initialize default statuses for this store
        for ds in DEFAULT_STATUSES:
            new_status = OrderStatusConfig(
                id=str(uuid.uuid4()),
                store_id=store_id,
                **ds
            )
            db.add(new_status)
        db.commit()
        statuses = db.query(OrderStatusConfig).filter(OrderStatusConfig.store_id == store_id).order_by(OrderStatusConfig.order_index).all()

    return {
        "success": True,
        "data": [OrderStatusConfigOut.model_validate(s).model_dump() for s in statuses]
    }

@router.post("/", response_model=dict)
def create_status(payload: OrderStatusConfigCreate, db: Session = Depends(get_db)):
    existing = db.query(OrderStatusConfig).filter(
        OrderStatusConfig.store_id == payload.store_id,
        OrderStatusConfig.code == payload.code
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Status code already exists")
        
    status = OrderStatusConfig(
        id=str(uuid.uuid4()),
        **payload.model_dump()
    )
    db.add(status)
    db.commit()
    db.refresh(status)
    
    return {"success": True, "data": OrderStatusConfigOut.model_validate(status).model_dump()}

@router.patch("/{status_id}", response_model=dict)
def update_status(status_id: str, payload: OrderStatusConfigUpdate, db: Session = Depends(get_db)):
    status = db.query(OrderStatusConfig).filter(OrderStatusConfig.id == status_id).first()
    if not status:
        raise HTTPException(status_code=404, detail="Status not found")
        
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(status, key, value)
        
    db.commit()
    db.refresh(status)
    return {"success": True, "data": OrderStatusConfigOut.model_validate(status).model_dump()}

@router.delete("/{status_id}", response_model=dict)
def delete_status(status_id: str, db: Session = Depends(get_db)):
    status = db.query(OrderStatusConfig).filter(OrderStatusConfig.id == status_id).first()
    if not status:
        raise HTTPException(status_code=404, detail="Status not found")
        
    if status.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system status")
        
    db.delete(status)
    db.commit()
    return {"success": True, "message": "Status deleted"}
