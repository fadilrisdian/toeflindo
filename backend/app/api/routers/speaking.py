"""Speaking router — audio, record, analyze, paginated reads, recommended, analyzer."""
import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from app.api.dependencies import get_current_user
from app.clients import speech as speech_client
from app.core.exceptions import SpeechAnalyzerError
from app.core.logging import get_logger
from app.db.session import db_context
from app.repositories.grammar_repository import GrammarRepository
from app.repositories.practice_repository import PracticeRepository
from app.services.speaking_service import analyze_speaking, get_recommended_speaking_task

router = APIRouter(prefix="/api/speaking", tags=["speaking"])
logger = get_logger(__name__)


@router.get("/audio")
async def speaking_audio(path: str = ""):
    """Serve practice audio files (no auth — browser Audio element can't send headers)."""
    if not path:
        raise HTTPException(status_code=400, detail="path is required")
    audio_path = Path("/audio") / path
    try:
        audio_path.resolve().relative_to(Path("/audio").resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not audio_path.exists():
        logger.warning("audio file not found path=%s", path)
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(audio_path, media_type="audio/mpeg")


@router.get("/recording/{filename}")
async def speaking_recording(filename: str, _user: str = Depends(get_current_user)):
    """Serve a saved user recording (requires auth)."""
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    rec_path = Path("/recordings") / filename
    if not rec_path.exists():
        raise HTTPException(status_code=404, detail="Recording not found")
    return FileResponse(rec_path, media_type="audio/webm")


@router.post("/record")
async def speaking_record(
    request: Request,
    _user: str = Depends(get_current_user),
):
    import time as _time
    form       = await request.form()
    audio_file = form.get("audio")
    task_id    = form.get("task_id", "0")
    if not audio_file:
        return JSONResponse({"status": "error", "message": "No audio file provided"}, status_code=400)
    recordings_dir = Path("/recordings")
    recordings_dir.mkdir(parents=True, exist_ok=True)
    filename = f"rec_{task_id}_{int(_time.time())}.webm"
    content  = await audio_file.read()
    (recordings_dir / filename).write_bytes(content)
    logger.debug("speaking record saved task_id=%s filename=%s size=%d", task_id, filename, len(content))
    return {"status": "ok", "filename": filename, "size": len(content)}


@router.post("/analyze")
async def speaking_analyze(
    request: Request,
    _user: str = Depends(get_current_user),
):
    form            = await request.form()
    audio_file      = form.get("audio")
    task_id         = form.get("task_id", "0")
    task_type       = form.get("task_type", "Listen and Repeat")
    expected_answer = form.get("expected_answer", "")
    topic           = form.get("topic", "")

    if not audio_file:
        return JSONResponse({"status": "error", "message": "No audio file provided"}, status_code=400)

    audio_bytes = await audio_file.read()

    try:
        with db_context() as conn:
            result = await analyze_speaking(
                audio_bytes=audio_bytes,
                task_id=task_id,
                task_type=task_type,
                expected_answer=expected_answer,
                topic=topic,
                practice_repo=PracticeRepository(conn),
                grammar_repo=GrammarRepository(conn),
            )
            conn.commit()
        return JSONResponse(result)
    except SpeechAnalyzerError as exc:
        logger.error("speaking analyze: speech analyzer error task_id=%s error=%s", task_id, exc)
        return JSONResponse({"status": "error", "message": str(exc)}, status_code=500)
    except Exception as exc:
        logger.exception("speaking analyze: unexpected error task_id=%s", task_id)
        return JSONResponse({"status": "error", "message": str(exc)}, status_code=500)


@router.post("/upload-analyze")
async def speaking_upload_analyze(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Standalone audio analysis — no practice log entry, no task context.
    Accepts a raw audio upload and returns the 5-dimension analysis from the speech analyzer.
    """
    import time as _time
    form       = await request.form()
    audio_file = form.get("file")
    if not audio_file:
        return JSONResponse({"status": "error", "message": "No file provided"}, status_code=400)

    audio_bytes = await audio_file.read()
    if len(audio_bytes) < 100:
        return JSONResponse({"status": "error", "message": "Recording empty — mic may not have captured audio"}, status_code=400)

    filename = getattr(audio_file, "filename", None) or f"upload_{int(_time.time())}.webm"

    try:
        result = await speech_client.analyze(
            audio_bytes=audio_bytes,
            filename=filename,
        )
        return JSONResponse(result)
    except SpeechAnalyzerError as exc:
        logger.error("upload-analyze: speech analyzer error error=%s", exc)
        return JSONResponse({"status": "error", "message": str(exc)}, status_code=500)
    except Exception as exc:
        logger.exception("upload-analyze: unexpected error")
        return JSONResponse({"status": "error", "message": str(exc)}, status_code=500)


@router.get("/analyzer-data")
async def speaking_analyzer_data(_user: str = Depends(get_current_user)):
    """Aggregated data for the Speaking Analyzer dashboard page."""
    with db_context() as conn:
        from app.repositories.dashboard_repository import DashboardRepository
        return JSONResponse(DashboardRepository(conn).speaking_analyzer())


@router.get("/analyzer/history")
async def speaking_analyzer_history(
    limit: int = 15,
    _user: str = Depends(get_current_user),
):
    """Return recent speech_analysis_log entries for the history table."""
    with db_context() as conn:
        rows = conn.execute("""
            SELECT id, date, audio_filename, transcript, task_type, topic,
                   overall_score, pronunciation_score, fluency_score,
                   grammar_score, vocabulary_score, intonation_score, discourse_score,
                   wpm, cefr_level, avg_word_confidence, pause_count, filler_count,
                   task_raw_score, estimated_band
            FROM speech_analysis_log
            ORDER BY date DESC
            LIMIT ?
        """, (limit,)).fetchall()
        return JSONResponse({"sessions": [dict(r) for r in rows]})


@router.get("/analyzer/history/{session_id}")
async def speaking_analyzer_session(
    session_id: int,
    _user: str = Depends(get_current_user),
):
    """Return full detail for one speech_analysis_log entry."""
    import json
    with db_context() as conn:
        row = conn.execute(
            "SELECT * FROM speech_analysis_log WHERE id = ?", (session_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Session not found")
        d = dict(row)
        for field in ["pronunciation_data", "fluency_data", "grammar_data", "vocabulary_data", "intonation_data"]:
            if d.get(field):
                try:
                    d[field] = json.loads(d[field])
                except Exception:
                    pass
        return JSONResponse(d)


@router.get("/listen-repeat")
async def speaking_lr(
    page: int = 1,
    page_size: int = 10,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        return JSONResponse(
            PracticeRepository(conn).list_speaking_sessions(
                page=page, page_size=page_size, task_type="Listen and Repeat"
            )
        )


@router.get("/interview")
async def speaking_iv(
    page: int = 1,
    page_size: int = 10,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        return JSONResponse(
            PracticeRepository(conn).list_speaking_sessions(
                page=page, page_size=page_size, task_type="Take an Interview"
            )
        )


@router.get("/mistakes")
async def speaking_mistakes(
    page: int = 1,
    page_size: int = 10,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        return JSONResponse(
            GrammarRepository(conn).list_mistakes(
                page=page, page_size=page_size, section="Speaking"
            )
        )


@router.post("/checklist/grade")
async def speaking_checklist_grade(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """LLM-grade a speaking session checklist. Returns {results: [{item, text, passed, note}]}."""
    from app.services.speaking_checklist_service import grade_speaking_checklist

    body = await request.json()
    task_type       = body.get("task_type", "Listen and Repeat")
    session_results = body.get("session_results", [])   # list of AnalyzeResult dicts

    try:
        results = await asyncio.get_running_loop().run_in_executor(
            None, lambda: grade_speaking_checklist(task_type=task_type, session_results=session_results)
        )
        return JSONResponse({"results": results})
    except Exception as exc:
        logger.exception("speaking checklist grade error")
        return JSONResponse({"status": "error", "message": str(exc)}, status_code=500)


@router.post("/checklist")
async def speaking_checklist_save(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Save a speaking self-check checklist result."""
    import json as _json
    from app.utils.time import now_wib

    body = await request.json()
    task_type       = body.get("task_type", "")
    results         = body.get("results", [])   # [{item, text, passed}]
    practice_log_id = body.get("practice_log_id") or None

    passed_count = sum(1 for r in results if r.get("passed"))
    total_count  = len(results)

    with db_context() as conn:
        cur = conn.execute(
            "INSERT INTO speaking_checklist_log "
            "(date, practice_log_id, task_type, results, passed_count, total_count) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (now_wib(), practice_log_id, task_type,
             _json.dumps(results), passed_count, total_count),
        )
        conn.commit()
        return JSONResponse({"id": cur.lastrowid, "passed_count": passed_count, "total_count": total_count})


@router.get("/sessions/{session_id}")
async def speaking_session_detail(
    session_id: int,
    _user: str = Depends(get_current_user),
):
    """Return full detail for a single speaking session."""
    import json
    with db_context() as conn:
        row = conn.execute(
            "SELECT pl.id, pl.date, pl.section, pl.task_type, pl.prompt, pl.response, "
            "pl.score, pl.feedback, pl.duration_minutes, pl.tags, "
            "sal.audio_filename, sal.transcript, sal.overall_score, "
            "sal.pronunciation_score, sal.fluency_score, sal.grammar_score, "
            "sal.vocabulary_score, sal.intonation_score, sal.wpm, sal.cefr_level, "
            "sal.task_raw_score, sal.estimated_band, "
            "sal.pause_count, sal.long_pause_count, sal.filler_count, sal.repetition_count, "
            "sal.avg_word_confidence, sal.low_confidence_words, "
            "sal.pitch_stats, sal.energy_variation, "
            "sal.vocabulary_diversity, sal.repeated_words, "
            "sal.pronunciation_data, sal.fluency_data, sal.intonation_data, "
            "sal.vocabulary_data, sal.grammar_data "
            "FROM practice_log pl "
            "LEFT JOIN speech_analysis_log sal ON sal.practice_log_id = pl.id "
            "WHERE pl.id = ? AND LOWER(pl.section) = 'speaking'",
            (session_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Speaking session not found")
        d = dict(row)
        for field in ["low_confidence_words", "pitch_stats", "vocabulary_diversity",
                      "repeated_words", "pronunciation_data", "fluency_data",
                      "intonation_data", "vocabulary_data", "grammar_data"]:
            if d.get(field):
                try:
                    d[field] = json.loads(d[field])
                except Exception:
                    pass
    return JSONResponse(d)


@router.get("/sessions/{session_id}/grammar-mistakes")
async def speaking_session_grammar_mistakes(
    session_id: int,
    _user: str = Depends(get_current_user),
):
    """Return grammar mistakes logged during a speaking session."""
    with db_context() as conn:
        row = conn.execute(
            "SELECT id FROM practice_log WHERE id=? AND LOWER(section)='speaking'",
            (session_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Speaking session not found")
        mistakes = GrammarRepository(conn).get_mistakes_for_session(session_id)
    return JSONResponse({"mistakes": mistakes})


@router.get("/recommended")
async def speaking_recommended(
    task_type: str = "Listen and Repeat",
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        return JSONResponse(
            get_recommended_speaking_task(
                task_type=task_type,
                practice_repo=PracticeRepository(conn),
            )
        )
