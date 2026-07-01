from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from app.db.session import get_db
from app.models.audit import AuditLog
from app.schemas.audit import AuditPagination
from sqlalchemy import desc, or_
from app.models.user import User

router = APIRouter()

@router.get("/", response_model=AuditPagination)
def get_audit_logs(
    db: Session = Depends(get_db),
    store_id: Optional[str] = None,
    entity: Optional[str] = None,
    action: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(30, ge=1, le=100)
):
    query = db.query(AuditLog)

    if store_id:
        query = query.filter(AuditLog.store_id == store_id)
    if entity:
        query = query.filter(AuditLog.entity == entity)
    if action:
        query = query.filter(AuditLog.action == action)
    
    if search:
        search_filter = or_(
            AuditLog.entity_id.contains(search),
            AuditLog.action.contains(search),
            AuditLog.actor.has(User.name.contains(search))
        )
        query = query.filter(search_filter)

    total = query.count()
    logs = query.order_by(desc(AuditLog.created_at)).offset((page - 1) * pageSize).limit(pageSize).all()

    return {
        "success": True,
        "data": logs,
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "totalPages": (total + pageSize - 1) // pageSize
    }
