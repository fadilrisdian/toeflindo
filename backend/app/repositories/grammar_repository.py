"""Grammar mistakes + SRS + performance repository."""
import sqlite3
from typing import Optional

from app.core.logging import get_logger
from app.utils.grammar import normalize_grammar_type, get_treatability, get_rubric_dimension
from app.utils.time import now_wib, today_wib, wib_date

logger = get_logger(__name__)


class GrammarRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._c = conn

    # ── Mistakes ──────────────────────────────────────────────────────────────

    def upsert_mistake(
        self,
        *,
        section: str,
        task_type: str,
        grammar_type: str,
        sub_type: str,
        wrong: str,
        correct: str,
        explanation: str,
        practice_log_id: Optional[int] = None,
    ) -> None:
        now = now_wib()
        normalized = normalize_grammar_type(grammar_type)
        existing = self._c.execute(
            "SELECT id FROM grammar_mistakes WHERE wrong=? AND section=? AND task_type=?",
            (wrong, section, task_type),
        ).fetchone()
        if existing:
            self._c.execute(
                "UPDATE grammar_mistakes SET recurrence_count=recurrence_count+1, date=?, reviewed=0,"
                " practice_log_id=COALESCE(?, practice_log_id) WHERE id=?",
                (now, practice_log_id, existing["id"]),
            )
            self.handle_re_encounter(normalize_grammar_type(grammar_type))
        else:
            self._c.execute(
                "INSERT INTO grammar_mistakes "
                "(date, grammar_type, sub_type, section, task_type, wrong, correct, explanation,"
                " reviewed, recurrence_count, practice_log_id, treatability, rubric_dimension) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)",
                (now, normalized, sub_type, section, task_type, wrong, correct, explanation,
                 practice_log_id, get_treatability(normalized), get_rubric_dimension(normalized)),
            )

    def upsert_mistake_bas(
        self,
        *,
        task_id: int,
        wrong: str,
        correct: str,
        grammar_type: str,
        sub_type: str,
        explanation: str,
        practice_log_id: Optional[int] = None,
    ) -> None:
        now = now_wib()
        normalized = normalize_grammar_type(grammar_type)
        existing = self._c.execute(
            "SELECT id FROM grammar_mistakes WHERE wrong=? AND section='Writing' AND task_type='Build a Sentence'",
            (wrong,),
        ).fetchone()
        if existing:
            self._c.execute(
                "UPDATE grammar_mistakes SET recurrence_count=recurrence_count+1, date=?, reviewed=0,"
                " practice_log_id=COALESCE(?, practice_log_id) WHERE id=?",
                (now, practice_log_id, existing["id"]),
            )
            self.handle_re_encounter(normalized)
        else:
            self._c.execute(
                "INSERT INTO grammar_mistakes "
                "(date, grammar_type, sub_type, section, task_type, wrong, correct, explanation,"
                " reviewed, recurrence_count, practice_log_id, treatability, rubric_dimension) "
                "VALUES (?, ?, ?, 'Writing', 'Build a Sentence', ?, ?, ?, 0, 1, ?, ?, ?)",
                (now, normalized, sub_type, wrong, correct,
                 f"[task_id:{task_id}] {explanation}", practice_log_id,
                 get_treatability(normalized), get_rubric_dimension(normalized)),
            )

    def upsert_mistake_speaking(
        self,
        *,
        wrong: str,
        correct: str,
        grammar_type: str,
        sub_type: str,
        explanation: str,
        practice_log_id: int | None = None,
    ) -> None:
        now = now_wib()
        normalized = normalize_grammar_type(grammar_type)
        existing = self._c.execute(
            "SELECT id, recurrence_count FROM grammar_mistakes "
            "WHERE wrong=? AND grammar_type=? AND section='Speaking' AND task_type='Take an Interview'",
            (wrong, normalized),
        ).fetchone()
        if existing:
            self._c.execute(
                "UPDATE grammar_mistakes SET recurrence_count=recurrence_count+1, date=?, reviewed=0,"
                " practice_log_id=COALESCE(?, practice_log_id) WHERE id=?",
                (now, practice_log_id, existing["id"]),
            )
            self.handle_re_encounter(normalized)
        else:
            self._c.execute(
                "INSERT INTO grammar_mistakes "
                "(date, grammar_type, sub_type, section, task_type, wrong, correct, explanation,"
                " reviewed, recurrence_count, practice_log_id, treatability, rubric_dimension) "
                "VALUES (?, ?, ?, 'Speaking', 'Take an Interview', ?, ?, ?, 0, 1, ?, ?, ?)",
                (now, normalized, sub_type or "", wrong, correct, explanation, practice_log_id,
                 get_treatability(normalized), get_rubric_dimension(normalized)),
            )

    def upsert_mistake_weakspot(
        self,
        *,
        wrong: str,
        correct: str,
        category: str,
        hint: str,
        sub_type: str = "",
    ) -> None:
        now = now_wib()
        existing = self._c.execute(
            "SELECT id, recurrence_count FROM grammar_mistakes WHERE wrong=? AND task_type='Weak Spot Drill'",
            (wrong,),
        ).fetchone()
        if existing:
            self._c.execute(
                "UPDATE grammar_mistakes SET recurrence_count=recurrence_count+1, date=?, reviewed=0 WHERE id=?",
                (now, existing["id"]),
            )
            self.handle_re_encounter(category)
        else:
            self._c.execute(
                "INSERT INTO grammar_mistakes "
                "(date, grammar_type, sub_type, section, task_type, wrong, correct, explanation,"
                " reviewed, recurrence_count, treatability, rubric_dimension) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)",
                (now, category, sub_type or category, "Grammar", "Weak Spot Drill",
                 wrong, correct, hint,
                 get_treatability(category), get_rubric_dimension(category)),
            )

    def list_mistakes(
        self,
        *,
        page: int = 1,
        page_size: int = 10,
        category: str = "",
        section: str = "",
        task_type: str = "",
        sort: str = "desc",
    ) -> dict:
        offset = (page - 1) * page_size
        conditions = []
        params: list = []
        if category:
            conditions.append("LOWER(grammar_type) = LOWER(?)")
            params.append(category)
        if section:
            conditions.append("LOWER(section) = LOWER(?)")
            params.append(section)
        if task_type:
            conditions.append("LOWER(task_type) = LOWER(?)")
            params.append(task_type)
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        order = "ASC" if sort == "asc" else "DESC"
        total = self._c.execute(
            f"SELECT COUNT(*) FROM grammar_mistakes {where}", params
        ).fetchone()[0]
        rows = self._c.execute(
            f"SELECT id, date, grammar_type as category, sub_type, section, task_type, "
            f"wrong, correct, recurrence_count, reviewed FROM grammar_mistakes {where} "
            f"ORDER BY date {order} LIMIT ? OFFSET ?",
            params + [page_size, offset],
        ).fetchall()
        return {
            "page": page, "page_size": page_size, "total": total,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "rows": [dict(r) for r in rows],
        }

    def get_filter_options(self, section: str = "") -> dict:
        """Return distinct task_types and grammar categories present in the data."""
        section_clause = "AND section = ?" if section else ""
        params: tuple = (section,) if section else ()
        task_types = [
            r[0] for r in self._c.execute(
                "SELECT DISTINCT task_type FROM grammar_mistakes "
                f"WHERE task_type IS NOT NULL {section_clause} ORDER BY task_type",
                params,
            ).fetchall()
        ]
        categories = [
            r[0] for r in self._c.execute(
                "SELECT DISTINCT grammar_type FROM grammar_mistakes "
                f"WHERE grammar_type IS NOT NULL AND grammar_type != 'Listening Accuracy' {section_clause} "
                "ORDER BY grammar_type",
                params,
            ).fetchall()
        ]
        return {"task_types": task_types, "categories": categories}

    def get_by_id(self, mistake_id: int) -> Optional[sqlite3.Row]:
        return self._c.execute(
            "SELECT * FROM grammar_mistakes WHERE id=?", (mistake_id,)
        ).fetchone()

    def get_mistakes_for_session(self, session_id: int) -> list[dict]:
        """Return grammar mistakes for a writing session.
        Prefer practice_log_id FK (new rows); fall back to date-match for old rows.
        """
        rows = self._c.execute(
            """
            SELECT DISTINCT gm.id, gm.grammar_type, gm.sub_type, gm.wrong, gm.correct,
                   gm.explanation, gm.reviewed, gm.recurrence_count
            FROM grammar_mistakes gm
            JOIN practice_log pl ON (
                gm.practice_log_id = pl.id
                OR (gm.practice_log_id IS NULL AND DATE(gm.date) = DATE(pl.date))
            )
            WHERE pl.id = ?
            ORDER BY gm.id
            """,
            (session_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_detail(self, mistake_id: int) -> Optional[dict]:
        """Full row plus recurrence history (all rows with same wrong+grammar_type)."""
        row = self._c.execute(
            "SELECT * FROM grammar_mistakes WHERE id=?", (mistake_id,)
        ).fetchone()
        if not row:
            return None
        detail = dict(row)
        # Recurrence history: all other entries with same wrong sentence
        history = self._c.execute(
            "SELECT id, date, section, task_type, recurrence_count "
            "FROM grammar_mistakes WHERE wrong=? ORDER BY date DESC",
            (detail["wrong"],),
        ).fetchall()
        detail["history"] = [dict(h) for h in history]
        # Murphy units — try specific sub_type first, fall back to category-level (sub_type IS NULL)
        mistake_sub_type = (detail.get("sub_type") or "").strip()
        murphy: list = []
        if mistake_sub_type:
            murphy = self._c.execute(
                "SELECT murphy_unit, murphy_title FROM grammar_topic_map "
                "WHERE category=? AND sub_type=? AND murphy_unit IS NOT NULL ORDER BY murphy_unit",
                (detail["grammar_type"], mistake_sub_type),
            ).fetchall()
            if not murphy:
                logger.debug(
                    "murphy lookup miss: no sub_type match category=%r sub_type=%r id=%s — falling back to broad",
                    detail["grammar_type"], mistake_sub_type, detail.get("id"),
                )
        if not murphy:
            murphy = self._c.execute(
                "SELECT murphy_unit, murphy_title FROM grammar_topic_map "
                "WHERE category=? AND sub_type IS NULL AND murphy_unit IS NOT NULL ORDER BY murphy_unit",
                (detail["grammar_type"],),
            ).fetchall()
            if murphy and mistake_sub_type:
                logger.info(
                    "murphy fallback used: category=%r sub_type=%r id=%s units=%s",
                    detail["grammar_type"], mistake_sub_type, detail.get("id"),
                    [m["murphy_unit"] for m in murphy],
                )
        detail["murphy_units"] = [dict(m) for m in murphy]
        # Audio filename + word-level seek window — only for Speaking mistakes
        detail["audio_filename"] = None
        detail["audio_start"] = None
        detail["audio_end"] = None
        if (detail.get("section") or "").lower() == "speaking":
            mistake_task_type = detail.get("task_type") or "Take an Interview"
            practice_log_id   = detail.get("practice_log_id")
            if practice_log_id:
                sal = self._c.execute(
                    "SELECT audio_filename, words_json FROM speech_analysis_log "
                    "WHERE practice_log_id = ? AND audio_filename IS NOT NULL LIMIT 1",
                    (practice_log_id,),
                ).fetchone()
            else:
                sal = self._c.execute(
                    "SELECT audio_filename, words_json FROM speech_analysis_log "
                    "WHERE audio_filename IS NOT NULL AND DATE(date) = DATE(?) "
                    "AND task_type = ? ORDER BY date DESC LIMIT 1",
                    (detail["date"], mistake_task_type),
                ).fetchone()
            if sal:
                detail["audio_filename"] = sal["audio_filename"]
                words_json = sal["words_json"] if sal["words_json"] else None
                if words_json:
                    try:
                        import json as _json
                        import re as _re
                        from difflib import SequenceMatcher
                        words = _json.loads(words_json)
                        wrong = (detail.get("wrong") or "").strip()
                        if words and wrong:
                            def _norm(s: str) -> list[str]:
                                return _re.sub(r"[^a-z0-9\s]", "", s.lower()).split()
                            wrong_tokens = _norm(wrong)
                            word_flat    = [(_norm(w["word"]) or [""])[0] for w in words]
                            n            = len(wrong_tokens)
                            best_ratio, best_i = -1.0, -1
                            if n <= len(word_flat):
                                for i in range(max(1, len(word_flat) - n + 1)):
                                    window = word_flat[i:i + n]
                                    ratio  = SequenceMatcher(None, wrong_tokens, window).ratio()
                                    if ratio > best_ratio:
                                        best_ratio, best_i = ratio, i
                            if best_i >= 0 and best_ratio >= 0.4:
                                pad = 0.25
                                detail["audio_start"] = max(0.0, round(words[best_i]["start"] - pad, 2))
                                end_i = min(best_i + n - 1, len(words) - 1)
                                detail["audio_end"] = round(words[end_i]["end"] + pad, 2)
                                logger.debug(
                                    "words_json seek ok mistake_id=%s ratio=%.2f start=%.2f end=%.2f",
                                    detail.get("id"), best_ratio,
                                    detail["audio_start"], detail["audio_end"],
                                )
                    except Exception as _e:
                        logger.debug("words_json seek failed mistake_id=%s: %s", detail.get("id"), _e)
        return detail

    def get_adjacent(self, mistake_id: int) -> dict:
        """Return the previous and next mistake IDs relative to the given id."""
        prev_row = self._c.execute(
            "SELECT id FROM grammar_mistakes WHERE id < ? ORDER BY id DESC LIMIT 1",
            (mistake_id,),
        ).fetchone()
        next_row = self._c.execute(
            "SELECT id FROM grammar_mistakes WHERE id > ? ORDER BY id ASC LIMIT 1",
            (mistake_id,),
        ).fetchone()
        return {
            "prev_id": prev_row[0] if prev_row else None,
            "next_id": next_row[0] if next_row else None,
        }

    def mark_reviewed(self, mistake_id: int) -> bool:
        cur = self._c.execute(
            "UPDATE grammar_mistakes SET reviewed=1 WHERE id=?", (mistake_id,)
        )
        return cur.rowcount > 0

    def get_category_examples(self, category: str, limit: int = 3) -> list[dict]:
        rows = self._c.execute(
            "SELECT wrong, correct, sub_type, explanation FROM grammar_mistakes "
            "WHERE grammar_type=? ORDER BY recurrence_count DESC LIMIT ?",
            (category, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_recent_drill_sentences(self, category: str, limit: int = 5) -> list[str]:
        """Return the most recent 'wrong' sentences used in Weak Spot Drills for a category."""
        rows = self._c.execute(
            "SELECT response FROM practice_log "
            "WHERE task_type='Weak Spot Drill' AND tags=? "
            "ORDER BY id DESC LIMIT ?",
            (category, limit),
        ).fetchall()
        return [r[0] for r in rows if r[0]]

    def get_recommendations(self) -> dict:
        """Return top weak categories + SRS due count for the hub recommendation panel."""
        categories = [dict(r) for r in self._c.execute("""
            SELECT grammar_type AS category,
                   COUNT(*) AS mistake_count,
                   SUM(recurrence_count) AS total_recurrences,
                   SUM(CASE WHEN reviewed = 0 THEN 1 ELSE 0 END) AS unreviewed
            FROM grammar_mistakes
            WHERE grammar_type != 'Listening Accuracy'
            GROUP BY grammar_type
            ORDER BY total_recurrences DESC, unreviewed DESC
            LIMIT 5
        """).fetchall()]
        total_mistakes = self._c.execute(
            "SELECT COUNT(*) FROM grammar_mistakes "
            "WHERE grammar_type != 'Listening Accuracy'"
        ).fetchone()[0]
        return {
            "top_categories": categories,
            "total_mistakes": total_mistakes,
        }

    def get_remediation_queue(self) -> dict:
        """Return count of mistakes not yet strengthened and the first pending ID."""
        row = self._c.execute(
            """
            SELECT COUNT(*) AS total, MIN(id) AS first_id
            FROM grammar_mistakes
            WHERE grammar_type != 'Listening Accuracy'
              AND (remediation_status IS NULL OR remediation_status = 'new')
            """
        ).fetchone()
        return {
            "pending": row["total"] if row else 0,
            "first_id": row["first_id"] if row else None,
        }

    # ── Remediation: ReviewAttempts ───────────────────────────────────────────

    def get_for_remediate(self, mistake_id: int) -> Optional[dict]:
        """Return full mistake row enriched with treatability/rubric_dimension.
        Falls back to computing them live if columns are NULL (old rows)."""
        row = self._c.execute(
            "SELECT * FROM grammar_mistakes WHERE id=?", (mistake_id,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        # Back-fill treatability / rubric_dimension if stored as NULL (pre-migration rows)
        if not d.get("treatability"):
            d["treatability"] = get_treatability(d["grammar_type"] or "")
        if not d.get("rubric_dimension"):
            d["rubric_dimension"] = get_rubric_dimension(d["grammar_type"] or "")
        if not d.get("review_stage"):
            d["review_stage"] = 0
        if not d.get("remediation_status"):
            d["remediation_status"] = "new"
        # Fetch previous attempts for this mistake
        attempts = self._c.execute(
            "SELECT id, attempt_type, attempt_text, is_correct, feedback, created_at "
            "FROM review_attempts WHERE grammar_mistake_id=? ORDER BY id",
            (mistake_id,),
        ).fetchall()
        d["review_attempts"] = [dict(a) for a in attempts]
        return d

    def insert_review_attempt(
        self,
        *,
        grammar_mistake_id: int,
        attempt_type: str,
        attempt_text: str,
        is_correct: bool,
        feedback: str = "",
        hint_level_used: int = 0,
    ) -> int:
        """Log a single student attempt. Returns the new attempt id."""
        now = now_wib()
        cur = self._c.execute(
            "INSERT INTO review_attempts "
            "(grammar_mistake_id, attempt_type, attempt_text, is_correct, feedback, created_at, hint_level_used) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (grammar_mistake_id, attempt_type, attempt_text, int(is_correct), feedback, now, hint_level_used),
        )
        return cur.lastrowid  # type: ignore[return-value]

    def set_remediation_status(self, mistake_id: int, status: str) -> None:
        """Update remediation_status. Valid values: new, engaged, mastered."""
        self._c.execute(
            "UPDATE grammar_mistakes SET remediation_status=? WHERE id=?",
            (status, mistake_id),
        )

    def advance_review_stage(self, mistake_id: int) -> int:
        """Increment review_stage (capped at 4) and reschedule next_review_date.
        Returns the new stage.

        Stage → interval:  0→1d, 1→3d, 2→7d, 3→14d, 4+→30d
        """
        INTERVALS = {0: 1, 1: 3, 2: 7, 3: 14, 4: 30}
        row = self._c.execute(
            "SELECT review_stage FROM grammar_mistakes WHERE id=?", (mistake_id,)
        ).fetchone()
        if not row:
            return 0
        current = row["review_stage"] or 0
        new_stage = min(current + 1, 4)
        days = INTERVALS.get(new_stage, 30)
        next_review = wib_date(days)
        self._c.execute(
            "UPDATE grammar_mistakes SET review_stage=?, next_review_date=? WHERE id=?",
            (new_stage, next_review, mistake_id),
        )
        return new_stage

    def handle_re_encounter(self, grammar_type: str) -> int:
        """Called whenever a new mistake of grammar_type is logged in fresh practice.

        Finds all 'engaged' or 'mastered' mistakes of the same type that have
        review_stage > 0, and regresses each by 1 stage (spec §4 failure path).
        Returns the number of rows regressed.
        """
        rows = self._c.execute(
            "SELECT id, review_stage, remediation_status FROM grammar_mistakes "
            "WHERE grammar_type=? AND review_stage > 0 "
            "AND remediation_status IN ('engaged', 'mastered')",
            (grammar_type,),
        ).fetchall()
        if not rows:
            return 0
        tomorrow = wib_date(1)
        count = 0
        last_new_stage = 0
        for row in rows:
            new_stage = max(0, (row["review_stage"] or 1) - 1)
            last_new_stage = new_stage
            # mastered → regress back to engaged
            new_status = "engaged" if row["remediation_status"] == "mastered" else row["remediation_status"]
            self._c.execute(
                "UPDATE grammar_mistakes SET review_stage=?, next_review_date=?, remediation_status=? WHERE id=?",
                (new_stage, tomorrow, new_status, row["id"]),
            )
            count += 1
        if count:
            logger.info(
                "re_encounter regress grammar_type=%r rows=%d last_new_stage=%d",
                grammar_type, count, last_new_stage,
            )
        return count

    def get_remediation_trends(self) -> list[dict]:
        """Return per-error-type trend data for the progress panel.

        Only includes grammar_types that have at least one remediated mistake
        (review_stage > 0 or remediation_status != 'new').
        Trend signal: compare recurrences in last 14 days vs prior 14 days.
        """
        rows = self._c.execute("""
            SELECT
                grammar_type,
                MAX(remediation_status) AS remediation_status,
                MAX(review_stage)       AS review_stage,
                COUNT(*)                AS total_mistakes,
                SUM(recurrence_count)   AS total_recurrences,
                SUM(CASE WHEN date >= date('now', '-14 days')
                         THEN recurrence_count ELSE 0 END) AS recent_14d,
                SUM(CASE WHEN date >= date('now', '-28 days')
                         AND  date <  date('now', '-14 days')
                         THEN recurrence_count ELSE 0 END) AS prev_14d
            FROM grammar_mistakes
            WHERE review_stage > 0
               OR remediation_status IN ('engaged', 'mastered')
            GROUP BY grammar_type
            ORDER BY review_stage DESC, total_recurrences DESC
        """).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            recent = d["recent_14d"] or 0
            prev   = d["prev_14d"] or 0
            if prev == 0 and recent == 0:
                trend = "stable"
            elif prev == 0:
                trend = "regressing"
            elif recent == 0:
                trend = "improving"
            elif recent < prev:
                trend = "improving"
            elif recent > prev:
                trend = "regressing"
            else:
                trend = "stable"
            d["trend"] = trend
            result.append(d)
        return result

    # ── SRS review queue ──────────────────────────────────────────────────────

    def get_srs_due(self, limit: int = 20) -> list[dict]:
        """Return mistakes due for spaced review today.

        Ordered: engaged/mastered with earlier review_stage first (hardest first),
        then any with NULL next_review_date that are engaged.
        """
        today = today_wib()
        rows = self._c.execute(
            """
            SELECT id, grammar_type, sub_type, section, task_type,
                   wrong, correct, explanation,
                   review_stage, remediation_status, next_review_date,
                   recurrence_count, treatability, rubric_dimension
            FROM grammar_mistakes
            WHERE remediation_status IN ('engaged', 'mastered')
              AND (next_review_date IS NULL OR next_review_date <= ?)
              AND grammar_type != 'Listening Accuracy'
            ORDER BY review_stage ASC, next_review_date ASC
            LIMIT ?
            """,
            (today, limit),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if not d.get("treatability"):
                d["treatability"] = get_treatability(d["grammar_type"] or "")
            if not d.get("rubric_dimension"):
                d["rubric_dimension"] = get_rubric_dimension(d["grammar_type"] or "")
            result.append(d)
        return result

    def get_srs_due_count(self) -> int:
        today = today_wib()
        return self._c.execute(
            """
            SELECT COUNT(*) FROM grammar_mistakes
            WHERE remediation_status IN ('engaged', 'mastered')
              AND (next_review_date IS NULL OR next_review_date <= ?)
              AND grammar_type != 'Listening Accuracy'
            """,
            (today,),
        ).fetchone()[0]

    def rate_srs_item(self, mistake_id: int, passed: bool) -> dict:
        """Process a review rating for a single SRS card.

        passed=True  → advance_review_stage (success path)
        passed=False → regress stage by 1, reschedule to tomorrow
        Returns {"new_stage": int, "next_review_date": str, "remediation_status": str}
        """
        row = self._c.execute(
            "SELECT review_stage, remediation_status FROM grammar_mistakes WHERE id=?",
            (mistake_id,),
        ).fetchone()
        if not row:
            return {}
        if passed:
            new_stage = self.advance_review_stage(mistake_id)
            new_status = "mastered" if new_stage >= 4 else "engaged"
            self._c.execute(
                "UPDATE grammar_mistakes SET remediation_status=? WHERE id=?",
                (new_status, mistake_id),
            )
        else:
            current = row["review_stage"] or 1
            new_stage = max(0, current - 1)
            tomorrow = wib_date(1)
            new_status = "engaged"
            self._c.execute(
                "UPDATE grammar_mistakes SET review_stage=?, next_review_date=?, remediation_status=? WHERE id=?",
                (new_stage, tomorrow, new_status, mistake_id),
            )
        updated = self._c.execute(
            "SELECT review_stage, next_review_date, remediation_status FROM grammar_mistakes WHERE id=?",
            (mistake_id,),
        ).fetchone()
        return dict(updated) if updated else {}

    def get_writing_focus(self) -> list[dict]:
        """Return grammar types due for spaced review today that have
        elicitation hints, for the writing focus panel.

        Returns up to 3 canonical grammar_types ordered by review_stage ASC
        (lowest stage = hardest = most needs practice).
        """
        from app.utils.grammar import get_grammar_focus_hints
        today = today_wib()
        rows = self._c.execute(
            """
            SELECT grammar_type, MAX(review_stage) as review_stage
            FROM grammar_mistakes
            WHERE remediation_status IN ('engaged', 'mastered')
              AND (next_review_date IS NULL OR next_review_date <= ?)
              AND grammar_type != 'Listening Accuracy'
            GROUP BY grammar_type
            ORDER BY review_stage ASC
            LIMIT 10
            """,
            (today,),
        ).fetchall()
        types = [r["grammar_type"] for r in rows]
        return get_grammar_focus_hints(types)

    # ── Transfer tests ────────────────────────────────────────────────────────

    def get_pending_transfer_tests(self) -> list[dict]:
        """Return all pending transfer tests, newest first."""
        rows = self._c.execute(
            "SELECT id, grammar_type, drill_accuracy, target_task_type, date_created "
            "FROM transfer_test WHERE status='pending' ORDER BY date_created DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def create_transfer_test(
        self,
        *,
        grammar_type: str,
        drill_accuracy: float,
        target_task_type: str,
    ) -> int:
        """Create a pending transfer test if one doesn't already exist for this grammar_type.
        Returns the id of the existing or new row."""
        existing = self._c.execute(
            "SELECT id FROM transfer_test WHERE grammar_type=? AND status='pending'",
            (grammar_type,),
        ).fetchone()
        if existing:
            return existing["id"]
        now = now_wib()
        cur = self._c.execute(
            "INSERT INTO transfer_test (date_created, grammar_type, drill_accuracy, target_task_type, status) "
            "VALUES (?, ?, ?, ?, 'pending')",
            (now, grammar_type, drill_accuracy, target_task_type),
        )
        return cur.lastrowid  # type: ignore[return-value]

    def get_drill_accuracy(self, grammar_type: str) -> float:
        """Return the overall drill accuracy for a grammar type (0.0 if untested)."""
        row = self._c.execute(
            "SELECT SUM(attempts) as total, SUM(correct) as correct "
            "FROM grammar_performance WHERE grammar_type=?",
            (grammar_type,),
        ).fetchone()
        if not row or not row["total"]:
            return 0.0
        return round(row["correct"] / row["total"], 3)
