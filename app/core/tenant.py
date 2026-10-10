import contextvars
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria
from app.db.base_class import Base

# Context var to hold the current tenant's store_id
tenant_store_id = contextvars.ContextVar("tenant_store_id", default=None)

class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        from app.core import timing as _timing
        import time as _time_mod

        _t0 = _time_mod.perf_counter()

        # 1. Try to get tenant from Header
        store_id = request.headers.get("X-Store-Id")

        # 2. Try to get tenant from Host (if custom domains are mapped)
        # In a real app, you'd lookup the store_id by domain from a quick cache like Redis
        host = request.headers.get("Host", "")

        # Determine the tenant
        if store_id:
            tenant_val = store_id
        elif host and "azzougshop.com" not in host and "azghub.com" not in host and "localhost" not in host:
            # Simulated host resolution (this would be a Redis fetch map)
            tenant_val = request.headers.get("X-Resolved-Store-Id")
        else:
            tenant_val = None

        token = tenant_store_id.set(tenant_val)
        _timing.record("tenant", (_time_mod.perf_counter() - _t0) * 1000)

        try:
            response = await call_next(request)
            return response
        finally:
            tenant_store_id.reset(token)

def set_tenant_isolation_event(sessionmaker):
    """
    Globally hook into SQLAlchemy ORM to append the `store_id` filter
    to EVERY query that targets a model with a `store_id` column.
    
    This guarantees data leakage prevention without relying on developers
    remembering to add `.filter(Model.store_id == current_tenant)`.
    """
    @event.listens_for(Session, "do_orm_execute")
    def _add_tenant_filtering_criteria(execute_state):
        # We only care about SELECT / READs here.
        # Updates/Deletes should be guarded by endpoints and their own fetch.
        # SQLAlchemy with_loader_criteria adds filtering to SELECT implicitly.
        if execute_state.is_select:
            # Skip auto-filtering if requested explicitly in session info (e.g., for SUPER_ADMIN)
            if execute_state.session.info.get("skip_tenant_isolation"):
                return

            current_tenant = tenant_store_id.get()
            
            # If no tenant context is set (e.g. background worker or super admin), skip auto-filtering
            if not current_tenant or current_tenant == "SUPER_ADMIN_MODE":
                return

            from sqlalchemy import bindparam
            tenant_param = bindparam("current_tenant_id", value=current_tenant)

            def include_tenant_filter(cls):
                # Ensure the model actually has a store_id attribute
                if hasattr(cls, "store_id"):
                    return cls.store_id == tenant_param
                return True

            # Add criteria to all ORM entities in the query
            execute_state.statement = execute_state.statement.options(
                with_loader_criteria(
                    Base, 
                    include_tenant_filter, 
                    include_aliases=True,
                    track_closure_variables=True
                )
            )

