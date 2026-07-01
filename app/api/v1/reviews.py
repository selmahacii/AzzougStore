from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, func
from typing import Optional
from app.db.session import get_db
from app.models.review import Review
from app.models.product import Product
from app.schemas.review import Review as ReviewSchema, ReviewCreate, ReviewUpdate
from app.api import deps

router = APIRouter()

@router.get("/")
def get_reviews(
    product_id: Optional[str] = Query(None),
    store_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, alias="pageSize", ge=1, le=50),
    sort_by: str = Query("createdAt"),
    sort_dir: str = Query("desc"),
    is_admin: bool = Query(False),
    approved: Optional[bool] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(Review)
    
    if product_id:
        query = query.filter(Review.product_id == product_id)
    if store_id:
        query = query.filter(Review.store_id == store_id)
        
    if approved is not None:
        query = query.filter(Review.is_approved == approved)
    elif not is_admin:
        query = query.filter(Review.is_approved == True)

    total = query.count()
    
    # Calculate stats filter
    stats_filter = (Review.is_approved == True)
    if product_id:
        stats_filter &= (Review.product_id == product_id)
    if store_id:
        stats_filter &= (Review.store_id == store_id)

    # Calculate stats on approved reviews only
    stats_query = db.query(
        func.avg(Review.rating).label("avg_rating"),
        func.count(Review.id).label("count")
    ).filter(stats_filter).first()
    
    avg_rating = round(stats_query.avg_rating or 0, 1)
    
    # Group by rating
    distribution_query = db.query(
        Review.rating,
        func.count(Review.id).label("count")
    ).filter(stats_filter).group_by(Review.rating).all()
    
    distribution = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    for row in distribution_query:
        distribution[row.rating] = row.count

    if sort_by == 'rating':
        order_col = Review.rating
    else:
        order_col = Review.created_at

    order = desc(order_col) if sort_dir == 'desc' else asc(order_col)
    
    reviews = query.order_by(order).offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "success": True,
        "reviews": reviews,
        "total": total,
        "averageRating": avg_rating,
        "ratingDistribution": distribution,
        "page": page,
        "pageSize": page_size,
        "totalPages": (total + page_size - 1) // page_size if page_size > 0 else 0
    }

@router.post("/")
def create_review(
    review_in: ReviewCreate,
    db: Session = Depends(get_db)
):
    product = db.query(Product).filter(Product.id == review_in.product_id, Product.is_active == True).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable")
        
    if product.store_id != review_in.store_id:
        raise HTTPException(status_code=400, detail="Produit n'appartient pas à la boutique")
        
    db_review = Review(
        product_id=review_in.product_id,
        store_id=review_in.store_id,
        customer_name=review_in.customer_name.strip(),
        rating=review_in.rating,
        title=review_in.title.strip() if review_in.title else None,
        comment=review_in.comment.strip(),
        is_verified=False,
        is_approved=True
    )
    
    db.add(db_review)
    db.commit()
    db.refresh(db_review)
    
    return {
        "success": True,
        "data": db_review,
        "message": "Avis publié avec succès."
    }

@router.patch("/{review_id}", response_model=ReviewSchema)
def update_review(
    review_id: str,
    review_in: ReviewUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(deps.get_current_active_user)
):
    db_review = db.query(Review).filter(Review.id == review_id).first()
    if not db_review:
        raise HTTPException(status_code=404, detail="Avis introuvable")
        
    if review_in.is_approved is not None:
        db_review.is_approved = review_in.is_approved
    if review_in.is_verified is not None:
        db_review.is_verified = review_in.is_verified
        
    db.commit()
    db.refresh(db_review)
    return db_review
    
@router.delete("/{review_id}")
def delete_review(
    review_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(deps.get_current_active_user)
):
    db_review = db.query(Review).filter(Review.id == review_id).first()
    if not db_review:
        raise HTTPException(status_code=404, detail="Avis introuvable")
    
    db.delete(db_review)
    db.commit()
    return {"success": True, "message": "Avis supprimé"}
