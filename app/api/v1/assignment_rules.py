"""
Assignment Rule Engine — admin API.

Configure PRODUCT > STORE > CATEGORY > BRAND assignment rules for the
confirmatrice auto-assignment engine (app/services/order_service.py
resolve_assignment_rule). Reserved to ADMIN/SUPER_ADMIN/MANAGER — this
directly controls who gets paid commission on which orders.
"""
import uuid
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api import deps
from app.models.assignment_rule import AssignmentRule, RULE_TYPE_PRIORITY
from app.models.user import User

router = APIRouter()


def _require_admin(current_user: User):
    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER"):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs et managers — ceci contrôle qui est commissionné sur quelles commandes.")


class AssignmentRuleCreate(BaseModel):
    rule_type: str  # PRODUCT | STORE | CATEGORY | BRAND
    target_id: str
    agent_id: str
    is_exclusion: bool = False
    notes: Optional[str] = None


class AssignmentRuleOut(BaseModel):
    id: str
    rule_type: str
    target_id: str
    agent_id: str
    is_exclusion: bool
    is_active: bool
    notes: Optional[str] = None

    class Config:
        from_attributes = True


@router.get("/", response_model=dict)
def list_assignment_rules(
    rule_type: Optional[str] = Query(None),
    agent_id: Optional[str] = Query(None),
    active_only: bool = Query(True),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    _require_admin(current_user)
    q = db.query(AssignmentRule)
    if rule_type:
        q = q.filter(AssignmentRule.rule_type == rule_type)
    if agent_id:
        q = q.filter(AssignmentRule.agent_id == agent_id)
    if active_only:
        q = q.filter(AssignmentRule.is_active == True)
    rows = q.order_by(AssignmentRule.rule_type).all()
    return {"success": True, "data": [AssignmentRuleOut.model_validate(r).model_dump() for r in rows],
            "rule_type_priority": RULE_TYPE_PRIORITY}


@router.post("/", response_model=dict, status_code=201)
def create_assignment_rule(
    payload: AssignmentRuleCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    _require_admin(current_user)

    if payload.rule_type not in RULE_TYPE_PRIORITY:
        raise HTTPException(status_code=400, detail=f"rule_type doit être l'un de : {', '.join(RULE_TYPE_PRIORITY)}")

    agent = db.query(User).filter(User.id == payload.agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable.")

    rule = AssignmentRule(
        id=str(uuid.uuid4()),
        rule_type=payload.rule_type,
        target_id=payload.target_id,
        agent_id=payload.agent_id,
        is_exclusion=payload.is_exclusion,
        is_active=True,
        notes=payload.notes,
    )
    db.add(rule)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Une règle active existe déjà pour cette cible — un seul agent peut être responsable d'une même cible à la fois. Désactivez l'ancienne règle d'abord.",
        )
    db.refresh(rule)
    return {"success": True, "data": AssignmentRuleOut.model_validate(rule).model_dump()}


@router.patch("/{rule_id}/deactivate", response_model=dict)
def deactivate_assignment_rule(
    rule_id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    _require_admin(current_user)
    rule = db.query(AssignmentRule).filter(AssignmentRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Règle introuvable.")
    rule.is_active = False
    db.commit()
    return {"success": True, "message": "Règle désactivée."}


@router.delete("/{rule_id}", response_model=dict)
def delete_assignment_rule(
    rule_id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    _require_admin(current_user)
    rule = db.query(AssignmentRule).filter(AssignmentRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Règle introuvable.")
    db.delete(rule)
    db.commit()
    return {"success": True, "message": "Règle supprimée."}
