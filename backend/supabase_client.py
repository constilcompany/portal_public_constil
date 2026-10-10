import logging
from supabase import create_client, Client
from config import settings

logger = logging.getLogger(__name__)

supabase: Client | None = None

if settings.supabase_url and settings.supabase_key:
    try:
        supabase = create_client(settings.supabase_url, settings.supabase_key)
        logger.info("Supabase client initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize Supabase client: {e}")
else:
    logger.warning("SUPABASE_URL or SUPABASE_KEY not provided. Supabase integration will be disabled.")
