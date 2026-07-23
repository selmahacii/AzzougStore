"""
Central store-access authorization — the single answer to "which store_ids
may this user touch" and "may this user touch store X specifically".

Why this exists (2026-07-23 inventory audit): TenantMiddleware
(app/core/tenant.py) derives the "current tenant" purely from the
CLIENT-SUPPLIED X-Store-Id request header — it's a convenience default for
endpoints that forget to scope themselves, not a security boundary, since
the header is entirely attacker-controlled. Several inventory endpoints
(app/api/v1/stock.py: dashboard, discrepancies, alerts-engine, livreurs,
lots, returns-by-variant, summary, alerts, movement list) additionally
opt OUT of even that soft default via `skip_tenant_isolation=True` and take
`store_id` as a plain, unchecked query parameter — meaning ANY authenticated
user (a confirmatrice or livreur from Store A) could pass Store B's UUID
and see Store B's full inventory dashboard, discrepancies, and alerts.
This module is the fix: a real, role-based check, reused across every
endpoint that scopes itself to one store_id.

Existing per-module scope logic stays as-is and is NOT replaced here —
orders.py's _confirmateur_resolved_stores/_confirmateur_scope_criterion and
products.py's _confirmateur_product_scope_criterion encode broader UNION
semantics specific to orders/products (store scope OR individually
assigned products) that a single "may I see store X" check doesn't need to
replicate. This module is for the simpler, common case: an endpoint that
takes exactly one store_id and must verify the caller may see THAT store.
"""
from typing import Optional

from fastapi import HTTPException

from app.models.user import User


def user_accessible_store_ids(user: User) -> Optional[set]:
    """
    The set of store_ids this user may access, or None meaning
    "unrestricted" (SUPER_ADMIN/ADMIN — cross-store by design).

    LIVREUR is ALSO unrestricted here, matching the existing, deliberate
    design already documented at every other cross-store LIVREUR carve-out
    in this codebase (app/api/v1/products.py:26, stock.py's manual-movement
    endpoint): a single delivery agent serves every store in this
    deployment and must be able to see/restock any of them, not just
    their own employee_store_id.
    """
    if user.role in ("SUPER_ADMIN", "ADMIN", "LIVREUR"):
        return None
    stores: set = set()
    employee_store_id = getattr(user, "employee_store_id", None)
    if employee_store_id:
        stores.add(employee_store_id)
    raw = getattr(user, "assigned_store_ids", None)
    if isinstance(raw, list):
        stores.update(raw)
    return stores


def assert_store_access(user: User, store_id: Optional[str]) -> None:
    """
    Raise 403 if `user` is not allowed to see `store_id`. A falsy
    store_id is never blocked here — whether an unscoped call is valid is
    the calling endpoint's own concern (most of these routes require it).
    A user with NO store configured at all (no employee_store_id, no
    assigned_store_ids — e.g. a product-only confirmatrice) has zero
    accessible stores: whole-store inventory views are, correctly, not
    part of her scope even if she's individually assigned some products
    inside that store.
    """
    if not store_id:
        return
    accessible = user_accessible_store_ids(user)
    if accessible is None:
        return  # unrestricted (admin)
    if store_id not in accessible:
        raise HTTPException(
            status_code=403,
            detail="Accès refusé : cette boutique ne fait pas partie de votre périmètre.",
        )
