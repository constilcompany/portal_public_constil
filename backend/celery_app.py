from celery import Celery
from config import settings

celery_app = Celery(
    "estimation_tasks",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["tasks"]
)

# Optional configuration
celery_app.conf.update(
    task_track_started=True,
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    result_expires=86400,  # Results expire in 24 hours
    worker_concurrency=1,  # Only one task at a time
    worker_prefetch_multiplier=1,  # Don't prefetch more than one task
)
