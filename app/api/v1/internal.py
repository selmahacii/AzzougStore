"""
Internal observability endpoints — SUPER_ADMIN only, not for storefront or
general staff use.
"""
from typing import Any

from fastapi import APIRouter, Depends

from app.api import deps

router = APIRouter()


@router.get("/cache-metrics", response_model=dict)
def cache_metrics(
    current_user: Any = Depends(deps.get_current_active_superuser),
) -> Any:
    """
    Live snapshot of the L1(in-process)+L2(Upstash) cache system's health —
    see app/core/cache.py. Per-process only: each backend worker/replica
    tracks its own counters from the moment it started, there is no
    cross-worker aggregation. Restart-sensitive — a fresh deploy resets to
    zero, which is expected and not a fault.
    """
    from app.core.cache import get_metrics
    return {"success": True, "data": get_metrics()}
