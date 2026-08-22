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


@router.get("/env", response_model=dict)
def get_environment_config(
    current_user: Any = Depends(deps.get_current_active_superuser),
) -> Any:
    """
    Return environment configuration for Vercel / Server migration auditing.
    """
    import os
    from app.core.config import settings

    def mask_val(v):
        if not v:
            return None
        if len(v) <= 8:
            return "********"
        return f"{v[:4]}...{v[-4:]}"

    frontend_env = {
        "BACKEND_URL": os.getenv("BACKEND_URL") or "https://azconfort.azghub.com",
        "NEXT_PUBLIC_API_URL": os.getenv("NEXT_PUBLIC_API_URL") or "https://azconfort.azghub.com",
        "NEXT_PUBLIC_APP_URL": os.getenv("NEXT_PUBLIC_APP_URL") or os.getenv("APP_URL") or "https://azzougshop.vercel.app",
        "INTERNAL_API_KEY": os.getenv("INTERNAL_API_KEY") or getattr(settings, "INTERNAL_API_KEY", "azzougshop_internal_secure_key_2026"),
        "SECRET_KEY": mask_val(os.getenv("SECRET_KEY") or settings.SECRET_KEY),
        "NODE_ENV": "production"
    }

    env_file = "\n".join([
        "# AZZOUGSHOP — VERCEL FRONTEND ENV CONFIG",
        f'BACKEND_URL="{frontend_env["BACKEND_URL"]}"',
        f'NEXT_PUBLIC_API_URL="{frontend_env["NEXT_PUBLIC_API_URL"]}"',
        f'NEXT_PUBLIC_APP_URL="{frontend_env["NEXT_PUBLIC_APP_URL"]}"',
        f'INTERNAL_API_KEY="{frontend_env["INTERNAL_API_KEY"]}"',
        f'SECRET_KEY="{os.getenv("SECRET_KEY") or settings.SECRET_KEY}"',
        'NODE_ENV="production"'
    ])

    return {
        "success": True,
        "message": "Configuration d'environnement pour la migration Vercel",
        "frontend_env": frontend_env,
        "vercel_copy_paste": env_file
    }

