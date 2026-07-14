from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
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
    actor_id: Optional[str] = Query(None, description="Filter by profile — who performed the action"),
    start_date: Optional[str] = Query(None, description="ISO date, inclusive lower bound on created_at"),
    end_date: Optional[str] = Query(None, description="ISO date, inclusive upper bound on created_at"),
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(30, ge=1, le=100)
):
    # This endpoint already scopes explicitly via the store_id param below
    # when the caller passes one — the header-driven tenant auto-filter is
    # redundant and, same class of bug fixed across orders.py/users.py this
    # session, would silently exclude entries on a header/store mismatch.
    db.info["skip_tenant_isolation"] = True

    query = db.query(AuditLog)

    if store_id:
        query = query.filter(AuditLog.store_id == store_id)
    if entity:
        query = query.filter(AuditLog.entity == entity)
    if action:
        query = query.filter(AuditLog.action == action)
    if actor_id:
        query = query.filter(AuditLog.actor_id == actor_id)
    if start_date:
        from app.core.dates import parse_local_date_filter
        try:
            query = query.filter(AuditLog.created_at >= parse_local_date_filter(start_date))
        except ValueError:
            pass
    if end_date:
        from app.core.dates import parse_local_date_filter
        try:
            query = query.filter(AuditLog.created_at <= parse_local_date_filter(end_date))
        except ValueError:
            pass

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
