from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import Optional, Any
from datetime import datetime, timezone, timedelta
import calendar
import uuid
import logging

logger = logging.getLogger(__name__)

from app.api import deps
from app.models.user import User
from app.models.payroll import PayrollRecord
from app.services.salary_service import compute_salary

router = APIRouter()

PAYABLE_ROLES = ["CONFIRMATEUR", "AGENT", "AGENT_MANAGER", "MANAGER", "MARKETER", "LIVREUR"]

# Fixed-monthly roles are paid from the revenue of every ACTIVE store of the
# month (equal split); commission roles split naturally by delivered orders.
MONTHLY_ROLES = ("MANAGER", "LIVREUR")


def _require_super_admin(current_user: User):
    # Managers handle day-to-day operations, payroll included.
    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER"):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs et managers.")


def _previous_period() -> str:
    today = datetime.now(timezone.utc)
    first = today.replace(day=1)
    prev = first - timedelta(days=1)
    return prev.strftime("%Y-%m")


def _period_bounds(period: str):
    try:
        year, month = int(period[:4]), int(period[5:7])
        start = datetime(year, month, 1)
        last_day = calendar.monthrange(year, month)[1]
        end = datetime(year, month, last_day, 23, 59, 59, 999999)
        return start, end
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Période invalide — format attendu : YYYY-MM.")


def _compute_store_contributions(db: Session, emp: User, salary_result: dict, since, until) -> list:
    """
    How each store funds this salary:
    - PER_DELIVERED_ORDER → proportional to the employee's DELIVERED orders per store.
    - MONTHLY_SALARY (manager, livreur…) → equal split across every store with
      business activity in the month (≥ 1 order); falls back to active stores.
    """
    from sqlalchemy import func
    from app.models.order import Order
    from app.models.store import Store

    total = float(salary_result.get("salary") or 0)
    if total <= 0:
        return []

    if salary_result.get("payment_type") == "PER_DELIVERED_ORDER":
        rows = (
            db.query(Order.store_id, func.count(Order.id))
            .filter(
                Order.assigned_to == emp.id,
                Order.status == "DELIVERED",
                Order.is_deleted == False,
                func.coalesce(Order.updated_at, Order.created_at) >= since,
                func.coalesce(Order.updated_at, Order.created_at) <= until,
            )
            .group_by(Order.store_id)
            .all()
        )
        delivered_total = sum(cnt for _, cnt in rows)
        contribs = [(sid, total * cnt / delivered_total) for sid, cnt in rows] if delivered_total else []
    else:
        active_ids = [
            r[0] for r in (
                db.query(Order.store_id)
                .filter(
                    Order.is_deleted == False,
                    func.coalesce(Order.updated_at, Order.created_at) >= since,
                    func.coalesce(Order.updated_at, Order.created_at) <= until
                )
                .group_by(Order.store_id)
                .all()
            )
        ]
        if not active_ids:
            active_ids = [
                s.id for s in db.query(Store).filter(Store.is_active == True, Store.is_deleted == False).all()
            ]
        contribs = [(sid, total / len(active_ids)) for sid in active_ids] if active_ids else []

    names = {
        s.id: s.name
        for s in db.query(Store).filter(Store.id.in_([sid for sid, _ in contribs])).all()
    } if contribs else {}
    return [
        {"store_id": sid, "store_name": names.get(sid, sid), "amount": round(amount, 2)}
        for sid, amount in contribs
    ]


def _record_out(r: PayrollRecord) -> dict:
    return {
        "id": r.id,
        "user_id": r.user_id,
        "user_name": r.user.name if r.user else None,
        "user_role": r.user.role if r.user else None,
        "period": r.period,
        "payment_type": r.payment_type,
        "base_salary": r.base_salary,
        "bonus": r.bonus,
        "total": r.total,
        "delivered_count": r.delivered_count,
        "recovered_count": r.recovered_count,
        "status": r.status,
        "generated_at": r.generated_at.isoformat() if r.generated_at else None,
        "paid_at": r.paid_at.isoformat() if r.paid_at else None,
    }


@router.post("/generate", response_model=dict)
def generate_payroll(
    period: Optional[str] = Query(None, description="YYYY-MM (défaut : mois précédent)"),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """
    Freeze the monthly payroll: computes the salary of every active payable
    employee for the period and stores an immutable PayrollRecord.
    Re-running refreshes PENDING records; PAID records are never touched.
    """
    _require_super_admin(current_user)
    period = period or _previous_period()
    since, until = _period_bounds(period)

    employees = db.query(User).filter(
        User.role.in_(PAYABLE_ROLES),
        User.is_active == True,
    ).all()

    created, updated, skipped_paid = 0, 0, 0
    for emp in employees:
        salary = compute_salary(db, emp, store_id=None, since=since, until=until)

        record = db.query(PayrollRecord).filter(
            PayrollRecord.user_id == emp.id,
            PayrollRecord.period == period,
        ).first()

        if record and record.status == "PAID":
            skipped_paid += 1
            continue

        if not record:
            record = PayrollRecord(id=str(uuid.uuid4()), user_id=emp.id, period=period)
            db.add(record)
            created += 1
        else:
            updated += 1

        record.payment_type = salary.get("payment_type")
        record.base_salary = float(salary.get("base_salary") or 0)
        record.bonus = float(salary.get("abandoned_bonus") or 0)
        record.total = float(salary.get("salary") or 0)
        record.delivered_count = int(salary.get("normal_delivered_count") or 0)
        record.recovered_count = int(salary.get("recovered_delivered_count") or 0)
        record.breakdown = {
            **salary,
            "role": emp.role,
            # Which store funds what share of this salary (business rule §4)
            "store_contributions": _compute_store_contributions(db, emp, salary, since, until),
        }
        record.generated_by = current_user.id

    db.commit()
    logger.info("Payroll %s generated by %s: %d created, %d refreshed, %d already paid",
                period, current_user.id, created, updated, skipped_paid)
    return {
        "success": True,
        "period": period,
        "created": created,
        "updated": updated,
        "skipped_paid": skipped_paid,
        "message": f"Paie {period} : {created} fiche(s) créée(s), {updated} actualisée(s), {skipped_paid} déjà payée(s).",
    }


@router.get("/", response_model=dict)
def list_payroll(
    period: Optional[str] = Query(None, description="YYYY-MM (défaut : mois précédent)"),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    _require_super_admin(current_user)
    period = period or _previous_period()

    records = (
        db.query(PayrollRecord)
        .options(joinedload(PayrollRecord.user))
        .filter(PayrollRecord.period == period)
        .order_by(PayrollRecord.total.desc())
        .all()
    )
    total_pending = sum(r.total for r in records if r.status == "PENDING")
    total_paid = sum(r.total for r in records if r.status == "PAID")
    return {
        "success": True,
        "period": period,
        "data": [_record_out(r) for r in records],
        "summary": {
            "count": len(records),
            "pending_count": sum(1 for r in records if r.status == "PENDING"),
            "paid_count": sum(1 for r in records if r.status == "PAID"),
            "total_pending": total_pending,
            "total_paid": total_paid,
            "total": total_pending + total_paid,
        },
    }


@router.post("/{record_id}/mark-paid", response_model=dict)
def mark_paid(
    record_id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    _require_super_admin(current_user)
    record = db.query(PayrollRecord).filter(PayrollRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Fiche de paie introuvable.")
    if record.status == "PAID":
        return {"success": True, "message": "Déjà marquée payée."}

    record.status = "PAID"
    record.paid_at = datetime.now(timezone.utc).replace(tzinfo=None)
    record.paid_by = current_user.id

    # ── Expenses integration: one PAID payroll expense per contributing store ──
    from app.models.expense import Expense, ExpenseCategory, ExpenseStatus
    emp = record.user or db.query(User).filter(User.id == record.user_id).first()
    emp_name = emp.name if emp else record.user_id
    emp_role = emp.role if emp else "?"
    contributions = (record.breakdown or {}).get("store_contributions") or []
    if not contributions and record.total:
        # Legacy records without a stored split: recompute on the fly
        since, until = _period_bounds(record.period)
        contributions = _compute_store_contributions(
            db, emp, record.breakdown or {"salary": record.total, "payment_type": record.payment_type}, since, until,
        )
    expenses_created = 0
    for contrib in contributions:
        db.add(Expense(
            id=str(uuid.uuid4()),
            store_id=contrib["store_id"],
            category=ExpenseCategory.SALARY,
            label=f"Salaire {record.period} — {emp_name} ({emp_role})",
            description=(
                f"Quote-part boutique : {contrib['amount']} DA sur un salaire total de {record.total} DA "
                f"({record.payment_type or 'PER_DELIVERED_ORDER'}). Fiche de paie {record.id}."
            ),
            amount=int(round(contrib["amount"])),
            tax_amount=0,
            total_amount=int(round(contrib["amount"])),
            status=ExpenseStatus.PAID,
            expense_date=record.paid_at.date(),
        ))
        expenses_created += 1

    # ── Audit + notification ──
    try:
        from app.services.audit_service import audit_service
        audit_service.record_change(
            db,
            actor_id=current_user.id,
            entity_name="payroll_record",
            entity_id=record.id,
            action="STATUS_CHANGE",
            before={"status": "PENDING"},
            after={"status": "PAID", "total": record.total, "period": record.period,
                   "expenses_created": expenses_created},
        )
    except Exception as audit_err:
        logger.warning("Payroll audit log failed: %s", audit_err)

    from app.services.notification_service import notify
    notify(
        db,
        type="PAYROLL_PAID",
        title=f"Salaire payé — {emp_name} ({record.period})",
        message=f"{record.total} DA versés, {expenses_created} dépense(s) « Salaires » créée(s) sur les boutiques contributrices.",
        user_id=None,  # broadcast to admins/managers
    )

    db.commit()
    logger.info(
        "Payroll record %s (period %s) marked PAID by %s — %d expense rows created",
        record.id, record.period, current_user.id, expenses_created,
    )
    return {"success": True, "message": f"Fiche marquée payée — {expenses_created} dépense(s) créée(s).", "expenses_created": expenses_created}


@router.get("/reminders", response_model=dict)
def payroll_reminders(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """
    Monthly payroll reminders for the super-admin:
    - previous month not generated at all → GENERATE reminder
    - generated but some records still PENDING → PAY reminder
    """
    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER"):
        return {"success": True, "reminders": []}

    period = _previous_period()
    records = db.query(PayrollRecord).filter(PayrollRecord.period == period).all()

    reminders = []
    if not records:
        payable = db.query(User).filter(User.role.in_(PAYABLE_ROLES), User.is_active == True).count()
        if payable > 0:
            reminders.append({
                "type": "GENERATE",
                "period": period,
                "message": f"La paie de {period} n'a pas encore été générée ({payable} employé(s) à payer).",
            })
    else:
        pending = [r for r in records if r.status == "PENDING"]
        if pending:
            reminders.append({
                "type": "PAY",
                "period": period,
                "pending_count": len(pending),
                "total_pending": sum(r.total for r in pending),
                "message": f"Paie {period} : {len(pending)} fiche(s) en attente de paiement "
                           f"({sum(r.total for r in pending):,.0f} DA au total).",
            })

    return {"success": True, "period": period, "reminders": reminders}
