"""SQLite connection factory.

Each request should call get_db(), use the connection, then close it.
Row factory is set so rows behave like dicts.
"""
import sqlite3
from contextlib import contextmanager
from typing import Generator

from app.core.config import TOEFL_DB_PATH
from app.db.migrations import _MIGRATIONS


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(TOEFL_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def db_context() -> Generator[sqlite3.Connection, None, None]:
    """Context manager that commits on success and rolls back on error."""
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def run_migrations() -> None:
    """Apply idempotent DDL migrations at startup."""
    with db_context() as conn:
        for stmt in _MIGRATIONS:
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError as e:
                # ALTER TABLE ADD COLUMN fails if column already exists — safe to ignore
                if "duplicate column name" in str(e).lower():
                    pass
                else:
                    raise
