"""
Unit tests for app/core/analytics_cache.py — the short-TTL cache added in
front of the 3 most expensive Meta analytics endpoints (signal-quality,
learning-diagnostics, tracking-quality-v2) to bring their response time
under a second on repeated/rapid dashboard opens.

Uses a tiny in-memory fake standing in for redis.Redis (no live Redis
available in this environment) — only exercises get/setex, matching
exactly what analytics_cache.py calls.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.core.analytics_cache as analytics_cache


class _FakeRedis:
    def __init__(self):
        self.store = {}

    def get(self, key):
        return self.store.get(key)

    def setex(self, key, ttl, value):
        self.store[key] = value


def test_cache_miss_then_hit(monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(analytics_cache, "get_redis_client", lambda: fake)

    assert analytics_cache.get_cached("k1") is None

    analytics_cache.set_cached("k1", {"success": True, "data": {"score": 42}}, ttl_seconds=600)
    cached = analytics_cache.get_cached("k1")

    assert cached is not None
    assert cached["data"]["score"] == 42
    # Never hides that this came from cache — a stale number must be labeled as such.
    assert cached["data"]["_cache"]["hit"] is True


def test_cached_response_computes_once(monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(analytics_cache, "get_redis_client", lambda: fake)

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


def test_redis_unavailable_falls_back_to_compute(monkeypatch):
    """
    Redis down must NEVER break the endpoint — every cached_response()/
    get_cached() call degrades to "always compute", exactly like
    get_redis_client() itself already does for rate limiting.
    """
    monkeypatch.setattr(analytics_cache, "get_redis_client", lambda: None)

    assert analytics_cache.get_cached("k3") is None

    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"success": True, "data": {"value": "fresh"}}

    result = analytics_cache.cached_response("k3", 600, compute)
    result2 = analytics_cache.cached_response("k3", 600, compute)

    assert calls["n"] == 2  # no cache available -> computed every time, never crashes
    assert result["data"]["value"] == "fresh"
    assert result2["data"]["value"] == "fresh"
