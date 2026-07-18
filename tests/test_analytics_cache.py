"""
Unit tests for app/core/analytics_cache.py — the short-TTL cache in front of
the most expensive Meta analytics endpoints (signal-quality,
learning-diagnostics, tracking-quality-v2, conversion optimization).

Backed by app/core/cache.py's unified L1 (in-process) + L2 (Upstash) cache.
Mocks at the L2 boundary (get_json/set_json) rather than a fake redis.Redis,
since Upstash is a REST API, not a TCP client.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.core.analytics_cache as analytics_cache


class _FakeL2:
    """Stands in for app.core.cache.get_json/set_json (the Upstash REST calls)."""

    def __init__(self):
        self.store = {}

    def get_json(self, key):
        return self.store.get(key)

    def set_json(self, key, value, ttl_seconds):
        self.store[key] = value


def setup_function(_):
    # L1 is a module-level dict — reset it so tests don't leak cache entries
    # into each other via the (shared) in-process layer.
    analytics_cache._l1.clear()


def test_cache_miss_then_hit(monkeypatch):
    fake = _FakeL2()
    monkeypatch.setattr(analytics_cache, "get_json", fake.get_json)
    monkeypatch.setattr(analytics_cache, "set_json", fake.set_json)

    assert analytics_cache.get_cached("k1") is None

    analytics_cache.set_cached("k1", {"success": True, "data": {"score": 42}}, ttl_seconds=600)
    cached = analytics_cache.get_cached("k1")

    assert cached is not None
    assert cached["data"]["score"] == 42
    # Never hides that this came from cache — a stale number must be labeled as such.
    assert cached["data"]["_cache"]["hit"] is True


def test_cached_response_computes_once(monkeypatch):
    fake = _FakeL2()
    monkeypatch.setattr(analytics_cache, "get_json", fake.get_json)
    monkeypatch.setattr(analytics_cache, "set_json", fake.set_json)

    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"success": True, "data": {"value": calls["n"]}}

    first = analytics_cache.cached_response("k2", 600, compute)
    second = analytics_cache.cached_response("k2", 600, compute)

    assert calls["n"] == 1  # compute() only ran once — the second call was served from cache
    assert first["data"]["value"] == 1
    assert second["data"]["value"] == 1
    assert second["data"]["_cache"]["hit"] is True


def test_l2_unavailable_l1_still_serves_within_process(monkeypatch):
    """
    L2 (Upstash) being unreachable must NEVER break the endpoint, and must
    NOT disable L1 — a worker that already computed a value in the last 45s
    should still serve it from memory even if Upstash is down, exactly the
    fallback chain requested (L1 -> L2 -> Postgres, each tier optional).
    """
    monkeypatch.setattr(analytics_cache, "get_json", lambda key: None)
    monkeypatch.setattr(analytics_cache, "set_json", lambda key, value, ttl_seconds: None)

    assert analytics_cache.get_cached("k3") is None

    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"success": True, "data": {"value": "fresh"}}

    result = analytics_cache.cached_response("k3", 600, compute)
    result2 = analytics_cache.cached_response("k3", 600, compute)

    # L2 never persisted anything, but L1 (in-process) still caught the second
    # call within the same worker — compute() ran once, not crashed, not twice.
    assert calls["n"] == 1
    assert result["data"]["value"] == "fresh"
    assert result2["data"]["value"] == "fresh"
    assert result2["data"]["_cache"]["hit"] is True
