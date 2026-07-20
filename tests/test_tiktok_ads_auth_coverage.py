"""
TikTok Ads security audit (2026-07-20, same pass as Meta's — see
tests/test_meta_ads_auth_coverage.py): every route in
app/api/v1/tiktok_ads.py was reviewed for who calls it.

POST /events is called by the ANONYMOUS SHOPPER's browser (storefront
relay, twin of the browser Pixel's ttq.track call) and must stay public.
GET /catalog-feed is called directly by TikTok Catalog Manager's own
servers (same reasoning as Meta's /catalog-feed) and must also stay
public. Every other route is called exclusively by the authenticated
admin dashboard with no cron/webhook/external caller — these all require
current_user=Depends(deps.get_current_active_user).
"""
import inspect
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.v1 import tiktok_ads

_MUST_STAY_PUBLIC = {"/events", "/catalog-feed"}


def test_every_route_is_authenticated_except_events():
    unexpectedly_public = []
    unexpectedly_protected = []
    for r in tiktok_ads.router.routes:
        sig = inspect.signature(r.endpoint)
        has_auth = "current_user" in sig.parameters
        if r.path in _MUST_STAY_PUBLIC:
            if has_auth:
                unexpectedly_protected.append(r.path)
        elif not has_auth:
            unexpectedly_public.append(r.path)

    assert not unexpectedly_public, f"admin routes lost their auth dependency: {unexpectedly_public}"
    assert not unexpectedly_protected, f"routes must stay public but now require auth: {unexpectedly_protected}"
