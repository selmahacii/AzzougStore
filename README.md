---
title: Azzoug Backend
emoji: 🛒
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 8000
pinned: false
---

# AzzougShop Industrial Backend

This is the production-ready FastAPI backend for the AzzougShop ecosystem.

## 🚀 Features
- **FastAPI**: High-performance API framework.
- **Pydantic V2**: Robust data validation and settings management.
- **SQLAlchemy 2.0**: Modern ORM with async support potential.
- **Alembic**: Database migrations.
- **JWT Authentication**: Secure identity management with RBAC.
- **Prometheus**: High-fidelity monitoring and telemetry.
- **Structured Logging**: Production-grade observability.

## 🛠️ Setup
1. **Environment**: Create a `.env` file based on the examples in `app/core/config.py`.
2. **Dependencies**: `pip install -r requirements.txt`
3. **Database**: `alembic upgrade head`
4. **Run**: `uvicorn app.main:app --reload --port 8000`

## 📂 Project Structure
- `app/api`: API routes and logic.
- `app/core`: Core configurations, security, and logging.
- `app/db`: Database session and base classes.
- `app/models`: SQLAlchemy data models.
- `app/schemas`: Pydantic data models (Request/Response).
- `app/services`: Business logic layer.
- `alembic/`: Database migration history.
