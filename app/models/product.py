from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, JSON, Float, UniqueConstraint, DateTime, func, Index
from sqlalchemy.orm import relationship
from app.db.base_class import Base


class Product(Base):
    __tablename__ = "products"  # pyrefly: ignore[bad-override]

    # ─── Table Arguments: Unique Constraint & Composite Indexes ───
    __table_args__ = (
        UniqueConstraint('store_id', 'slug', name='uq_store_product_slug'),
        Index('idx_product_store_active', 'store_id', 'is_active'),
        Index('idx_product_store_category', 'store_id', 'category'),
    )

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)

    name = Column(String, nullable=False)
    slug = Column(String, nullable=False)
    sku = Column(String, index=True, nullable=True)           # Stock Keeping Unit
    barcode = Column(String, index=True, nullable=True)       # EAN/UPC
    external_id = Column(String, nullable=True)               # External system ID (e.g. marketplace)
    description = Column(String, nullable=True)

    # ─── Monetary fields in Algerian Dinar (DA) — Integer ───
    price = Column(Integer, nullable=False)
    compare_price = Column(Integer, nullable=True)
    cost_price = Column(Integer, nullable=True)               # Hidden from public API

    # ─── Inventory ───
    stock = Column(Integer, default=0)                        # Physical stock
    reserved_stock = Column(Integer, default=0)               # Reserved for unconfirmed orders
    low_stock_threshold = Column(Integer, default=5)

    # ─── Media & Variants ───
    main_image = Column(String, nullable=True)               # Primary display image URL
    images = Column(JSON, default=[])                         # List of image URLs
    variants = Column(JSON, nullable=True)                    # [{name: 'Color', options: ['Red', 'Blue']}]

    # ─── Brand & Classification ───
    brand = Column(String, nullable=True)
    category = Column(String, index=True, nullable=True)
    tags = Column(JSON, default=[])                           # ["promo", "bestseller"]

    # ─── Business Flags ───
    is_active = Column(Boolean, default=True)
    is_featured = Column(Boolean, default=False)
    # Produit upsell indépendant : créé par l'admin uniquement pour être
    # proposé comme upsell (jamais rattaché à un produit principal via
    # UpsellRule), jamais visible sur le site, jamais dans les listes de
    # produits standard — seulement dans le sélecteur upsell dédié (voir
    # GET /products?include_upsell_only=true).
    is_upsell_only = Column(Boolean, default=False)
    is_pack = Column(Boolean, default=False)                  # Bundle/pack product
    pack_items = Column(JSON, default=list)                  # [{product_id, quantity, unit_cost}]
    pack_charges = Column(JSON, default=list)                # [{label, amount}]
    pack_margin = Column(Float, default=0.0)                 # calculated margin percentage
    pack_options = Column(JSON, default=list)                # options/variantes own to pack

    # ─── Marketing & Logistics ───
    marketer_percentage = Column(Float, nullable=True)        # Affiliate commission %
    shipping_model = Column(String, nullable=True)            # "flat", "calculated", "free"
    page_url = Column(String, nullable=True)                  # Landing page URL
    
    # ─── Production & Logistics ───
    production_source = Column(String, default='imported')    # 'imported' | 'local'
    prod_supplier_name = Column(String, nullable=True)
    prod_batch_qty = Column(Integer, default=1)
    prod_fabric_cost = Column(Integer, default=0)
    prod_fabric_supplier = Column(String, nullable=True)
    prod_accessories_cost = Column(Integer, default=0)
    prod_accessories_supplier = Column(String, nullable=True)
    prod_labor_cut_cost = Column(Integer, default=0)
    prod_labor_cut_supplier = Column(String, nullable=True)
    prod_labor_sew_cost = Column(Integer, default=0)
    prod_labor_sew_supplier = Column(String, nullable=True)
    prod_labor_finish_cost = Column(Integer, default=0)
    prod_labor_finish_supplier = Column(String, nullable=True)
    prod_packaging_cost = Column(Integer, default=0)
    prod_packaging_supplier = Column(String, nullable=True)
    prod_transport_cost = Column(Integer, default=0)
    prod_transport_supplier = Column(String, nullable=True)
    prod_other_cost = Column(Integer, default=0)
    prod_other_supplier = Column(String, nullable=True)
    prod_notes = Column(String, nullable=True)
    allowed_carriers = Column(JSON, default=[])               # List of carrier names/IDs
    prod_custom_charges = Column(JSON, default=[])            # List of custom charges {name, unit, qty, unit_cost, supplier, total}
    delivery_fees = Column(JSON, nullable=True)               # JSON field storing {is_free: bool, fees: {carrier_id: {wilaya_id: {home: float, desk: float}}}}

    # ─── Timestamps ───
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # ─── Relationships ───
    store = relationship("Store", back_populates="products")
    stock_movements = relationship("StockMovement", back_populates="product", cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="product", cascade="all, delete-orphan")
    order_items = relationship("OrderItem", back_populates="product")
    delivery_partners = relationship("ProductDeliveryPartner", back_populates="product", cascade="all, delete-orphan")
