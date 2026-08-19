import os
import time
import uuid
import logging
from fastapi import FastAPI, Query, Request, Response, Depends
from typing import Any
from app.api import deps
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1 import (
    auth, orders, products, stores, analytics, users, customers,
    promotions, finance, audit, stock, pos, delivery, warehouses,
    reviews, chat, suppliers, purchases, returns, expenses, marketing,
    partners, delivery_partners, upload, landing_pages, api_keys,
    meta_ads, upsell, purchase_vouchers, locations, tiktok_ads, payroll,
    notifications, conversion_optimization, internal, ads_comparison,
    assignment_rules,
)
from app.api.carriers import yalidine as yalidine_carrier
from app.api.carriers import noest as noest_carrier
from app.core.config import settings
from app.core.error_handlers import register_error_handlers
from app.core.logging import setup_logging
from app.core.tenant import TenantMiddleware
from app.core.rate_limit import DistributedRateLimitMiddleware
from app.db.session import SessionLocal
from app.models.store import Store

# Initialize Logging
setup_logging()

access_logger = logging.getLogger("access")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Assign a correlation ID to every request
        request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
        start = time.monotonic()
        response = await call_next(request)
        duration_ms = (time.monotonic() - start) * 1000
        user_id = request.headers.get("x-user-id", "-")
        # host + client_ip: who actually reached the server and via which
        # domain. A user who "can't access" whose device is stuck on stale DNS
        # (still pointing at the old Namecheap parking IP) never gets a TCP
        # connection to us at all — nothing appears in these logs for them.
        # If her login attempt IS visible here, the problem is downstream of
        # DNS (auth/network from here on); if it's absent, it's DNS/network
        # on her device/carrier, not this server.
        host = request.headers.get("host", "-")
        client_ip = (
            request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else "-")
        )
        # Breakdown of where the time actually went — previously only
        # exposed via the Server-Timing response header (invisible unless
        # someone opens devtools mid-incident), never logged server-side.
        # Answers "was this request slow because of SQL, Redis, or our own
        # code" from the container logs alone, after the fact.
        #
        # Read from response headers, NOT app.core.timing's contextvar
        # directly: BaseHTTPMiddleware runs each middleware's dispatch() in
        # its own asyncio task, so a ContextVar.set() done deeper in the
        # chain (DistributedRateLimitMiddleware calls timing.start()) is
        # invisible from this task's own context — reading the contextvar
        # here always returned an empty bag (confirmed in prod: every
        # access log line showed sql=0.0ms(0q) regardless of actual query
        # activity). DistributedRateLimitMiddleware is the correct place
        # that already computes this correctly for the Server-Timing
        # header; it also stamps these X-Internal-* headers for us to read.
        sql_ms = float(response.headers.get("X-Internal-Sql-Ms", "0") or 0)
        sql_count = int(response.headers.get("X-Internal-Sql-Count", "0") or 0)
        redis_ms = float(response.headers.get("X-Internal-Redis-Ms", "0") or 0)
        for _h in ("X-Internal-Sql-Ms", "X-Internal-Sql-Count", "X-Internal-Redis-Ms"):
            if _h in response.headers:
                del response.headers[_h]

        access_logger.info(
            "%s %s %d %.1fms user=%s host=%s ip=%s req_id=%s sql=%.1fms(%dq) redis=%.1fms",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            user_id,
            host,
            client_ip,
            request_id,
            sql_ms,
            sql_count,
            redis_ms,
        )
        # Propagate correlation ID back to client
        response.headers["X-Request-Id"] = request_id
        # Server-side processing time only (excludes network/TLS/proxy hops)
        # — lets us separate "our handler was slow" from "the network path
        # to/from us was slow" from outside, without guessing.
        response.headers["X-Process-Time-Ms"] = f"{duration_ms:.1f}"
        # This middleware is innermost of the 3 custom ones (rate-limit and
        # tenant wrap it), so this span is FastAPI routing + all Depends()
        # resolution (auth, get_db) + the route body itself — recorded into
        # the same per-request bag DistributedRateLimitMiddleware (outermost)
        # turns into the Server-Timing header.
        from app.core import timing as _timing
        _timing.record("handler_total", duration_ms)
        return response

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Production-ready Multi-Tenant ERP & Storefront API for AzzougShop",
    version=settings.VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# Accept both /endpoint and /endpoint/ — avoids redirect loops with Next.js proxy
app.router.redirect_slashes = False

@app.on_event("startup")
def run_db_migrations():
    from app.db.session import engine
    from sqlalchemy import text

    print("[START] Connecting to database for startup migrations...")

    statements = [
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS offers JSONB",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS banner_image_url VARCHAR",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_fees JSONB",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS module_visibility JSONB DEFAULT '{}'::jsonb",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_store_pickup INTEGER DEFAULT 100",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_recovered_store_pickup INTEGER DEFAULT 150",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_store_pickup_rate INTEGER",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_recovered_store_pickup_rate INTEGER",
        "UPDATE products SET is_active = TRUE WHERE (stock - COALESCE(reserved_stock, 0)) > 0 AND (is_active IS FALSE OR is_active IS NULL)",
        "UPDATE orders SET status = 'NEW' WHERE status IS NULL OR status = ''",
        "UPDATE orders c SET is_deleted = TRUE, parent_order_id = NULL FROM orders p WHERE c.parent_order_id = p.id AND (c.is_deleted IS FALSE OR c.is_deleted IS NULL) AND ABS(EXTRACT(EPOCH FROM (c.created_at - p.created_at))) <= 86400",
        "DELETE FROM notifications WHERE order_id IN (SELECT d.id FROM orders d JOIN (SELECT id, COALESCE(store_id, 'default') AS store_key, LOWER(TRIM(customer_phone)) AS clean_phone, created_at, ROW_NUMBER() OVER (PARTITION BY COALESCE(store_id, 'default'), LOWER(TRIM(customer_phone)) ORDER BY created_at ASC) AS rn FROM orders WHERE customer_phone IS NOT NULL AND TRIM(customer_phone) != '' AND LOWER(TRIM(customer_phone)) != 'inconnu') m ON LOWER(TRIM(d.customer_phone)) = m.clean_phone AND COALESCE(d.store_id, 'default') = m.store_key AND m.rn = 1 AND d.id != m.id AND d.created_at >= m.created_at AND d.created_at <= m.created_at + INTERVAL '5 minutes')",
        "DELETE FROM stock_movements WHERE order_id IN (SELECT d.id FROM orders d JOIN (SELECT id, COALESCE(store_id, 'default') AS store_key, LOWER(TRIM(customer_phone)) AS clean_phone, created_at, ROW_NUMBER() OVER (PARTITION BY COALESCE(store_id, 'default'), LOWER(TRIM(customer_phone)) ORDER BY created_at ASC) AS rn FROM orders WHERE customer_phone IS NOT NULL AND TRIM(customer_phone) != '' AND LOWER(TRIM(customer_phone)) != 'inconnu') m ON LOWER(TRIM(d.customer_phone)) = m.clean_phone AND COALESCE(d.store_id, 'default') = m.store_key AND m.rn = 1 AND d.id != m.id AND d.created_at >= m.created_at AND d.created_at <= m.created_at + INTERVAL '5 minutes')",
        "DELETE FROM order_events WHERE order_id IN (SELECT d.id FROM orders d JOIN (SELECT id, COALESCE(store_id, 'default') AS store_key, LOWER(TRIM(customer_phone)) AS clean_phone, created_at, ROW_NUMBER() OVER (PARTITION BY COALESCE(store_id, 'default'), LOWER(TRIM(customer_phone)) ORDER BY created_at ASC) AS rn FROM orders WHERE customer_phone IS NOT NULL AND TRIM(customer_phone) != '' AND LOWER(TRIM(customer_phone)) != 'inconnu') m ON LOWER(TRIM(d.customer_phone)) = m.clean_phone AND COALESCE(d.store_id, 'default') = m.store_key AND m.rn = 1 AND d.id != m.id AND d.created_at >= m.created_at AND d.created_at <= m.created_at + INTERVAL '5 minutes')",
        "DELETE FROM order_items WHERE order_id IN (SELECT d.id FROM orders d JOIN (SELECT id, COALESCE(store_id, 'default') AS store_key, LOWER(TRIM(customer_phone)) AS clean_phone, created_at, ROW_NUMBER() OVER (PARTITION BY COALESCE(store_id, 'default'), LOWER(TRIM(customer_phone)) ORDER BY created_at ASC) AS rn FROM orders WHERE customer_phone IS NOT NULL AND TRIM(customer_phone) != '' AND LOWER(TRIM(customer_phone)) != 'inconnu') m ON LOWER(TRIM(d.customer_phone)) = m.clean_phone AND COALESCE(d.store_id, 'default') = m.store_key AND m.rn = 1 AND d.id != m.id AND d.created_at >= m.created_at AND d.created_at <= m.created_at + INTERVAL '5 minutes')",
        "DELETE FROM orders WHERE id IN (SELECT d.id FROM orders d JOIN (SELECT id, COALESCE(store_id, 'default') AS store_key, LOWER(TRIM(customer_phone)) AS clean_phone, created_at, ROW_NUMBER() OVER (PARTITION BY COALESCE(store_id, 'default'), LOWER(TRIM(customer_phone)) ORDER BY created_at ASC) AS rn FROM orders WHERE customer_phone IS NOT NULL AND TRIM(customer_phone) != '' AND LOWER(TRIM(customer_phone)) != 'inconnu') m ON LOWER(TRIM(d.customer_phone)) = m.clean_phone AND COALESCE(d.store_id, 'default') = m.store_key AND m.rn = 1 AND d.id != m.id AND d.created_at >= m.created_at AND d.created_at <= m.created_at + INTERVAL '5 minutes')",
        "WITH ranked_orders AS (SELECT id, FIRST_VALUE(id) OVER (PARTITION BY COALESCE(store_id, 'default'), LOWER(TRIM(customer_phone)) ORDER BY (CASE WHEN COALESCE(is_abandoned_cart, FALSE) IS FALSE AND status NOT IN ('ABANDONED', 'MERGED') THEN 0 ELSE 1 END) ASC, created_at ASC) as parent_id FROM orders WHERE customer_phone IS NOT NULL AND TRIM(customer_phone) != '' AND LOWER(TRIM(customer_phone)) != 'inconnu' AND (is_deleted IS FALSE OR is_deleted IS NULL) AND status != 'MERGED') UPDATE orders o SET status = 'MERGED', parent_order_id = r.parent_id, is_deleted = TRUE FROM ranked_orders r WHERE o.id = r.id AND o.id != r.parent_id",
        "WITH renumbered AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY store_id ORDER BY created_at ASC) AS seq FROM orders WHERE (is_deleted IS FALSE OR is_deleted IS NULL) AND status != 'MERGED') UPDATE orders SET store_sequence_number = renumbered.seq FROM renumbered WHERE orders.id = renumbered.id",
        "UPDATE orders SET status = CASE WHEN status = 'ABANDONED' THEN 'NEW' ELSE status END, is_abandoned_cart = FALSE WHERE created_at >= '2026-08-18 00:00:00' AND (is_abandoned_cart = TRUE OR status = 'ABANDONED')",
        "UPDATE orders SET is_deleted = TRUE, status = 'DELETED' WHERE order_number = 'ABN-20260819-051F94' OR order_number LIKE '%051F94%' OR (customer_phone = '0780125700' AND order_number LIKE 'ABN%')",
    ]

    for stmt in statements:
        try:
            with engine.begin() as conn:
                conn.execute(text(stmt))
        except Exception as e:
            print(f"[WARN] Startup migration statement failed ({stmt[:60]}...): {e}")

    # Execute batch delivered orders SQL migration file
    try:
        sql_file_path = os.path.join(os.path.dirname(__file__), "db", "migrations", "update_delivered_orders.sql")
        if os.path.exists(sql_file_path):
            with open(sql_file_path, "r", encoding="utf-8") as sf:
                sql_content = sf.read()
            sql_commands = [c.strip() for c in sql_content.split(";") if c.strip() and not c.strip().startswith("--")]
            with engine.begin() as conn:
                for cmd in sql_commands:
                    conn.execute(text(cmd))
            print(f"[OK] Executed delivered orders batch migration script ({len(sql_commands)} statements).")
    except Exception as e:
        print(f"[WARN] Failed to execute delivered orders migration script: {e}")

    print("[OK] Startup migrations finished — database connection is live.")

    try:
        from app.models.order import Order, OrderItem
        from app.db.session import SessionLocal
        db_mig = SessionLocal()
        try:
            parents = db_mig.query(Order).filter(Order.id.in_(db_mig.query(Order.parent_order_id).filter(Order.parent_order_id.isnot(None)))).all()
            for p in parents:
                if p.items:
                    seen = set()
                    to_remove = []
                    for item in p.items:
                        key = (item.product_id, str(item.variant_details))
                        if key in seen:
                            to_remove.append(item)
                        else:
                            seen.add(key)
                            item.quantity = 1
                    for item in to_remove:
                        db_mig.delete(item)
                    db_mig.flush()
                    subtotal = sum(int(i.quantity or 1) * float(i.unit_price or 0) for i in p.items if i not in to_remove)
                    p.subtotal = int(subtotal)
                    p.total = max(0, int(subtotal) + int(p.delivery_fee or 0) - int(p.discount or 0))
            # Delete any MERGED child orders created within 10 minutes of their parent order
            child_orders = db_mig.query(Order).filter(
                Order.parent_order_id.isnot(None),
                Order.status == "MERGED",
            ).all()
            purged = 0
            for child in child_orders:
                parent = db_mig.query(Order).filter(Order.id == child.parent_order_id).first()
                if parent and child.created_at and parent.created_at:
                    diff_sec = abs((child.created_at - parent.created_at).total_seconds())
                    if diff_sec <= 600:
                        db_mig.query(OrderItem).filter(OrderItem.order_id == child.id).delete(synchronize_session=False)
                        db_mig.delete(child)
                        purged += 1
            db_mig.commit()
            print(f"[OK] Cleaned up merged parent order baskets and purged {purged} <10min duplicate child orders.")
        finally:
            db_mig.close()
    except Exception as exc:
        print(f"[WARN] Clean up merged parent orders skipped: {exc}")

def _acquire_scheduler_leader_lock() -> bool:
    """
    True iff this process wins an exclusive, non-blocking lock — used to run
    background_loop() in exactly one worker. Below this app ran uvicorn with
    no --workers flag (single process), which meant one Python event loop
    serialized every request; concurrent dashboard loads across 2+ stores
    (each firing ~10 requests) queued up and HuggingFace's own gateway
    timed the slow ones out as a 500 with no trace in our own logs (the
    request never got a chance to run). Multiple workers fixes that, but
    each worker's startup event fires independently — without this lock,
    N workers would each spin up their own background_loop(), meaning N
    duplicate Meta Ads syncs, N duplicate reminder notifications sent to
    staff/customers, N duplicate Cloudinary migration passes, etc. All
    workers share the container filesystem, so flock on a fixed path is a
    simple, dependency-free way to pick exactly one leader.
    """
    import fcntl
    try:
        lock_file = open("/tmp/azzougshop_scheduler.lock", "w")
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        globals()["_scheduler_lock_fh"] = lock_file  # keep FD alive for process lifetime
        return True
    except (OSError, BlockingIOError):
        return False


@app.on_event("startup")
async def start_background_sync():
    """Noest polling + reminder scheduler (see app/services/noest_sync.py) — leader-only, see _acquire_scheduler_leader_lock."""
    import asyncio
    if not _acquire_scheduler_leader_lock():
        logging.getLogger("app.startup").info("[Scheduler] Another worker already holds the leader lock — skipping background_loop in this worker.")
        return
    from app.services.noest_sync import background_loop
    asyncio.create_task(background_loop())
    asyncio.create_task(_funnel_flush_loop())


async def _funnel_flush_loop() -> None:
    """
    Drains the Redis funnel-event counters every 15 min — same interval the
    Celery beat schedule used, moved onto this leader-locked asyncio loop
    instead. start_hf.sh detaches Celery worker/beat as background processes
    (`--detach`) and then `exec`s uvicorn, which replaces PID 1 — nothing
    supervises or restarts those detached processes if either dies, and
    nothing surfaces it (the container's only externally-visible health
    signal is whether the HTTP server responds, which is independent of
    Celery beat). This loop runs inside the same already-alive, already
    leader-locked process as every other proven periodic job in this
    deployment (Noest sync, reminders, Meta Ads sync) instead of depending
    on a second, unsupervised scheduling mechanism for a feature that only
    exists to power a diagnostics dashboard.
    """
    import asyncio
    _log = logging.getLogger("app.startup")
    await asyncio.sleep(30)  # let DB/Redis connections settle after boot
    while True:
        try:
            from app.services.funnel_tracking import flush_funnel_counters
            result = await asyncio.to_thread(flush_funnel_counters)
            _log.info("[FunnelFlush] %s", result)
        except Exception as exc:
            _log.error("[FunnelFlush] crashed: %s", exc)
        await asyncio.sleep(900)  # 15 min

@app.on_event("startup")
async def resume_pending_queues():
    """
    Immediate recovery after any restart: flush overdue CAPI events and
    resume any pending NOEST operations without waiting for the first
    background_loop tick (which fires after REMINDER_SCAN_INTERVAL_SECONDS).
    """
    import asyncio
    import logging
    _log = logging.getLogger("app.startup")

    async def _sweep():
        try:
            from app.services.meta_capi import retry_pending_events
            from app.db.session import SessionLocal
            from app.models.marketing import MetaCapiLog
            from datetime import datetime, timezone
            db = SessionLocal()
            try:
                # 'queued': written before the background task ran, never
                # attempted — this is the exact class of row a container
                # kill leaves behind (see app.services.meta_capi module
                # docstring / migration f6a7b8c9d0e1). 'processing': a
                # worker that died mid-send; the sweep itself reclaims rows
                # stuck >15min back to 'retry'. 'retry'/'pending_retry':
                # already-failed sends still eligible for another attempt.
                pending = db.query(MetaCapiLog).filter(
                    MetaCapiLog.status.in_(("queued", "processing", "retry", "pending_retry"))
                ).count()
            finally:
                db.close()
            if pending:
                _log.info("[StartupRecovery] %d CAPI event(s) pending — running immediate retry sweep", pending)
                await asyncio.to_thread(retry_pending_events)
                _log.info("[StartupRecovery] CAPI startup sweep complete")
            else:
                _log.info("[StartupRecovery] CAPI queue empty — no recovery needed")
        except Exception as exc:
            _log.error("[StartupRecovery] CAPI sweep failed: %s", exc)

    # Run after a short delay so DB connections are fully ready
    await asyncio.sleep(3)
    asyncio.create_task(_sweep())


@app.on_event("startup")
def create_initial_superadmin():
    from app.db.session import SessionLocal
    from app.models.user import User
    from app.models.store import Store
    from app.models.order import Order
    from app.core.security import get_password_hash
    from sqlalchemy import text
    from sqlalchemy.orm import Session
    from app.core.tenant import tenant_store_id
    import uuid
    
    db: Session = SessionLocal()
    try:
        # 0. Cleanly renumber all active non-merged orders per store
        db.execute(text("""
            WITH renumbered AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY store_id ORDER BY created_at ASC) AS seq
                FROM orders
                WHERE (is_deleted IS FALSE OR is_deleted IS NULL) AND status != 'MERGED'
            )
            UPDATE orders
            SET store_sequence_number = renumbered.seq
            FROM renumbered
            WHERE orders.id = renumbered.id
        """))

        # Auto-reconcile delivered orders provided by user
        db.execute(text("""
            UPDATE orders
            SET status = 'DELIVERED',
                carrier_stage = 'delivered',
                carrier_stage_label = 'Livré',
                updated_at = NOW()
            WHERE order_number IN (
                'ABN-20260815-48D664', 'ABN-20260815-77FDEF', 'ABN-20260814-A35338',
                'ABN-20260814-643E4A', 'ABN-20260814-44A16D', 'ABN-20260814-E8EE49',
                'ABN-20260813-8ACB5E', 'ABN-20260813-409D11', 'ABN-20260813-ACA9FB',
                'ABN-20260812-F9E227', 'ABN-20260812-8CB4C3', 'ABN-20260809-115962',
                'ABN-20260705-8FF0D5', 'ORD-20260706-9E2A98', 'ABN-20260707-785C7E',
                'ABN-20260707-EB34CF', 'ABN-20260707-B750D0', 'ABN-20260708-141665',
                'ABN-20260708-771186', 'ABN-20260709-D04EAB', 'ABN-20260708-840808',
                'ABN-20260709-56D938', 'ABN-20260710-08ACF9', 'ABN-20260710-30E804',
                'ABN-20260710-33FB15', 'ABN-20260710-7F9F06', 'ABN-20260712-D58720',
                'ABN-20260710-C16985', 'ABN-20260712-C153DA', 'ORD-20260712-A2EE0C',
                'ABN-20260712-08DBCA', '5282992', 'ABN-20260713-1529C9',
                'ABN-20260713-03E6CF', 'ABN-20260713-DCF18B', 'ABN-20260713-0051CA',
                'ABN-20260712-5C5CA7', 'ABN-20260712-068B43', 'ABN-20260712-836782',
                'ORD-20260713-685AE5', 'ABN-20260712-872730', 'ABN-20260712-2381ED',
                'ABN-20260713-55CD08', 'ABN-20260713-632A3D', 'ABN-20260713-80110A',
                'ABN-20260712-97522B', 'ABN-20260713-D64841', 'ABN-20260713-C47FAD',
                'ABN-20260713-5C581A', 'ABN-20260714-A2D661', 'ABN-20260714-4CD65C',
                'ORD-20260714-F994AE', 'ABN-20260714-0A7FA3', 'ORD-20260714-C17502',
                '4789765', 'ABN-20260714-98AC80', 'ABN-20260714-22557F',
                'ABN-20260714-50C3AA', 'ABN-20260715-366DFC', 'ABN-20260715-6622DF',
                'ABN-20260715-D8DC82', 'ABN-20260715-1C4F71', 'ABN-20260715-6EEBFF',
                'ABN-20260709-673795', 'ABN-20260711-44F35D', 'ABN-20260714-A4B717',
                'ORD-20260715-0FF840', 'ABN-20260715-73838D', 'ORD-20260715-39C478',
                'ORD-20260715-8F7E38', 'ORD-20260715-FAB104', 'ABN-20260715-C168D1',
                'ABN-20260715-DD319A', 'ABN-20260715-943D67', 'ABN-20260715-3AB618',
                'ABN-20260715-CEF324', 'ABN-20260715-CFE1B4', 'ABN-20260716-FA5553',
                'ABN-20260716-F469BF', 'ABN-20260716-D9FB69', 'ABN-20260716-9412EB',
                'ORD-20260716-DE2556', 'ABN-20260716-01A8E5', 'ABN-20260715-8AE7BE',
                'ABN-20260713-5A67B4', 'ABN-20260716-5C6833', 'ABN-20260717-8BE0F6',
                'ABN-20260717-82BCFC', 'ABN-20260717-415CF5', 'ABN-20260716-83CA03',
                'ABN-20260716-1841A2', 'ABN-20260717-1CAE0F', 'ABN-20260717-5CAA64',
                'ABN-20260713-675395', 'ABN-20260717-040B7B', 'ABN-20260717-6511D1',
                'ABN-20260717-227B2A', 'ABN-20260717-5C687F', 'ABN-20260717-35F746',
                'ABN-20260718-328DDC', 'ABN-20260718-8DDF42', 'ABN-20260718-EC9A30',
                'ABN-20260718-D3A78F', 'ABN-20260717-606D32', '367890',
                'ORD-20260718-450A32', 'ABN-20260718-89FFD0', 'ABN-20260718-BAD770',
                'ABN-20260718-8FFE69', 'ABN-20260718-9D6AC6', 'ABN-20260718-BC490F',
                'ABN-20260719-D2D156', 'ABN-20260719-EEA935', 'ABN-20260719-9779B7',
                'ABN-20260719-A142A8', 'ABN-20260719-5F7D51', 'ABN-20260717-A669E5',
                'ORD-20260719-249EBA', 'ABN-20260719-1C68F8', 'ABN-20260717-6F1F1C',
                'ABN-20260720-DB4241', 'ABN-20260720-C042DB', 'ABN-20260719-99BF56',
                'ABN-20260718-68BA58', 'ABN-20260720-265E5F', 'ABN-20260719-C28BCB',
                'ORD-20260720-144076', 'ABN-20260720-BEE0BF', 'ABN-20260720-76AB46',
                'ABN-20260717-1A243C', 'ORD-20260720-ECAF62', 'ORD-20260720-F3D355',
                'ABN-20260720-5303C1', 'ABN-20260720-BAF72D', 'ABN-20260720-E2697E',
                'ABN-20260720-B0B6FB', 'ABN-20260719-6A3BDF', 'ABN-20260721-D7A8BF',
                'ABN-20260720-808707', 'ABN-20260721-67C648', 'ABN-20260720-28D2B6',
                'ABN-20260721-D105F2', 'ABN-20260721-C971E2', 'ABN-20260722-0F1A8C'
            ) OR tracking_number IN (
                'OZW-35B-19629322', 'OZW-35B-19605904', 'OZW-35B-19590003',
                'OZW-35B-19589487', 'OZW-35B-19588550', 'OZW-35B-19578515',
                'OZW-35B-19578288', 'OZW-35B-19578267', 'OZW-35B-19558757',
                'OZW-35B-19553950', 'OZW-35B-19525453', 'OZW-35B-19448126',
                'OZW-35B-18473402', 'OZW-35B-18500779', 'OZW-35B-18505035',
                'OZW-35B-18517235', 'OZW-35B-18535498', 'OZW-35B-18564139',
                'OZW-35B-18564365', 'OZW-35B-18575794', 'OZW-35B-18608029',
                'OZW-35B-18608411', 'OZW-35B-18610386', 'OZW-35B-18610731',
                'OZW-35B-18611021', 'OZW-35B-18613161', 'OZW-35B-18651437',
                'OZW-35B-18654068', 'OZW-35B-18654254', 'OZW-35B-18656528',
                'OZW-35B-18657029', 'OZW-35B-18660500', 'OZW-35B-18678292',
                'OZW-35B-18678732', 'OZW-35B-18679372', 'OZW-35B-18679620',
                'OZW-35B-18679626', 'OZW-35B-18679680', 'OZW-35B-18679736',
                'OZW-35B-18680019', 'OZW-35B-18680033', 'OZW-35B-18680055',
                'OZW-35B-18680097', 'OZW-35B-18684379', 'OZW-35B-18684765',
                'OZW-35B-18684904', 'OZW-35B-18704054', 'OZW-35B-18704089',
                'OZW-35B-18704137', 'OZW-35B-18704507', 'OZW-35B-18704575',
                'OZW-35B-18705123', 'OZW-35B-18705351', 'OZW-35B-18711027',
                'OZW-35B-18720098', 'OZW-35B-18733125', 'OZW-35B-18733216',
                'OZW-35B-18733472', 'OZW-35B-18734399', 'OZW-35B-18734499',
                'OZW-35B-18735429', 'OZW-35B-18736592', 'OZW-35B-18736882',
                'OZW-35B-18736994', 'OZW-35B-18737243', 'OZW-35B-18738715',
                'OZW-35B-18738832', 'OZW-35B-18739298', 'OZW-35B-18739371',
                'OZW-35B-18742785', 'OZW-35B-18742902', 'OZW-35B-18743041',
                'OZW-35B-18743224', 'OZW-35B-18749415', 'OZW-35B-18762662',
                'OZW-35B-18765064', 'OZW-35B-18765093', 'OZW-35B-18765153',
                'OZW-35B-18765210', 'OZW-35B-18765345', 'OZW-35B-18765430',
                'OZW-35B-18767302', 'OZW-35B-18768290', 'OZW-35B-18770622',
                'OZW-35B-18770851', 'OZW-35B-18770979', 'OZW-35B-18772494',
                'OZW-35B-18786338', 'OZW-35B-18786578', 'OZW-35B-18786702',
                'OZW-35B-18786770', 'OZW-35B-18788226', 'OZW-35B-18788236',
                'OZW-35B-18788258', 'OZW-35B-18788401', 'OZW-35B-18789152',
                'OZW-35B-18789334', 'OZW-35B-18801377', 'OZW-35B-18801398',
                'OZW-35B-18803379', 'OZW-35B-18803598', 'OZW-35B-18803683',
                'OZW-35B-18803899', 'OZW-35B-18804078', 'OZW-35B-18808771',
                'OZW-35B-18809103', 'OZW-35B-18811903', 'OZW-35B-18812275',
                'OZW-35B-18812472', 'OZW-35B-18825889', 'OZW-35B-18827237',
                'OZW-35B-18839817', 'OZW-35B-18839851', 'OZW-35B-18840066',
                'OZW-35B-18840763', 'OZW-35B-18849186', 'OZW-35B-18852643',
                'OZW-35B-18853276', 'OZW-35B-18853372', 'OZW-35B-18853899',
                'OZW-35B-18854653', 'OZW-35B-18870185', 'OZW-35B-18870351',
                'OZW-35B-18870492', 'OZW-35B-18871654', 'OZW-35B-18871896',
                'OZW-35B-18872535', 'OZW-35B-18875750', 'OZW-35B-18879107',
                'OZW-35B-18880708', 'OZW-35B-18880988', 'OZW-35B-18881168',
                'OZW-35B-18881355', 'OZW-35B-18881531', 'OZW-35B-18899189',
                'OZW-35B-18899266', 'OZW-35B-18901074', 'OZW-35B-18901728',
                'OZW-35B-18901944', 'OZW-35B-18902348', 'OZW-35B-18904815',
                'OZW-35B-18910952', 'OZW-35B-18913634', 'OZW-35B-18918531',
                'OZW-35B-18938060'
            ) OR customer_phone IN (
                '0671034439', '0668430343', '0665600716', '0560675917',
                '0655580995', '0772821912', '0773525375', '0792396552',
                '0664952215', '0542218693', '0668296537', '0667099715',
                '0660491499', '0659715847', '0657507066', '0666063255',
                '0662955831', '0550451309', '0668227065', '0660088156',
                '0775491372', '0550416875', '0655957267', '0551181968',
                '0666233231', '0551914163', '0697262384', '0550462656',
                '0556611868', '0540101802', '0773375785', '0664578091',
                '0562230987', '0669159133', '0779223813', '0659537813',
                '0552270061', '0662625994', '0542558371', '0660392701',
                '0553335312', '0555187640', '0795939832', '0699214140',
                '0794197125', '0663265119', '0774635624', '0663552655',
                '0779487680', '0698066683', '0667653545', '0770363892',
                '0770737168', '0770778249', '0552011977', '0674301441',
                '0542941318', '0542802607', '0782724583', '0660617462',
                '0770729471', '0662048797', '0661598031', '0676870767',
                '0559128304', '0662492369', '0663181124', '0675243436',
                '0549313345', '0793926253', '0661132768', '0662000772',
                '0799239645', '0558644262', '0665735756', '0657210393',
                '0774718533', '0661829486', '0667965141', '0770550837',
                '0555790735', '0698427740', '0668197637', '0656700105',
                '0773833536', '0559218700', '0654827730', '0671121629',
                '0662823337', '0659175561', '0770139364', '0671042259',
                '0793693962', '0698013530', '0793035957', '0667769691',
                '0652726040', '0792601576', '0774073927', '0660774013',
                '0549114843', '0553061924', '0661818853', '0549611350',
                '0799540009', '0770283643', '0542693865', '0676433124',
                '0550787131', '0770470496', '0556434277', '0555794254',
                '0782048359', '0664725539', '0541831401', '0795195221',
                '0664451933', '0660393491', '0555779526', '0660719732',
                '0790017958', '0661927966', '0657978112', '0553541542',
                '0557025575', '0793416540', '0666871720', '0795037472',
                '0770318563', '0558613188', '0696622533', '0562334712',
                '0556413915', '0557277935', '0696329044', '0559697815',
                '0659882876', '0542342061', '0542763035', '0672738244',
                '0552066649', '0671863473', '0660485477', '0659751676'
            )
        """))

        tracking_pairs = [
            ("ABN-20260815-48D664", "OZW-35B-19629322"),
            ("ABN-20260815-77FDEF", "OZW-35B-19605904"),
            ("ABN-20260814-A35338", "OZW-35B-19590003"),
            ("ABN-20260814-643E4A", "OZW-35B-19589487"),
            ("ABN-20260814-44A16D", "OZW-35B-19588550"),
            ("ABN-20260814-E8EE49", "OZW-35B-19578515"),
            ("ABN-20260813-8ACB5E", "OZW-35B-19578288"),
            ("ABN-20260813-409D11", "OZW-35B-19578267"),
            ("ABN-20260813-ACA9FB", "OZW-35B-19558757"),
            ("ABN-20260812-F9E227", "OZW-35B-19553950"),
            ("ABN-20260812-8CB4C3", "OZW-35B-19525453"),
            ("ABN-20260809-115962", "OZW-35B-19448126"),
        ]
        for num, trk in tracking_pairs:
            db.execute(text("""
                UPDATE orders
                SET tracking_number = :trk
                WHERE order_number = :num AND (tracking_number IS NULL OR tracking_number = '')
            """), {"num": num, "trk": trk})

        # Auto-reconcile returned orders provided by user
        db.execute(text("""
            UPDATE orders
            SET status = 'RETURNED',
                carrier_stage = 'returned',
                carrier_stage_label = 'Retourné',
                updated_at = NOW()
            WHERE order_number IN (
                'ABN-20260813-156636', 'ABN-20260812-B437EA', 'ABN-20260811-F4F81E',
                'ABN-20260811-A02579', '53783839', 'ORD-20260731-3730CF',
                'ORD-20260731-006547', 'ABN-20260731-0FA2FF', 'ABN-20260730-5B1CBF',
                'ABN-20260730-097BFB', 'ABN-20260730-52AB4E', 'ABN-20260727-ECBC8F',
                'ABN-20260728-BD652F', 'ABN-20260726-C7CC08', 'ORD-20260726-14EF50',
                'ABN-20260726-B44B89', 'ABN-20260724-BDAC8B', 'ABN-20260724-C7FF6F'
            ) OR tracking_number IN (
                'OZW-35B-19557760', 'OZW-35B-19525890', 'OZW-35B-19507952',
                'OZW-35B-19500073', 'OZW-35B-19268921', 'OZW-35B-19240600',
                'OZW-35B-19184043', 'OZW-35B-19183980', 'OZW-35B-19183823',
                'OZW-35B-19175727', 'OZW-35B-19163456', 'OZW-35B-19163402',
                'OZW-35B-19099723', 'OZW-35B-19098822', 'OZW-35B-19072669',
                'OZW-35B-19037977', 'OZW-35B-19034805', 'OZW-35B-18995104',
                'OZW-35B-18983366'
            ) OR customer_phone IN (
                '0675024669', '0551666590', '0661689685', '0665741665',
                '0540020302', '0792616602', '0656700105', '0781460187',
                '0699600077', '0557584614', '0698480423', '0660200328',
                '0671915719', '0660304346', '0660030318', '0561242806',
                '0675401140', '0557331083', '0671985917'
            )
        """))

        returned_tracking_pairs = [
            ("ABN-20260813-156636", "OZW-35B-19557760"),
            ("ABN-20260812-B437EA", "OZW-35B-19525890"),
            ("ABN-20260811-F4F81E", "OZW-35B-19507952"),
            ("ABN-20260811-A02579", "OZW-35B-19500073"),
            ("53783839", "OZW-35B-19240600"),
            ("ORD-20260731-3730CF", "OZW-35B-19184043"),
            ("ORD-20260731-006547", "OZW-35B-19183980"),
            ("ABN-20260731-0FA2FF", "OZW-35B-19183823"),
            ("ABN-20260730-5B1CBF", "OZW-35B-19175727"),
            ("ABN-20260730-097BFB", "OZW-35B-19163456"),
            ("ABN-20260730-52AB4E", "OZW-35B-19163402"),
            ("ABN-20260727-ECBC8F", "OZW-35B-19099723"),
            ("ABN-20260728-BD652F", "OZW-35B-19098822"),
            ("ABN-20260726-C7CC08", "OZW-35B-19072669"),
            ("ORD-20260726-14EF50", "OZW-35B-19037977"),
            ("ABN-20260726-B44B89", "OZW-35B-19034805"),
            ("ABN-20260724-BDAC8B", "OZW-35B-18995104"),
            ("ABN-20260724-C7FF6F", "OZW-35B-18983366"),
        ]
        for num, trk in returned_tracking_pairs:
            db.execute(text("""
                UPDATE orders
                SET tracking_number = :trk
                WHERE (order_number = :num OR tracking_number = :trk) AND (tracking_number IS NULL OR tracking_number = '' OR tracking_number != :trk)
            """), {"num": num, "trk": trk})

        db.commit()

        # 1. Create super admin if it doesn't exist
        tenant_store_id.set("SUPER_ADMIN_MODE")

        email = "nadjibazzoug@gmail.com"
        existing = db.query(User).filter(User.email == email).first()
        if not existing:
            user = User(
                id=str(uuid.uuid4()),
                email=email,
                name="nadjib",
                hashed_password=get_password_hash("nadjib2026@"),
                role="SUPER_ADMIN",
                is_active=True
            )
            db.add(user)
            db.commit()
            print(f"Created SUPER_ADMIN user: {email} via startup event")
        else:
            existing.hashed_password = get_password_hash("nadjib2026@")
            existing.name = "nadjib"
            existing.role = "SUPER_ADMIN"
            existing.is_active = True
            db.commit()
            print(f"SUPER_ADMIN user {email} already exists, updated password and role via startup event")
    except Exception as e:
        db.rollback()
        print(f"Error creating startup superadmin: {e}")
    finally:
        db.close()

# (Removed: [StartupDiag] full stores/products/LPs report — it ran a complete
# N+1 scan of every store × products × landing pages at every container boot,
# purely for logging. HF Spaces restarts made this a recurring DB cost.)

@app.get("/api/v1/routes-debug")
def list_routes(current_user: Any = Depends(deps.get_current_active_user)):
    if getattr(current_user, "role", None) not in ("SUPER_ADMIN", "ADMIN"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Superadmin only")
    return [{"path": r.path, "name": r.name} for r in app.routes if hasattr(r, "path")]

@app.get("/api/v1/debug-noest-token")
def debug_noest_token(store_id: str, x_internal_key: str = Depends(deps.get_current_user)):
    from app.db.session import SessionLocal
    from app.api.carriers.noest import _get_partner, _creds
    db = SessionLocal()
    try:
        partner = _get_partner(db, store_id)
        token, guid, base = _creds(partner)
        return {"token": token, "guid": guid, "base": base}
    finally:
        db.close()

# ─── CORS ────────────────────────────────────────────────────
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Total-Count", "X-Page", "X-Total-Pages"]
    )

# ─── Centralized Exception Handlers ─────────────────────────
# Must be registered BEFORE middleware to catch startup errors
register_error_handlers(app)

# ─── Multi-Tenant & Distributed Rate Limiting ────────────────
app.add_middleware(DistributedRateLimitMiddleware)
app.add_middleware(TenantMiddleware)
app.add_middleware(RequestLoggingMiddleware)

# ─── Vercel Service Prefix Routing Middleware ────────────────
# Registered LAST → Starlette makes it the OUTERMOST middleware, i.e. the
# very first code of ours that runs for any request and the very last that
# runs on the way out. Every prior production incident where the browser saw
# a 500/502/503 showed ZERO trace anywhere in our logs (register_error_handlers
# catches and logs every exception that reaches FastAPI's routing/handlers —
# see app/core/error_handlers.py — so an exception THERE always leaves a
# line). That left one unproven possibility: a request dies before even
# reaching FastAPI's routing (inside this ASGI layer, or never delivered by
# uvicorn at all). RAWENTRY/RAWEXIT below is unconditional — it runs before
# any routing, auth, or FastAPI exception handling — so it settles the
# question with direct evidence instead of inference:
#   - RAWENTRY with no matching RAWEXIT/RAWERROR  → hung/killed inside our
#     process (a real, fixable app-level bug — investigate from there).
#   - The browser's failed request has NO RAWENTRY line at all           → it
#     never reached this process; confirmed external (HF's gateway/proxy),
#     nothing left to fix in application code.
import logging as _rawlog_module
_raw_logger = _rawlog_module.getLogger("app.rawentry")

class VercelPrefixMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if path.startswith("/_/backend"):
            scope["path"] = path[len("/_/backend"):]
            raw_path = scope.get("raw_path", b"")
            if raw_path.startswith(b"/_/backend"):
                scope["raw_path"] = raw_path[len(b"/_/backend"):]
            scope["root_path"] = "/_/backend"

        req_id = str(uuid.uuid4())[:8]
        method = scope.get("method", "?")
        log_path = scope.get("path", "?")
        _raw_logger.info("RAWENTRY[%s] %s %s", req_id, method, log_path)
        status_holder = {}

        async def _send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, _send_wrapper)
        except BaseException as exc:
            # Anything escaping here bypassed FastAPI's own exception
            # handlers entirely — genuinely unprecedented if it ever fires.
            _raw_logger.critical("RAWERROR[%s] %s %s: %r", req_id, method, log_path, exc, exc_info=True)
            raise
        else:
            _raw_logger.info("RAWEXIT[%s] %s %s status=%s", req_id, method, log_path, status_holder.get("status", "?"))

app.add_middleware(VercelPrefixMiddleware)



# ─── Prometheus Monitoring (optional) ────────────────────────
try:
    from prometheus_fastapi_instrumentator import Instrumentator
    Instrumentator().instrument(app).expose(app)
except ImportError:
    pass


# ─── Route Registration Helper ───────────────────────────────
def include_v1(router, path: str, tags: list):
    """Register a router under /api/v1/{path}."""
    clean_path = path.lstrip("/")
    app.include_router(
        router,
        prefix=f"{settings.API_V1_STR}/{clean_path}",
        tags=tags
    )


# ─── Authentication ──────────────────────────────────────────
include_v1(auth.router, "auth", ["🔐 Authentification"])

# ─── Core Business ───────────────────────────────────────────
include_v1(stores.router, "stores", ["🏪 Boutiques"])
include_v1(products.router, "products", ["📦 Produits"])
include_v1(orders.router, "orders", ["🛒 Commandes"])
include_v1(customers.router, "customers", ["👥 Clients"])
include_v1(users.router, "users", ["👤 Utilisateurs & RH"])
include_v1(promotions.router, "promotions", ["🎁 Promotions"])

# ─── Inventory & Supply Chain ────────────────────────────────
include_v1(stock.router, "stock", ["📊 Stock"])
include_v1(warehouses.router, "warehouses", ["🏭 Entrepôts"])
include_v1(suppliers.router, "suppliers", ["🤝 Fournisseurs"])
include_v1(purchases.router, "purchases", ["🛍️ Achats"])
include_v1(purchase_vouchers.router, "purchase-vouchers", ["🛍️ Bons d'Achat & d'Entrée"])
include_v1(returns.router, "returns", ["↩️ Retours"])

# ─── Finance & Operations ────────────────────────────────────
include_v1(finance.router, "finance", ["💰 Finance"])
include_v1(expenses.router, "expenses", ["💸 Dépenses"])
include_v1(pos.router, "pos", ["🖥️ Point de Vente (POS)"])
include_v1(upsell.router, "upsell", ["💸 Upsell"])

# ─── Analytics & Audit ───────────────────────────────────────
include_v1(analytics.router, "analytics", ["📈 Analytics"])
include_v1(audit.router, "audit", ["📋 Audit"])

# ─── Delivery, Reviews & Communication ──────────────────────
include_v1(delivery.router, "delivery", ["🚚 Livraison"])
include_v1(reviews.router, "reviews", ["⭐ Avis"])
include_v1(chat.router, "chat", ["💬 Chat IA"])
include_v1(marketing.router, "marketing", ["📣 Marketing"])
include_v1(meta_ads.router, "meta-ads", ["📣 Meta Ads & ROAS"])
include_v1(conversion_optimization.router, "conversion-optimization", ["🎯 Conversion Optimization Center"])
include_v1(tiktok_ads.router, "tiktok-ads", ["🎵 TikTok Ads & ROAS"])
include_v1(ads_comparison.router, "ads-comparison", ["📊 Comparatif Meta ↔ TikTok"])
include_v1(payroll.router, "payroll", ["💵 Paie Mensuelle"])
include_v1(assignment_rules.router, "assignment-rules", ["🎯 Moteur d'Assignation"])
include_v1(partners.router, "partners", ["🔗 Partenaires API"])
include_v1(delivery_partners.router, "delivery-partners", ["🚚 Carriers Livraison"])
include_v1(upload.router,         "upload",         ["📸 Upload Fichiers"])
include_v1(landing_pages.router,  "landing-pages",  ["🚀 Landing Pages"])
include_v1(api_keys.router,       "api-keys",       ["🔑 Clés API"])
include_v1(locations.router,      "locations",      ["🌍 Locations"])
include_v1(notifications.router,  "notifications",  ["🔔 Notifications"])
include_v1(internal.router,       "internal",       ["🛠️ Internal / Observability"])

# ─── Carrier Proxies (outside /api/v1 — own prefix) ─────────────────────────
app.include_router(yalidine_carrier.router, prefix="/api/yalidine", tags=["🚀 Yalidine"])
app.include_router(noest_carrier.router,    prefix="/api/noest",    tags=["🟦 Noest"])


# ─── Slash-Tolerant Route Aliases ────────────────────────────
# With redirect_slashes=False, routes defined as "/" only match with trailing slash.
# This block adds alias routes without trailing slash so both forms work.
from fastapi.routing import APIRoute as _APIRoute

def _add_slash_aliases():
    existing = {(r.path, m) for r in app.routes if isinstance(r, _APIRoute) for m in (r.methods or [])}
    for route in list(app.routes):
        if not isinstance(route, _APIRoute):
            continue
        if not (route.path.endswith("/") and len(route.path) > 1):
            continue
        no_slash = route.path.rstrip("/")
        for method in (route.methods or ["GET"]):
            if (no_slash, method) not in existing:
                app.add_api_route(
                    no_slash,
                    route.endpoint,
                    methods=[method],
                    include_in_schema=False,
                    response_model=route.response_model,
                    status_code=route.status_code,
                    dependencies=route.dependencies,
                )
                existing.add((no_slash, method))

try:
    _add_slash_aliases()
except Exception as e:
    import traceback
    print(f"CRITICAL STARTUP ERROR in _add_slash_aliases: {e}")
    traceback.print_exc()

# ─── Health & System Endpoints ───────────────────────────────
@app.get("/", tags=["système"])
async def root():
    return {
        "status": "online",
        "message": f"{settings.PROJECT_NAME} is running",
        "version": settings.VERSION,
        "docs": "/docs"
    }


@app.get("/health", tags=["système"])
async def health_check():
    """Health check endpoint for load balancers and Docker healthcheck."""
    return {"status": "healthy", "version": settings.VERSION}


@app.get(f"{settings.API_V1_STR}/domains/verify", tags=["système"])
def verify_domain(domain: str = Query(...)):
    """
    Endpoint for Caddy's on_demand_tls 'ask' mechanism.
    Returns 200 OK if domain is permitted, 403 otherwise.
    """
    db = SessionLocal()
    try:
        # Allow main platform domains (azzougshop.com and azghub.com)
        if (
            domain.endswith(".azzougshop.com") or domain == "azzougshop.com" or
            domain.endswith(".azghub.com") or domain == "azghub.com"
        ):
            return Response(status_code=200)

        # Check customer mapped domains
        store = db.query(Store).filter(
            Store.domain == domain,
            Store.is_active == True,
            Store.is_deleted == False
        ).first()
        if store:
            return Response(status_code=200)

        return Response(status_code=403, content="Domain not authorized")
    finally:
        db.close()
