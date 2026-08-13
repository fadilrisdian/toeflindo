"""Writing router — submit, BAS, sessions, mistakes, task bank, recommended."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.api.dependencies import get_current_user
from app.db.session import db_context
from app.models.schemas.writing import (
    BASSubmitRequest,
    ChecklistEvalRequest,
    WritingSubmitRequest,
)
from app.repositories.grammar_repository import GrammarRepository
from app.repositories.practice_repository import PracticeRepository
from app.repositories.checklist_repository import ChecklistRepository
from app.repositories.writing_features_repository import WritingFeaturesRepository
from app.services.writing_service import (
    enrich_task_bank_rows,
    get_recommended_task,
    run_nlp_background,
    submit_bas,
    submit_writing,
)
from app.services.checklist_service import run_checklist

router = APIRouter(prefix="/api", tags=["writing"])


@router.post("/practice/writing/submit")
async def writing_submit(
    body: WritingSubmitRequest,
    background_tasks: BackgroundTasks,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        try:
            result = submit_writing(
                task_id=body.task_id,
                task_type=body.task_type,
                essay=body.essay,
                time_spent_sec=body.time_spent_sec,
                practice_repo=PracticeRepository(conn),
                grammar_repo=GrammarRepository(conn),
                is_revision=body.is_revision,
                revision_of=body.revision_of,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        conn.commit()

    # Pull out precomputed NLP features (not sent to client) then persist async
    precomputed_nlp = result.pop("_nlp_features", None)
    background_tasks.add_task(
        run_nlp_background,
        practice_id=result["practice_id"],
        task_type=body.task_type,
        essay=body.essay,
        prompt_txt=result.pop("prompt", ""),
        precomputed_features=precomputed_nlp,
    )

    return JSONResponse(result)


@router.post("/practice/writing/bas/submit")
async def bas_submit(
    body: BASSubmitRequest,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        result = submit_bas(
            results=[r.model_dump() for r in body.results],
            practice_repo=PracticeRepository(conn),
            grammar_repo=GrammarRepository(conn),
        )
        conn.commit()
    return JSONResponse(result)


@router.get("/writing/sessions")
async def writing_sessions(
    page: int = 1,
    page_size: int = 10,
    task_type: str = "",
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        return JSONResponse(
            PracticeRepository(conn).list_writing_sessions(
                page=page, page_size=page_size, task_type=task_type
            )
        )


@router.get("/writing/mistakes")
async def writing_mistakes(
    page: int = 1,
    page_size: int = 10,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        return JSONResponse(
            GrammarRepository(conn).list_mistakes(
                page=page, page_size=page_size, section="Writing"
            )
        )


@router.get("/task/bank/groups")
async def task_bank_groups(
    task_type: str = "Build a Sentence",
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        rows = PracticeRepository(conn).list_topic_tags_by_type(task_type)
    return JSONResponse(rows)


@router.get("/task/bank")
async def task_bank(
    task_type: str = "",
    tags: str = "",
    page: int = 1,
    page_size: int = 20,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        data = PracticeRepository(conn).list_tasks(
            task_type=task_type, tags=tags, page=page, page_size=page_size
        )
    data["rows"] = enrich_task_bank_rows(data["rows"])
    return JSONResponse(data)


@router.get("/writing/recommended")
async def writing_recommended(
    task_type: str = "Write an Email",
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        return JSONResponse(
            get_recommended_task(
                task_type=task_type,
                practice_repo=PracticeRepository(conn),
            )
        )


@router.post("/writing/checklist")
async def writing_checklist(
    body: ChecklistEvalRequest,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        result = run_checklist(
            task_type=body.task_type,
            essay=body.essay,
            practice_log_id=body.practice_log_id,
            checklist_repo=ChecklistRepository(conn),
        )
        conn.commit()
    return JSONResponse(result)


@router.get("/writing/checklist")
async def writing_checklist_history(
    page: int = 1,
    page_size: int = 10,
    task_type: str = "",
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        return JSONResponse(
            ChecklistRepository(conn).list_checklist_logs(
                page=page, page_size=page_size, task_type=task_type
            )
        )


@router.get("/writing/checklist/{log_id}")
async def writing_checklist_detail(
    log_id: int,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        row = ChecklistRepository(conn).get_checklist_log(log_id)
    if not row:
        raise HTTPException(status_code=404, detail="Checklist log not found")
    return JSONResponse(row)


@router.get("/writing/sessions/{session_id}")
async def writing_session_detail(
    session_id: int,
    _user: str = Depends(get_current_user),
):
    """Return full detail for a single writing session."""
    with db_context() as conn:
        row = PracticeRepository(conn).get_session_detail(session_id)
        if not row or (row.get("section") or "").lower() != "writing":
            raise HTTPException(status_code=404, detail="Writing session not found")
        features = WritingFeaturesRepository(conn).get_by_practice_id(session_id)
    # Return the parsed features JSON directly (not the full DB row)
    row["features"] = features["features"] if features else None
    return JSONResponse(row)


@router.get("/writing/sessions/{session_id}/grammar-mistakes")
async def writing_session_grammar_mistakes(
    session_id: int,
    _user: str = Depends(get_current_user),
):
    """Return grammar mistakes logged during a writing session (date-matched)."""
    with db_context() as conn:
        row = PracticeRepository(conn).get_session_detail(session_id)
        if not row or (row.get("section") or "").lower() != "writing":
            raise HTTPException(status_code=404, detail="Writing session not found")
        mistakes = GrammarRepository(conn).get_mistakes_for_session(session_id)
    return JSONResponse({"mistakes": mistakes})


@router.get("/writing/latest-features")
async def writing_latest_features(
    _user: str = Depends(get_current_user),
):
    """Return dimension scores from the most recent non-BAS writing session."""
    with db_context() as conn:
        row = WritingFeaturesRepository(conn).get_latest()
    if not row:
        return JSONResponse({"found": False})
    return JSONResponse({
        "found": True,
        "practice_log_id": row["practice_log_id"],
        "task_type": row["task_type"],
        "syntax": row["dimension_syntax"],
        "lexical": row["dimension_lexical"],
        "conventions": row["dimension_conventions"],
    })


@router.get("/writing/features/{practice_id}")
async def writing_features_detail(
    practice_id: int,
    _user: str = Depends(get_current_user),
):
    """Retrieve NLP feature analysis for a writing submission."""
    with db_context() as conn:
        row = WritingFeaturesRepository(conn).get_by_practice_id(practice_id)
    if not row:
        raise HTTPException(status_code=404, detail="No NLP features found for this submission")
    return JSONResponse(row)
