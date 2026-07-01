from typing import Any, List, Union
from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "AzzougShop Industrial API"
    API_V1_STR: str = "/api/v1"
    VERSION: str = "1.0.0"

    # DATABASE
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: int = 5444
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "password"
    POSTGRES_DB: str = "azzougshop"
    DATABASE_URL: str | None = None

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def assemble_db_url(cls, v: str | None, info: Any) -> Any:
        import os
        v = v or os.environ.get("POSTGRES_URL_NON_POOLING") or os.environ.get("POSTGRES_URL")
        if isinstance(v, str) and v:
            if v.startswith("postgres://"):
                v = v.replace("postgres://", "postgresql://", 1)
            if v.startswith("file:"):
                path = v.replace("file:", "")
                return f"sqlite:///{path}"
            return v

        user = info.data.get("POSTGRES_USER")
        password = info.data.get("POSTGRES_PASSWORD")
        server = info.data.get("POSTGRES_SERVER")
        port = info.data.get("POSTGRES_PORT")
        db = info.data.get("POSTGRES_DB")

        if not server or server == "localhost":
             if port:
                 return f"postgresql://{user}:{password}@{server}:{port}/{db}"
             return "sqlite:///../prisma/dev.db"

        return f"postgresql://{user}:{password}@{server}:{port}/{db}"

    # AUTH — SECRET_KEY must be set via env, no insecure default
    SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60  # 60 minutes (1 hour)
    ALGORITHM: str = "HS256"
    INTERNAL_API_KEY: str = "development_key"
    ENCRYPTION_KEY: str | None = None

    # ENVIRONMENT
    ENVIRONMENT: str = "development"  # development | production

    # CORS — restrict to known origins in production via env var
    # Format: comma-separated URLs, e.g. "https://app.com,https://admin.app.com"
    BACKEND_CORS_ORIGINS: List[Union[AnyHttpUrl, str]] = ["http://localhost:3000", "http://localhost:3016"]

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: Any) -> Any:
        if isinstance(v, str):
            # Support comma-separated string from env var
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    # REDIS / CELERY
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379

    @property
    def CELERY_BROKER_URL(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/0"

    @property
    def CELERY_RESULT_BACKEND(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/0"

    model_config = SettingsConfigDict(
        case_sensitive=True,
        env_file=".env",
        extra="ignore"
    )

def _validate_production_settings(s: "Settings") -> None:
    if s.ENVIRONMENT == "production":
        insecure_defaults = {"CHANGE_ME_IN_PRODUCTION", "YOUR_SUPER_SECRET_KEY_CHANGE_ME"}
        if s.SECRET_KEY in insecure_defaults:
            raise ValueError("SECRET_KEY must be set to a secure random value in production. "
                             "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\"")
        if s.INTERNAL_API_KEY == "development_key":
            raise ValueError("INTERNAL_API_KEY must be changed from its default value in production.")
        if not s.ENCRYPTION_KEY:
            raise ValueError("ENCRYPTION_KEY must be set to a secure key in production.")
        if "*" in s.BACKEND_CORS_ORIGINS:
            raise ValueError("BACKEND_CORS_ORIGINS must not contain '*' in production.")

settings = Settings()
_validate_production_settings(settings)
