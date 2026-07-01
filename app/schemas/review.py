from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime

class ReviewBase(BaseModel):
    product_id: Optional[str] = None
    store_id: str
    customer_name: str
    rating: int = Field(ge=1, le=5)
    title: Optional[str] = None
    comment: str

class ReviewCreate(ReviewBase):
    pass

class ReviewUpdate(BaseModel):
    is_approved: Optional[bool] = None
    is_verified: Optional[bool] = None

class ReviewInDBBase(ReviewBase):
    id: str
    is_verified: bool
    is_approved: bool
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class Review(ReviewInDBBase):
    pass

class ReviewStats(BaseModel):
    success: bool
    reviews: List[Review]
    total: int
    averageRating: float
    ratingDistribution: Dict[int, int]
    page: int
    pageSize: int
    totalPages: int
