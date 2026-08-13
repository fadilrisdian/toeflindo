"""Repository for writing checklist evaluation logs."""
from __future__ import annotations

import json
import sqlite3
from typing import Optional

from app.utils.time import now_wib


class ChecklistRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._c = conn

    def insert_checklist_log(
        self,
        *,
        practice_log_id: Optional[int],
        task_type: str,
        essay: str,
        results: list[dict],
        passed_count: int,
        total_count: int,
        improvement_note: str,
    ) -> int:
        now = now_wib()
        cur = self._c.execute(
            "INSERT INTO writing_checklist_log "
            "(date, practice_log_id, task_type, essay, results, passed_count, total_count, improvement_note) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                now,
                practice_log_id,
                task_type,
                essay,
                json.dumps(results),
                passed_count,
                total_count,
                improvement_note,
            ),
        )
        return cur.lastrowid  # type: ignore[return-value]

    def list_checklist_logs(
        self,
        *,
        page: int = 1,
        page_size: int = 10,
        task_type: str = "",
    ) -> dict:
        offset = (page - 1) * page_size
        where = ""
        params: list = []
        if task_type:
            where = "WHERE task_type=?"
            params.append(task_type)

        total = self._c.execute(
            f"SELECT COUNT(*) FROM writing_checklist_log {where}", params
        ).fetchone()[0]

        rows = self._c.execute(
            f"SELECT id, date, practice_log_id, task_type, results, "
            f"passed_count, total_count, improvement_note "
            f"FROM writing_checklist_log {where} "
            f"ORDER BY date DESC LIMIT ? OFFSET ?",
            params + [page_size, offset],
        ).fetchall()

        parsed_rows = []
        for r in rows:
            d = dict(r)
            try:
                d["results"] = json.loads(d["results"])
            except (json.JSONDecodeError, TypeError):
                d["results"] = []
            parsed_rows.append(d)

        return {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "rows": parsed_rows,
        }

    def get_checklist_log(self, log_id: int) -> Optional[dict]:
        row = self._c.execute(
            "SELECT id, date, practice_log_id, task_type, essay, results, "
            "passed_count, total_count, improvement_note "
            "FROM writing_checklist_log WHERE id=?",
            (log_id,),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            d["results"] = json.loads(d["results"])
        except (json.JSONDecodeError, TypeError):
            d["results"] = []
        return d
