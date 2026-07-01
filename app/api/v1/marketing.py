from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional, Any
from app.db.session import get_db
from app.api import deps
from app.models.marketing import MarketingChannel, MessageTemplate, MarketingAutomation, MarketingLog, StoreVisitor
from app.models.customer import Customer
from app.schemas.marketing import (
    MarketingChannel as ChannelSchema,
    MessageTemplate as TemplateSchema,
    MessageTemplateCreate,
    MarketingAutomation as AutomationSchema,
    MarketingSummary,
)
import uuid
from datetime import datetime, timezone

router = APIRouter()

@router.get("/summary", response_model=MarketingSummary)
def get_marketing_summary(
    store_id: str,
    db: Session = Depends(get_db)
):
    # Simulated but could be based on logs
    return {
        "transmissionLoad": 42,
        "successRate": 99.4,
        "capacityPerDay": "250K / Jour",
        "latencyMs": 140,
        "activeNodes": True
    }

@router.get("/channels", response_model=List[ChannelSchema])
def get_channels(
    store_id: str,
    db: Session = Depends(get_db)
):
    channels = db.query(MarketingChannel).filter(MarketingChannel.store_id == store_id).all()
    if not channels:
        # Return defaults if none exist
        return [
            {"id": "c1", "name": "WhatsApp", "type": "WHATSAPP", "status": "CONNECTED", "health_score": 98},
            {"id": "c2", "name": "Instagram DM", "type": "INSTAGRAM", "status": "CONNECTED", "health_score": 94},
            {"id": "c3", "name": "SMS (DZ)", "type": "SMS", "status": "CONNECTED", "health_score": 91},
            {"id": "c4", "name": "SMTP Email", "type": "EMAIL", "status": "CONNECTED", "health_score": 100},
        ]
    return channels

@router.post("/channels", response_model=ChannelSchema)
def create_channel(payload: dict, db: Session = Depends(get_db)):
    store_id = payload.get("store_id")
    if not store_id:
        raise HTTPException(status_code=400, detail="store_id requis")
    channel = MarketingChannel(
        id=str(uuid.uuid4()),
        name=payload.get("name", ""),
        type=payload.get("type", "WHATSAPP"),
        status=payload.get("status", "CONNECTED"),
        health_score=payload.get("health_score", 100),
        config={"identifier": payload.get("identifier", "")},
        store_id=store_id,
    )
    db.add(channel)
    db.commit()
    db.refresh(channel)
    return channel


@router.patch("/channels/{channel_id}", response_model=ChannelSchema)
def update_channel(channel_id: str, payload: dict, db: Session = Depends(get_db)):
    channel = db.query(MarketingChannel).filter(MarketingChannel.id == channel_id).first()
    if not channel:
        raise HTTPException(status_code=404, detail="Canal introuvable")
    for field in ("name", "status", "health_score", "config"):
        if field in payload:
            setattr(channel, field, payload[field])
    db.commit()
    db.refresh(channel)
    return channel


@router.delete("/channels/{channel_id}")
def delete_channel(channel_id: str, db: Session = Depends(get_db)):
    channel = db.query(MarketingChannel).filter(MarketingChannel.id == channel_id).first()
    if not channel:
        raise HTTPException(status_code=404, detail="Canal introuvable")
    db.delete(channel)
    db.commit()
    return {"success": True}


@router.get("/templates", response_model=List[TemplateSchema])
def get_templates(
    store_id: str,
    db: Session = Depends(get_db)
):
    return db.query(MessageTemplate).filter(MessageTemplate.store_id == store_id).all()

@router.post("/templates", response_model=TemplateSchema)
def create_template(
    template: MessageTemplateCreate,
    db: Session = Depends(get_db)
):
    store_id = template.store_id
    if not store_id:
        raise HTTPException(status_code=400, detail="store_id requis")
    db_obj = MessageTemplate(
        id=str(uuid.uuid4()),
        name=template.name,
        type=template.type,
        language=template.language,
        content=template.content,
        store_id=store_id
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


@router.delete("/templates/{template_id}")
def delete_template(template_id: str, db: Session = Depends(get_db)):
    obj = db.query(MessageTemplate).filter(MessageTemplate.id == template_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Template introuvable")
    db.delete(obj)
    db.commit()
    return {"success": True}


@router.get("/campaigns")
def get_campaigns(
    store_id: str,
    db: Session = Depends(get_db)
):
    from app.models.marketing import MarketingCampaign
    return db.query(MarketingCampaign).filter(MarketingCampaign.store_id == store_id).all()


@router.post("/campaigns", status_code=201)
def create_campaign(
    payload: dict,
    db: Session = Depends(get_db)
):
    from app.models.marketing import MarketingCampaign
    campaign = MarketingCampaign(
        id=str(uuid.uuid4()),
        store_id=payload.get("store_id", ""),
        name=payload.get("name", ""),
        type=payload.get("type", "WHATSAPP"),
        status=payload.get("status", "DRAFT"),
        scheduled_at=payload.get("scheduled_at"),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(
    campaign_id: str,
    db: Session = Depends(get_db)
):
    from app.models.marketing import MarketingCampaign
    campaign = db.query(MarketingCampaign).filter(MarketingCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campagne introuvable")
    db.delete(campaign)
    db.commit()
    return {"success": True}

@router.get("/automations", response_model=List[AutomationSchema])
def get_automations(
    store_id: str,
    db: Session = Depends(get_db)
):
    return db.query(MarketingAutomation).filter(MarketingAutomation.store_id == store_id).all()

@router.post("/automations/toggle/{automation_id}")
def toggle_automation(
    automation_id: str,
    db: Session = Depends(get_db)
):
    auto = db.query(MarketingAutomation).filter(MarketingAutomation.id == automation_id).first()
    if not auto:
        raise HTTPException(status_code=404, detail="Automation non trouvée")
    auto.is_active = not auto.is_active  # type: ignore[assignment]
    db.commit()
    return {"success": True, "isActive": auto.is_active}


# ─── Visitor Capture ─────────────────────────────────────────

@router.post("/visitors", response_model=dict)
def capture_visitor(
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
) -> Any:
    """
    Public endpoint — no auth required.
    Records a storefront visitor who filled the capture form.
    """
    store_id = payload.get("store_id")
    if not store_id:
        raise HTTPException(status_code=400, detail="store_id requis")

    # Avoid duplicate submissions from the same session
    session_id = payload.get("session_id")
    if session_id:
        existing = db.query(StoreVisitor).filter(
            StoreVisitor.session_id == session_id,
            StoreVisitor.store_id == store_id,
        ).first()
        if existing:
            return {"success": True, "id": existing.id, "duplicate": True}

    visitor = StoreVisitor(
        id=str(uuid.uuid4()),
        store_id=store_id,
        name=payload.get("name"),
        phone=payload.get("phone"),
        email=payload.get("email"),
        source=payload.get("source"),
        page=payload.get("page", "/"),
        user_agent=request.headers.get("user-agent"),
        session_id=session_id,
        visited_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(visitor)
    
    # Also create/update Customer record as a "Guest" (Invite)
    phone = payload.get("phone")
    if phone:
        existing_customer = db.query(Customer).filter(
            Customer.phone == phone,
            Customer.store_id == store_id
        ).first()
        
        if not existing_customer:
            new_customer = Customer(
                id=str(uuid.uuid4()),
                store_id=store_id,
                phone=phone,
                name=payload.get("name") or "Invité",
                email=payload.get("email"),
                is_guest=True,
                source="INVITED",
                tier="BRONZE"
            )
            db.add(new_customer)
        elif existing_customer.is_guest:
            # Update info if they were already a guest
            if payload.get("name"): existing_customer.name = payload.get("name")
            if payload.get("email"): existing_customer.email = payload.get("email")

    db.commit()
    db.refresh(visitor)
    return {"success": True, "id": visitor.id}


@router.get("/visitors", response_model=dict)
def list_visitors(
    store_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    converted: Optional[bool] = None,
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    """List all visitors for a store (admin only)."""
    query = db.query(StoreVisitor).filter(StoreVisitor.store_id == store_id)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (StoreVisitor.name.ilike(like)) |
            (StoreVisitor.phone.ilike(like)) |
            (StoreVisitor.email.ilike(like))
        )
    if converted is not None:
        query = query.filter(StoreVisitor.converted == converted)

    total = query.count()
    visitors = query.order_by(desc(StoreVisitor.visited_at)).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "success": True,
        "data": [
            {
                "id": v.id,
                "name": v.name,
                "phone": v.phone,
                "email": v.email,
                "source": v.source,
                "page": v.page,
                "converted": v.converted,
                "visited_at": v.visited_at.isoformat() if v.visited_at else None,
            }
            for v in visitors
        ],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@router.patch("/visitors/{visitor_id}/convert", response_model=dict)
def mark_converted(
    visitor_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    v = db.query(StoreVisitor).filter(StoreVisitor.id == visitor_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visiteur introuvable")
    v.converted = True  # type: ignore[assignment]
    v.conversion_order_id = payload.get("order_id")  # type: ignore[assignment]
    db.commit()
    return {"success": True}
