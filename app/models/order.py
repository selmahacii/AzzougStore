from sqlalchemy import Column, String, Integer, ForeignKey, Boolean, JSON, DateTime, Text, Index
from sqlalchemy.orm import relationship
from app.db.base_class import Base

class Order(Base):
    __tablename__ = "orders"  # pyrefly: ignore[bad-override]

    __table_args__ = (
        Index('idx_order_store_status', 'store_id', 'status'),
        Index('idx_order_store_created', 'store_id', 'created_at'),
        Index('idx_order_store_deleted', 'store_id', 'is_deleted'),
    )

    id = Column(String, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    order_number = Column(String, unique=True, index=True, nullable=False)
    # Sequential number per store — shown to admin/agents as "Commande N°X"
    # The ORD-XXXXX order_number is shown to customers only
    store_sequence_number = Column(Integer, nullable=True, index=True)
    
    # Customer Info
    customer_name = Column(String, nullable=False)
    customer_phone = Column(String, index=True, nullable=False)
    customer_phone2 = Column(String, nullable=True)
    customer_email = Column(String, nullable=True)
    customer_address = Column(Text, nullable=False)
    customer_wilaya = Column(String, index=True, nullable=False)
    customer_commune = Column(String, nullable=True)
    
    # Logistics
    delivery_type = Column(String, default="HOME") # HOME | OFFICE
    delivery_fee = Column(Integer, default=0)
    tracking_number = Column(String, nullable=True)
    carrier_id = Column(String, ForeignKey("delivery_partners.id"), nullable=True)
    
    # Financials (in DA)
    subtotal    = Column(Integer, default=0)
    discount    = Column(Integer, default=0)
    total       = Column(Integer, nullable=False)
    promo_code  = Column(String, nullable=True)   # applied coupon/promo code
    
    # Status & Assignment
    status = Column(String, default="NEW") # NEW|ASSIGNED|CALLED|CONFIRMED|SHIPPED|DELIVERED|RETURNED
    assigned_to = Column(String, ForeignKey("users.id"), nullable=True)
    customer_id = Column(String, ForeignKey("customers.id"), nullable=True)
    
    # Acquisition & Source
    source = Column(String, nullable=True) # "facebook", "tiktok", etc.
    utm_source = Column(String, nullable=True)
    utm_medium = Column(String, nullable=True)
    utm_campaign = Column(String, nullable=True)
    utm_content = Column(String, nullable=True)
    utm_term = Column(String, nullable=True)

    # Meta Ads attribution — captured on the storefront at first touch and
    # stored on the order so the admin can trace campaign → order → revenue,
    # and so the CAPI Purchase carries fbp/fbc for maximum match quality.
    campaign_id = Column(String, nullable=True, index=True)
    adset_id = Column(String, nullable=True)
    ad_id = Column(String, nullable=True)
    fbclid = Column(String, nullable=True)
    fbp = Column(String, nullable=True)
    fbc = Column(String, nullable=True)
    referrer = Column(String, nullable=True)
    event_source_url = Column(String, nullable=True)
    
    notes = Column(Text, nullable=True)
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)
    
    # Characteristics & Tracking
    is_pack = Column(Boolean, default=False)
    is_upsell = Column(Boolean, default=False)
    is_abandoned_cart = Column(Boolean, default=False)
    abandoned_cart_recovery_fee = Column(Integer, default=0)
    is_duplicate = Column(Boolean, default=False)

    # Business origin marker: set once, the first time an abandoned cart is
    # confirmed by a confirmatrice. The order TYPE (normal / abandoned /
    # recovered) derives from is_abandoned_cart + recovered_at and NEVER
    # changes afterwards, whatever happens to the status.
    recovered_at = Column(DateTime, nullable=True)

    # Delivery agent (role LIVREUR) the confirmatrice hands the parcel to
    livreur_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)

    # Duplicate merge tracking — a MERGED order points to the surviving parent
    parent_order_id = Column(String, nullable=True, index=True)
    merged_by = Column(String, nullable=True)
    merged_at = Column(DateTime, nullable=True)
    status_before_merge = Column(String, nullable=True)
    
    # Confirmation Workflow
    confirmation_start_time = Column(DateTime, nullable=True)
    nrp_count = Column(Integer, default=0)
    next_callback_time = Column(DateTime, nullable=True)

    store = relationship("Store", back_populates="orders")
    assignee = relationship("User", back_populates="assigned_orders", foreign_keys=[assigned_to])
    livreur = relationship("User", foreign_keys=[livreur_id])
    customer = relationship("Customer", back_populates="orders")
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    events = relationship("OrderEvent", back_populates="order", cascade="all, delete-orphan")
    carrier = relationship("DeliveryPartner", back_populates="orders")

class OrderItem(Base):
    __tablename__ = "order_items"  # pyrefly: ignore[bad-override]

    id = Column(String, primary_key=True, index=True)
    order_id = Column(String, ForeignKey("orders.id"), nullable=False)
    product_id = Column(String, ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    
    # Snapshot data (to preserve history)
    product_name = Column(String, nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Integer, nullable=False)
    variant_details = Column(JSON, nullable=True)
    image_url = Column(String, nullable=True)

    order = relationship("Order", back_populates="items")
    product = relationship("Product", back_populates="order_items")
