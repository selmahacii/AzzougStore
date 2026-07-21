"""
Assignment Rule Engine — admin API.

Configure PRODUCT > STORE > CATEGORY > BRAND assignment rules for the
confirmatrice auto-assignment engine (app/services/order_service.py
resolve_assignment_rule), AND COMMUNE > WILAYA rules for direct courier
auto-assignment (resolve_courier_rule) — same table, same conflict-
prevention, two different consumers. Reserved to ADMIN/SUPER_ADMIN/
MANAGER — this directly controls who gets paid commission on which
orders, and who gets which deliveries.
"""
import uuid
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api import deps
from app.models.assignment_rule import AssignmentRule, RULE_TYPE_PRIORITY, COURIER_RULE_TYPE_PRIORITY
from app.models.user import User

router = APIRouter()

ALL_RULE_TYPES = RULE_TYPE_PRIORITY + COURIER_RULE_TYPE_PRIORITY


def _require_admin(current_user: User):
    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER"):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs et managers — ceci contrôle qui est commissionné sur quelles commandes, et qui livre où.")


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

    if payload.rule_type not in ALL_RULE_TYPES:
        raise HTTPException(status_code=400, detail=f"rule_type doit être l'un de : {', '.join(ALL_RULE_TYPES)}")

    agent = db.query(User).filter(User.id == payload.agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable.")

    # Un rôle qui ne correspond pas au type de règle est presque toujours
    # une erreur de configuration (ex: assigner un livreur à un produit, ou
    # une confirmatrice à une commune) — on prévient plutôt que de laisser
    # une règle silencieusement inefficace.
    if payload.rule_type in COURIER_RULE_TYPE_PRIORITY and agent.role != "LIVREUR":
        raise HTTPException(status_code=400, detail="Les règles COMMUNE/WILAYA (auto-assignation directe) doivent cibler un agent de rôle LIVREUR.")
    if payload.rule_type in RULE_TYPE_PRIORITY and agent.role not in ("CONFIRMATEUR", "AGENT", "AGENT_MANAGER"):
        raise HTTPException(status_code=400, detail="Les règles PRODUCT/STORE/CATEGORY/BRAND doivent cibler un agent de rôle CONFIRMATEUR, AGENT ou AGENT_MANAGER.")

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


class CourierZonesCreate(BaseModel):
    agent_id: str
    communes: List[str] = []
    wilayas: List[str] = []
    notes: Optional[str] = None


@router.post("/courier-zones", response_model=dict, status_code=201)
def assign_courier_zones(
    payload: CourierZonesCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Convenience bulk endpoint: associate ONE livreur with several communes
    and/or wilayas in a single call — e.g. Selma's example, Ahmed covering
    Hussein Dey + Kouba (wilaya Alger) — instead of one POST / per zone.
    Each zone becomes its own row in assignment_rules (rule_type=COMMUNE
    or WILAYA); zones that already have a conflicting active rule for a
    DIFFERENT agent are skipped and reported, not silently overwritten.
    """
    _require_admin(current_user)

    agent = db.query(User).filter(User.id == payload.agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable.")
    if agent.role != "LIVREUR":
        raise HTTPException(status_code=400, detail="L'auto-assignation par commune/wilaya cible uniquement des agents de rôle LIVREUR.")

    created: List[dict] = []
    skipped: List[dict] = []
    for rule_type, values in (("COMMUNE", payload.communes), ("WILAYA", payload.wilayas)):
        for target_id in values:
            target_id = (target_id or "").strip()
            if not target_id:
                continue
            existing = (
                db.query(AssignmentRule)
                .filter(AssignmentRule.rule_type == rule_type, AssignmentRule.target_id == target_id,
                        AssignmentRule.is_exclusion == False, AssignmentRule.is_active == True)
                .first()
            )
            if existing and existing.agent_id != payload.agent_id:
                skipped.append({"rule_type": rule_type, "target_id": target_id, "reason": f"déjà assigné à un autre livreur (agent_id={existing.agent_id})"})
                continue
            if existing:
                skipped.append({"rule_type": rule_type, "target_id": target_id, "reason": "déjà assigné à ce livreur"})
                continue
            rule = AssignmentRule(
                id=str(uuid.uuid4()), rule_type=rule_type, target_id=target_id,
                agent_id=payload.agent_id, is_exclusion=False, is_active=True, notes=payload.notes,
            )
            db.add(rule)
            created.append({"rule_type": rule_type, "target_id": target_id})
    db.commit()
    return {"success": True, "data": {"created": created, "skipped": skipped}}


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
