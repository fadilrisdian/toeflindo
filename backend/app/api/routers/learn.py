"""Learn router — Murphy Grammar content from grammar_content.db."""
import sqlite3
from contextlib import contextmanager
from typing import Generator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse

from app.api.dependencies import get_current_user
from app.core.config import GRAMMAR_CONTENT_DB_PATH, LESSON_PROMPT_PATH
from app.core.logging import get_logger

router = APIRouter(prefix="/api/learn", tags=["learn"])
logger = get_logger(__name__)


# ── DB helper (separate db file) ──────────────────────────────────────────────

def _get_grammar_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(GRAMMAR_CONTENT_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def _grammar_db() -> Generator[sqlite3.Connection, None, None]:
    conn = _get_grammar_conn()
    try:
        yield conn
    finally:
        conn.close()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/topics")
async def list_topics(_user: str = Depends(get_current_user)):
    """Return all Murphy grammar topics (id, section, title, page, page_range)."""
    with _grammar_db() as conn:
        rows = conn.execute(
            "SELECT id, section, title, page, page_range, "
            "(lesson_html IS NOT NULL AND lesson_html != '') as has_lesson "
            "FROM grammar_topics ORDER BY id"
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/topics/{topic_id}")
async def get_topic(topic_id: int, _user: str = Depends(get_current_user)):
    """Return a single topic with full content."""
    with _grammar_db() as conn:
        row = conn.execute(
            "SELECT id, section, title, page, page_range, content, "
            "(lesson_html IS NOT NULL AND lesson_html != '') as has_lesson "
            "FROM grammar_topics WHERE id = ?",
            (topic_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Topic not found")
    return dict(row)


@router.get("/topics/{topic_id}/lesson")
async def get_topic_lesson(topic_id: int, _user: str = Depends(get_current_user)):
    """Return the interactive lesson HTML for a topic."""
    with _grammar_db() as conn:
        row = conn.execute(
            "SELECT lesson_html FROM grammar_topics WHERE id = ?",
            (topic_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Topic not found")
    if not row["lesson_html"]:
        raise HTTPException(status_code=404, detail="No lesson generated for this topic yet")
    return HTMLResponse(content=row["lesson_html"])


@router.get("/lesson-prompt", response_class=PlainTextResponse)
async def get_lesson_prompt(_user: str = Depends(get_current_user)):
    """Return the grammar lesson prompt template as plain text."""
    try:
        with open(LESSON_PROMPT_PATH, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Lesson prompt file not found")


@router.put("/topics/{topic_id}/lesson")
async def upsert_topic_lesson(
    topic_id: int,
    payload: dict,
    _user: str = Depends(get_current_user),
):
    """Insert or replace the lesson_html for a topic."""
    html = payload.get("html", "").strip()
    if not html:
        raise HTTPException(status_code=400, detail="html field is required")
    with _grammar_db() as conn:
        row = conn.execute(
            "SELECT id FROM grammar_topics WHERE id = ?", (topic_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Topic not found")
        conn.execute(
            "UPDATE grammar_topics SET lesson_html = ? WHERE id = ?",
            (html, topic_id),
        )
        conn.commit()
    logger.info("lesson_html updated for topic %s", topic_id)
    return {"ok": True, "topic_id": topic_id}

