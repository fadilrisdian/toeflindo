"""Focus Drills router — Sentence Combining, Collocation Notebook, Phrase Bank."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api.dependencies import get_current_user
from app.core.logging import get_logger
from app.db.session import db_context
from app.repositories.collocation_repository import CollocationRepository
from app.services.focus_drill_service import (
    evaluate_collocation,
    evaluate_sentence_combining,
    generate_collocation_exercise,
    generate_sentence_combining,
    get_phrase_bank,
)

router = APIRouter(prefix="/api/focus-drills", tags=["focus-drills"])
logger = get_logger(__name__)


# ── Sentence Combining ────────────────────────────────────────────────────────

@router.get("/sentence-combining/generate")
async def sc_generate(_user: str = Depends(get_current_user)):
    """Generate a new sentence-combining exercise."""
    try:
        result = generate_sentence_combining()
    except Exception as exc:
        logger.error("sentence_combining generate failed err=%s", exc)
        raise HTTPException(status_code=502, detail="Exercise generation failed")
    return JSONResponse(result)


class SCEvaluateRequest(BaseModel):
    sentences: list[str]
    user_answer: str
    connector_used: str


@router.post("/sentence-combining/evaluate")
async def sc_evaluate(body: SCEvaluateRequest, _user: str = Depends(get_current_user)):
    """Evaluate a student's combined sentence."""
    try:
        result = evaluate_sentence_combining(
            sentences=body.sentences,
            user_answer=body.user_answer,
            connector_used=body.connector_used,
        )
    except Exception as exc:
        logger.error("sentence_combining evaluate failed err=%s", exc)
        raise HTTPException(status_code=502, detail="Evaluation failed")
    return JSONResponse(result)


# ── Collocation Notebook ──────────────────────────────────────────────────────

@router.get("/collocation/items")
async def collocation_items(_user: str = Depends(get_current_user)):
    """List all collocation items with due count."""
    with db_context() as conn:
        repo = CollocationRepository(conn)
        return JSONResponse({
            "items": repo.all_items(),
            "due_count": repo.due_count(),
        })


class CollocationAddRequest(BaseModel):
    phrase: str
    source: str = ""


@router.post("/collocation/add")
async def collocation_add(body: CollocationAddRequest, _user: str = Depends(get_current_user)):
    """Add a new collocation phrase to the notebook."""
    if not body.phrase.strip():
        raise HTTPException(status_code=400, detail="Phrase cannot be empty")
    with db_context() as conn:
        item_id = CollocationRepository(conn).add(phrase=body.phrase, source=body.source)
        conn.commit()
    return JSONResponse({"id": item_id, "ok": True})


@router.get("/collocation/due")
async def collocation_due(_user: str = Depends(get_current_user)):
    """Return next due item with LLM-generated exercise contexts."""
    with db_context() as conn:
        due = CollocationRepository(conn).list_due(limit=1)
    if not due:
        return JSONResponse({"found": False})
    item = due[0]
    try:
        exercise = generate_collocation_exercise(phrase=item["phrase"])
    except Exception as exc:
        logger.error("collocation exercise generate failed err=%s", exc)
        raise HTTPException(status_code=502, detail="Exercise generation failed")
    return JSONResponse({"found": True, "item": item, "exercise": exercise})


class CollocationReviewRequest(BaseModel):
    item_id: int
    context_index: int   # 0 or 1
    user_sentence: str
    task_type: str


@router.post("/collocation/review")
async def collocation_review(body: CollocationReviewRequest, _user: str = Depends(get_current_user)):
    """Evaluate a collocation sentence and advance/reset the SRS box."""
    with db_context() as conn:
        repo = CollocationRepository(conn)
        item = repo.get(body.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Item not found")
        try:
            result = evaluate_collocation(
                phrase=item["phrase"],
                user_sentence=body.user_sentence,
                task_type=body.task_type,
            )
        except Exception as exc:
            logger.error("collocation evaluate failed err=%s", exc)
            raise HTTPException(status_code=502, detail="Evaluation failed")
        if result.get("correct"):
            repo.advance(body.item_id)
        else:
            repo.reset(body.item_id)
        conn.commit()
    return JSONResponse({**result, "item_id": body.item_id})


# ── Phrase Bank ───────────────────────────────────────────────────────────────

@router.get("/phrase-bank")
async def phrase_bank(_user: str = Depends(get_current_user)):
    """Return the full phrase bank by category."""
    return JSONResponse(get_phrase_bank())
