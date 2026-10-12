"""
Runtime Funnel & Checkout Diagnostic Logger — Phase 3A.19.

Provides industrial, real-time structured logging across the entire storefront
purchase funnel and Meta Conversions API (CAPI) pipeline.
Flushes immediately to stdout (for HuggingFace & local terminal observation).
Strictly adheres to data protection (masks PII: phone, name, email, addresses).
"""

from __future__ import annotations

import logging
import os
import re
import sys
import threading
import time
from collections import deque
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger("app.funnel_diagnostic")

# Algeria local time offset (UTC+1)
ALGERIA_TZ = timezone(timedelta(hours=1))


def get_current_timestamp() -> str:
    """Returns ISO-formatted timestamp with UTC+1 Algeria timezone."""
    return datetime.now(ALGERIA_TZ).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC+1"


# ─── PII Masking Helpers ───────────────────────────────────────────────────

def mask_phone(phone: Optional[str]) -> str:
    if not phone:
        return "N/A"
    clean = re.sub(r"\D", "", str(phone).strip())
    if len(clean) >= 9:
        return f"{clean[:4]}****{clean[-2:]}"
    elif len(clean) >= 4:
        return f"{clean[:2]}**{clean[-2:]}"
    return "***"


def mask_name(name: Optional[str]) -> str:
    if not name:
        return "N/A"
    parts = str(name).strip().split()
    masked = []
    for p in parts:
        if len(p) <= 2:
            masked.append(f"{p[0]}*")
        else:
            masked.append(f"{p[0]}***{p[-1]}")
    return " ".join(masked)


def mask_email(email: Optional[str]) -> str:
    if not email or "@" not in str(email):
        return "N/A"
    parts = str(email).strip().split("@", 1)
    user, domain = parts[0], parts[1]
    masked_user = f"{user[0]}***" if len(user) > 1 else "***"
    return f"{masked_user}@{domain}"


def mask_secret(secret: Optional[str]) -> str:
    if not secret:
        return "N/A"
    s = str(secret).strip()
    if len(s) <= 8:
        return "********"
    return f"{s[:4]}...{s[-4:]}"


# ─── Real-Time Funnel Diagnostic Counters Tracker ───────────────────────────

class FunnelDiagnosticTracker:
    def __init__(self):
        self._lock = threading.Lock()
        self.reset()

    def reset(self):
        with self._lock:
            self.landing_views = 0
            self.product_views = 0
            self.add_to_cart = 0
            self.checkout_started = 0
            self.validation_failures = 0
            self.shipping_failures = 0
            self.order_creation_failures = 0
            self.orders_created = 0
            self.purchase_capi_sent = 0
            self.purchase_capi_failed = 0
            self.unclassified_dropoffs = 0
            self.events_log = deque(maxlen=200)

    def record_landing_view(self, meta: Optional[dict] = None):
        with self._lock:
            self.landing_views += 1
            self.events_log.append(("LANDING_PAGE_VIEW", meta))

    def record_product_view(self, meta: Optional[dict] = None):
        with self._lock:
            self.product_views += 1
            self.events_log.append(("PRODUCT_VIEW", meta))

    def record_add_to_cart(self, meta: Optional[dict] = None):
        with self._lock:
            self.add_to_cart += 1
            self.events_log.append(("ADD_TO_CART", meta))

    def record_checkout_started(self, meta: Optional[dict] = None):
        with self._lock:
            self.checkout_started += 1
            self.events_log.append(("CHECKOUT_STARTED", meta))

    def record_validation_failure(self, meta: Optional[dict] = None):
        with self._lock:
            self.validation_failures += 1
            self.events_log.append(("VALIDATION_FAILED", meta))

    def record_shipping_failure(self, meta: Optional[dict] = None):
        with self._lock:
            self.shipping_failures += 1
            self.events_log.append(("SHIPPING_CALCULATION_FAILED", meta))

    def record_order_creation_failure(self, meta: Optional[dict] = None):
        with self._lock:
            self.order_creation_failures += 1
            self.events_log.append(("ORDER_CREATION_FAILED", meta))

    def record_order_created(self, meta: Optional[dict] = None):
        with self._lock:
            self.orders_created += 1
            self.events_log.append(("ORDER_CREATED", meta))

    def record_capi_sent(self, meta: Optional[dict] = None):
        with self._lock:
            self.purchase_capi_sent += 1
            self.events_log.append(("PURCHASE_SENT", meta))

    def record_capi_failed(self, meta: Optional[dict] = None):
        with self._lock:
            self.purchase_capi_failed += 1
            self.events_log.append(("PURCHASE_FAILED", meta))

    def record_unclassified_dropoff(self, meta: Optional[dict] = None):
        with self._lock:
            self.unclassified_dropoffs += 1
            self.events_log.append(("UNCLASSIFIED_DROPOFF", meta))

    def get_summary_text(self) -> str:
        with self._lock:
            # Dropoffs calculation based on confirmed observations
            # e.g. Visitors who reached checkout but never completed an order nor had recorded error
            inferred_dropoffs = max(0, self.checkout_started - (self.orders_created + self.validation_failures + self.shipping_failures + self.order_creation_failures))
            total_dropoffs = self.unclassified_dropoffs + inferred_dropoffs

            return (
                f"[DIAGNOSTIC] Résumé du parcours\n"
                f"landing_views={self.landing_views}\n"
                f"product_views={self.product_views}\n"
                f"add_to_cart={self.add_to_cart}\n"
                f"checkout_started={self.checkout_started}\n"
                f"validation_failures={self.validation_failures}\n"
                f"shipping_failures={self.shipping_failures}\n"
                f"order_creation_failures={self.order_creation_failures}\n"
                f"orders_created={self.orders_created}\n"
                f"purchase_capi_sent={self.purchase_capi_sent}\n"
                f"purchase_capi_failed={self.purchase_capi_failed}\n"
                f"unclassified_dropoffs={total_dropoffs}"
            )


tracker = FunnelDiagnosticTracker()


# ─── Structured Funnel & Checkout Loggers ───────────────────────────────────

def log_funnel_event(
    event_type: str,
    *,
    request_id: Optional[str] = None,
    store_id: Optional[str] = None,
    product_id: Optional[str] = None,
    lp_id: Optional[str] = None,
    event_id: Optional[str] = None,
    campaign_id: Optional[str] = None,
    adset_id: Optional[str] = None,
    ad_id: Optional[str] = None,
    source: Optional[str] = None,
    has_attribution: bool = False,
    is_suspected_collision: bool = False,
    note: Optional[str] = None,
) -> None:
    """
    Emits structured funnel logs matching the standard format:
    [INFO] [FUNNEL] <EVENT_TYPE>
    """
    ts = get_current_timestamp()
    req_id = request_id or "req-none"

    if event_type == "LANDING_PAGE_VIEW":
        tracker.record_landing_view({"req": req_id, "lp": lp_id, "store": store_id})
    elif event_type == "PRODUCT_VIEW":
        tracker.record_product_view({"req": req_id, "prod": product_id, "store": store_id})
    elif event_type == "ADD_TO_CART":
        tracker.record_add_to_cart({"req": req_id, "prod": product_id, "store": store_id})
    elif event_type == "CHECKOUT_STARTED":
        tracker.record_checkout_started({"req": req_id, "prod": product_id, "store": store_id})

    # Line 1: Header
    print(f"[INFO] [FUNNEL] {event_type}", flush=True)

    # Line 2-N: Key Diagnostic Metadata
    details = [
        f"timestamp={ts}",
        f"request_id={req_id}",
        f"step={event_type.lower()}",
        f"store_id={store_id or '—'}",
        f"product_id={product_id or '—'}",
        f"lp_id={lp_id or '—'}",
        f"event_id={event_id or '—'}",
        f"campaign_id={campaign_id or 'N/A'}",
        f"adset_id={adset_id or 'N/A'}",
        f"ad_id={ad_id or 'N/A'}",
        f"attribution={'YES' if has_attribution else 'NONE'}",
    ]
    if is_suspected_collision:
        details.append("collision_risk=DETECTED_STATIC_OR_COLLIDING_EVENT_ID")
    if note:
        details.append(f"note={note}")

    print("  " + " | ".join(details), flush=True)


def log_checkout_diagnostic(
    level: str,
    event_type: str,
    *,
    request_id: Optional[str] = None,
    step: str = "checkout",
    endpoint: Optional[str] = None,
    http_status: Optional[int] = None,
    error_code: Optional[str] = None,
    duration_ms: Optional[float] = None,
    reason: Optional[str] = None,
    previous_step: Optional[str] = None,
    expected_result: Optional[str] = None,
    actual_result: Optional[str] = None,
    recovery_action: Optional[str] = None,
    order_id: Optional[str] = None,
    order_number: Optional[str] = None,
    customer_phone_masked: Optional[str] = None,
    wilaya: Optional[str] = None,
    action_classification: Optional[str] = None,  # "réussie", "échouée", "répétée", "non_déclenchée", "inconnue"
) -> None:
    """
    Emits structured checkout logs matching the required pattern:
    [LEVEL] [CHECKOUT] <EVENT_TYPE>
    request_id=<correlation_id>
    step=<step>
    http_status=<http_status>
    error_code=<application_error_code>
    duration_ms=<measured_duration>
    reason=<sanitized_reason>
    """
    ts = get_current_timestamp()
    req_id = request_id or "req-none"

    if event_type == "VALIDATION_FAILED":
        tracker.record_validation_failure({"req": req_id, "reason": reason})
    elif event_type == "SHIPPING_CALCULATION_FAILED":
        tracker.record_shipping_failure({"req": req_id, "reason": reason})
    elif event_type == "ORDER_CREATION_FAILED":
        tracker.record_order_creation_failure({"req": req_id, "reason": reason})
    elif event_type == "ORDER_CREATED":
        tracker.record_order_created({"req": req_id, "order": order_number})

    # Header
    print(f"[{level.upper()}] [CHECKOUT] {event_type}", flush=True)

    # Detailed lines
    print(f"timestamp={ts}", flush=True)
    print(f"request_id={req_id}", flush=True)
    print(f"step={step}", flush=True)
    if endpoint:
        print(f"endpoint={endpoint}", flush=True)
    if http_status is not None:
        print(f"http_status={http_status}", flush=True)
    if error_code:
        print(f"error_code={error_code}", flush=True)
    if duration_ms is not None:
        print(f"duration_ms={duration_ms:.1f}", flush=True)
    if reason:
        print(f"reason={reason}", flush=True)
    if previous_step:
        print(f"previous_step={previous_step}", flush=True)
    if expected_result:
        print(f"expected_result={expected_result}", flush=True)
    if actual_result:
        print(f"actual_result={actual_result}", flush=True)
    if recovery_action:
        print(f"recovery_action={recovery_action}", flush=True)
    if order_number or order_id:
        print(f"order_ref={order_number or '—'} (ID: {order_id or '—'})", flush=True)
    if customer_phone_masked:
        print(f"customer_phone={customer_phone_masked}", flush=True)
    if wilaya:
        print(f"wilaya={wilaya}", flush=True)
    if action_classification:
        print(f"action_status={action_classification}", flush=True)


def log_meta_capi_event(
    level: str,
    event_type: str,
    *,
    request_id: Optional[str] = None,
    order_id: Optional[str] = None,
    order_number: Optional[str] = None,
    event_id: Optional[str] = None,
    pixel_id: Optional[str] = None,
    fbtrace_id: Optional[str] = None,
    http_status: Optional[int] = None,
    duration_ms: Optional[float] = None,
    events_received: Optional[int] = None,
    retry_count: Optional[int] = None,
    next_retry_at: Optional[str] = None,
    error_message: Optional[str] = None,
    error_category: Optional[str] = None,
    attribution_data: Optional[dict] = None,
    action_classification: Optional[str] = None,
) -> None:
    """
    Emits structured Meta CAPI logs matching:
    [INFO] [META_CAPI] PURCHASE_QUEUED
    [INFO] [META_CAPI] PURCHASE_PROCESSING
    [OK] [META_CAPI] PURCHASE_SENT
    [ERROR] [META_CAPI] PURCHASE_FAILED
    """
    ts = get_current_timestamp()
    req_id = request_id or "req-none"

    if event_type == "PURCHASE_SENT":
        tracker.record_capi_sent({"order": order_number, "event_id": event_id})
    elif event_type == "PURCHASE_FAILED":
        tracker.record_capi_failed({"order": order_number, "event_id": event_id, "err": error_message})

    print(f"[{level.upper()}] [META_CAPI] {event_type}", flush=True)
    print(f"timestamp={ts}", flush=True)
    print(f"request_id={req_id}", flush=True)
    print(f"order_ref={order_number or '—'} (ID: {order_id or '—'})", flush=True)
    print(f"event_id={event_id or '—'}", flush=True)
    if pixel_id:
        print(f"pixel_id={pixel_id}", flush=True)
    if fbtrace_id:
        print(f"fbtrace_id={fbtrace_id}", flush=True)
    if http_status is not None:
        print(f"http_status={http_status}", flush=True)
    if duration_ms is not None:
        print(f"duration_ms={duration_ms:.1f}", flush=True)
    if events_received is not None:
        print(f"events_received={events_received}", flush=True)
    if retry_count is not None:
        print(f"retry_count={retry_count}", flush=True)
    if next_retry_at:
        print(f"next_retry_at={next_retry_at}", flush=True)
    if error_category:
        print(f"error_category={error_category}", flush=True)
    if error_message:
        print(f"reason={error_message}", flush=True)
    if action_classification:
        print(f"action_status={action_classification}", flush=True)

    if attribution_data:
        utm = attribution_data.get("utm_source") or "N/A"
        camp = attribution_data.get("campaign_id") or "N/A"
        fbp = "YES" if attribution_data.get("fbp") else "NO"
        fbc = "YES" if attribution_data.get("fbc") else "NO"
        fbclid = "YES" if attribution_data.get("fbclid") else "NO"
        landing = attribution_data.get("landing_url") or "None"
        print(f"attribution_audit=utm:{utm} | camp_id:{camp} | fbp:{fbp} | fbc:{fbc} | fbclid:{fbclid} | landing_url:{landing}", flush=True)


def print_reproduction_summary() -> None:
    """Prints the final summary of observed funnel events."""
    print("\n" + "=" * 60, flush=True)
    print(tracker.get_summary_text(), flush=True)
    print("=" * 60 + "\n", flush=True)
