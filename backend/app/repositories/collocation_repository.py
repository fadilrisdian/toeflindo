"""Repository for collocation notebook items (Leitner spaced review)."""
import sqlite3
from typing import Optional

from app.utils.time import now_wib, wib_date

# Leitner box → review interval in days
_BOX_INTERVALS = {1: 1, 2: 3, 3: 7, 4: 14, 5: 30}


class CollocationRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._c = conn

    def add(self, *, phrase: str, source: str = "") -> int:
        """Add a new phrase to box 1, due today so it appears in the next review session."""
        cur = self._c.execute(
            "INSERT INTO collocation_items (phrase, source, date_added, box_level, next_review_date)"
            " VALUES (?, ?, ?, 1, ?)",
            (phrase.strip(), source, now_wib(), wib_date(0)),
        )
        return cur.lastrowid  # type: ignore[return-value]

    def list_due(self, limit: int = 5) -> list[dict]:
        """Return items whose next_review_date <= today, oldest first."""
        rows = self._c.execute(
            "SELECT id, phrase, source, box_level, next_review_date, review_count"
            " FROM collocation_items"
            " WHERE next_review_date <= ?"
            " ORDER BY next_review_date ASC LIMIT ?",
            (wib_date(0), limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def due_count(self) -> int:
        row = self._c.execute(
            "SELECT COUNT(*) FROM collocation_items WHERE next_review_date <= ?",
            (wib_date(0),),
        ).fetchone()
        return row[0]

    def all_items(self) -> list[dict]:
        rows = self._c.execute(
            "SELECT id, phrase, source, box_level, next_review_date, review_count"
            " FROM collocation_items ORDER BY id DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def advance(self, item_id: int) -> None:
        """Correct → move up one box (max 5), schedule next review."""
        row = self._c.execute(
            "SELECT box_level FROM collocation_items WHERE id=?", (item_id,)
        ).fetchone()
        if not row:
            return
        new_box = min(row["box_level"] + 1, 5)
        interval = _BOX_INTERVALS[new_box]
        self._c.execute(
            "UPDATE collocation_items"
            " SET box_level=?, next_review_date=?, review_count=review_count+1"
            " WHERE id=?",
            (new_box, wib_date(interval), item_id),
        )

    def reset(self, item_id: int) -> None:
        """Incorrect → drop back to box 1, due tomorrow."""
        self._c.execute(
            "UPDATE collocation_items"
            " SET box_level=1, next_review_date=?, review_count=review_count+1"
            " WHERE id=?",
            (wib_date(1), item_id),
        )

    def get(self, item_id: int) -> Optional[dict]:
        row = self._c.execute(
            "SELECT id, phrase, source, box_level, next_review_date, review_count"
            " FROM collocation_items WHERE id=?",
            (item_id,),
        ).fetchone()
        return dict(row) if row else None
