"""Admin router — CRUD for task_bank + audio upload."""
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api.dependencies import get_current_user
from app.core.config import AUDIO_MOUNT_PREFIX
from app.db.session import db_context

router = APIRouter(prefix="/api/admin", tags=["admin"])

# ── Audio upload dir mapping ───────────────────────────────────────────────────

AUDIO_SUBDIRS = {
    "Listen and Repeat": "listen-and-repeat/uploads",
    "Take an Interview": "take-an-interview/uploads",
}

AUDIO_ROOT = Path("/audio")


@router.post("/audio/upload")
async def upload_audio(
    file: UploadFile = File(...),
    task_type: str = Form(...),
    _user: str = Depends(get_current_user),
):
    """Upload an MP3/audio file for a speaking task.
    Returns the absolute host-side path to store in task_bank.question.
    """
    if task_type not in AUDIO_SUBDIRS:
        raise HTTPException(
            status_code=400,
            detail=f"task_type must be one of: {list(AUDIO_SUBDIRS)}",
        )

    subdir = AUDIO_SUBDIRS[task_type]
    dest_dir = AUDIO_ROOT / subdir
    dest_dir.mkdir(parents=True, exist_ok=True)

    raw_name = file.filename or "upload.mp3"
    # sanitise — keep only safe chars
    safe_name = "".join(c for c in Path(raw_name).name if c.isalnum() or c in "._- ").strip()
    if not safe_name:
        safe_name = "upload.mp3"

    dest_path = dest_dir / safe_name
    # avoid clobbering existing files
    counter = 1
    while dest_path.exists():
        stem, suffix = Path(safe_name).stem, Path(safe_name).suffix
        dest_path = dest_dir / f"{stem}_{counter}{suffix}"
        counter += 1

    content = await file.read()
    dest_path.write_bytes(content)

    # Build absolute host path — mirrors how existing tasks store the path
    rel = dest_path.relative_to(AUDIO_ROOT)
    host_path = AUDIO_MOUNT_PREFIX + str(rel)

    return JSONResponse({"path": host_path, "filename": dest_path.name, "size": len(content)})


# ── Schemas ────────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    category: Optional[str] = None
    task_type: str
    question: str
    tags: Optional[str] = None
    answer: Optional[str] = None
    source: str = "https://www.toeflresources.com/"
    reference_only: int = 0
    question_type: Optional[str] = None


class TaskUpdate(BaseModel):
    category: Optional[str] = None
    task_type: Optional[str] = None
    question: Optional[str] = None
    tags: Optional[str] = None
    answer: Optional[str] = None
    source: Optional[str] = None
    reference_only: Optional[int] = None
    question_type: Optional[str] = None


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/answer-stats")
async def answer_stats(_user: str = Depends(get_current_user)):
    with db_context() as conn:
        rows = conn.execute(
            "SELECT task_type, COUNT(*) as total, "
            "SUM(CASE WHEN answer IS NULL OR answer = '' THEN 1 ELSE 0 END) as missing "
            "FROM task_bank GROUP BY task_type ORDER BY task_type"
        ).fetchall()
    return JSONResponse({"rows": [dict(r) for r in rows]})


@router.get("/tasks")
async def list_tasks(
    task_type: str = "",
    search: str = "",
    missing_only: int = 0,
    page: int = 1,
    page_size: int = 25,
    _user: str = Depends(get_current_user),
):
    offset = (page - 1) * page_size
    conditions: list[str] = []
    params: list = []

    if task_type:
        conditions.append("task_type = ?")
        params.append(task_type)
    if search:
        conditions.append("(question LIKE ? OR tags LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like])
    if missing_only:
        conditions.append("(answer IS NULL OR answer = '')")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db_context() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM task_bank {where}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT task_id, category, task_type, question, tags, answer, "
            f"source, reference_only, question_type "
            f"FROM task_bank {where} ORDER BY task_id DESC LIMIT ? OFFSET ?",
            params + [page_size, offset],
        ).fetchall()

    return JSONResponse({
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "rows": [dict(r) for r in rows],
    })


@router.post("/tasks", status_code=201)
async def create_task(
    body: TaskCreate,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        cur = conn.execute(
            "INSERT INTO task_bank "
            "(category, task_type, question, tags, answer, source, reference_only, question_type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                body.category, body.task_type, body.question,
                body.tags, body.answer, body.source,
                body.reference_only, body.question_type,
            ),
        )
        task_id = cur.lastrowid
        conn.commit()
        row = conn.execute(
            "SELECT * FROM task_bank WHERE task_id = ?", (task_id,)
        ).fetchone()
    return JSONResponse(dict(row), status_code=201)


@router.put("/tasks/{task_id}")
async def update_task(
    task_id: int,
    body: TaskUpdate,
    _user: str = Depends(get_current_user),
):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Validate column names against allowed set to prevent SQL injection.
    # TaskUpdate Pydantic model already constrains keys, but belt-and-suspenders.
    _ALLOWED_COLS = frozenset({
        "category", "task_type", "question", "tags", "answer",
        "source", "reference_only", "question_type",
    })
    bad_cols = set(updates) - _ALLOWED_COLS
    if bad_cols:
        raise HTTPException(status_code=400, detail=f"Unknown fields: {sorted(bad_cols)}")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [task_id]

    with db_context() as conn:
        existing = conn.execute(
            "SELECT task_id FROM task_bank WHERE task_id = ?", (task_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")
        conn.execute(
            f"UPDATE task_bank SET {set_clause} WHERE task_id = ?", values
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM task_bank WHERE task_id = ?", (task_id,)
        ).fetchone()
    return JSONResponse(dict(row))


class TaskBulkCreate(BaseModel):
    tasks: list[TaskCreate]


@router.post("/tasks/bulk", status_code=201)
async def bulk_create_tasks(
    body: TaskBulkCreate,
    _user: str = Depends(get_current_user),
):
    """Insert multiple tasks at once. Returns inserted count + per-row errors."""
    inserted_ids: list[int] = []
    errors: list[dict] = []

    with db_context() as conn:
        for i, task in enumerate(body.tasks):
            try:
                cur = conn.execute(
                    "INSERT INTO task_bank "
                    "(category, task_type, question, tags, answer, source, reference_only, question_type) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        task.category, task.task_type, task.question,
                        task.tags, task.answer, task.source,
                        task.reference_only, task.question_type,
                    ),
                )
                if cur.lastrowid is not None:
                    inserted_ids.append(cur.lastrowid)
            except Exception as exc:
                # Roll back the current transaction and start fresh so subsequent
                # rows still have a chance to be inserted cleanly.
                conn.rollback()
                errors.append({"row": i + 1, "error": str(exc)})
        # Final commit for all successfully inserted rows

    return JSONResponse(
        {"inserted": len(inserted_ids), "task_ids": inserted_ids, "errors": errors},
        status_code=201,
    )


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: int,
    _user: str = Depends(get_current_user),
):
    with db_context() as conn:
        existing = conn.execute(
            "SELECT task_id FROM task_bank WHERE task_id = ?", (task_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")
        conn.execute("DELETE FROM task_bank WHERE task_id = ?", (task_id,))
        conn.commit()
    # 204 No Content — no body
