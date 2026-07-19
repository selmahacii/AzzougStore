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
    notifications, conversion_optimization, internal,
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

    # Bracketing prints around the very first DB connection attempt — if the
    # container hangs at startup, these pin down whether it's stuck waking
    # Neon's compute (nothing printed after "Connecting") vs stuck later in
    # one of the backfill queries below.
    print("🔌 Connecting to database for startup migrations...")

    # One information_schema round-trip instead of blindly firing ALTER TABLE
    # statements (DDL) at every container boot — each failed ALTER still costs
    # a network round-trip and wakes the database compute.
    try:
        with engine.begin() as conn:
            existing = {
                (r[0], r[1]) for r in conn.execute(text(
                    "SELECT table_name, column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND (table_name, column_name) IN "
                    "(('landing_pages','offers'), ('landing_pages','banner_image_url'), ('products','delivery_fees'))"
                ))
            }
            if ("landing_pages", "offers") not in existing:
                conn.execute(text("ALTER TABLE landing_pages ADD COLUMN offers JSONB"))
                print("✅ landing_pages: added offers column")
            if ("landing_pages", "banner_image_url") not in existing:
                conn.execute(text("ALTER TABLE landing_pages ADD COLUMN banner_image_url VARCHAR"))
                print("✅ landing_pages: added banner_image_url column")
            if ("products", "delivery_fees") not in existing:
                conn.execute(text("ALTER TABLE products ADD COLUMN delivery_fees JSONB"))
                print("✅ products: added delivery_fees column")
    except Exception as e:
        print(f"⚠️ Startup column check failed: {e}")

    # store_sequence_number backfill: handled by the single SQL UPDATE in
    # create_initial_superadmin (one statement, set-based) — the old per-order
    # Python loop (1 MAX + 1 COMMIT per row) was removed.
    print("✅ Startup migrations finished — database connection is live.")

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
        # 0. Backfill missing store_sequence_number
        db.execute(text("""
            WITH numbered_orders AS (
                SELECT id, ROW_NUMBER() OVER(PARTITION BY store_id ORDER BY created_at ASC) as seq
                FROM orders
                WHERE store_sequence_number IS NULL
            )
            UPDATE orders
            SET store_sequence_number = numbered_orders.seq + COALESCE((SELECT MAX(store_sequence_number) FROM orders o2 WHERE o2.store_id = orders.store_id), 0)
            FROM numbered_orders
            WHERE orders.id = numbered_orders.id
        """))
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
include_v1(payroll.router, "payroll", ["💵 Paie Mensuelle"])
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
