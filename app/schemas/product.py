from typing import List, Optional, Any, Union
from pydantic import BaseModel, field_validator
from datetime import datetime
import json


class ProductBase(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    external_id: Optional[str] = None
    description: Optional[str] = None

    # Monetary (DA integers)
    price: Optional[int] = 0
    compare_price: Optional[int] = None
    cost_price: Optional[int] = 0

    # Classification
    brand: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = []

    # Inventory
    stock: Optional[int] = 0
    low_stock_threshold: Optional[int] = 5

    # Media
    main_image: Optional[str] = None      # Primary display image URL
    images: Optional[List[str]] = []
    variants: Optional[List[Any]] = []

    # Flags
    is_active: Optional[bool] = True
    is_featured: Optional[bool] = False
    is_upsell_only: Optional[bool] = False
    is_pack: Optional[bool] = False
    pack_items: Optional[List[Any]] = []
    pack_charges: Optional[List[Any]] = []
    pack_margin: Optional[float] = 0.0
    pack_options: Optional[List[Any]] = []

    # Marketing & Logistics
    marketer_percentage: Optional[float] = None
    shipping_model: Optional[str] = None
    page_url: Optional[str] = None

    store_id: Optional[str] = None

    # Production & Logistics
    production_source: Optional[str] = 'imported'
    prod_supplier_name: Optional[str] = None
    prod_batch_qty: Optional[int] = 1
    prod_fabric_cost: Optional[int] = 0
    prod_fabric_supplier: Optional[str] = None
    prod_accessories_cost: Optional[int] = 0
    prod_accessories_supplier: Optional[str] = None
    prod_labor_cut_cost: Optional[int] = 0
    prod_labor_cut_supplier: Optional[str] = None
    prod_labor_sew_cost: Optional[int] = 0
    prod_labor_sew_supplier: Optional[str] = None
    prod_labor_finish_cost: Optional[int] = 0
    prod_labor_finish_supplier: Optional[str] = None
    prod_packaging_cost: Optional[int] = 0
    prod_packaging_supplier: Optional[str] = None
    prod_transport_cost: Optional[int] = 0
    prod_transport_supplier: Optional[str] = None
    prod_other_cost: Optional[int] = 0
    prod_other_supplier: Optional[str] = None
    prod_notes: Optional[str] = None
    allowed_carriers: Optional[List[str]] = []
    prod_custom_charges: Optional[List[Any]] = []
    delivery_fees: Optional[Union[dict, list, str]] = None

    @field_validator('images', 'variants', 'tags', 'allowed_carriers', 'pack_items', 'pack_charges', 'pack_options', 'prod_custom_charges', 'delivery_fees', mode='before')
    @classmethod
    def parse_json_string(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return v
        return v or []


class ProductCreate(ProductBase):
    name: str  # pyrefly: ignore[bad-override-mutable-attribute]
    price: int  # pyrefly: ignore[bad-override-mutable-attribute]
    store_id: str  # pyrefly: ignore[bad-override-mutable-attribute]


class ProductUpdate(ProductBase):
    pass


class ProductInDBBase(ProductBase):
    id: Optional[str] = None
    reserved_stock: Optional[int] = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    # Review stats (computed from relationships, not stored)
    review_count: Optional[int] = 0
    average_rating: Optional[float] = None

    class Config:
        from_attributes = True


class Product(ProductInDBBase):
    pass


class ProductList(BaseModel):
    data: List[Product]
    total: int
    page: int
    pageSize: int
    totalPages: int
    categories: Optional[List[str]] = []


class ProductSearchResult(BaseModel):
    """Lightweight product for search dropdowns (order creation)."""
    id: str
    name: str
    sku: Optional[str] = None
    price: int
    stock: int
    reserved_stock: int = 0
    images: List[str] = []
    category: Optional[str] = None

    class Config:
        from_attributes = True
