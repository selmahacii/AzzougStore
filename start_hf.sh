#!/bin/bash

echo "🚀 Starting Redis Server..."
redis-server --daemonize yes --port 6379 --protected-mode no

echo "🚀 Starting Celery Worker..."
celery -A app.celery_app worker -l info -Q main-queue,heavy-queue --detach

echo "🚀 Starting Celery Beat..."
celery -A app.celery_app beat -l info --detach

echo "🚀 Running Database Migrations..."
alembic upgrade head

echo "🚀 Starting FastAPI App on port 7860..."
# Hugging Face Spaces expects the web service to run on port 7860
exec uvicorn app.main:app --host 0.0.0.0 --port 7860
