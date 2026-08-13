"""Application-wide logging configuration.

Log level policy (use these consistently across the entire codebase):

  DEBUG    -- detailed diagnostics only useful during development:
              SQL params, full LLM prompts, raw audio sizes.
              Never enabled in production.

  INFO     -- normal operational events that confirm the system is working:
              "request handled", "LLM call ok", "score saved", "token issued".

  WARNING  -- unexpected but fully handled situations — the user still got a response:
              LLM fallback model used, SRS item not found, auth rejected,
              scoring failed and default fallback was returned.

  ERROR    -- a failure that degraded the user's experience:
              DB write failed after successful LLM call, all LLM fallbacks exhausted,
              speech analyzer unreachable.

  CRITICAL -- system cannot start or continue:
              DB file missing at boot, config invalid, port already in use.

Usage pattern in every module:
    from app.core.logging import get_logger
    logger = get_logger(__name__)   # produces "app.services.writing", etc.

Never log: passwords, JWT tokens, essay text, audio bytes, PII.
Do log:    task_id, task_type, score, latency_ms, model name, error type + message.
"""

import logging
import sys
import uuid
from contextvars import ContextVar
from typing import Optional

# ── Request-ID context ────────────────────────────────────────────────────────
# Set by AccessLogMiddleware at the top of every request.
# Read by RequestIdFormatter so every log line carries the same ID.
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


def set_request_id(rid: Optional[str] = None) -> str:
    """Generate (or accept) a request-ID, store it in the context, and return it."""
    rid = rid or uuid.uuid4().hex[:12]
    request_id_var.set(rid)
    return rid


# ── Custom formatter ──────────────────────────────────────────────────────────

class RequestIdFormatter(logging.Formatter):
    """Injects the current request-ID into every log record."""

    def format(self, record: logging.LogRecord) -> str:
        record.request_id = request_id_var.get("-")
        return super().format(record)


# ── Noisy third-party loggers to silence ──────────────────────────────────────
# These all default to INFO and produce irrelevant or duplicate output.
_SUPPRESS_AT_WARNING = [
    "httpx",
    "httpcore",
    "litellm",
    "litellm.utils",
    "litellm.proxy",
    "openai",
    "openai._base_client",
    "hpack",
    "uvicorn.access",   # we emit our own structured access log
]


# ── Public API ────────────────────────────────────────────────────────────────

def configure_logging(level: int = logging.INFO) -> None:
    """Call once at startup (app/main.py) before any other imports emit logs."""
    formatter = RequestIdFormatter(
        fmt="%(asctime)s [%(levelname)-8s] %(request_id)s %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(level)
    # Avoid duplicate handlers if called more than once (e.g. in tests)
    root.handlers.clear()
    root.addHandler(handler)

    # Silence noisy third-party libs
    for name in _SUPPRESS_AT_WARNING:
        logging.getLogger(name).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Return a named logger.  Use __name__ so hierarchy is preserved."""
    return logging.getLogger(name)
