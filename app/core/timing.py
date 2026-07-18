"""
Per-request timing recorder for the Server-Timing response header.

A contextvar (not a Request attribute) so deeply-nested code — get_db(),
get_current_user(), app/core/cache.py's Upstash calls — can record their
own timing without the Request object being threaded through every
function signature. Started fresh at the top of the outermost middleware
(DistributedRateLimitMiddleware) and read back at the very end to build
the header.
"""
import contextvars
import time
from typing import List, Optional, Tuple

_timings: contextvars.ContextVar[Optional[List[Tuple[str, float]]]] = contextvars.ContextVar(
    "request_timings", default=None
)


def start() -> None:
    _timings.set([])


def record(name: str, duration_ms: float) -> None:
    bag = _timings.get()
    if bag is not None:
        bag.append((name, duration_ms))


def get_all() -> List[Tuple[str, float]]:
    return _timings.get() or []


def to_server_timing_header() -> str:
    """
    Renders collected entries as a Server-Timing header value. Repeated
    names (e.g. multiple Upstash calls in one request) are summed under
    one entry so the header stays readable.
    """
    totals: dict = {}
    for name, dur in get_all():
        totals[name] = totals.get(name, 0.0) + dur
    return ", ".join(f'{name};dur={dur:.2f}' for name, dur in totals.items())


class Timer:
    """with Timer('redis'): ... — records elapsed ms under `name` on exit."""

    def __init__(self, name: str):
        self.name = name

    def __enter__(self):
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, *exc_info):
        record(self.name, (time.perf_counter() - self._t0) * 1000)
