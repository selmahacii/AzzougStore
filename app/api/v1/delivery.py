from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from app.db.session import get_db
from app.models.delivery import WilayaDeliveryFee
from app.schemas.delivery import DeliveryFee, DeliveryFeeCreate, DeliveryFeeUpdate, DeliveryFeeListResponse
from app.api import deps

router = APIRouter()

# Algierian Wilayas default list for DB init if empty
WILAYAS = [
    'Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa',
    'Biskra', 'Béchar', 'Blida', 'Bouira', 'Tamanrasset', 'Tébessa',
    'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger', 'Djelfa', 'Jijel',
    'Sétif', 'Saïda', 'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma',
    'Constantine', 'Médéa', 'Mostaganem', "M'Sila", 'Mascara', 'Ouargla',
    'Oran', 'El Bayadh', 'Illizi', 'Bordj Bou Arréridj', 'Boumerdès',
    'El Tarf', 'Tindouf', 'Tissemsilt', 'El Oued', 'Khenchela',
    'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent',
    'Ghardaïa', 'Relizane', 'Timimoun', 'Bordj Baji Mokhtar', 'Ouled Djellal',
    'Béni Abbès', 'In Salah', 'In Guezzam', 'Touggourt', 'Djanet',
    "El M'Ghair", 'El Meniaa'
]

def init_wilayas_if_empty(db: Session):
    count = db.query(WilayaDeliveryFee).count()
    if count == 0:
        for i, name in enumerate(WILAYAS):
            db.add(WilayaDeliveryFee(
                wilaya_id=i + 1,
                wilaya_name=name,
                home_fee=700.0,
                office_fee=400.0
            ))
        db.commit()
    else:
        # One-time repair: the 10 post-2019 wilayas (ids 49-58) were seeded
        # with a scrambled name order that didn't match Noest's actual
        # wilaya_id numbering (verified live: 49=Timimoun, 50=Bordj Baji
        # Mokhtar, 51=Ouled Djellal, 52=Béni Abbès, 53=In Salah,
        # 54=In Guezzam, 55=Touggourt, 56=Djanet, 57=El M'Ghair,
        # 58=El Meniaa). Fee values are preserved; only the label is fixed.
        for i, name in enumerate(WILAYAS):
            wid = i + 1
            if wid < 49:
                continue
            row = db.query(WilayaDeliveryFee).filter(WilayaDeliveryFee.wilaya_id == wid).first()
            if row and row.wilaya_name != name:
                row.wilaya_name = name
        db.commit()

@router.get("/", response_model=DeliveryFeeListResponse)
def get_all_delivery_fees(db: Session = Depends(get_db)):
    init_wilayas_if_empty(db)
    fees = db.query(WilayaDeliveryFee).order_by(WilayaDeliveryFee.wilaya_id).all()
    return {"success": True, "data": fees}

@router.get("/{wilaya_id}", response_model=DeliveryFee)
def get_delivery_fee(wilaya_id: int, db: Session = Depends(get_db)):
    init_wilayas_if_empty(db)
    fee = db.query(WilayaDeliveryFee).filter(WilayaDeliveryFee.wilaya_id == wilaya_id).first()
    if not fee:
        # Fallback for out of bound or new wilayas not initialized
        raise HTTPException(status_code=404, detail="Wilaya introuvable")
    return fee

@router.patch("/{wilaya_id}", response_model=DeliveryFee)
def update_delivery_fee(
    wilaya_id: int,
    fee_in: DeliveryFeeUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(deps.get_current_active_user) # Only auth users can modify
):
    init_wilayas_if_empty(db)
    fee_db = db.query(WilayaDeliveryFee).filter(WilayaDeliveryFee.wilaya_id == wilaya_id).first()
    if not fee_db:
        raise HTTPException(status_code=404, detail="Wilaya introuvable")
        
    update_data = fee_in.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(fee_db, field, value)
        
    db.commit()
    db.refresh(fee_db)
    return fee_db
