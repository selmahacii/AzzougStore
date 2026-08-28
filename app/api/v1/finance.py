from fastapi import APIRouter, Depends, Query, HTTPException, Body
from sqlalchemy.orm import Session
from typing import Optional, List
from app.db.session import get_db
from app.models.finance import Wallet, FinancialTransaction, TransactionType, WalletType
from app.schemas.finance import TransactionPagination, FinancialTransaction as TransSchema, TransactionCreate, WalletListResponse, Wallet as WalletSchema, WalletCreate
from sqlalchemy import desc
import uuid
from datetime import datetime, timezone, timedelta

router = APIRouter()

# ─── Wallets ───

@router.get("/wallets", response_model=WalletListResponse)
def get_wallets(
    store_id: str,
    db: Session = Depends(get_db)
):
    wallets = db.query(Wallet).filter(Wallet.store_id == store_id).all()
    return {"success": True, "data": wallets}

@router.post("/wallets", response_model=WalletSchema)
def create_wallet(
    wallet: WalletCreate,
    db: Session = Depends(get_db)
):
    db_wallet = Wallet(
        id=str(uuid.uuid4()),
        **wallet.dict()
    )
    db.add(db_wallet)
    db.commit()
    db.refresh(db_wallet)
    return db_wallet

# ─── Transactions ───

@router.get("/transactions", response_model=TransactionPagination)
def get_transactions(
    store_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    type: Optional[str] = None,
    transaction_type: Optional[str] = None,
    wallet_id: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100)
):
    from sqlalchemy.orm import joinedload
    from sqlalchemy import func, or_

    query = db.query(FinancialTransaction).options(joinedload(FinancialTransaction.wallet))

    is_valid_store = bool(store_id and store_id.strip() and store_id.upper() not in ("ALL", "UNDEFINED", "NULL", "NONE", ""))
    if is_valid_store:
        query = query.filter(FinancialTransaction.store_id == store_id)

    raw_type = (type or transaction_type or "").strip().lower()
    if raw_type:
        try:
            effective_type = TransactionType(raw_type)
            query = query.filter(FinancialTransaction.type == effective_type)
        except ValueError:
            pass  # unknown type → return all
    if wallet_id:
        query = query.filter(FinancialTransaction.wallet_id == wallet_id)
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(
            (FinancialTransaction.reference.ilike(like))
            | (FinancialTransaction.beneficiary.ilike(like))
            | (FinancialTransaction.description.ilike(like))
        )
    if date_from:
        try:
            query = query.filter(func.coalesce(FinancialTransaction.transaction_date, FinancialTransaction.created_at) >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(func.coalesce(FinancialTransaction.transaction_date, FinancialTransaction.created_at) < datetime.fromisoformat(date_to) + timedelta(days=1))
        except ValueError:
            pass

    total = query.count()
    transactions = query.order_by(
        desc(func.coalesce(FinancialTransaction.transaction_date, FinancialTransaction.created_at))
    ).offset((page - 1) * pageSize).limit(pageSize).all()

    # Normalize dates and metadata for frontend display
    for t in transactions:
        if not t.created_at and t.transaction_date:
            t.created_at = t.transaction_date
        elif not t.transaction_date and t.created_at:
            t.transaction_date = t.created_at

        if not t.category:
            ref = str(t.reference or "")
            if ref.startswith("COD-"):
                t.category = "VENTE_COD"
            elif ref.startswith("FEE-"):
                t.category = "COMMISSION_RECUPERATION"
            elif ref.startswith("SALARY-"):
                t.category = "SALAIRE"
            elif ref.startswith("TRF-"):
                t.category = "VIREMENT"
            elif ref.startswith("PURCHASE-"):
                t.category = "ACHAT_STOCK"
            elif ref.startswith("ADS-") or ref.startswith("META-"):
                t.category = "PUBLICITÉ"
            else:
                t.category = "OPERATION"

        if not t.beneficiary:
            desc_text = str(t.description or "")
            if "(" in desc_text and ")" in desc_text:
                extracted = desc_text[desc_text.rfind("(") + 1 : desc_text.rfind(")")].strip()
                if extracted:
                    t.beneficiary = extracted
            if not t.beneficiary and str(t.reference or "").startswith("COD-"):
                t.beneficiary = "Client COD"

    return {
        "success": True,
        "data": transactions,
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "totalPages": (total + pageSize - 1) // pageSize
    }

@router.post("/wallets/transfer")
def transfer_between_wallets(
    body: dict = Body(...),
    db: Session = Depends(get_db)
):
    from_id = body.get("from_wallet_id")
    to_id = body.get("to_wallet_id")
    amount = body.get("amount", 0)
    note = body.get("note", "")
    store_id = body.get("store_id", "")

    if not from_id or not to_id or amount <= 0:
        raise HTTPException(status_code=400, detail="Données de virement invalides")

    from_wallet = db.query(Wallet).filter(Wallet.id == from_id).first()
    to_wallet = db.query(Wallet).filter(Wallet.id == to_id).first()
    if not from_wallet or not to_wallet:
        raise HTTPException(status_code=404, detail="Portefeuille introuvable")
    if from_wallet.balance < amount:
        raise HTTPException(status_code=400, detail="Solde insuffisant")

    ref = f"TRF-{uuid.uuid4().hex[:8].upper()}"
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    out_tx = FinancialTransaction(
        id=str(uuid.uuid4()), reference=ref, wallet_id=from_id,
        store_id=store_id, type=TransactionType.DISBURSEMENT,
        amount=amount, description=note or f"Virement vers {to_wallet.name}",
        transaction_date=now,
    )
    in_tx = FinancialTransaction(
        id=str(uuid.uuid4()), reference=ref, wallet_id=to_id,
        store_id=store_id, type=TransactionType.PAYMENT,
        amount=amount, description=note or f"Virement depuis {from_wallet.name}",
        transaction_date=now,
    )
    from_wallet.balance -= amount
    from_wallet.total_out += amount
    to_wallet.balance += amount
    to_wallet.total_in += amount

    db.add_all([out_tx, in_tx])
    db.commit()
    return {"success": True, "reference": ref, "amount": amount}


@router.post("/wallets/rebalance")
def rebalance_wallets(
    body: dict = Body(...),
    db: Session = Depends(get_db)
):
    from_id = body.get("from_wallet_id")
    targets = body.get("targets", []) # list of {"to_wallet_id": "...", "amount": ...}
    note = body.get("note", "")
    store_id = body.get("store_id", "")
    strategy = body.get("strategy", "CUSTOM")

    if not from_id or not targets:
        raise HTTPException(status_code=400, detail="Données de rééquilibrage invalides")

    from_wallet = db.query(Wallet).filter(Wallet.id == from_id).first()
    if not from_wallet:
        raise HTTPException(status_code=404, detail="Portefeuille source introuvable")

    total_rebalance_amount = sum(t.get("amount", 0) for t in targets)
    if total_rebalance_amount <= 0:
        raise HTTPException(status_code=400, detail="Le montant total de rééquilibrage doit être positif")

    if from_wallet.balance < total_rebalance_amount:
        raise HTTPException(status_code=400, detail=f"Solde insuffisant dans le compte source (Solde: {from_wallet.balance} DA, Demandé: {total_rebalance_amount} DA)")

    ref = f"REB-{uuid.uuid4().hex[:8].upper()}"
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    # Process target transfers
    transactions_to_add = []
    
    # Total disbursement transaction from source
    out_tx = FinancialTransaction(
        id=str(uuid.uuid4()), reference=ref, wallet_id=from_id,
        store_id=store_id, type=TransactionType.DISBURSEMENT,
        amount=total_rebalance_amount, 
        description=note or f"Rééquilibrage (Débit global) - Stratégie: {strategy}",
        transaction_date=now,
    )
    transactions_to_add.append(out_tx)
    
    from_wallet.balance -= total_rebalance_amount
    from_wallet.total_out += total_rebalance_amount

    for item in targets:
        target_id = item.get("to_wallet_id")
        target_amount = item.get("amount", 0)
        if target_amount <= 0:
            continue
        
        target_wallet = db.query(Wallet).filter(Wallet.id == target_id).first()
        if not target_wallet:
            raise HTTPException(status_code=404, detail=f"Portefeuille cible {target_id} introuvable")
            
        in_tx = FinancialTransaction(
            id=str(uuid.uuid4()), reference=ref, wallet_id=target_id,
            store_id=store_id, type=TransactionType.PAYMENT,
            amount=target_amount, 
            description=note or f"Rééquilibrage (Entrée) depuis {from_wallet.name} - Stratégie: {strategy}",
            transaction_date=now,
        )
        transactions_to_add.append(in_tx)
        
        target_wallet.balance += target_amount
        target_wallet.total_in += target_amount
        db.add(target_wallet)

    db.add_all(transactions_to_add)
    db.add(from_wallet)
    db.commit()
    
    return {"success": True, "reference": ref, "total_amount": total_rebalance_amount, "targets_processed": len(targets)}


@router.post("/transactions", response_model=TransSchema)
def create_transaction(
    trans: TransactionCreate,
    db: Session = Depends(get_db)
):
    # Verify wallet belongs to store
    wallet = db.query(Wallet).filter(Wallet.id == trans.wallet_id, Wallet.store_id == trans.store_id).first()
    if not wallet:
        raise HTTPException(status_code=404, detail="Portefeuille non trouvé ou n'appartient pas à cette boutique")

    db_trans = FinancialTransaction(
        id=str(uuid.uuid4()),
        reference=trans.reference or f"TRX-{uuid.uuid4().hex[:8].upper()}",
        **trans.dict(exclude={"reference"})
    )
    
    # Update wallet balance
    # Disbursements and Charges are typically outflows (negative)
    # Payments are inflows (positive)
    if db_trans.type in [TransactionType.DISBURSEMENT, TransactionType.CHARGE]:
        wallet.balance -= db_trans.amount
        wallet.total_out += db_trans.amount
    elif db_trans.type == TransactionType.PAYMENT:
        wallet.balance += db_trans.amount
        wallet.total_in += db_trans.amount
    
    db.add(db_trans)
    db.add(wallet)
    db.commit()
    db.refresh(db_trans)
    return db_trans


@router.get("/transactions/{transaction_id}/order-details")
def get_transaction_order_details(
    transaction_id: str,
    db: Session = Depends(get_db)
):
    from app.models.order import Order, OrderItem
    from app.models.events import OrderEvent
    from app.models.user import User
    from app.models.delivery import DeliveryPartner
    import re

    # 1. Fetch transaction
    tx = db.query(FinancialTransaction).filter(FinancialTransaction.id == transaction_id).first()
    if not tx:
        tx = db.query(FinancialTransaction).filter(FinancialTransaction.reference == transaction_id).first()

    order = None
    if tx:
        ref = str(tx.reference or "")
        clean_ref = re.sub(r"^(COD|FEE|TRX)-", "", ref)
        
        order = db.query(Order).filter(
            (Order.order_number == clean_ref)
            | (Order.order_number == ref)
            | (Order.id == clean_ref)
        ).first()

        if not order and tx.description:
            match = re.search(r"(ORD-[A-Za-z0-9\-]+|ABN-[A-Za-z0-9\-]+)", tx.description)
            if match:
                order = db.query(Order).filter(Order.order_number == match.group(1)).first()

    if not order:
        clean_id = re.sub(r"^(COD|FEE|TRX)-", "", transaction_id)
        order = db.query(Order).filter(
            (Order.order_number == clean_id)
            | (Order.order_number == transaction_id)
            | (Order.id == clean_id)
        ).first()

    if not order:
        return {
            "success": True,
            "has_order": False,
            "message": "Aucune commande rattachée à cette transaction financière."
        }

    delivered_event = None
    confirmation_event = None
    all_events = []
    
    events = db.query(OrderEvent).filter(OrderEvent.order_id == order.id).order_by(OrderEvent.created_at.asc()).all()
    for ev in events:
        actor_name = "Système Automatique"
        if ev.actor:
            actor_name = ev.actor.name
        elif ev.actor_id:
            u = db.query(User).filter(User.id == ev.actor_id).first()
            if u:
                actor_name = u.name

        ev_dict = {
            "id": ev.id,
            "from_status": ev.from_status,
            "to_status": ev.to_status,
            "actor_name": actor_name,
            "actor_role": ev.actor_role or "Agent",
            "created_at": ev.created_at.isoformat() if ev.created_at else None,
            "note": ev.note,
            "call_result": ev.call_result
        }
        all_events.append(ev_dict)

        if ev.to_status == "DELIVERED" and not delivered_event:
            delivered_event = ev_dict
        if ev.to_status in ("CONFIRMED", "SHIPPED") and not confirmation_event:
            confirmation_event = ev_dict

    delivery_date = None
    if delivered_event and delivered_event["created_at"]:
        delivery_date = delivered_event["created_at"]
    elif tx and (tx.transaction_date or tx.created_at):
        delivery_date = (tx.transaction_date or tx.created_at).isoformat()
    elif order.status == "DELIVERED":
        delivery_date = order.created_at.isoformat() if order.created_at else None

    assignee_name = order.assignee.name if order.assignee else (confirmation_event["actor_name"] if confirmation_event else "Non assigné")
    livreur_name = order.livreur.name if order.livreur else (order.carrier.name if order.carrier else "Livreur COD")

    items_data = []
    computed_items_total = 0
    for it in order.items:
        it_total = (it.unit_price or 0) * (it.quantity or 1)
        computed_items_total += it_total
        items_data.append({
            "id": it.id,
            "product_name": it.product_name,
            "quantity": it.quantity,
            "unit_price": it.unit_price,
            "total_price": it_total,
            "variant_details": it.variant_details,
            "image_url": it.image_url
        })

    expected_total = computed_items_total + (order.delivery_fee or 0)
    has_discount = bool(order.discount and order.discount > 0)
    has_tariff_diff = bool(order.total != expected_total or has_discount)
    price_diff_amount = (expected_total - order.total) if has_tariff_diff else 0

    return {
        "success": True,
        "has_order": True,
        "order": {
            "id": order.id,
            "order_number": order.order_number,
            "store_sequence_number": order.store_sequence_number,
            "customer_name": order.customer_name,
            "customer_phone": order.customer_phone,
            "customer_wilaya": order.customer_wilaya,
            "customer_commune": order.customer_commune,
            "customer_address": order.customer_address,
            "status": order.status,
            
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "delivery_date": delivery_date,
            "recovered_at": order.recovered_at.isoformat() if order.recovered_at else None,
            
            "assignee_name": assignee_name,
            "assignee_role": order.assignee.role if order.assignee else "Confirmatrice",
            "livreur_name": livreur_name,
            "carrier_name": order.carrier.name if order.carrier else None,
            
            "subtotal": order.subtotal or computed_items_total,
            "delivery_fee": order.delivery_fee or 0,
            "discount": order.discount or 0,
            "total": order.total,
            "has_price_modification": has_tariff_diff or has_discount,
            "price_diff_amount": price_diff_amount,
            "promo_code": order.promo_code,
            
            "items": items_data,
            "events": all_events,
            "internal_notes": order.internal_notes,
            "notes": order.notes
        }
    }
