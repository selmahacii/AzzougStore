from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "worker",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.worker"]
)

def route_task(name, args, kwargs, options, task=None, **kw):
    """
    Dynamic routing: 
    If a task receives 'store_id' and 'priority' it can route to 'store_{id}_heavy'.
    Otherwise uses default category mappings.
    """
    store_id = kwargs.get("store_id")
    is_heavy = name.startswith("app.worker.heavy_") or kwargs.get("heavy", False)
    
    if store_id:
        if is_heavy:
            return {"queue": f"store_{store_id}_heavy"}
        return {"queue": f"store_{store_id}_default"}
        
    if is_heavy:
        return {"queue": "heavy-queue"}
    return {"queue": "main-queue"}

celery_app.conf.task_routes = (route_task,)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Africa/Algiers",
    enable_utc=True,
)

celery_app.conf.beat_schedule = {
    "auto-reassign-inactive-orders-every-5-min": {
        "task": "app.worker.auto_reassign_inactive_orders",
        "schedule": 300.0,
    },
    # Funnel-counter flush deliberately NOT scheduled here — moved to the
    # leader-locked asyncio loop in app/main.py's _funnel_flush_loop().
    # Celery beat here is detached (`--detach` in start_hf.sh) then the
    # parent shell is replaced by `exec uvicorn`, leaving worker/beat
    # unsupervised: if either dies, nothing restarts it and nothing
    # surfaces the failure. app.worker.flush_funnel_counters (below)
    # stays defined and callable manually/via Celery if ever needed —
    # only the automatic schedule entry was removed, to avoid running the
    # same flush from two independent, potentially-overlapping schedulers.
}
