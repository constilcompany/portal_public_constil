import os
from pydantic_settings import BaseSettings, SettingsConfigDict

_env_file = os.getenv("ENV_FILE") or (".env.staging" if os.getenv("APP_ENV") == "staging" else ".env")


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-3-5-sonnet-20241022"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_s3_region_name: str = "us-east-1"
    aws_storage_bucket_name: str = "paybue-invoice-estimation"
    fastapi_shared_secret: str = ""
    supabase_url: str = ""
    supabase_key: str = ""
    database_url: str = ""  # PostgreSQL URL for shared replica outbox/idempotency store
    idempotency_db_path: str = "idempotency.db"  # Fallback local SQLite path
    host: str = "0.0.0.0"
    port: int = 8001
    redis_url: str = "redis://localhost:6379/0"

    model_config = SettingsConfigDict(env_file=_env_file, extra="ignore")


settings = Settings()
