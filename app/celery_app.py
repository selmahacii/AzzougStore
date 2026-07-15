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
}
