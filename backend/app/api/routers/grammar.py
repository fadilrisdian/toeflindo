"""Grammar router — weak spot, evaluate, mistakes."""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.api.dependencies import get_current_user
from app.core.exceptions import LLMError
from app.core.logging import get_logger
from app.db.session import db_context
from app.models.schemas.grammar import (
    FreeTextAnalyzeRequest,
    GrammarEvaluateRequest,
    WeakspotSubmitRequest,
    WSFixRequest,
)
from app.repositories.grammar_repository import GrammarRepository
from app.repositories.practice_repository import PracticeRepository
from app.services.grammar_service import (
    analyze_free_text,
    evaluate_grammar,
    fix_weakspot_card,
    generate_drill_sentences,
    process_weakspot_submit,
)

router = APIRouter(prefix="/api/grammar", tags=["grammar"])
logger = get_logger(__name__)


@router.post("/transcribe")
async def srs_transcribe(
    request: Request,
    _user: str = Depends(get_current_user),
):
    import asyncio
    from app.core.exceptions import SpeechAnalyzerError
    from app.services.speech.stt import transcribe_simple_bytes

    form = await request.form()
    audio_file = form.get("audio")
    if not audio_file:
        return JSONResponse({"error": "No audio"}, status_code=400)
    audio_bytes = await audio_file.read()
    filename = getattr(audio_file, "filename", None) or "audio.webm"

    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: transcribe_simple_bytes(audio_bytes, filename),
        )
        return JSONResponse(result)
    except SpeechAnalyzerError as exc:
        logger.error("srs transcribe: failed error=%s", exc)
        return JSONResponse({"error": str(exc)[:200]}, status_code=500)
    except Exception as exc:
        logger.error("srs transcribe: unexpected error=%s", exc)
        return JSONResponse({"error": str(exc)[:200]}, status_code=500)


@router.post("/transcribe-evaluate")
async def srs_transcribe_evaluate(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Transcribe audio + evaluate in one round-trip (grammar mistake drill speak mode)."""
    import asyncio
    from app.core.exceptions import SpeechAnalyzerError
    from app.services.speech.stt import transcribe_simple_bytes

    form        = await request.form()
    audio_file  = form.get("audio")
    wrong       = str(form.get("wrong") or "").strip()
    correct     = str(form.get("correct") or "").strip()
    category    = str(form.get("category") or "").strip()

    if not audio_file or isinstance(audio_file, str):
        return JSONResponse({"error": "No audio"}, status_code=400)
    if not correct:
        return JSONResponse({"error": "correct is required"}, status_code=400)

    audio_bytes = await audio_file.read()
    filename    = getattr(audio_file, "filename", None) or "audio.webm"

    try:
        loop = asyncio.get_running_loop()
        # Step 1: transcribe (no ffmpeg — raw bytes to Groq)
        stt = await loop.run_in_executor(
            None,
            lambda: transcribe_simple_bytes(audio_bytes, filename),
        )
        transcript = stt.get("text", "").strip()
        if not transcript:
            return JSONResponse({"error": "Could not hear anything — try again."}, status_code=422)

        # Step 2: evaluate
        eval_result = await loop.run_in_executor(
            None,
            lambda: evaluate_grammar(
                user_answer=transcript,
                correct=correct,
                wrong=wrong,
                category=category,
            ),
        )
        return JSONResponse({
            "transcript": transcript,
            "verdict":    eval_result.get("verdict", "wrong"),
            "feedback":   eval_result.get("feedback", ""),
        })
    except SpeechAnalyzerError as exc:
        logger.error("transcribe-evaluate: speech error=%s", exc)
        return JSONResponse({"error": str(exc)[:200]}, status_code=500)
    except Exception as exc:
        logger.exception("transcribe-evaluate: unexpected error")
        return JSONResponse({"error": str(exc)[:200]}, status_code=500)


@router.post("/mistakes/delete")
async def srs_delete(
    request: Request,
    _user: str = Depends(get_current_user),
):
    body = await request.json()
    mistake_id = body.get("id")
    if mistake_id is None:
        return JSONResponse({"ok": False, "error": "missing id"}, status_code=400)
    with db_context() as conn:
        cur = conn.execute("DELETE FROM grammar_mistakes WHERE id=?", (mistake_id,))
        if cur.rowcount == 0:
            return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
    logger.info("srs delete mistake_id=%s", mistake_id)
    return JSONResponse({"ok": True})




@router.get("/recommendations")
async def grammar_recommendations(_user: str = Depends(get_current_user)):
    with db_context() as conn:
        data = GrammarRepository(conn).get_recommendations()
    return JSONResponse(data)


@router.get("/remediation-trends")
async def grammar_remediation_trends(_user: str = Depends(get_current_user)):
    """Return per-error-type remediation progress for the progress panel."""
    with db_context() as conn:
        data = GrammarRepository(conn).get_remediation_trends()
    return JSONResponse(data)


@router.get("/srs/due-count")
async def srs_due_count(_user: str = Depends(get_current_user)):
    """Count of grammar mistakes due for spaced review today."""
    with db_context() as conn:
        count = GrammarRepository(conn).get_srs_due_count()
    return JSONResponse({"count": count})


@router.get("/srs/writing-focus")
async def srs_writing_focus(_user: str = Depends(get_current_user)):
    """Return grammar patterns due for review today with writing elicitation hints.
    Used by the writing hub to show today's grammar focus callout.
    Returns up to 3 items: [{grammar_type, context, tip, prompt_note}]
    """
    with db_context() as conn:
        hints = GrammarRepository(conn).get_writing_focus()
    return JSONResponse({"hints": hints})


@router.get("/srs/queue")
async def srs_queue(
    limit: int = 20,
    _user: str = Depends(get_current_user),
):
    """Return the list of mistakes due for spaced review today."""
    with db_context() as conn:
        items = GrammarRepository(conn).get_srs_due(limit=min(limit, 50))
    return JSONResponse({"items": items, "count": len(items)})


@router.post("/srs/rate/{mistake_id}")
async def srs_rate(
    mistake_id: int,
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Rate a single SRS review card as passed or failed.
    Body: {"passed": true|false}
    """
    body = await request.json()
    passed = bool(body.get("passed", False))
    with db_context() as conn:
        repo = GrammarRepository(conn)
        result = repo.rate_srs_item(mistake_id, passed)
        conn.commit()
    if not result:
        raise HTTPException(status_code=404, detail="Mistake not found")
    logger.info("srs rate mistake_id=%s passed=%s new_stage=%s", mistake_id, passed, result.get("review_stage"))
    return JSONResponse({"ok": True, **result})


# ── Weak spot ─────────────────────────────────────────────────────────────────

@router.post("/ws/fix")
async def ws_fix(
    body: WSFixRequest,
    _user: str = Depends(get_current_user),
):
    try:
        new_wrong, new_correct = fix_weakspot_card(
            wrong=body.wrong, correct=body.correct,
            category=body.category, description=body.description,
        )
        return JSONResponse({"ok": True, "wrong": new_wrong, "correct": new_correct})
    except Exception as exc:
        logger.error("ws fix failed category=%s error=%s", body.category, exc)
        return JSONResponse({"ok": False, "error": "LLM error: " + str(exc)[:120]})


@router.get("/weakspot/generate")
async def weakspot_generate(
    category: str,
    count: int = 5,
    custom_prompt: str = "",
    difficulty: str = "medium",
    _user: str = Depends(get_current_user),
):
    # category can be comma-separated for multi-topic
    categories = [c.strip() for c in category.split(",") if c.strip()]
    if not categories:
        return JSONResponse({"error": "No category provided"}, status_code=400)
    if count < 1:
        count = 1
    elif count > 20:
        count = 20

    with db_context() as conn:
        repo = GrammarRepository(conn)
        all_examples: list[dict] = []
        recent_sentences: list[str] = []
        for cat in categories:
            all_examples.extend(repo.get_category_examples(cat, limit=2))
            recent_sentences.extend(repo.get_recent_drill_sentences(cat, limit=5))
    try:
        sentences = generate_drill_sentences(
            categories, all_examples, count=count, custom_prompt=custom_prompt,
            avoid_sentences=recent_sentences, difficulty=difficulty,
        )
        return JSONResponse({"sentences": sentences})
    except LLMError as exc:
        logger.error("weakspot generate failed category=%s error=%s", category, exc)
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/weakspot/submit")
async def weakspot_submit(
    body: WeakspotSubmitRequest,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        result = process_weakspot_submit(
            category=body.category,
            results=[r.model_dump() for r in body.results],
            grammar_repo=GrammarRepository(conn),
            practice_repo=PracticeRepository(conn),
        )
        conn.commit()
    return JSONResponse(result)


# ── Evaluate ──────────────────────────────────────────────────────────────────

@router.post("/evaluate")
async def grammar_evaluate(
    body: GrammarEvaluateRequest,
    _user: str = Depends(get_current_user),
):
    if not body.user_answer or not body.correct:
        return JSONResponse({"verdict": "wrong", "feedback": "No answer provided."})
    # evaluate_grammar handles its own fallback and logs internally
    result = evaluate_grammar(
        user_answer=body.user_answer,
        correct=body.correct,
        wrong=body.wrong,
        category=body.category,
    )
    return JSONResponse(result)


@router.post("/analyze-text")
async def grammar_analyze_text(
    body: FreeTextAnalyzeRequest,
    _user: str = Depends(get_current_user),
):
    """Analyze a free-form text for grammar mistakes.

    Optionally saves found mistakes to the grammar_mistakes table.
    Returns: {mistakes: [{wrong, correct, grammar_type, sub_type, explanation, treatability}]}
    """
    import asyncio

    if not body.text.strip():
        return JSONResponse({"mistakes": []})

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None,
        lambda: analyze_free_text(text=body.text.strip()),
    )

    if body.save_mistakes:
        mistakes = result.get("mistakes", [])
        if mistakes:
            with db_context() as conn:
                repo = GrammarRepository(conn)
                for m in mistakes:
                    wrong = (m.get("wrong") or "").strip()
                    correct = (m.get("correct") or "").strip()
                    grammar_type = (m.get("grammar_type") or "Grammar").strip()
                    sub_type = (m.get("sub_type") or "").strip()
                    explanation = (m.get("explanation") or "").strip()
                    if wrong and correct:
                        repo.upsert_mistake_weakspot(
                            wrong=wrong,
                            correct=correct,
                            category=grammar_type,
                            hint=explanation,
                            sub_type=sub_type,
                        )
                conn.commit()

    return JSONResponse(result)


# ── Read ──────────────────────────────────────────────────────────────────────

@router.get("/mistakes")
async def grammar_mistakes(
    page: int = 1,
    page_size: int = 10,
    category: str = "",
    section: str = "",
    task_type: str = "",
    sort: str = "desc",
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        return JSONResponse(
            GrammarRepository(conn).list_mistakes(
                page=page, page_size=page_size,
                category=category, section=section,
                task_type=task_type, sort=sort,
            )
        )


@router.get("/filter-options")
async def grammar_filter_options(
    section: str = "",
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        return JSONResponse(GrammarRepository(conn).get_filter_options(section=section))


@router.get("/mistakes/{mistake_id}/adjacent")
async def grammar_mistake_adjacent(
    mistake_id: int,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        return JSONResponse(GrammarRepository(conn).get_adjacent(mistake_id))


@router.get("/mistakes/{mistake_id}")
async def grammar_mistake_detail(
    mistake_id: int,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        detail = GrammarRepository(conn).get_detail(mistake_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Mistake not found")
    return JSONResponse(detail)


@router.post("/mistakes/{mistake_id}/review")
async def grammar_mistake_review(
    mistake_id: int,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        repo = GrammarRepository(conn)
        ok = repo.mark_reviewed(mistake_id)
        conn.commit()
    if not ok:
        raise HTTPException(status_code=404, detail="Mistake not found")
    return JSONResponse({"ok": True})


@router.get("/remediation-queue")
async def grammar_remediation_queue(_user: str = Depends(get_current_user)):
    """Return count of un-remediated mistakes and the first pending mistake ID."""
    with db_context() as conn:
        data = GrammarRepository(conn).get_remediation_queue()
    return JSONResponse(data)


@router.get("/transfer-tests")
async def get_transfer_tests(_user: str = Depends(get_current_user)):
    """Return pending transfer tests for the grammar hub."""
    with db_context() as conn:
        pending = GrammarRepository(conn).get_pending_transfer_tests()
    return JSONResponse({"pending": pending})
