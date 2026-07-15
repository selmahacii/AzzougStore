from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Dict, Any

from app.api.deps import get_db
from app.services.noest_mapping import WILAYAS, get_noest_communes

router = APIRouter()

@router.get("/wilayas", response_model=List[Dict[str, Any]])
def get_wilayas():
    """
    Returns the list of the 58 Algerian Wilayas.
    """
    wilayas_list = [
        {"id": idx + 1, "name": name}
        for idx, name in enumerate(WILAYAS)
    ]
    return wilayas_list

@router.get("/communes")
async def get_communes(
    wilaya_id: int = Query(..., description="The ID of the Wilaya (1-58)"),
    store_id: str = Query(..., description="Store ID for which to fetch communes (used for Noest integration)"),
    db: Session = Depends(get_db)
):
    """
    Returns the list of communes for a specific Wilaya.
    If Noest integration is available, fetches the official list from Noest.
    """
    if wilaya_id < 1 or wilaya_id > 58:
        raise HTTPException(status_code=400, detail="Invalid wilaya_id. Must be between 1 and 58.")
    
    communes = await get_noest_communes(db, store_id, wilaya_id)
    if not communes:
        return []
    
    return [{"name": c} for c in communes]
