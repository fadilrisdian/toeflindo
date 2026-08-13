"""Centralised settings — all env vars read exactly once here."""
import os


def _require(name: str) -> str:
    """Raise at startup if a required secret env var is missing."""
    val = os.environ.get(name)
    if val is None:
        raise ValueError(
            f"Required environment variable '{name}' is not set. "
            "Set it in your .env file or container environment."
        )
    return val


# ── Auth ──────────────────────────────────────────────────────────────────────
SECRET_KEY: str = _require("SECRET_KEY")
ALGORITHM: str = "HS256"
try:
    ACCESS_TOKEN_EXPIRE_HOURS: int = int(os.environ.get("SESSION_EXPIRE_HOURS", "8"))
except ValueError:
    raise ValueError(
        "SESSION_EXPIRE_HOURS must be a plain integer (e.g. '8'), "
        f"got: {os.environ.get('SESSION_EXPIRE_HOURS')!r}"
    )
AUTH_USER: str = os.environ.get("AUTH_USER", "fadil")
AUTH_PASS: str = _require("AUTH_PASS")
SESSION_COOKIE: str = "toefl_token"

# ── LLM proxy ─────────────────────────────────────────────────────────────────
LITELLM_PROXY_URL: str = os.environ.get("LITELLM_PROXY_URL", "")
LITELLM_MASTER_KEY: str = os.environ.get("LITELLM_MASTER_KEY", "")

# ── Services ─────────────────────────────────────────────────────────────────
FRONTEND_ORIGIN: str = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")

# ── Storage ──────────────────────────────────────────────────────────────────
TOEFL_DB_PATH: str = os.environ.get("TOEFL_DB_PATH", "/data/toefl.db")
GRAMMAR_CONTENT_DB_PATH: str = os.environ.get("GRAMMAR_CONTENT_DB_PATH", "/data/grammar_content.db")
LESSON_PROMPT_PATH: str = os.environ.get("LESSON_PROMPT_PATH", "/data/grammar-lesson-prompt.md")
AUDIO_MOUNT_PREFIX: str = os.environ.get("AUDIO_MOUNT_PREFIX", "/audio/")
GUIDE_DIR: str = "/app/guides"
