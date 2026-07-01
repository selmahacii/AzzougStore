from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.api import deps
from app.models.pos import POSSession, POSSale, POSSaleItem
from app.schemas.pos import POSSaleCreate, POSSale as POSSaleSchema, POSSessionCreate, POSSession as POSSessionSchema, POSSessionUpdate
import uuid
from datetime import datetime

router = APIRouter()

@router.post("/session", response_model=POSSessionSchema)
def create_session(
    *,
    db: Session = Depends(deps.get_db),
    session_in: POSSessionCreate
) -> Any:
    """Create a new POS session."""
    session = POSSession(**session_in.model_dump())
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

@router.get("/session/active", response_model=Optional[POSSessionSchema])
def get_active_session(
    *,
    db: Session = Depends(deps.get_db),
    store_id: str,
    user_id: str
) -> Any:
    """Get the active POS session for a user in a store."""
    session = db.query(POSSession).filter(
        POSSession.store_id == store_id,
        POSSession.user_id == user_id,
        POSSession.status == "OPEN"
    ).first()
    return session

@router.post("/sale", response_model=POSSaleSchema)
def create_sale(
    *,
    db: Session = Depends(deps.get_db),
    sale_in: POSSaleCreate
) -> Any:
    """Process a new POS sale."""
    # Check if session is still open
    session = db.query(POSSession).filter(POSSession.id == sale_in.session_id).first()
    if not session or session.status != "OPEN":
        raise HTTPException(status_code=400, detail="POS session is not active")

    # Generate receipt number
    timestamp = datetime.now().strftime("%y%m%d%H%M")
    unique = str(uuid.uuid4())[:4].upper()
    receipt_number = f"REC-{timestamp}-{unique}"

    # --- ATOMIC STOCK DEDUCTION LOGIC ---
    try:
        from app.models.product import Product
        from app.models.stock import StockMovement
        
        # 1. Validation phase (Check availability without locking yet for better performance)
        for item_in in sale_in.items:
            product = db.query(Product).filter(Product.id == item_in.product_id).first()
            if not product:
                raise HTTPException(status_code=404, detail=f"Produit {item_in.product_name} introuvable")
            if product.stock < item_in.quantity:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Stock insuffisant pour {product.name} (Disponible: {product.stock}, Requis: {item_in.quantity})"
                )

        # 2. Execution phase (Locking records and updating)
        sale = POSSale(
            receipt_number=receipt_number,
            **sale_in.model_dump(exclude={'items'})
        )
        db.add(sale)
        db.flush() 

        for item_in in sale_in.items:
            # Lock the product row to prevent concurrent updates
            product = db.query(Product).filter(Product.id == item_in.product_id).with_for_update().first()
            
            # Re-check stock in case it changed between validation and lock
            if product.stock < item_in.quantity:
                raise HTTPException(status_code=400, detail=f"Conflit de stock sur {product.name}")

            # Decrement Physical Stock
            product.stock -= item_in.quantity
            
            # Create Sale Item Record
            item = POSSaleItem(
                sale_id=sale.id,
                **item_in.model_dump()
            )
            db.add(item)

            # Record Stock Movement for Traceability (linked to the resto of the system)
            movement = StockMovement(**{
                "id": str(uuid.uuid4()),
                "product_id": item_in.product_id,
                "type": "POS_SALE",
                "quantity": -item_in.quantity,
                "reason": f"Vente POS {receipt_number}",
                "actor_id": session.user_id
            })
            db.add(movement)

        db.commit()
        db.refresh(sale)
        return sale

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Échec critique de la transaction : {str(e)}")

@router.get("/sales", response_model=List[POSSaleSchema])
def get_sales(
    *,
    db: Session = Depends(deps.get_db),
    store_id: str,
    skip: int = 0,
    limit: int = 100
) -> Any:
    """Get POS sales for a store."""
    return db.query(POSSale).filter(POSSale.store_id == store_id).offset(skip).limit(limit).all()
