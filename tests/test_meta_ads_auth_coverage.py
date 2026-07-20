"""
Meta Ads security audit (2026-07-20): every route in app/api/v1/meta_ads.py
was reviewed for who actually calls it (grep across src/ for the frontend
caller, plus a check for cron/external-service callers in app/services/).

Two routes are called by parties that cannot hold an admin session and must
stay public:
  - POST /events: fired by the ANONYMOUS SHOPPER's browser via
    navigator.sendBeacon (see src/lib/meta-tracking.ts) — never authenticated.
  - GET /catalog-feed: fetched directly by Meta's own servers (Commerce
    Manager data feed) — cannot present an admin bearer token.

Every other route in this router is called exclusively by the authenticated
admin dashboard (verified via apiFetch call sites in
src/components/admin/modules/meta-ads-dashboard.tsx) with no cron/webhook/
external caller found — these now all require
current_user=Depends(deps.get_current_active_user). Before this audit, 14 of
them (12 admin routes below + the 2 originally-missing diagnostic endpoints
already fixed in the pre-deploy pass) had no server-side auth check at all —
the frontend sent a token, but nothing on the backend verified it, so the
raw HTTP endpoint (config incl. access_token, financial integration summary,
destructive queue purge, etc.) was reachable by anyone who knew a store_id.

This test pins both halves of that fix so neither regresses silently.
"""
import inspect
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.v1 import meta_ads

# Must NEVER require admin auth — see module docstring for why.
_MUST_STAY_PUBLIC = {"/events", "/catalog-feed"}


def test_every_route_is_authenticated_except_the_two_public_ones():
    routes_by_path = {}
    for r in meta_ads.router.routes:
        for method in r.methods:
            routes_by_path.setdefault((method, r.path), r)

    unexpectedly_public = []
    unexpectedly_protected = []
    for (method, path), route in routes_by_path.items():
        if method == "HEAD":
            continue
        sig = inspect.signature(route.endpoint)
        has_auth = "current_user" in sig.parameters
        if path in _MUST_STAY_PUBLIC:
            if has_auth:
                unexpectedly_protected.append((method, path))
        elif not has_auth:
            unexpectedly_public.append((method, path))

    assert not unexpectedly_public, (
        f"these admin-only routes lost their auth dependency: {unexpectedly_public}"
    )
    assert not unexpectedly_protected, (
        f"these routes must stay public (external caller: anonymous shopper "
        f"or Meta's own servers) but now require auth, which will break them: "
        f"{unexpectedly_protected}"
    )


def test_public_routes_are_exactly_the_two_expected():
    """
    Guards against a THIRD route silently losing its auth requirement in the
    future without anyone re-auditing whether it's genuinely safe to be
    public — any new unauthenticated route must be a deliberate addition to
    _MUST_STAY_PUBLIC with a documented external caller, not an oversight.
    """
    unauthenticated = set()
    for r in meta_ads.router.routes:
        sig = inspect.signature(r.endpoint)
        if "current_user" not in sig.parameters:
            unauthenticated.add(r.path)
    assert unauthenticated == _MUST_STAY_PUBLIC, (
        f"unauthenticated routes changed: found {unauthenticated}, expected exactly {_MUST_STAY_PUBLIC}"
    )
