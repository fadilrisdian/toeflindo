"""Remediation loop router — error-feedback loop per grammar mistake.

Flow per mistake:
  GET  /api/remediate/{id}              → load mistake data for the UI
  POST /api/remediate/{id}/self-correct → Step 1: student attempts fix, reveals feedback
  GET  /api/remediate/{id}/prompts      → Step 3: get generation prompts
  POST /api/remediate/{id}/check        → Step 3: check a student-written sentence
  POST /api/remediate/{id}/complete     → mark mistake as 'engaged', advance review_stage
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.api.dependencies import get_current_user
from app.core.logging import get_logger
from app.db.session import db_context
from app.models.schemas.grammar import (
    CheckSentenceRequest,
    SelfCorrectRequest,
)
from app.repositories.grammar_repository import GrammarRepository
from app.services.grammar_service import (
    build_remediation_feedback,
    check_student_sentence,
    evaluate_grammar,
    generate_remediation_prompts,
)

router = APIRouter(prefix="/api/remediate", tags=["remediate"])
logger = get_logger(__name__)


@router.get("/{mistake_id}")
async def remediate_detail(
    mistake_id: int,
    _user: str = Depends(get_current_user),
):
    """Load full mistake data enriched with treatability/rubric_dimension."""
    with db_context() as conn:
        data = GrammarRepository(conn).get_for_remediate(mistake_id)
    if not data:
        raise HTTPException(status_code=404, detail="Mistake not found")
    return JSONResponse(data)


@router.post("/{mistake_id}/self-correct")
async def remediate_self_correct(
    mistake_id: int,
    body: SelfCorrectRequest,
    _user: str = Depends(get_current_user),
):
    """Step 1 + 2: log the student's self-correction attempt, evaluate it,
    then always reveal the explicit feedback (rule or model sentences).

    The attempt is logged regardless of whether it's correct — attempting is the point.
    """
    import asyncio

    with db_context() as conn:
        repo = GrammarRepository(conn)
        data = repo.get_for_remediate(mistake_id)
        if not data:
            raise HTTPException(status_code=404, detail="Mistake not found")

        # Evaluate the attempt
        loop = asyncio.get_running_loop()
        eval_result = await loop.run_in_executor(
            None,
            lambda: evaluate_grammar(
                user_answer=body.attempt_text,
                correct=data["correct"],
                wrong=data["wrong"],
                category=data["grammar_type"],
            ),
        )
        verdict  = eval_result.get("verdict", "wrong")
        feedback = eval_result.get("feedback", "")

        # Log the attempt
        attempt_id = repo.insert_review_attempt(
            grammar_mistake_id=mistake_id,
            attempt_type="self_correct",
            attempt_text=body.attempt_text,
            is_correct=(verdict == "correct"),
            feedback=feedback,
            hint_level_used=body.hint_level_used,
        )
        conn.commit()

    # Always generate explicit feedback (Step 2) — revealed regardless of outcome
    loop = asyncio.get_running_loop()
    fb = await loop.run_in_executor(
        None,
        lambda: build_remediation_feedback(
            grammar_type=data["grammar_type"],
            sub_type=data.get("sub_type") or "",
            wrong=data["wrong"],
            correct=data["correct"],
            explanation=data.get("explanation") or "",
            treatability=data["treatability"],
        ),
    )

    return JSONResponse({
        "attempt_id": attempt_id,
        "verdict": verdict,
        "feedback": feedback,
        "rule": fb.get("rule", ""),
        "model_sentences": fb.get("model_sentences", []),
        "correct": data["correct"],
    })


@router.get("/{mistake_id}/prompts")
async def remediate_prompts(
    mistake_id: int,
    _user: str = Depends(get_current_user),
):
    """Step 3: generate 2-3 new-sentence practice prompts for this error type."""
    import asyncio

    with db_context() as conn:
        data = GrammarRepository(conn).get_for_remediate(mistake_id)
    if not data:
        raise HTTPException(status_code=404, detail="Mistake not found")

    loop = asyncio.get_running_loop()
    prompts = await loop.run_in_executor(
        None,
        lambda: generate_remediation_prompts(
            grammar_type=data["grammar_type"],
            sub_type=data.get("sub_type") or "",
            correct=data["correct"],
            treatability=data["treatability"],
        ),
    )
    return JSONResponse({"prompts": prompts})


@router.post("/{mistake_id}/check")
async def remediate_check_sentence(
    mistake_id: int,
    body: CheckSentenceRequest,
    _user: str = Depends(get_current_user),
):
    """Step 3: evaluate a student's newly-written sentence."""
    import asyncio

    with db_context() as conn:
        repo = GrammarRepository(conn)
        data = repo.get_for_remediate(mistake_id)
        if not data:
            raise HTTPException(status_code=404, detail="Mistake not found")

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: check_student_sentence(
                student_sentence=body.student_sentence,
                prompt=body.prompt,
                grammar_type=data["grammar_type"],
                sub_type=data.get("sub_type") or "",
                treatability=data["treatability"],
            ),
        )

        attempt_id = repo.insert_review_attempt(
            grammar_mistake_id=mistake_id,
            attempt_type="new_sentence",
            attempt_text=body.student_sentence,
            is_correct=(result["verdict"] == "correct"),
            feedback=result.get("feedback", ""),
        )
        conn.commit()

    return JSONResponse({
        "attempt_id": attempt_id,
        "verdict": result["verdict"],
        "feedback": result.get("feedback", ""),
    })


@router.post("/{mistake_id}/complete")
async def remediate_complete(
    mistake_id: int,
    _user: str = Depends(get_current_user),
):
    """Mark mistake as 'engaged' and advance review_stage.

    Only callable after the student has completed at least one new_sentence attempt
    (enforced client-side — the Complete button is gated on that).
    """
    with db_context() as conn:
        repo = GrammarRepository(conn)
        data = repo.get_for_remediate(mistake_id)
        if not data:
            raise HTTPException(status_code=404, detail="Mistake not found")
        # Must have at least one new_sentence attempt logged
        has_generation = any(
            a["attempt_type"] == "new_sentence"
            for a in data.get("review_attempts", [])
        )
        if not has_generation:
            return JSONResponse(
                {"ok": False, "error": "Complete at least one generation practice sentence first."},
                status_code=400,
            )
        repo.set_remediation_status(mistake_id, "engaged")
        new_stage = repo.advance_review_stage(mistake_id)

        # Auto-create a transfer test if one doesn't exist for this grammar_type
        drill_accuracy = repo.get_drill_accuracy(data["grammar_type"])
        section = (data.get("section") or "").lower()
        target_task = (
            "Write for an Academic Discussion" if section == "writing"
            else "Take an Interview"
        )
        repo.create_transfer_test(
            grammar_type=data["grammar_type"],
            drill_accuracy=drill_accuracy,
            target_task_type=target_task,
        )
        conn.commit()

    logger.info("remediation complete mistake_id=%s new_stage=%s", mistake_id, new_stage)
    return JSONResponse({"ok": True, "new_stage": new_stage, "remediation_status": "engaged"})
