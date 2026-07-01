from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid

from app.api.deps import get_db
from app.models.upsell import UpsellRule, UpsellOffer, UpsellCommission
from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.user import User

router = APIRouter()

class UpsellRuleCreate(BaseModel):
    store_id: str
    product_id: str
    upsell_product_ids: List[str]
    trigger_conditions: Optional[dict] = None
    is_active: bool = True

class UpsellOfferRecord(BaseModel):
    order_id: str
    product_id: str
    agent_id: str
    accepted: bool
    quantity: int = 1
    commission_amount: Optional[int] = None # custom commission, or auto-calculated

@router.get("/rules", response_model=dict)
def list_rules(store_id: str = Query(...), db: Session = Depends(get_db)):
    rules = db.query(UpsellRule).filter(UpsellRule.store_id == store_id).all()
    data = []
    for r in rules:
        p = db.query(Product).filter(Product.id == r.product_id).first()
        data.append({
            "id": r.id,
            "product_id": r.product_id,
            "product_name": p.name if p else "Product inconnu",
            "upsell_product_ids": r.upsell_product_ids,
            "trigger_conditions": r.trigger_conditions,
            "is_active": r.is_active
        })
    return {"success": True, "data": data}

@router.post("/rules", response_model=dict)
def create_or_update_rule(payload: UpsellRuleCreate, db: Session = Depends(get_db)):
    rule = db.query(UpsellRule).filter(
        UpsellRule.store_id == payload.store_id,
        UpsellRule.product_id == payload.product_id
    ).first()

    if not rule:
        rule = UpsellRule(
            id=str(uuid.uuid4()),
            store_id=payload.store_id,
            product_id=payload.product_id
        )
        db.add(rule)

    rule.upsell_product_ids = payload.upsell_product_ids
    rule.trigger_conditions = payload.trigger_conditions
    rule.is_active = payload.is_active
    db.commit()
    db.refresh(rule)
    return {"success": True, "data": {
        "id": rule.id,
        "product_id": rule.product_id,
        "upsell_product_ids": rule.upsell_product_ids,
        "is_active": rule.is_active
    }}

@router.post("/offer", response_model=dict)
def record_upsell_offer(payload: UpsellOfferRecord, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == payload.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    product = db.query(Product).filter(Product.id == payload.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Record the upsell offer
    offer = UpsellOffer(
        id=str(uuid.uuid4()),
        order_id=payload.order_id,
        offered_product_id=payload.product_id,
        offered_by=payload.agent_id,
        accepted=payload.accepted,
        quantity=payload.quantity,
        value=product.price * payload.quantity
    )
    db.add(offer)

    if payload.accepted:
        # 1. Add new item to the order
        item_id = str(uuid.uuid4())
        new_item = OrderItem(
            id=item_id,
            order_id=payload.order_id,
            product_id=payload.product_id,
            product_name=f"[UPSELL] {product.name}",
            quantity=payload.quantity,
            unit_price=product.price,
            image_url=product.main_image
        )
        db.add(new_item)

        # 2. Update order financials
        added_cost = product.price * payload.quantity
        order.subtotal += added_cost
        order.total += added_cost

        # 3. Create or calculate commission (10% of upsell value or flat 100 DA, let's use 10% of upsell price)
        commission_value = payload.commission_amount
        if commission_value is None:
            commission_value = int(added_cost * 0.1) # 10% default commission
            if commission_value == 0:
                commission_value = 100 # minimum 100 DA flat

        commission = UpsellCommission(
            id=str(uuid.uuid4()),
            store_id=order.store_id,
            user_id=payload.agent_id,
            order_id=payload.order_id,
            amount=commission_value,
            is_paid=False
        )
        db.add(commission)

    db.commit()
    return {"success": True, "message": "Upsell offer recorded successfully."}

@router.get("/stats", response_model=dict)
def get_upsell_stats(store_id: str = Query(...), db: Session = Depends(get_db)):
    # Calculate statistics
    offers = db.query(UpsellOffer).join(Order).filter(Order.store_id == store_id).all()
    
    total_offers = len(offers)
    accepted_offers = [o for o in offers if o.accepted]
    total_accepted = len(accepted_offers)
    
    upsell_rate = round((total_accepted / total_offers) * 100, 2) if total_offers > 0 else 0.0
    total_revenue = sum(o.value for o in accepted_offers)
    
    # Calculate top upsell products
    top_products = {}
    for o in accepted_offers:
        prod_id = o.offered_product_id
        if prod_id:
            if prod_id not in top_products:
                top_products[prod_id] = {"count": 0, "revenue": 0}
            top_products[prod_id]["count"] += o.quantity
            top_products[prod_id]["revenue"] += o.value

    top_list = []
    for pid, stats in top_products.items():
        p = db.query(Product).filter(Product.id == pid).first()
        top_list.append({
            "product_id": pid,
            "product_name": p.name if p else "Product Inconnu",
            "quantity": stats["count"],
            "revenue": stats["revenue"]
        })
    # Sort by revenue descending
    top_list.sort(key=lambda x: x["revenue"], reverse=True)

    return {
        "success": True,
        "data": {
            "total_offers": total_offers,
            "total_accepted": total_accepted,
            "upsell_rate": upsell_rate,
            "total_revenue": total_revenue,
            "top_products": top_list[:5]
        }
    }

@router.get("/commissions", response_model=dict)
def list_commissions(store_id: str = Query(...), db: Session = Depends(get_db)):
    commissions = db.query(UpsellCommission).filter(UpsellCommission.store_id == store_id).all()
    data = []
    for c in commissions:
        agent = db.query(User).filter(User.id == c.user_id).first()
        order = db.query(Order).filter(Order.id == c.order_id).first()
        data.append({
            "id": c.id,
            "agent_name": agent.name if agent else "Agent inconnu",
            "order_number": order.order_number if order else "N/A",
            "amount": c.amount,
            "is_paid": c.is_paid,
            "created_at": c.created_at.isoformat() if c.created_at else None
        })
    return {"success": True, "data": data}

@router.post("/commissions/{commission_id}/pay", response_model=dict)
def pay_commission(commission_id: str, db: Session = Depends(get_db)):
    comm = db.query(UpsellCommission).filter(UpsellCommission.id == commission_id).first()
    if not comm:
        raise HTTPException(status_code=404, detail="Commission not found")
    comm.is_paid = True
    db.commit()
    return {"success": True, "message": "Commission marked as paid."}
