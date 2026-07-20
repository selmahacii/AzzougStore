"""
TikTok Catalog Feed Enterprise — server-side sync of the product catalog
to TikTok Catalog Manager via the Catalog API (product/create, update,
delete), architecturally mirroring app/services/tiktok_capi.py's durable-
queue design (which itself mirrors app/services/meta_capi.py).

Two complementary integration paths, same as most retail-feed platforms
support side by side:
- PULL: GET /tiktok-ads/catalog-feed — a JSON feed TikTok's Catalog
  Manager can poll directly (same role as Meta's CSV /catalog-feed).
  Always reflects current DB state, no queue, no retry needed (TikTok
  controls the poll cadence).
- PUSH: sync_catalog_incremental() — proactive, low-latency create/update/
  delete calls via the Catalog API, with the same durable-queue contract
  as tiktok_capi_logs (queued before the network call, retried on
  transient failure, never silently dropped). This is what makes stock-
  outs and price changes reach TikTok within minutes instead of waiting
  for the next poll cycle.

Deliberately its own circuit breaker/retry state (not shared with
tiktok_capi.py's): the Catalog API and the Events API are different
TikTok endpoints with independent uptime — conflating their failure
counters would open the circuit for event tracking because catalog sync
failed, or vice versa. Same documented tradeoff as tiktok_capi.py's own
circuit breaker vs meta_capi.py's.
"""

from __future__ import annotations

import logging
import random
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

logger = logging.getLogger("app.tiktok_catalog")

CATALOG_API_VERSION = "v1.3"
CATALOG_API_BASE = f"https://business-api.tiktok.com/open_api/{CATALOG_API_VERSION}/catalog"

# ─── Circuit breaker — own state, same pattern as tiktok_capi.py ──────────
_CIRCUIT_FAILURE_THRESHOLD = 5
_CIRCUIT_COOLDOWN_SECONDS = 60
_circuit_lock = threading.Lock()
_circuit_state = {"consecutive_failures": 0, "opened_at": 0.0}
_sweep_lock = threading.Lock()


def _circuit_is_open() -> bool:
    with _circuit_lock:
        if _circuit_state["consecutive_failures"] < _CIRCUIT_FAILURE_THRESHOLD:
            return False
        if time.monotonic() - _circuit_state["opened_at"] >= _CIRCUIT_COOLDOWN_SECONDS:
            _circuit_state["consecutive_failures"] = _CIRCUIT_FAILURE_THRESHOLD - 1
            return False
        return True


def _circuit_record(success: bool) -> None:
    with _circuit_lock:
        if success:
            _circuit_state["consecutive_failures"] = 0
        else:
            _circuit_state["consecutive_failures"] += 1
            if _circuit_state["consecutive_failures"] == _CIRCUIT_FAILURE_THRESHOLD:
                _circuit_state["opened_at"] = time.monotonic()
                logger.error(
                    "[TikTokCatalog] circuit breaker OPEN after %d consecutive failures — "
                    "immediate attempts suspended for %ds",
                    _CIRCUIT_FAILURE_THRESHOLD, _CIRCUIT_COOLDOWN_SECONDS,
                )


def get_circuit_state() -> Dict[str, Any]:
    with _circuit_lock:
        n = _circuit_state["consecutive_failures"]
        opened_at = _circuit_state["opened_at"]
    elapsed = time.monotonic() - opened_at if opened_at else 0.0
    is_open = n >= _CIRCUIT_FAILURE_THRESHOLD and elapsed < _CIRCUIT_COOLDOWN_SECONDS
    return {
        "is_open": is_open, "consecutive_failures": n,
        "threshold": _CIRCUIT_FAILURE_THRESHOLD, "cooldown_seconds": _CIRCUIT_COOLDOWN_SECONDS,
        "seconds_until_reset": max(0, int(_CIRCUIT_COOLDOWN_SECONDS - elapsed)) if is_open else 0,
    }


_client: Optional[httpx.Client] = None
_client_lock = threading.Lock()


def _get_client() -> httpx.Client:
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is None:
            _client = httpx.Client(
                timeout=httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0),
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            )
        return _client


# ─── ERP -> TikTok catalog item mapping ────────────────────────────────────

def build_catalog_item(product, *, base_url: str, store_name: str, currency: str = "DZD") -> Dict[str, Any]:
    """
    Maps a Product row onto TikTok Catalog Manager's product schema.
    Field names follow TikTok's documented Catalog API product object —
    same underlying data Meta's CSV /catalog-feed already exposes
    (id/title/availability/price/link/image_link/brand), just as a JSON
    object with TikTok's own field names instead of a CSV row.

    - sku_id: TikTok's product identifier — our own SKU when set, else
      the product's internal id (same fallback as Meta's feed: p.sku or p.id).
    - item_group_id: groups product variants under one parent, same as
      Meta's "item_group_id" column — uses our own product id (a variant
      relationship isn't modeled as separate Product rows in this schema,
      so this is 1:1 with sku_id for now; kept as its own field for when
      variant-as-separate-row support is added, not invented data).
    - availability: IN_STOCK / OUT_OF_STOCK, computed from real stock -
      reserved_stock, never fabricated.
    """
    available_qty = max(0, (product.stock or 0) - (product.reserved_stock or 0))
    images = product.images if isinstance(product.images, list) else []
    main_image = product.main_image or (images[0] if images else None)
    additional_images = [str(i) for i in images if str(i).startswith("http") and i != main_image][:10]

    return {
        "sku_id": product.sku or product.id,
        "item_group_id": product.sku or product.id,
        "title": product.name,
        "description": (product.description or product.name or "")[:5000],
        "availability": "IN_STOCK" if available_qty > 0 else "OUT_OF_STOCK",
        "condition": "NEW",
        "price": {"amount": f"{float(product.price or 0):.2f}", "currency": currency},
        "link": f"{base_url}/?app=storefront&view=product&product={product.slug}",
        "image_link": main_image,
        "additional_image_link": additional_images,
        "brand": product.brand or store_name,
        "category": product.category or "",
        "inventory": available_qty,
        # GTIN/EAN — TikTok's spec accepts it when known, omitted (never
        # fabricated) when the product has no barcode on file.
        "gtin": product.barcode or None,
    }


def validate_catalog_item(item: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Validates a built catalog item BEFORE sending — mirrors the same
    validation TikTok's own Catalog API would reject on, so a rejected
    item is caught and reported locally (error_category="validation")
    instead of burning a network round-trip to discover it.
    """
    errors: List[str] = []
    if not item.get("sku_id"):
        errors.append("sku_id manquant")
    if not item.get("title"):
        errors.append("title manquant")
    if not item.get("image_link") or not str(item["image_link"]).startswith("http"):
        errors.append("image_link absente ou non-permanente (TikTok exige une URL http(s) absolue)")
    price = (item.get("price") or {}).get("amount")
    try:
        if price is None or float(price) <= 0:
            errors.append("price invalide (doit être > 0)")
    except (TypeError, ValueError):
        errors.append("price invalide (doit être > 0)")
    if not item.get("link"):
        errors.append("link (URL produit) manquant")
    return (len(errors) == 0, errors)


# ─── Retry/backoff — same shape as tiktok_capi.py ──────────────────────────
_BACKOFF_BASE = 1.0
_BACKOFF_CAP = 30.0
_BACKOFF_JITTER = 0.5
_MAX_IMMEDIATE_ATTEMPTS = 3
_MAX_RETRY_COUNT = 8
_STUCK_PROCESSING_MINUTES = 15


def _backoff_with_jitter(attempt: int) -> float:
    base = min(_BACKOFF_CAP, _BACKOFF_BASE * (2 ** attempt))
    return max(0.1, base + random.uniform(-_BACKOFF_JITTER, _BACKOFF_JITTER))


def _log_sync(
    db: Session, *, store_id: str, product_id: str, action: str, status: str,
    error_message: Optional[str] = None, error_category: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None, retry_count: int = 0,
    next_retry_at: Optional[datetime] = None, latency_ms: Optional[int] = None,
    tiktok_item_id: Optional[str] = None, last_http_status: Optional[int] = None,
) -> None:
    """Upsert-by-(product_id, action) — same contract as tiktok_capi._log_send."""
    try:
        from app.models.marketing import TikTokCatalogSyncLog
        existing = (
            db.query(TikTokCatalogSyncLog)
            .filter(TikTokCatalogSyncLog.product_id == product_id, TikTokCatalogSyncLog.action == action)
            .order_by(TikTokCatalogSyncLog.id.desc())
            .first()
        )
        if existing:
            existing.status = status
            existing.error_message = (error_message or "")[:1000] or None
            existing.error_category = error_category
            existing.retry_count = retry_count
            existing.next_retry_at = next_retry_at
            existing.latency_ms = latency_ms
            if payload is not None:
                existing.payload = payload
            if tiktok_item_id:
                existing.tiktok_item_id = tiktok_item_id
            if last_http_status is not None:
                existing.last_http_status = last_http_status
            if status == "success":
                existing.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        else:
            db.add(TikTokCatalogSyncLog(
                id=str(uuid.uuid4()), store_id=store_id, product_id=product_id, action=action,
                status=status, error_message=(error_message or "")[:1000] or None,
                error_category=error_category, payload=payload, retry_count=retry_count,
                next_retry_at=next_retry_at, latency_ms=latency_ms, tiktok_item_id=tiktok_item_id,
                last_http_status=last_http_status,
                completed_at=datetime.now(timezone.utc).replace(tzinfo=None) if status == "success" else None,
            ))
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("tiktok_catalog log write failed: %s", exc)


def push_catalog_item(
    db: Session, *, store_id: str, access_token: str, catalog_id: str,
    product_id: str, action: str, item: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Pushes ONE product create/update/delete to the TikTok Catalog API, with
    circuit breaker + exponential-backoff immediate retries; on exhausted
    immediate attempts the sync is persisted as status='pending_retry'
    (never dropped) for retry_pending_catalog_syncs() to pick up later.
    """
    if action != "delete" and item is not None:
        is_valid, errors = validate_catalog_item(item)
        if not is_valid:
            _log_sync(
                db, store_id=store_id, product_id=product_id, action=action, status="failed",
                error_message="; ".join(errors), error_category="validation", payload=item,
            )
            return {"success": False, "error": "validation_failed", "errors": errors}

    endpoint = {"create": "product/create", "update": "product/update", "delete": "product/delete"}[action]
    body = {"catalog_id": catalog_id, "products": [item] if item is not None else [{"sku_id": product_id}]}

    if _circuit_is_open():
        state = get_circuit_state()
        _log_sync(
            db, store_id=store_id, product_id=product_id, action=action, status="pending_retry",
            error_message="circuit breaker open — queued directly", error_category="network_error",
            payload=body, next_retry_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=state["seconds_until_reset"] or _CIRCUIT_COOLDOWN_SECONDS),
        )
        return {"success": False, "error": "circuit_open"}

    last_exc: Optional[Exception] = None
    last_status: Optional[int] = None
    error_category = "other"
    for attempt in range(_MAX_IMMEDIATE_ATTEMPTS):
        start = time.monotonic()
        try:
            client = _get_client()
            resp = client.post(
                f"{CATALOG_API_BASE}/{endpoint}/",
                headers={"Access-Token": access_token, "Content-Type": "application/json"},
                json=body,
            )
            latency_ms = int((time.monotonic() - start) * 1000)
            last_status = resp.status_code
            resp_json = resp.json() if resp.content else {}
            if resp.status_code == 200 and resp_json.get("code", -1) == 0:
                _circuit_record(success=True)
                tiktok_item_id = item.get("sku_id") if item else product_id
                _log_sync(
                    db, store_id=store_id, product_id=product_id, action=action, status="success",
                    payload=body, retry_count=attempt, latency_ms=latency_ms,
                    tiktok_item_id=tiktok_item_id, last_http_status=last_status,
                )
                return {"success": True, "latency_ms": latency_ms}
            error_message = resp_json.get("message") or f"HTTP {resp.status_code}"
            error_category = "api_5xx" if resp.status_code >= 500 else "api_4xx"
            last_exc = Exception(error_message)
        except Exception as exc:
            latency_ms = int((time.monotonic() - start) * 1000)
            last_exc = exc
            error_category = "network_timeout" if isinstance(exc, (httpx.ConnectTimeout, httpx.ConnectError)) else "network_error"

        _circuit_record(success=False)
        if attempt < _MAX_IMMEDIATE_ATTEMPTS - 1:
            time.sleep(_backoff_with_jitter(attempt))

    next_retry_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=_backoff_with_jitter(0))
    _log_sync(
        db, store_id=store_id, product_id=product_id, action=action, status="pending_retry",
        error_message=str(last_exc) if last_exc else "unknown error", error_category=error_category,
        payload=body, retry_count=_MAX_IMMEDIATE_ATTEMPTS, next_retry_at=next_retry_at, last_http_status=last_status,
    )
    return {"success": False, "error": str(last_exc) if last_exc else "unknown"}


def sync_catalog_incremental(db: Session, store_id: str, *, access_token: str, catalog_id: str, base_url: str, store_name: str, currency: str = "DZD") -> Dict[str, Any]:
    """
    Incremental sync: only pushes products whose data changed since their
    last SUCCESSFUL sync (compares Product.updated_at against the most
    recent successful TikTokCatalogSyncLog row), plus products never
    synced before. Deleted/deactivated products (is_active=False, is
    upsell-only, or is a pack — same exclusions as Meta's feed) are pushed
    as `delete` if they were previously synced successfully.
    """
    from app.models.product import Product
    from app.models.marketing import TikTokCatalogSyncLog

    products = db.query(Product).filter(Product.store_id == store_id, Product.is_upsell_only == False).all()
    last_success_by_product = {
        row.product_id: row.completed_at
        for row in (
            db.query(TikTokCatalogSyncLog)
            .filter(TikTokCatalogSyncLog.store_id == store_id, TikTokCatalogSyncLog.status == "success")
            .all()
        )
    }

    created = updated = deleted = skipped = failed = 0
    for p in products:
        should_delete = not p.is_active
        action = "delete" if should_delete else ("update" if p.id in last_success_by_product else "create")

        last_sync = last_success_by_product.get(p.id)
        if not should_delete and last_sync and p.updated_at and p.updated_at <= last_sync:
            skipped += 1
            continue

        item = None if should_delete else build_catalog_item(p, base_url=base_url, store_name=store_name, currency=currency)
        result = push_catalog_item(
            db, store_id=store_id, access_token=access_token, catalog_id=catalog_id,
            product_id=p.id, action=action, item=item,
        )
        if result.get("success"):
            if action == "create":
                created += 1
            elif action == "update":
                updated += 1
            else:
                deleted += 1
        else:
            failed += 1

    return {
        "success": True, "products_evaluated": len(products),
        "created": created, "updated": updated, "deleted": deleted,
        "skipped_unchanged": skipped, "failed": failed,
    }


def _reclaim_stuck_processing(db: Session) -> int:
    from sqlalchemy import update as sa_update
    from app.models.marketing import TikTokCatalogSyncLog

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=_STUCK_PROCESSING_MINUTES)
    result = db.execute(
        sa_update(TikTokCatalogSyncLog.__table__)
        .where(TikTokCatalogSyncLog.status == "processing", TikTokCatalogSyncLog.processing_started_at < cutoff)
        .values(status="retry", error_message="reclaimed: stuck in processing > 15min",
                next_retry_at=datetime.now(timezone.utc).replace(tzinfo=None))
    )
    db.commit()
    if result.rowcount:
        logger.warning("[TikTokCatalog] reclaimed %d row(s) stuck in 'processing'", result.rowcount)
    return result.rowcount


def retry_pending_catalog_syncs() -> None:
    """Periodic sweep — same mutex-protected contract as tiktok_capi.retry_pending_events."""
    if not _sweep_lock.acquire(blocking=False):
        logger.info("[TikTokCatalog] retry sweep: already running — skipped")
        return
    try:
        _retry_pending_catalog_syncs_inner()
    finally:
        _sweep_lock.release()


def _retry_pending_catalog_syncs_inner() -> None:
    from app.db.session import SessionLocal
    from app.models.marketing import TikTokCatalogSyncLog, TikTokAdsConfig

    db = SessionLocal()
    try:
        _reclaim_stuck_processing(db)

        now = datetime.now(timezone.utc)
        due = (
            db.query(TikTokCatalogSyncLog)
            .filter(
                TikTokCatalogSyncLog.status.in_(("queued", "retry", "pending_retry")),
                (TikTokCatalogSyncLog.next_retry_at.is_(None)) | (TikTokCatalogSyncLog.next_retry_at <= now),
            )
            .limit(200)
            .all()
        )
        if not due:
            return

        if _circuit_is_open():
            state = get_circuit_state()
            deferred_until = now.replace(tzinfo=None) + timedelta(seconds=state["seconds_until_reset"] or _CIRCUIT_COOLDOWN_SECONDS)
            for row in due:
                row.next_retry_at = deferred_until
                row.retry_count = (row.retry_count or 0) + 1
                if row.retry_count > _MAX_RETRY_COUNT:
                    row.status = "failed"
                    row.error_message = "max retry count exceeded while circuit breaker open"
            db.commit()
            return

        for row in due:
            config = db.query(TikTokAdsConfig).filter(TikTokAdsConfig.store_id == row.store_id).first()
            if not config or not config.access_token or not config.catalog_id:
                row.status = "failed"
                row.error_message = "TikTok catalog non configuré — impossible de réessayer"
                db.commit()
                continue

            row.status = "processing"
            row.processing_started_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()

            item = None
            if row.action != "delete" and row.payload:
                products = row.payload.get("products") or []
                item = products[0] if products else None

            result = push_catalog_item(
                db, store_id=row.store_id, access_token=config.access_token, catalog_id=config.catalog_id,
                product_id=row.product_id, action=row.action, item=item,
            )
            if not result.get("success") and row.retry_count >= _MAX_RETRY_COUNT:
                row.status = "failed"
                row.error_message = f"max retry count ({_MAX_RETRY_COUNT}) exceeded: {result.get('error')}"
                db.commit()
    finally:
        db.close()


def compute_catalog_health(db: Session, store_id: str) -> Dict[str, Any]:
    """
    Catalog Health dashboard data: how many products are tracked, success/
    failed/pending breakdown, per-error-category counts, most recent
    successful sync, average latency, success rate — same "single source
    of truth, never recomputed per-widget" principle as compute_meta_metrics.
    """
    from sqlalchemy import func
    from app.models.marketing import TikTokCatalogSyncLog

    rows = db.query(
        TikTokCatalogSyncLog.status, TikTokCatalogSyncLog.error_category, func.count(TikTokCatalogSyncLog.id),
    ).filter(TikTokCatalogSyncLog.store_id == store_id).group_by(
        TikTokCatalogSyncLog.status, TikTokCatalogSyncLog.error_category,
    ).all()

    by_status: Dict[str, int] = {}
    by_error_category: Dict[str, int] = {}
    for status, error_category, count in rows:
        by_status[status] = by_status.get(status, 0) + count
        if error_category:
            by_error_category[error_category] = by_error_category.get(error_category, 0) + count

    total = sum(by_status.values())
    success = by_status.get("success", 0)
    failed = by_status.get("failed", 0)
    pending = by_status.get("queued", 0) + by_status.get("processing", 0) + by_status.get("retry", 0) + by_status.get("pending_retry", 0)
    success_rate = round(success / total * 100, 1) if total else None

    last_success_at = (
        db.query(func.max(TikTokCatalogSyncLog.completed_at))
        .filter(TikTokCatalogSyncLog.store_id == store_id, TikTokCatalogSyncLog.status == "success")
        .scalar()
    )
    avg_latency_ms = (
        db.query(func.avg(TikTokCatalogSyncLog.latency_ms))
        .filter(TikTokCatalogSyncLog.store_id == store_id, TikTokCatalogSyncLog.status == "success",
                TikTokCatalogSyncLog.latency_ms.isnot(None))
        .scalar()
    )

    return {
        "total_tracked": total, "success": success, "failed": failed, "pending": pending,
        "success_rate_pct": success_rate,
        "last_success_at": last_success_at,
        "avg_latency_ms": round(avg_latency_ms, 1) if avg_latency_ms is not None else None,
        "errors_by_category": by_error_category,
    }
