"""Request lifecycle middleware.

- Assigns a unique request-ID to every incoming request (reads X-Request-ID
  header if present, otherwise generates one).
- Stores it in the contextvars so every log line emitted during this request
  automatically carries the same ID.
- Emits a single structured access-log line at request completion.
"""
import time
import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.logging import get_logger, set_request_id

logger = get_logger("api.access")


class AccessLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Honour upstream request-ID (e.g. from a load balancer) or generate one.
        # Sanitize to prevent log-injection via newline embedding.
        raw_rid = request.headers.get("X-Request-ID") or ""
        safe_rid = raw_rid.replace("\r", "").replace("\n", "")[:40] if raw_rid else None
        rid = set_request_id(safe_rid)
        start = time.perf_counter()

        response = await call_next(request)

        ms = (time.perf_counter() - start) * 1000
        level = logging.WARNING if response.status_code >= 500 else logging.INFO
        logger.log(
            level,
            "%s %s %d %.1fms",
            request.method,
            request.url.path,
            response.status_code,
            ms,
        )
        # Propagate request-ID downstream so the frontend/caller can correlate
        response.headers["X-Request-ID"] = rid
        return response
