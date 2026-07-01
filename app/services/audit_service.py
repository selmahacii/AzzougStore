from typing import Any, Dict, Optional
from sqlalchemy.orm import Session
from uuid import uuid4
from fastapi import Request

from app.models.audit import AuditLog
from app.core.tenant import tenant_store_id

class AuditService:
    def _calculate_diff(self, before: Optional[Dict[str, Any]], after: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Deep JSON diff implementation for structured rollback support.
        Generates { "field_name": { "from": old_val, "to": new_val } }
        """
        diff = {}
        if not before: # CREATE
            return {"_all": {"from": None, "to": after}}
        if not after: # DELETE
            return {"_all": {"from": before, "to": None}}
            
        keys = set(before.keys()).union(set(after.keys()))
        for key in keys:
            if key in ["updated_at", "_sa_instance_state"]: 
                continue
                
            val_before = before.get(key)
            val_after = after.get(key)
            
            if val_before != val_after:
                diff[key] = {
                    "from": val_before,
                    "to": val_after
                }
        return diff

    def record_change(
        self,
        db: Session,
        actor_id: str,
        entity_name: str,
        entity_id: str,
        action: str, # CREATE, UPDATE, DELETE, STATUS_CHANGE
        before: Optional[Dict[str, Any]] = None,
        after: Optional[Dict[str, Any]] = None,
        request: Optional[Request] = None
    ) -> AuditLog:
        """
        Records an industrial-grade audit log.
        """
        ip_address = None
        user_agent = None
        if request:
            ip_address = request.client.host if request.client else None
            user_agent = request.headers.get("user-agent")

        diff = self._calculate_diff(before, after)

        log = AuditLog(
            id=str(uuid4()),
            actor_id=actor_id,
            store_id=tenant_store_id.get(),
            entity=entity_name,
            entity_id=entity_id,
            action=action,
            diff=diff,
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        db.add(log)
        # Flush is recommended to ensure order but commit usually handled by caller
        db.flush()
        return log

audit_service = AuditService()
