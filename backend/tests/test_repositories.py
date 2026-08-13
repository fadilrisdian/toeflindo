"""Tests for PracticeRepository and GrammarRepository."""
import sqlite3

import pytest

from app.repositories.grammar_repository import GrammarRepository
from app.repositories.practice_repository import PracticeRepository


# ── PracticeRepository ────────────────────────────────────────────────────────

class TestPracticeRepository:

    def test_insert_and_list_writing(self, in_memory_db: sqlite3.Connection):
        repo = PracticeRepository(in_memory_db)
        pid = repo.insert_practice(
            section="Writing", task_type="Write an Email",
            prompt="Write to your boss", response="Dear Sir...",
            score=5.0, feedback="Good structure",
        )
        assert isinstance(pid, int) and pid > 0

        result = repo.list_writing_sessions(page=1, page_size=10)
        assert result["total"] == 1
        assert result["rows"][0]["task_type"] == "Write an Email"
        assert result["rows"][0]["score"] == 5.0

    def test_list_writing_pagination(self, in_memory_db: sqlite3.Connection):
        repo = PracticeRepository(in_memory_db)
        for i in range(5):
            repo.insert_practice(
                section="Writing", task_type="Write an Email",
                prompt=f"p{i}", response=f"r{i}",
                score=float(i + 1), feedback="ok",
            )
        in_memory_db.commit()

        page1 = repo.list_writing_sessions(page=1, page_size=3)
        page2 = repo.list_writing_sessions(page=2, page_size=3)
        assert page1["total"] == 5
        assert len(page1["rows"]) == 3
        assert len(page2["rows"]) == 2
        assert page1["total_pages"] == 2

    def test_list_writing_by_task_type_filter(self, in_memory_db: sqlite3.Connection):
        repo = PracticeRepository(in_memory_db)
        repo.insert_practice(section="Writing", task_type="Write an Email",
                             prompt="p", response="r", score=5.0, feedback="ok")
        repo.insert_practice(section="Writing", task_type="Discussion",
                             prompt="p", response="r", score=4.0, feedback="ok")
        in_memory_db.commit()

        result = repo.list_writing_sessions(task_type="Write an Email")
        assert result["total"] == 1
        assert result["rows"][0]["task_type"] == "Write an Email"

    def test_insert_and_list_speaking(self, in_memory_db: sqlite3.Connection):
        repo = PracticeRepository(in_memory_db)
        pid = repo.insert_practice(
            section="Speaking", task_type="Listen and Repeat",
            prompt="Welcome to the library", response="Welcome to the library",
            score=5.0, feedback="Accurate", tags="speaking,listen-repeat,campus",
        )
        in_memory_db.commit()

        result = repo.list_speaking_sessions(task_type="Listen and Repeat")
        assert result["total"] == 1
        assert result["rows"][0]["id"] == pid

    def test_get_task_missing(self, in_memory_db: sqlite3.Connection):
        repo = PracticeRepository(in_memory_db)
        assert repo.get_task(9999) is None

    def test_list_tasks_empty(self, in_memory_db: sqlite3.Connection):
        repo = PracticeRepository(in_memory_db)
        result = repo.list_tasks()
        assert result["total"] == 0
        assert result["rows"] == []

    def test_list_tasks_with_filter(self, in_memory_db: sqlite3.Connection):
        in_memory_db.execute(
            "INSERT INTO task_bank (task_type, question, answer, tags) VALUES (?,?,?,?)",
            ("Listen and Repeat", "Hello world", "Hello world", "speaking,listen-repeat,general"),
        )
        in_memory_db.execute(
            "INSERT INTO task_bank (task_type, question, answer, tags) VALUES (?,?,?,?)",
            ("Take an Interview", "Tell me about yourself", "...", "speaking,interview,general"),
        )
        in_memory_db.commit()

        repo = PracticeRepository(in_memory_db)
        result = repo.list_tasks(task_type="Listen and Repeat")
        assert result["total"] == 1
        assert result["rows"][0]["task_type"] == "Listen and Repeat"

    def test_insert_speech_log(self, in_memory_db: sqlite3.Connection):
        repo = PracticeRepository(in_memory_db)
        pid = repo.insert_practice(
            section="Speaking", task_type="Listen and Repeat",
            prompt="Hello", response="Hello", score=5.0, feedback="Good",
        )
        in_memory_db.commit()

        repo.insert_speech_log(
            practice_log_id=pid, filename="rec_1.webm",
            transcript="Hello", overall_score=4.8,
            pronunciation_score=5, fluency_score=4,
            grammar_score=6, vocabulary_score=4, intonation_score=4,
            wpm=130.0, cefr_level="B2",
            task_type="Listen and Repeat", topic="greeting",
            expected_answer="Hello",
        )
        in_memory_db.commit()

        row = in_memory_db.execute(
            "SELECT * FROM speech_analysis_log WHERE practice_log_id=?", (pid,)
        ).fetchone()
        assert row is not None
        assert row["transcript"] == "Hello"
        assert row["overall_score"] == 4.8

    def test_upsert_study_log_new(self, in_memory_db: sqlite3.Connection):
        repo = PracticeRepository(in_memory_db)
        repo.upsert_study_log(topic_id=1, topic_title="Conditionals", score=5.0)
        in_memory_db.commit()

        row = in_memory_db.execute(
            "SELECT * FROM study_logs WHERE topic_title='Conditionals'"
        ).fetchone()
        assert row is not None
        assert row["attempts"] == 1
        assert row["accuracy_rate"] == 1.0

    def test_upsert_study_log_increments(self, in_memory_db: sqlite3.Connection):
        repo = PracticeRepository(in_memory_db)
        repo.upsert_study_log(topic_id=1, topic_title="Conditionals", score=5.0)
        repo.upsert_study_log(topic_id=1, topic_title="Conditionals", score=1.0)
        in_memory_db.commit()

        row = in_memory_db.execute(
            "SELECT * FROM study_logs WHERE topic_title='Conditionals'"
        ).fetchone()
        assert row["attempts"] == 2


# ── GrammarRepository ─────────────────────────────────────────────────────────

class TestGrammarRepository:

    def test_upsert_mistake_insert(self, in_memory_db: sqlite3.Connection):
        repo = GrammarRepository(in_memory_db)
        repo.upsert_mistake(
            section="Writing", task_type="Write an Email",
            grammar_type="Verb Tense Error", sub_type="",
            wrong="I goes to school", correct="I go to school",
            explanation="Subject-verb agreement error",
        )
        in_memory_db.commit()

        rows = in_memory_db.execute("SELECT * FROM grammar_mistakes").fetchall()
        assert len(rows) == 1
        assert rows[0]["wrong"] == "I goes to school"
        assert rows[0]["recurrence_count"] == 1

    def test_upsert_mistake_increments_recurrence(self, in_memory_db: sqlite3.Connection):
        repo = GrammarRepository(in_memory_db)
        for _ in range(3):
            repo.upsert_mistake(
                section="Writing", task_type="Write an Email",
                grammar_type="Verb Tense Error", sub_type="",
                wrong="I goes to school", correct="I go to school",
                explanation="Subject-verb agreement error",
            )
        in_memory_db.commit()

        row = in_memory_db.execute("SELECT * FROM grammar_mistakes").fetchone()
        assert row["recurrence_count"] == 3

    def test_list_mistakes_empty(self, in_memory_db: sqlite3.Connection):
        repo = GrammarRepository(in_memory_db)
        result = repo.list_mistakes()
        assert result["total"] == 0
        assert result["rows"] == []

    def test_list_mistakes_section_filter(self, in_memory_db: sqlite3.Connection):
        repo = GrammarRepository(in_memory_db)
        repo.upsert_mistake(section="Writing", task_type="Write an Email",
                            grammar_type="Article Error", sub_type="",
                            wrong="a apple", correct="an apple", explanation="")
        repo.upsert_mistake(section="Speaking", task_type="Take an Interview",
                            grammar_type="Verb Tense Error", sub_type="",
                            wrong="I goed", correct="I went", explanation="")
        in_memory_db.commit()

        result = repo.list_mistakes(section="Writing")
        assert result["total"] == 1
        assert result["rows"][0]["section"] == "Writing"

    def test_upsert_mistake_speaking(self, in_memory_db: sqlite3.Connection):
        repo = GrammarRepository(in_memory_db)
        repo.upsert_mistake_speaking(
            wrong="I goed to school",
            correct="I went to school",
            grammar_type="Verb Tense Error",
            sub_type="past simple",
            explanation="Irregular past tense",
        )
        in_memory_db.commit()

        row = in_memory_db.execute("SELECT * FROM grammar_mistakes").fetchone()
        assert row["section"] == "Speaking"
        assert row["task_type"] == "Take an Interview"
