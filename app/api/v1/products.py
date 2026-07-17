from typing import Any, List, Optional
import logging
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from uuid import uuid4
from datetime import datetime, timedelta

from app.api import deps
from app.models.product import Product
from app.models.order import Order, OrderItem
from app.schemas.product import (
    Product as ProductSchema,
    ProductCreate,
    ProductUpdate,
    ProductList,
    ProductSearchResult
)
from app.db.session import get_db

router = APIRouter()
logger = logging.getLogger("app.products")

# Back-office roles that get cross-store product visibility (a livreur serving
# several stores must browse and restock each one's catalogue). The storefront
# and unauthenticated traffic are never in this set and stay tenant-isolated.
_STAFF_ROLES = ("SUPER_ADMIN", "ADMIN", "MANAGER", "LIVREUR", "CONFIRMATEUR", "AGENT", "AGENT_MANAGER", "MARKETER")


def _generate_slug(name: str) -> str:
    """Generate URL-friendly slug from product name."""
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[àáâãäå]", "a", slug)
    slug = re.sub(r"[èéêë]", "e", slug)
    slug = re.sub(r"[ìíîï]", "i", slug)
    slug = re.sub(r"[òóôõö]", "o", slug)
    slug = re.sub(r"[ùúûü]", "u", slug)
    slug = re.sub(r"[ç]", "c", slug)
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug


@router.get("/search", response_model=List[ProductSearchResult])
def search_products_lightweight(
    db: Session = Depends(get_db),
    store_id: Optional[str] = None,
    q: Optional[str] = Query(None, min_length=1),
    limit: int = Query(20, le=50),
    in_stock: bool = False
):
    """
    Lightweight product search for order creation dropdowns.
    Returns minimal fields for fast typeahead.
    """
    query = db.query(Product).filter(Product.is_active == True)

    if store_id:
        query = query.filter(Product.store_id == store_id)
    if in_stock:
        query = query.filter(Product.stock > 0)
    if q:
        query = query.filter(
            (Product.name.ilike(f"%{q}%")) |
            (Product.sku.ilike(f"%{q}%")) |
            (Product.barcode.ilike(f"%{q}%"))
        )

    return query.limit(limit).all()


@router.get("/categories", response_model=List[str])
def get_categories(
    db: Session = Depends(get_db),
    store_id: Optional[str] = None
):
    """
    Get all distinct categories for a store (used in sidebar filters).
    """
    query = db.query(Product.category).filter(
        Product.is_active == True,
        Product.category.isnot(None)
    )
    if store_id:
        query = query.filter(Product.store_id == store_id)

    categories = query.distinct().all()
    return [c[0] for c in categories if c[0]]


@router.get("/", response_model=ProductList)
def read_products(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=2000),
    store_id: Optional[str] = None,
    search: Optional[str] = None,
    category: Optional[str] = None,
    slug: Optional[str] = None,
    is_active: Optional[bool] = None,
    is_featured: Optional[bool] = None,
    featured: Optional[bool] = None,
    in_stock: Optional[bool] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    promo: Optional[bool] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    include_upsell_only: bool = Query(False),
    current_user: Optional[Any] = Depends(deps.get_current_user_optional)
) -> Any:
    """
    Retrieve products. Public when store_id is provided (storefront), auth required for admin.

    include_upsell_only=false (default, every caller today) excludes
    products created purely as independent upsell offers — never shown on
    the storefront, never cluttering the regular admin/agent product
    pickers. Only the dedicated upsell-candidate picker passes
    include_upsell_only=true, which is the ONLY place these products
    become visible — matching "visible uniquement dans la section upsell,
    jamais sur le site". Staff vs. public status does NOT gate this (both
    default to excluded) — a separate, explicit axis from is_active.
    """
    logger.debug(f"[Products] Listing: store_id={store_id!r}, page={page}, pageSize={pageSize}, search={search!r}, category={category!r}, user={getattr(current_user, 'email', 'anon')!r}")

    # Authenticated back-office staff (livreur/confirmateur/manager/admin) are
    # allowed cross-store product visibility — a livreur switches between the
    # stores they serve and must see each one's catalogue. The SELECT tenant
    # auto-filter otherwise pins every query to the single X-Store-Id header, so
    # switching store showed nothing. The explicit store_id query param below is
    # what scopes the result; unauthenticated storefront traffic keeps the tenant
    # isolation untouched.
    if current_user is not None and getattr(current_user, "role", None) in _STAFF_ROLES:
        db.info["skip_tenant_isolation"] = True

    query = db.query(Product)

    # Back-office staff manage products (incl. restocking inactive ones), so
    # they see every product and may filter by active state; the storefront and
    # unauthenticated traffic only ever see active products.
    is_staff = current_user is not None and getattr(current_user, "role", None) in _STAFF_ROLES
    if not is_staff:
        query = query.filter(Product.is_active == True)
    elif is_active is not None:
        query = query.filter(Product.is_active == is_active)

    if not include_upsell_only:
        query = query.filter(Product.is_upsell_only == False)

    if store_id:
        query = query.filter(Product.store_id == store_id)
    if search:
        query = query.filter(
            (Product.name.ilike(f"%{search}%")) |
            (Product.description.ilike(f"%{search}%")) |
            (Product.brand.ilike(f"%{search}%")) |
            (Product.sku.ilike(f"%{search}%")) |
            (Product.barcode.ilike(f"%{search}%"))
        )
    if category and category != "all":
        query = query.filter(Product.category == category)
    if slug:
        query = query.filter(Product.slug == slug)
    effective_featured = is_featured if is_featured is not None else featured
    if effective_featured is not None:
        query = query.filter(Product.is_featured == effective_featured)
    if in_stock:
        query = query.filter(Product.stock > 0)
    if min_price is not None:
        query = query.filter(Product.price >= min_price)
    if max_price is not None:
        query = query.filter(Product.price <= max_price)
    if promo:
        query = query.filter(Product.compare_price > Product.price)
        
    if start_date:
        from app.core.dates import parse_local_date_filter
        try:
            query = query.filter(Product.created_at >= parse_local_date_filter(start_date))
        except ValueError:
            pass

    if end_date:
        from app.core.dates import parse_local_date_filter
        try:
            query = query.filter(Product.created_at <= parse_local_date_filter(end_date))
        except ValueError:
            pass

    total = query.count()
    skip = (page - 1) * pageSize
    products = query.order_by(Product.created_at.desc()).offset(skip).limit(pageSize).all()
    logger.debug(f"[Products] Found {total} products for store_id={store_id!r}, page={page}")

    # Categories for sidebar
    cat_query = db.query(Product.category).filter(Product.is_active == True, Product.category.isnot(None))
    if store_id:
        cat_query = cat_query.filter(Product.store_id == store_id)
    categories_list = [c[0] for c in cat_query.distinct().all() if c[0]]

    return {
        "data": products,
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "totalPages": (total + pageSize - 1) // pageSize,
        "categories": categories_list
    }


@router.post("/", response_model=ProductSchema)
def create_product(
    *,
    db: Session = Depends(get_db),
    product_in: ProductCreate,
    current_user: Any = Depends(deps.get_current_active_user)
) -> Any:
    """
    Create new product. Accessible by ADMIN, MANAGER and LIVREUR (store-scoped).
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER", "LIVREUR"]:
        raise HTTPException(status_code=403, detail="Privilèges insuffisants pour créer un produit.")

    # Store ownership check (non-superadmin)
    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER") and current_user.employee_store_id and str(current_user.employee_store_id) != product_in.store_id:
        raise HTTPException(status_code=403, detail="Vous ne pouvez créer des produits que pour votre propre store.")

    # Auto-generate slug
    if not product_in.slug:
        product_in.slug = _generate_slug(product_in.name)

    # Auto-generate SKU if missing
    if not product_in.sku:
        prefix = (product_in.brand[:3].upper() if product_in.brand else "PRD")
        product_in.sku = f"{prefix}-{str(uuid4())[:8].upper()}"

    # Check uniqueness (slug per store)
    slug_conflict = db.query(Product).filter(
        Product.store_id == product_in.store_id,
        Product.slug == product_in.slug
    ).first()
    if slug_conflict:
        product_in.slug = f"{product_in.slug}-{str(uuid4())[:4]}"

    # Check SKU uniqueness per store
    if product_in.sku:
        sku_conflict = db.query(Product).filter(
            Product.store_id == product_in.store_id,
            Product.sku == product_in.sku
        ).first()
        if sku_conflict:
            raise HTTPException(
                status_code=400,
                detail=f"Un produit avec le SKU '{product_in.sku}' existe déjà dans cette boutique."
            )

    product = Product(
        id=str(uuid4()),
        **product_in.model_dump()
    )
    db.add(product)

    # Automatically create expenses for additional/custom product charges
    from app.models.expense import Expense, ExpenseCategory, ExpenseStatus
    from datetime import date
    
    expenses_to_add = []
    batch_qty = getattr(product_in, "prod_batch_qty", 1) or 1
    
    # 1. Frais annexes (prod_other_cost)
    other_cost = getattr(product_in, "prod_other_cost", 0)
    if other_cost and other_cost > 0:
        total_other_cost = other_cost * batch_qty
        other_supplier = getattr(product_in, "prod_other_supplier", "N/A")
        expenses_to_add.append(
            Expense(
                id=str(uuid4()),
                store_id=product_in.store_id,
                category=ExpenseCategory.PRODUCTION,
                label=f"Frais annexes (création) - {product_in.name}",
                description=f"Lot de {batch_qty} pcs. Fournisseur: {other_supplier}",
                amount=total_other_cost,
                total_amount=total_other_cost,
                status=ExpenseStatus.PAID,
                expense_date=date.today(),
                created_by=current_user.id if hasattr(current_user, 'id') else None
            )
        )
        
    # 2. Frais personnalisés (prod_custom_charges)
    custom_charges = getattr(product_in, "prod_custom_charges", [])
    for charge in custom_charges:
        if not isinstance(charge, dict):
            continue
        try:
            amt = int(charge.get("amount") or charge.get("cost") or 0)
            if amt > 0:
                label = charge.get("label", charge.get("name", "Frais personnalisé"))
                # Custom charges in the UI have "quantity" (qte) and "unit_cost" usually, or just "amount"
                qty = int(charge.get("quantity") or charge.get("qty") or batch_qty)
                total_custom_cost = amt * qty
                
                expenses_to_add.append(
                    Expense(
                        id=str(uuid4()),
                        store_id=product_in.store_id,
                        category=ExpenseCategory.PRODUCTION,
                        label=f"{label} - {product_in.name}",
                        description=f"Quantité: {qty}. Création de produit.",
                        amount=total_custom_cost,
                        total_amount=total_custom_cost,
                        status=ExpenseStatus.PAID,
                        expense_date=date.today(),
                        created_by=current_user.id if hasattr(current_user, 'id') else None
                    )
                )
        except Exception:
            pass

    for exp in expenses_to_add:
        db.add(exp)

    db.commit()
    db.refresh(product)
    return product


@router.get("/{id}", response_model=ProductSchema)
def read_product(
    *,
    db: Session = Depends(get_db),
    id: str,
    x_store_id: Optional[str] = Header(None, alias="X-Store-Id"),
    current_user: Optional[Any] = Depends(deps.get_current_user_optional)
) -> Any:
    """Get product by ID. Public storefront access is restricted to store tenant and hides secret cost/production fields."""
    is_staff = current_user is not None and getattr(current_user, "role", None) in _STAFF_ROLES
    # Staff browse across the stores they serve, so bypass the SELECT tenant
    # auto-filter (it otherwise 404'd the product when X-Store-Id didn't match
    # the store the livreur just switched to). Public traffic stays isolated.
    if is_staff:
        db.info["skip_tenant_isolation"] = True

    product = db.query(Product).filter(Product.id == id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable.")

    is_admin = current_user is not None and getattr(current_user, "role", None) in ("SUPER_ADMIN", "ADMIN", "MANAGER")

    if is_staff:
        # Back-office staff (livreur/confirmateur/marketer/manager/admin) may
        # view any store's product, active or not. MANAGER stays pinned to their
        # own store; everyone else with a staff role has cross-store visibility.
        if getattr(current_user, "role", None) == "MANAGER" and current_user.employee_store_id:
            if product.store_id != str(current_user.employee_store_id):
                raise HTTPException(status_code=403, detail="Accès refusé : Ce produit n'appartient pas à votre boutique.")
    else:
        # Public storefront: strict tenant isolation + active-only.
        if not x_store_id:
            raise HTTPException(status_code=400, detail="L'identifiant de la boutique (X-Store-Id) est requis.")
        if product.store_id != x_store_id:
            raise HTTPException(status_code=403, detail="Accès refusé : Ce produit n'appartient pas à cette boutique.")
        if not product.is_active:
            raise HTTPException(status_code=404, detail="Produit inactif ou introuvable.")

    # 2. Purge confidential industrial data if not an authorized manager/admin
    if not is_admin:
        # Purge pricing
        product.cost_price = 0
        product.pack_margin = 0.0
        # Purge production fields
        product.production_source = "imported"
        product.prod_supplier_name = None
        product.prod_batch_qty = 1
        product.prod_fabric_cost = 0
        product.prod_accessories_cost = 0
        product.prod_labor_cut_cost = 0
        product.prod_labor_sew_cost = 0
        product.prod_labor_finish_cost = 0
        product.prod_packaging_cost = 0
        product.prod_transport_cost = 0
        product.prod_other_cost = 0
        product.prod_notes = None
        product.prod_custom_charges = []

    return product


@router.put("/{id}", response_model=ProductSchema)
def update_product(
    *,
    db: Session = Depends(get_db),
    id: str,
    product_in: ProductUpdate,
    current_user: Any = Depends(deps.get_current_active_user)
) -> Any:
    """Update a product fully."""
    # CONFIRMATEUR n'a normalement aucun droit de modification produit — SAUF
    # sur un produit upsell indépendant (is_upsell_only=True), qu'elle doit
    # pouvoir gérer elle-même (stock, prix, variantes) en temps réel plutôt
    # que de dépendre de l'admin à chaque changement. Vérifié APRÈS avoir
    # chargé le produit puisque la décision dépend de son is_upsell_only.
    _is_confirmateur = current_user.role == "CONFIRMATEUR"
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER", "LIVREUR"] and not _is_confirmateur:
        raise HTTPException(status_code=403, detail="Privilèges insuffisants pour modifier un produit.")

    # Back-office staff (livreur included) edit products across stores in real
    # time; bypass the SELECT tenant auto-filter so a mismatched X-Store-Id
    # header doesn't 404 the lookup (same rationale as read_product / stock).
    db.info["skip_tenant_isolation"] = True
    product = db.query(Product).filter(Product.id == id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable.")

    if _is_confirmateur and not product.is_upsell_only:
        raise HTTPException(status_code=403, detail="La confirmatrice ne peut modifier que les produits upsell indépendants.")

    update_data = product_in.model_dump(exclude_unset=True)

    # Validate slug uniqueness if changed
    if "slug" in update_data and update_data["slug"] != product.slug:
        conflict = db.query(Product).filter(
            Product.store_id == product.store_id,
            Product.slug == update_data["slug"],
            Product.id != id
        ).first()
        if conflict:
            raise HTTPException(status_code=400, detail="Ce slug est déjà utilisé dans cette boutique.")

    for field, value in update_data.items():
        if hasattr(product, field):
            setattr(product, field, value)

    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.patch("/{id}/toggle", response_model=dict)
def toggle_product(
    *,
    db: Session = Depends(get_db),
    id: str,
    current_user: Any = Depends(deps.get_current_active_user)
) -> Any:
    """Toggle product active/inactive status."""
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER", "LIVREUR"]:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    # Livreur toggles products across stores too — see update_product.
    db.info["skip_tenant_isolation"] = True
    product = db.query(Product).filter(Product.id == id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable.")

    product.is_active = not bool(product.is_active)  # type: ignore[assignment]
    db.commit()
    return {
        "success": True,
        "is_active": product.is_active,
        "message": f"Produit {'activé' if product.is_active else 'désactivé'} avec succès."
    }


@router.post("/bulk-import", response_model=dict)
def bulk_import_products(
    *,
    db: Session = Depends(get_db),
    payload: dict,
    current_user: Any = Depends(deps.get_current_active_user)
) -> Any:
    """
    Bulk import products from a list.
    Expected: { store_id: "...", products: [...] }
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Privilèges insuffisants pour l'import groupé.")

    store_id = payload.get("store_id")
    products_data = payload.get("products", [])

    if not store_id or not products_data:
        raise HTTPException(status_code=400, detail="store_id et products sont requis.")

    created = 0
    skipped = 0
    errors = []

    for p_data in products_data:
        try:
            name = p_data.get("name", "").strip()
            if not name:
                skipped += 1
                continue

            slug = _generate_slug(name)
            # Make slug unique
            existing = db.query(Product).filter(Product.store_id == store_id, Product.slug == slug).first()
            if existing:
                slug = f"{slug}-{str(uuid4())[:4]}"

            sku = p_data.get("sku") or f"IMP-{str(uuid4())[:8].upper()}"

            product = Product(
                id=str(uuid4()),
                store_id=store_id,
                name=name,
                slug=slug,
                sku=sku,
                price=int(p_data.get("price", 0)),
                compare_price=p_data.get("compare_price"),
                cost_price=p_data.get("cost_price"),
                category=p_data.get("category"),
                brand=p_data.get("brand"),
                stock=int(p_data.get("stock", 0)),
                description=p_data.get("description"),
                images=p_data.get("images", []),
                is_active=p_data.get("is_active", True)
            )
            db.add(product)
            created += 1
        except Exception as e:
            skipped += 1
            errors.append({"name": p_data.get("name", "?"), "error": str(e)})

    db.commit()
    return {
        "success": True,
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "message": f"{created} produits importés, {skipped} ignorés."
    }


@router.patch("/{id}/stock", response_model=dict)
def quick_update_stock(
    *,
    db: Session = Depends(get_db),
    id: str,
    payload: dict,
    current_user: Any = Depends(deps.get_current_active_user)
) -> Any:
    """
    Quick stock update directly on product (for inline table edits).
    Expected: { stock: N }

    Only valid for products WITHOUT variants. For a variant product,
    product.stock is a DERIVED value — everywhere else (reserve/confirm/
    release/restock in inventory_service) treats each variant's own stock
    as the source of truth and recalculates the aggregate from their sum
    whenever any variant is touched. Blindly overwriting the aggregate here
    would get silently reverted back to the (unchanged) variant sum the
    next time any order touches this product, reappearing as "rupture"
    even though the admin just added stock. Use the per-variant adjustment
    (StockManager / POST /stock/) instead for those.
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER", "LIVREUR"]:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    # Ownership is enforced explicitly just below, so bypass the SELECT tenant
    # auto-filter for the lookup — it otherwise 404s a store-scoped livreur/
    # manager whenever the X-Store-Id header doesn't line up with the product.
    db.info["skip_tenant_isolation"] = True
    product = db.query(Product).filter(Product.id == id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable.")

    if product.variants:
        raise HTTPException(
            status_code=400,
            detail="Ce produit a des variantes : ajustez le stock par variante (module Inventaire) plutôt que le total, "
                   "sinon la modification sera écrasée au prochain mouvement de stock.",
        )

    new_stock = payload.get("stock")
    if new_stock is None or int(new_stock) < 0:
        raise HTTPException(status_code=400, detail="Stock invalide (doit être >= 0).")

    new_stock = int(new_stock)
    old_stock = product.stock or 0
    delta = new_stock - old_stock

    # Invariant du module Inventaire : aucun stock ne change sans mouvement
    # traçable. Cette route l'ignorait — un admin pouvait taper un chiffre
    # dans le tableau et le stock changeait sans laisser aucune trace (pas
    # d'auteur, pas de raison, pas de "avant/après").
    if delta != 0:
        import uuid as _uuid
        from app.models.stock import StockMovement
        db.add(StockMovement(
            id=str(_uuid.uuid4()),
            product_id=product.id,
            type="MANUAL_ADJUSTMENT",
            quantity=delta,
            actor_id=getattr(current_user, "id", None),
            reason=f"Ajustement rapide (tableau) : {old_stock} → {new_stock}",
        ))

    product.stock = new_stock  # type: ignore[assignment]
    db.commit()
    return {"success": True, "id": id, "stock": product.stock}


@router.delete("/{id}", response_model=dict)
def delete_product(
    *,
    db: Session = Depends(get_db),
    id: str,
    current_user: Any = Depends(deps.get_current_active_user)
) -> Any:
    """
    Hard-delete a product. FK children (order_items, reviews, etc.) are SET NULL on product_id;
    stock_movements are CASCADE deleted. Only ADMIN and SUPER_ADMIN can delete.
    """
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Seul un administrateur peut supprimer un produit.")

    product = db.query(Product).filter(Product.id == id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable.")

    if current_user.role not in ("SUPER_ADMIN", "ADMIN", "MANAGER") and current_user.employee_store_id and str(current_user.employee_store_id) != str(product.store_id):
        raise HTTPException(status_code=403, detail="Accès refusé.")

    from sqlalchemy import text
    from app.models.order import OrderItem

    # If the product has order history, soft-delete (deactivate) to preserve records
    has_orders = db.query(OrderItem).filter(OrderItem.product_id == id).first() is not None
    if has_orders:
        product.is_active = False  # type: ignore[assignment]
        db.commit()
        return {"success": True, "id": id, "soft": True, "message": "Produit désactivé (historique de commandes conservé)."}

    # No order history — safe to hard-delete after clearing other FK refs
    db.execute(text("UPDATE stock_movements SET product_id = NULL WHERE product_id = :pid"), {"pid": id})
    db.execute(text("UPDATE purchase_items  SET product_id = NULL WHERE product_id = :pid"), {"pid": id})
    db.execute(text("UPDATE pos_sale_items  SET product_id = NULL WHERE product_id = :pid"), {"pid": id})
    db.execute(text("UPDATE return_items    SET product_id = NULL WHERE product_id = :pid"), {"pid": id})

    db.delete(product)
    db.commit()
    return {"success": True, "id": id, "soft": False, "message": "Produit supprimé définitivement."}


@router.get("/{product_id}/analytics")
def get_product_analytics(
    product_id: str,
    store_id: str = Query(...),
    period: str = Query("30d"),
    db: Session = Depends(get_db),
    _auth: Any = Depends(deps.get_current_active_user),
) -> Any:
    """Per-product performance: orders, funnel counts, revenue, cost, profit."""
    product = db.query(Product).filter(Product.id == product_id, Product.store_id == store_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable.")

    # Period → start_date
    now = datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "today":
        start_date = today_start
    elif period == "yesterday":
        start_date = today_start - timedelta(days=1)
    elif period == "7d":
        start_date = today_start - timedelta(days=7)
    elif period == "90d":
        start_date = today_start - timedelta(days=90)
    elif period == "all_time":
        start_date = datetime(2020, 1, 1)
    else:  # default 30d
        start_date = today_start - timedelta(days=30)

    base = and_(
        OrderItem.product_id == product_id,
        Order.store_id == store_id,
        Order.is_deleted == False,
        Order.created_at >= start_date,
    )

    def count_status(*statuses):
        return (
            db.query(func.count(func.distinct(Order.id)))
            .join(OrderItem, OrderItem.order_id == Order.id)
            .filter(base, Order.status.in_(statuses))
            .scalar() or 0
        )

    total_orders = (
        db.query(func.count(func.distinct(Order.id)))
        .join(OrderItem, OrderItem.order_id == Order.id)
        .filter(base)
        .scalar() or 0
    )
    confirmed  = count_status("CONFIRMED", "SHIPPED", "DELIVERED")
    delivered  = count_status("DELIVERED")
    returned   = count_status("RETURNED")
    pending    = count_status("NEW", "ASSIGNED", "CALLED")

    # Revenue & cost from DELIVERED items only
    delivered_items = (
        db.query(
            func.sum(OrderItem.unit_price * OrderItem.quantity).label("revenue"),
            func.sum(OrderItem.quantity).label("qty"),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .filter(base, Order.status == "DELIVERED")
        .first()
    )
    revenue = int(delivered_items.revenue or 0) if delivered_items else 0
    delivered_qty = int(delivered_items.qty or 0) if delivered_items else 0
    cost_price: float = product.cost_price or 0  # type: ignore[assignment]
    cost = cost_price * delivered_qty
    profit = revenue - cost
    profit_pct = round(profit / revenue * 100, 2) if revenue > 0 else 0.0

    return {
        "product_id": product_id,
        "product_name": product.name,
        "period": period,
        "orders": total_orders,
        "pending": pending,
        "confirmed": confirmed,
        "delivered": delivered,
        "returned": returned,
        "revenue": revenue,
        "cost": cost,
        "profit": profit,
        "profit_pct": profit_pct,
    }


# ─── Pack & Option Configuration ───────────────────────────────

class PackConfigPayload(BaseModel):
    pack_items: List[dict] # [{product_id, quantity, unit_cost}]
    pack_charges: List[dict] # [{label, amount}]
    pack_options: Optional[List[dict]] = []
    is_pack: bool = True

@router.post("/{id}/pack-config", response_model=dict)
def configure_product_pack(
    id: str,
    payload: PackConfigPayload,
    db: Session = Depends(get_db),
    current_user: Any = Depends(deps.get_current_active_user)
) -> Any:
    """Configure a product as a bundle pack with sub-items, automatic cost and margin calculation."""
    if current_user.role not in ["SUPER_ADMIN", "ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    product = db.query(Product).filter(Product.id == id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable.")

    product.is_pack = payload.is_pack
    product.pack_items = payload.pack_items
    product.pack_charges = payload.pack_charges
    product.pack_options = payload.pack_options or []

    # Calculate automatically cost_price and pack_margin
    total_cost = 0
    for item in payload.pack_items:
        qty = int(item.get("quantity", 0))
        unit_cost = int(item.get("unit_cost", 0))
        total_cost += qty * unit_cost

    for charge in payload.pack_charges:
        amt = int(charge.get("amount", 0))
        total_cost += amt

    product.cost_price = total_cost

    margin_pct = 0.0
    if product.price and product.price > 0:
        margin_pct = round(((product.price - total_cost) / product.price) * 100.0, 2)
    
    product.pack_margin = margin_pct

    db.commit()
    db.refresh(product)

    return {
        "success": True,
        "id": product.id,
        "is_pack": product.is_pack,
        "cost_price": product.cost_price,
        "pack_margin": product.pack_margin,
        "pack_items": product.pack_items,
        "pack_charges": product.pack_charges,
        "pack_options": product.pack_options
    }

