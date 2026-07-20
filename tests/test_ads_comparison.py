"""
Tests for app/api/v1/ads_comparison.py — the Meta ↔ TikTok comparative
dashboard requested alongside TikTok Ads Enterprise.
"""
import inspect
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.v1 import ads_comparison


def test_comparison_endpoint_requires_authentication():
    route = next(r for r in ads_comparison.router.routes if r.path == "/summary")
    sig = inspect.signature(route.endpoint)
    assert "current_user" in sig.parameters


def test_comparison_reads_both_engines_never_recomputes(db_session=None):
    """Static check: the endpoint must import compute_meta_metrics AND
    compute_tiktok_metrics — never recompute a metric independently, which
    would be exactly the kind of divergent-formula bug the whole Meta audit
    was built to eliminate."""
    import inspect as _inspect
    from app.api.v1 import ads_comparison as mod

    source = _inspect.getsource(mod.get_ads_comparison_summary)
    assert "compute_meta_metrics" in source
    assert "compute_tiktok_metrics" in source
