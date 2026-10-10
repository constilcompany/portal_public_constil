import hmac
import logging
from fastapi import Request, HTTPException
from config import settings

logger = logging.getLogger(__name__)


def verify_internal_auth(request: Request):
    """
    Constant-time server-to-server authentication dependency.
    Fails closed (HTTP 503) if FASTAPI_SHARED_SECRET is not configured on the server.
    Accepts credentials via:
      - Authorization: Bearer <FASTAPI_SHARED_SECRET>
      - X-Internal-Secret: <FASTAPI_SHARED_SECRET>
    Never logs secret values.
    """
    secret = settings.fastapi_shared_secret
    if not secret or not secret.strip():
        logger.error("[Auth] FASTAPI_SHARED_SECRET is not configured. Request rejected (fail-closed).")
        raise HTTPException(
            status_code=503,
            detail="Server authentication configuration missing (fail-closed)."
        )

    auth_header = request.headers.get("Authorization", "").strip()
    internal_header = request.headers.get("X-Internal-Secret", "").strip()

    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif auth_header:
        token = auth_header
    elif internal_header:
        token = internal_header

    if not token:
        logger.warning("[Auth] Missing authentication token header.")
        raise HTTPException(status_code=401, detail="Missing authentication credentials.")

    # Constant-time comparison to prevent timing attacks
    if not hmac.compare_digest(token.encode("utf-8"), secret.strip().encode("utf-8")):
        logger.warning("[Auth] Invalid authentication token provided.")
        raise HTTPException(status_code=401, detail="Invalid authentication credentials.")

    return True
