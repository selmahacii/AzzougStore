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
    from app.models.product import Product
    from app.models.landing_page import LandingPage
    from app.models.marketing import MetaAdsCampaign, MetaAdsConfig, MetaAdsAdInsight
    from sqlalchemy import or_
    import re

    # 1. Fetch transaction
    tx = db.query(FinancialTransaction).filter(FinancialTransaction.id == transaction_id).first()
    if not tx:
        tx = db.query(FinancialTransaction).filter(FinancialTransaction.reference == transaction_id).first()

    ref = str(tx.reference if tx else transaction_id or "")
    desc = str(tx.description if tx else "")
    cat = str(tx.category if tx else "").lower()

    # ─────────────────────────────────────────────────────────────
    # A. Check if this is a Marketing / Ad Spend Transaction (META / ADS)
    # ─────────────────────────────────────────────────────────────
    is_marketing = ref.startswith("META-") or ref.startswith("ADS-") or cat in ("ads", "marketing", "publicité", "publicite")

    marketing_data = None
    if is_marketing:
        camp_name = ""
        camp_id = ""
        raw_currency_info = ""

        # Robust campaign name extraction from description
        if "Campagne:" in desc:
            after_camp = desc.split("Campagne:")[1]
            if "Devise d'origine:" in after_camp:
                camp_name = after_camp.split("Devise d'origine:")[0].strip()
            elif "Devise" in after_camp:
                camp_name = after_camp.split("Devise")[0].strip()
            elif "\n" in after_camp:
                camp_name = after_camp.split("\n")[0].strip()
            else:
                camp_name = after_camp.strip()

        if "Devise d'origine:" in desc:
            raw_currency_info = desc.split("Devise d'origine:")[1].splitlines()[0].strip()

        # Try to find matching MetaAdsCampaign
        campaign = None
        if camp_name:
            campaign = db.query(MetaAdsCampaign).filter(MetaAdsCampaign.campaign_name.ilike(f"%{camp_name}%")).first()
        if not campaign and ref.startswith("META-"):
            parts = ref.split("-")
            if len(parts) >= 3:
                camp_prefix = parts[2]
                campaign = db.query(MetaAdsCampaign).filter(MetaAdsCampaign.campaign_id.ilike(f"%{camp_prefix}%")).first()

        # Fallback date_start
        date_start = None
        date_end = None
        if campaign:
            date_start = campaign.date_start.isoformat() if campaign.date_start else None
            date_end = campaign.date_end.isoformat() if campaign.date_end else None
            camp_name = campaign.campaign_name or camp_name
            camp_id = campaign.campaign_id or camp_id
        
        if not date_start and tx and (tx.transaction_date or tx.created_at):
            dt = tx.transaction_date or tx.created_at
            date_start = dt.replace(hour=0, minute=0, second=0).isoformat()
            date_end = dt.replace(hour=23, minute=59, second=59).isoformat()

        # Match Products
        targeted_products = []
        seen_prod_ids = set()

        if campaign and campaign.product_id:
            p = db.query(Product).filter(Product.id == campaign.product_id).first()
            if p:
                seen_prod_ids.add(p.id)
                targeted_products.append({
                    "id": p.id,
                    "name": p.name,
                    "price": p.price,
                    "image_url": p.image_url,
                    "category": p.category or "Catalogue"
                })

        if camp_name:
            # Search by campaign name keywords (e.g. "coussin de voyage" -> "coussin", "voyage")
            prods = db.query(Product).filter(
                (Product.name.ilike(f"%{camp_name}%")) |
                (Product.slug.ilike(f"%{camp_name.replace(' ', '-')}%"))
            ).all()
            if not prods and " " in camp_name:
                words = [w for w in camp_name.split() if len(w) > 3]
                if words:
                    clauses = [Product.name.ilike(f"%{w}%") for w in words]
                    prods = db.query(Product).filter(or_(*clauses)).all()

            for p in prods:
                if p.id not in seen_prod_ids:
                    seen_prod_ids.add(p.id)
                    targeted_products.append({
                        "id": p.id,
                        "name": p.name,
                        "price": p.price,
                        "image_url": p.image_url,
                        "category": p.category or "Catalogue"
                    })

        # Match Landing Pages
        landing_pages_list = []
        seen_urls = set()

        if camp_name:
            lps = db.query(LandingPage).filter(
                (LandingPage.product_name.ilike(f"%{camp_name}%")) |
                (LandingPage.headline.ilike(f"%{camp_name}%")) |
                (LandingPage.slug.ilike(f"%{camp_name.replace(' ', '-')}%"))
            ).all()
            for lp in lps:
                url = f"/lp/{lp.slug}"
                if url not in seen_urls:
                    seen_urls.add(url)
                    landing_pages_list.append({
                        "title": lp.headline or lp.product_name or f"Landing Page {lp.slug}",
                        "url": url
                    })

        for p in targeted_products:
            p_url = f"/products/{p.get('slug') or p.get('id')}"
            if p_url not in seen_urls:
                seen_urls.add(p_url)
                landing_pages_list.append({
                    "title": f"Fiche Produit — {p.get('name')}",
                    "url": p_url
                })

        if not landing_pages_list:
            landing_pages_list.append({
                "title": "Boutique & Page d'accueil",
                "url": "/"
            })

        # Match Ads / Publicités (MetaAdsAdInsight)
        ads_breakdown = []
        if campaign:
            ad_insights = db.query(MetaAdsAdInsight).filter(MetaAdsAdInsight.campaign_id == campaign.campaign_id).all()
            for a in ad_insights:
                ads_breakdown.append({
                    "ad_id": a.ad_id,
                    "ad_name": a.ad_name,
                    "adset_name": a.adset_name or "Ensemble par défaut",
                    "spend": a.spend,
                    "clicks": a.clicks,
                    "impressions": a.impressions,
                    "purchases": a.meta_purchases
                })

        if not ads_breakdown:
            ads_breakdown.append({
                "ad_id": f"AD-{ref.split('-')[2] if len(ref.split('-')) >= 3 else 'META'}",
                "ad_name": f"Annonce Publicitaire — {camp_name or 'Meta Ads'}",
                "adset_name": f"Audience Ciblée ({camp_name or 'Générale'})",
                "spend": abs(tx.amount) if tx else 0,
                "clicks": 0,
                "impressions": 0,
                "purchases": 0
            })

        # Match orders generated by this campaign
        attributed_orders_query = db.query(Order).filter(Order.is_deleted == False)
        filters = []
        if camp_id:
            filters.append(Order.campaign_id == camp_id)
        if camp_name:
            filters.append(Order.campaign_name.ilike(f"%{camp_name}%"))
            filters.append(Order.utm_campaign.ilike(f"%{camp_name}%"))
        if seen_prod_ids:
            filters.append(Order.items.any(OrderItem.product_id.in_(list(seen_prod_ids))))

        if filters:
            attributed_orders_query = attributed_orders_query.filter(or_(*filters))
        else:
            attributed_orders_query = attributed_orders_query.filter(
                (Order.source.ilike("%meta%")) | (Order.source.ilike("%facebook%"))
            )

        attributed_orders = attributed_orders_query.all()
        orders_count = len(attributed_orders)
        delivered_count = sum(1 for o in attributed_orders if o.status == "DELIVERED")
        generated_revenue = sum(o.total for o in attributed_orders)

        spend_amount = abs(tx.amount) if tx else 0
        cpa = round(spend_amount / orders_count, 1) if orders_count > 0 else 0
        roas = round(generated_revenue / spend_amount, 2) if spend_amount > 0 else 0.0

        marketing_data = {
            "is_marketing": True,
            "campaign_name": camp_name or "Campagne Meta Ads (Acquisition)",
            "campaign_id": camp_id or ref,
            "currency_info": raw_currency_info,
            "spend": spend_amount,
            "date_start": date_start,
            "date_end": date_end,
            "landing_pages": landing_pages_list,
            "ads": ads_breakdown,
            "orders_count": orders_count,
            "delivered_orders_count": delivered_count,
            "generated_revenue": generated_revenue,
            "cpa": cpa,
            "roas": roas,
            "products": targeted_products
        }

    # ─────────────────────────────────────────────────────────────
    # B. Check if this is an Order Payment Transaction (COD)
    # ─────────────────────────────────────────────────────────────
    order = None
    if tx:
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

    order_data = None
    if order:
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

        order_data = {
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

    return {
        "success": True,
        "has_order": bool(order_data),
        "order": order_data,
        "has_marketing": bool(marketing_data),
        "marketing": marketing_data
    }
