"""Practice log + study logs + task bank repository."""
import sqlite3
from typing import Optional

from app.utils.time import now_wib, wib_date


class PracticeRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._c = conn

    # ── Practice log ──────────────────────────────────────────────────────────

    def insert_practice(
        self,
        *,
        section: str,
        task_type: str,
        prompt: str,
        response: str,
        score: Optional[float],
        feedback: str,
        duration_minutes: int = 0,
        tags: str = "",
        is_revision: bool = False,
        revision_of: Optional[int] = None,
    ) -> int:
        now = now_wib()
        # Dedup guard for Writing: same task_id + identical response within 5 minutes
        # prevents double-scoring the same essay (e.g. retry clicks, timer auto-submit race)
        # Revisions bypass this guard — they may be identical to the original intentionally.
        if section == "Writing" and response.strip() and tags and not is_revision:
            task_id_part = next((p.split(":")[1] for p in tags.split(",") if p.startswith("task_id:")), None)
            if task_id_part:
                existing = self._c.execute(
                    "SELECT id FROM practice_log "
                    "WHERE section='Writing' AND tags LIKE ? AND response=? "
                    "AND (is_revision IS NULL OR is_revision=0) "
                    "AND date >= datetime(?, '-5 minutes') ORDER BY id DESC LIMIT 1",
                    (f"%task_id:{task_id_part}%", response.strip(), now),
                ).fetchone()
                if existing:
                    return existing["id"]  # type: ignore[return-value]
        cur = self._c.execute(
            "INSERT INTO practice_log (date, section, task_type, prompt, response, score, feedback, duration_minutes, tags, is_revision, revision_of) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (now, section, task_type, prompt, response, score, feedback, duration_minutes, tags, int(is_revision), revision_of),
        )
        return cur.lastrowid  # type: ignore[return-value]

    def find_recent_writing(self, *, task_id: int, essay: str) -> Optional[int]:
        """Return practice_id if same essay was submitted for same task within 5 minutes."""
        now = now_wib()
        row = self._c.execute(
            "SELECT id FROM practice_log "
            "WHERE section='Writing' AND tags LIKE ? AND response=? "
            "AND date >= datetime(?, '-5 minutes') ORDER BY id DESC LIMIT 1",
            (f"%task_id:{task_id}%", essay.strip(), now),
        ).fetchone()
        return row["id"] if row else None

    def get_practice(self, practice_id: int) -> Optional[dict]:
        """Return a single practice_log row as dict."""
        row = self._c.execute(
            "SELECT id, score, feedback FROM practice_log WHERE id=?",
            (practice_id,),
        ).fetchone()
        return dict(row) if row else None

    def get_session_detail(self, session_id: int) -> Optional[dict]:
        """Return full detail for a single practice_log session."""
        row = self._c.execute(
            "SELECT id, date, section, task_type, prompt, response, score, "
            "feedback, duration_minutes, tags "
            "FROM practice_log WHERE id=?",
            (session_id,),
        ).fetchone()
        return dict(row) if row else None

    def list_writing_sessions(
        self, *, page: int = 1, page_size: int = 10, task_type: str = ""
    ) -> dict:
        offset = (page - 1) * page_size
        where = "WHERE LOWER(section)='writing'"
        params: list = []
        if task_type:
            where += " AND task_type=?"
            params.append(task_type)
        total = self._c.execute(f"SELECT COUNT(*) FROM practice_log {where}", params).fetchone()[0]
        rows = self._c.execute(
            f"SELECT id, date, task_type, score, prompt, response, feedback, tags "
            f"FROM practice_log {where} ORDER BY date DESC LIMIT ? OFFSET ?",
            params + [page_size, offset],
        ).fetchall()
        return {
            "page": page, "page_size": page_size, "total": total,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "rows": [dict(r) for r in rows],
        }

    def list_speaking_sessions(
        self, *, page: int = 1, page_size: int = 10, task_type: str
    ) -> dict:
        offset = (page - 1) * page_size
        total = self._c.execute(
            "SELECT COUNT(*) FROM practice_log WHERE LOWER(section)='speaking' AND task_type=?",
            (task_type,),
        ).fetchone()[0]
        rows = self._c.execute(
            "SELECT pl.id, pl.date, pl.task_type, pl.score, pl.prompt, pl.response, pl.feedback, pl.tags, "
            "sal.audio_filename "
            "FROM practice_log pl "
            "LEFT JOIN speech_analysis_log sal ON sal.practice_log_id = pl.id "
            "WHERE LOWER(pl.section)='speaking' AND pl.task_type=? "
            "ORDER BY pl.date DESC LIMIT ? OFFSET ?",
            (task_type, page_size, offset),
        ).fetchall()
        return {
            "page": page, "page_size": page_size, "total": total,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "rows": [dict(r) for r in rows],
        }

    # ── SRS study logs ────────────────────────────────────────────────────────

    def upsert_study_log(
        self,
        *,
        topic_id: int,
        topic_title: str,
        score: Optional[float],
    ) -> None:
        now = now_wib()
        existing = self._c.execute(
            "SELECT log_id, attempts, accuracy_rate FROM study_logs WHERE topic_title=? AND topic_id=?",
            (topic_title, topic_id),
        ).fetchone()
        new_attempts = (existing["attempts"] + 1) if existing else 1
        # Reconstruct correct count as integer to avoid float drift from stored
        # rounded accuracy_rate. Round to nearest int to handle rounding artefacts.
        prev_correct = round(existing["accuracy_rate"] * (new_attempts - 1)) if existing else 0
        new_correct = prev_correct + (1 if score and score >= 4.0 else 0)
        new_accuracy = round(new_correct / new_attempts, 2)
        next_days = 7 if new_accuracy >= 0.9 else (3 if new_accuracy >= 0.7 else 1)
        next_review = wib_date(next_days)
        retention = min(5, (new_attempts // 3) if existing else 0)
        if existing:
            self._c.execute(
                "UPDATE study_logs SET last_reviewed=?, accuracy_rate=?, attempts=?, "
                "next_review_date=?, retention_level=?, status='in_progress' WHERE log_id=?",
                (now, new_accuracy, new_attempts, next_review, retention, existing["log_id"]),
            )
        else:
            self._c.execute(
                "INSERT INTO study_logs (topic_id, topic_title, status, last_reviewed, accuracy_rate, "
                "attempts, next_review_date, retention_level, source) "
                "VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?, 'website')",
                (topic_id, topic_title, now, new_accuracy, new_attempts, next_review, retention),
            )

    # ── Task bank ─────────────────────────────────────────────────────────────

    def get_task(self, task_id: int) -> Optional[sqlite3.Row]:
        return self._c.execute(
            "SELECT * FROM task_bank WHERE task_id=?", (task_id,)
        ).fetchone()

    def list_tasks(
        self,
        *,
        task_type: str = "",
        tags: str = "",
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        offset = (page - 1) * page_size
        conditions: list[str] = []
        params: list = []
        if task_type:
            conditions.append("task_type=?")
            params.append(task_type)
        if tags:
            conditions.append("tags LIKE ?")
            params.append(f"%{tags}%")
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        total = self._c.execute(f"SELECT COUNT(*) FROM task_bank {where}", params).fetchone()[0]
        rows = self._c.execute(
            f"SELECT task_id, task_type, question, answer, tags FROM task_bank {where} "
            f"ORDER BY task_id LIMIT ? OFFSET ?",
            params + [page_size, offset],
        ).fetchall()
        return {
            "page": page, "page_size": page_size, "total": total,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "rows": [dict(r) for r in rows],
        }

    def list_topic_tags_by_type(self, task_type: str) -> list[dict]:
        """Return distinct topic tags with first_task_id and display name."""
        rows = self._c.execute(
            "SELECT DISTINCT tags, MIN(task_id) as first_task_id FROM task_bank "
            "WHERE task_type=? AND tags IS NOT NULL GROUP BY tags ORDER BY tags",
            (task_type,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_practice_history_by_tags_field(self, task_type: str) -> list[dict]:
        """MAX score and date per tags value from practice_log."""
        rows = self._c.execute(
            "SELECT tags, MAX(score) as best_score, MAX(date) as last_date "
            "FROM practice_log WHERE task_type=? AND tags IS NOT NULL GROUP BY tags",
            (task_type,),
        ).fetchall()
        return [dict(r) for r in rows]

    def list_tasks_by_type(self, task_type: str) -> list[sqlite3.Row]:
        return self._c.execute(
            "SELECT task_id, question, answer FROM task_bank WHERE task_type=? ORDER BY task_id",
            (task_type,),
        ).fetchall()

    def get_practice_history_by_type(self, task_type: str) -> list[sqlite3.Row]:
        return self._c.execute(
            "SELECT tags, MAX(score) as best_score, MAX(date) as last_date "
            "FROM practice_log WHERE task_type=? AND tags IS NOT NULL GROUP BY tags",
            (task_type,),
        ).fetchall()

    # ── Speech analysis log ───────────────────────────────────────────────────

    def insert_speech_log(
        self,
        *,
        practice_log_id: int,
        filename: str,
        transcript: str,
        overall_score: float,
        pronunciation_score: Optional[int],
        fluency_score: Optional[int],
        grammar_score: Optional[int],
        vocabulary_score: Optional[int],
        intonation_score: Optional[int],
        discourse_score: Optional[float] = None,
        wpm: Optional[float],
        cefr_level: Optional[str],
        task_type: str,
        topic: str,
        expected_answer: str,
        task_raw_score: Optional[float] = None,
        estimated_band: Optional[float] = None,
        readiness_score: Optional[int] = None,
        readiness_level: Optional[str] = None,
        priority_issues: Optional[str] = None,
        prompt_version: Optional[str] = None,
    ) -> None:
        now = now_wib()
        self._c.execute(
            "INSERT INTO speech_analysis_log "
            "(date, audio_filename, transcript, overall_score, pronunciation_score, fluency_score, "
            "grammar_score, vocabulary_score, intonation_score, discourse_score, wpm, cefr_level, "
            "practice_log_id, task_type, topic, expected_answer, task_raw_score, estimated_band, "
            "readiness_score, readiness_level, priority_issues, prompt_version) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (now, filename, transcript, overall_score, pronunciation_score, fluency_score,
             grammar_score, vocabulary_score, intonation_score, discourse_score, wpm, cefr_level,
             practice_log_id, task_type, topic, expected_answer, task_raw_score, estimated_band,
             readiness_score, readiness_level, priority_issues, prompt_version),
        )

    def update_words_json(self, practice_log_id: int, words_json: str) -> None:
        """Update the words_json column on the speech_analysis_log row for practice_log_id."""
        self._c.execute(
            "UPDATE speech_analysis_log SET words_json=? WHERE practice_log_id=?",
            (words_json, practice_log_id),
        )

    def update_expected_answer(self, practice_log_id: int, expected_answer: str) -> None:
        """Update the expected_answer column on the speech_analysis_log row for practice_log_id."""
        self._c.execute(
            "UPDATE speech_analysis_log SET expected_answer=? WHERE practice_log_id=?",
            (expected_answer, practice_log_id),
        )
