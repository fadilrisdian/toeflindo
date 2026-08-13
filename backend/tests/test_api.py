"""API integration tests — health, auth, speaking, writing, grammar endpoints."""
import sqlite3

import pytest
from fastapi.testclient import TestClient


# ── Health ────────────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_ok(self, client: TestClient):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


# ── Auth ──────────────────────────────────────────────────────────────────────

class TestAuth:
    def test_login_success(self, client: TestClient, monkeypatch):
        # Ensure AUTH_PASS and SECRET_KEY are set regardless of host environment
        monkeypatch.setenv("AUTH_PASS", "fadil123")
        monkeypatch.setenv("SECRET_KEY", "test-secret-key-for-pytest")
        r = client.post("/api/auth/login", data={"username": "fadil", "password": "fadil123"})
        assert r.status_code == 200

    def test_login_wrong_password(self, client: TestClient):
        r = client.post("/api/auth/login", data={"username": "fadil", "password": "wrong"})
        assert r.status_code == 401

    def test_login_wrong_user(self, client: TestClient):
        r = client.post("/api/auth/login", data={"username": "notauser", "password": "fadil123"})
        assert r.status_code == 401

    def test_protected_without_token(self):
        """No auth override — raw app should reject unauthenticated requests."""
        from fastapi.testclient import TestClient as RawClient
        from app.main import app as raw_app
        with RawClient(app=raw_app) as c:
            r = c.get("/api/speaking/listen-repeat")
        assert r.status_code == 401

    def test_me_endpoint(self, client: TestClient):
        r = client.get("/api/auth/me")
        assert r.status_code == 200


# ── Speaking ──────────────────────────────────────────────────────────────────

class TestSpeakingEndpoints:

    def test_listen_repeat_empty(self, client: TestClient):
        r = client.get("/api/speaking/listen-repeat")
        assert r.status_code == 200
        data = r.json()
        assert "rows" in data
        assert data["total"] == 0

    def test_interview_empty(self, client: TestClient):
        r = client.get("/api/speaking/interview")
        assert r.status_code == 200
        assert r.json()["total"] == 0

    def test_mistakes_empty(self, client: TestClient):
        r = client.get("/api/speaking/mistakes")
        assert r.status_code == 200
        assert r.json()["total"] == 0

    def test_recommended_no_tasks(self, client: TestClient):
        r = client.get("/api/speaking/recommended?task_type=Listen+and+Repeat")
        assert r.status_code == 200
        data = r.json()
        assert "task_id" in data

    def test_recommended_with_task(self, client: TestClient, in_memory_db: sqlite3.Connection):
        in_memory_db.execute(
            "INSERT INTO task_bank (task_type, question, answer, tags) VALUES (?,?,?,?)",
            ("Listen and Repeat", "Hello world", "Hello world", "speaking,listen-repeat,general"),
        )
        in_memory_db.commit()
        r = client.get("/api/speaking/recommended?task_type=Listen+and+Repeat")
        assert r.status_code == 200
        data = r.json()
        assert data["task_id"] is not None

    def test_analyzer_history_empty(self, client: TestClient):
        r = client.get("/api/speaking/analyzer/history")
        assert r.status_code == 200
        assert r.json()["sessions"] == []

    def test_analyzer_history_session_not_found(self, client: TestClient):
        r = client.get("/api/speaking/analyzer/history/9999")
        assert r.status_code == 404

    def test_analyzer_data(self, client: TestClient):
        r = client.get("/api/speaking/analyzer-data")
        assert r.status_code == 200

    def test_audio_missing_path(self, client: TestClient):
        r = client.get("/api/speaking/audio")
        assert r.status_code == 400

    def test_audio_path_traversal_blocked(self, client: TestClient):
        r = client.get("/api/speaking/audio?path=../../etc/passwd")
        assert r.status_code in (403, 404)

    def test_recording_not_found(self, client: TestClient):
        r = client.get("/api/speaking/recording/nonexistent.webm")
        assert r.status_code == 404

    def test_recording_invalid_filename(self, client: TestClient):
        r = client.get("/api/speaking/recording/../etc/passwd")
        assert r.status_code in (400, 404)

    def test_listen_repeat_pagination(self, client: TestClient, in_memory_db: sqlite3.Connection):
        from app.repositories.practice_repository import PracticeRepository
        repo = PracticeRepository(in_memory_db)
        for i in range(5):
            repo.insert_practice(
                section="Speaking", task_type="Listen and Repeat",
                prompt=f"sentence {i}", response=f"sentence {i}",
                score=float(i + 1), feedback="ok",
                tags="speaking,listen-repeat,test",
            )
        in_memory_db.commit()

        r = client.get("/api/speaking/listen-repeat?page=1&page_size=3")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 5
        assert len(data["rows"]) == 3


# ── Writing ───────────────────────────────────────────────────────────────────

class TestWritingEndpoints:

    def test_list_writing_empty(self, client: TestClient):
        r = client.get("/api/writing/sessions")
        assert r.status_code == 200
        data = r.json()
        assert "rows" in data
        assert data["total"] == 0

    def test_writing_mistakes_empty(self, client: TestClient):
        r = client.get("/api/writing/mistakes")
        assert r.status_code == 200
        assert r.json()["total"] == 0


# ── Grammar ───────────────────────────────────────────────────────────────────

class TestGrammarEndpoints:

    def test_mistakes_empty(self, client: TestClient):
        r = client.get("/api/grammar/mistakes")
        assert r.status_code == 200
        assert r.json()["total"] == 0

    def test_mistakes_with_data(self, client: TestClient, in_memory_db: sqlite3.Connection):
        in_memory_db.execute(
            "INSERT INTO grammar_mistakes (date, grammar_type, wrong, correct, section, task_type, recurrence_count) "
            "VALUES ('2026-07-16', 'Article Error', 'a apple', 'an apple', 'Writing', 'Write an Email', 1)"
        )
        in_memory_db.commit()

        r = client.get("/api/grammar/mistakes")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 1
        assert data["rows"][0]["wrong"] == "a apple"

    def test_mistakes_category_filter(self, client: TestClient, in_memory_db: sqlite3.Connection):
        in_memory_db.executemany(
            "INSERT INTO grammar_mistakes (date, grammar_type, wrong, correct, section, task_type, recurrence_count) "
            "VALUES (?, ?, ?, ?, ?, ?, 1)",
            [
                ("2026-07-16", "Article Error", "a apple", "an apple", "Writing", "Write an Email"),
                ("2026-07-16", "Verb Tense Error", "I goed", "I went", "Speaking", "Take an Interview"),
            ]
        )
        in_memory_db.commit()

        r = client.get("/api/grammar/mistakes?category=Article+Error")
        assert r.status_code == 200
        assert r.json()["total"] == 1


# ── Dashboard ─────────────────────────────────────────────────────────────────

class TestDashboardEndpoints:

    def test_dashboard_summary(self, client: TestClient):
        r = client.get("/api/dashboard/summary")
        assert r.status_code == 200

    def test_dashboard_writing_kpis(self, client: TestClient):
        r = client.get("/api/dashboard/writing")
        assert r.status_code == 200

    def test_dashboard_speaking_kpis(self, client: TestClient):
        r = client.get("/api/dashboard/speaking")
        assert r.status_code == 200


# ── Grammar — Remediation Queue & Transfer Tests ──────────────────────────────

class TestGrammarRemediationQueue:

    def test_queue_empty(self, client: TestClient):
        r = client.get("/api/grammar/remediation-queue")
        assert r.status_code == 200
        data = r.json()
        assert data["pending"] == 0
        assert data["first_id"] is None

    def test_queue_with_mistake(self, client: TestClient, in_memory_db: sqlite3.Connection):
        in_memory_db.execute(
            "INSERT INTO grammar_mistakes (date, grammar_type, wrong, correct, recurrence_count, remediation_status) "
            "VALUES ('2026-07-16', 'Article Error', 'a apple', 'an apple', 1, 'new')"
        )
        in_memory_db.commit()
        r = client.get("/api/grammar/remediation-queue")
        assert r.status_code == 200
        data = r.json()
        assert data["pending"] == 1
        assert data["first_id"] is not None

    def test_queue_excludes_engaged(self, client: TestClient, in_memory_db: sqlite3.Connection):
        in_memory_db.executemany(
            "INSERT INTO grammar_mistakes (date, grammar_type, wrong, correct, recurrence_count, remediation_status) "
            "VALUES (?, ?, ?, ?, 1, ?)",
            [
                ("2026-07-16", "Article Error", "a apple", "an apple", "new"),
                ("2026-07-16", "Verb Tense Error", "I goed", "I went", "engaged"),
            ],
        )
        in_memory_db.commit()
        r = client.get("/api/grammar/remediation-queue")
        assert r.status_code == 200
        assert r.json()["pending"] == 1  # only the 'new' one


class TestGrammarTransferTests:

    def test_transfer_tests_empty(self, client: TestClient):
        r = client.get("/api/grammar/transfer-tests")
        assert r.status_code == 200
        assert r.json()["pending"] == []

    def test_transfer_tests_returns_pending(self, client: TestClient, in_memory_db: sqlite3.Connection):
        in_memory_db.execute(
            "INSERT INTO transfer_test (date_created, grammar_type, drill_accuracy, target_task_type, status) "
            "VALUES ('2026-07-16', 'Article Error', 85.0, 'Write for an Academic Discussion', 'pending')"
        )
        in_memory_db.commit()
        r = client.get("/api/grammar/transfer-tests")
        assert r.status_code == 200
        data = r.json()
        assert len(data["pending"]) == 1
        assert data["pending"][0]["grammar_type"] == "Article Error"

    def test_transfer_tests_excludes_passed(self, client: TestClient, in_memory_db: sqlite3.Connection):
        in_memory_db.executemany(
            "INSERT INTO transfer_test (date_created, grammar_type, drill_accuracy, target_task_type, status) "
            "VALUES (?, ?, 85.0, 'Write for an Academic Discussion', ?)",
            [
                ("2026-07-16", "Article Error", "pending"),
                ("2026-07-16", "Verb Tense Error", "passed"),
            ],
        )
        in_memory_db.commit()
        r = client.get("/api/grammar/transfer-tests")
        assert r.status_code == 200
        assert len(r.json()["pending"]) == 1


class TestGrammarMistakeReview:

    def test_mark_reviewed_ok(self, client: TestClient, in_memory_db: sqlite3.Connection):
        in_memory_db.execute(
            "INSERT INTO grammar_mistakes (date, grammar_type, wrong, correct, recurrence_count) "
            "VALUES ('2026-07-16', 'Article Error', 'a apple', 'an apple', 1)"
        )
        in_memory_db.commit()
        mid = in_memory_db.execute("SELECT last_insert_rowid()").fetchone()[0]
        r = client.post(f"/api/grammar/mistakes/{mid}/review", json={})
        assert r.status_code == 200
        assert r.json()["ok"] is True
        row = in_memory_db.execute("SELECT reviewed FROM grammar_mistakes WHERE id=?", (mid,)).fetchone()
        assert row[0] == 1

    def test_mark_reviewed_not_found(self, client: TestClient):
        r = client.post("/api/grammar/mistakes/9999/review", json={})
        assert r.status_code == 404


# ── Remediate Router ──────────────────────────────────────────────────────────

class TestRemediateEndpoints:

    def _insert_mistake(self, db: sqlite3.Connection) -> int:
        db.execute(
            "INSERT INTO grammar_mistakes "
            "(date, grammar_type, wrong, correct, section, task_type, recurrence_count, "
            "treatability, rubric_dimension, review_stage, remediation_status) "
            "VALUES ('2026-07-16', 'Subject-Verb Agreement', 'She go to school', 'She goes to school', "
            "'Writing', 'Write an Email', 1, 'treatable', 'grammar', 0, 'new')"
        )
        db.commit()
        return db.execute("SELECT last_insert_rowid()").fetchone()[0]

    def test_get_detail(self, client: TestClient, in_memory_db: sqlite3.Connection):
        mid = self._insert_mistake(in_memory_db)
        r = client.get(f"/api/remediate/{mid}")
        assert r.status_code == 200
        data = r.json()
        assert data["grammar_type"] == "Subject-Verb Agreement"
        assert isinstance(data["review_attempts"], list)

    def test_get_detail_not_found(self, client: TestClient):
        r = client.get("/api/remediate/9999")
        assert r.status_code == 404

    def test_self_correct(self, client: TestClient, in_memory_db: sqlite3.Connection, monkeypatch):
        mid = self._insert_mistake(in_memory_db)
        monkeypatch.setattr(
            "app.api.routers.remediate.evaluate_grammar",
            lambda **_kw: {"verdict": "correct", "feedback": "Well done!"},
        )
        monkeypatch.setattr(
            "app.api.routers.remediate.build_remediation_feedback",
            lambda **_kw: {"rule": "Subject must agree with verb.", "model_sentences": []},
        )
        r = client.post(
            f"/api/remediate/{mid}/self-correct",
            json={"attempt_text": "She goes to school", "hint_level_used": 0},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["verdict"] == "correct"
        assert "rule" in data
        assert data["correct"] == "She goes to school"

    def test_self_correct_not_found(self, client: TestClient):
        r = client.post("/api/remediate/9999/self-correct", json={"attempt_text": "test", "hint_level_used": 0})
        assert r.status_code == 404

    def test_get_prompts(self, client: TestClient, in_memory_db: sqlite3.Connection, monkeypatch):
        mid = self._insert_mistake(in_memory_db)
        monkeypatch.setattr(
            "app.api.routers.remediate.generate_remediation_prompts",
            lambda **_kw: ["Write about your job.", "Write about school.", "Write about daily life."],
        )
        r = client.get(f"/api/remediate/{mid}/prompts")
        assert r.status_code == 200
        data = r.json()
        assert len(data["prompts"]) == 3

    def test_get_prompts_not_found(self, client: TestClient):
        r = client.get("/api/remediate/9999/prompts")
        assert r.status_code == 404

    def test_check_sentence(self, client: TestClient, in_memory_db: sqlite3.Connection, monkeypatch):
        mid = self._insert_mistake(in_memory_db)
        monkeypatch.setattr(
            "app.api.routers.remediate.check_student_sentence",
            lambda **_kw: {"verdict": "correct", "feedback": "Good job!"},
        )
        r = client.post(
            f"/api/remediate/{mid}/check",
            json={"student_sentence": "She goes to the office every day.", "prompt": "Write about your job."},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["verdict"] == "correct"
        assert "feedback" in data

    def test_check_sentence_not_found(self, client: TestClient, monkeypatch):
        monkeypatch.setattr(
            "app.api.routers.remediate.check_student_sentence",
            lambda **_kw: {"verdict": "correct", "feedback": "ok"},
        )
        r = client.post(
            "/api/remediate/9999/check",
            json={"student_sentence": "test", "prompt": "test prompt"},
        )
        assert r.status_code == 404

    def test_complete_requires_attempt(self, client: TestClient, in_memory_db: sqlite3.Connection):
        mid = self._insert_mistake(in_memory_db)
        r = client.post(f"/api/remediate/{mid}/complete", json={})
        assert r.status_code == 400

    def test_complete_after_new_sentence_attempt(self, client: TestClient, in_memory_db: sqlite3.Connection):
        mid = self._insert_mistake(in_memory_db)
        in_memory_db.execute(
            "INSERT INTO review_attempts (grammar_mistake_id, attempt_type, attempt_text, is_correct, created_at, hint_level_used) "
            "VALUES (?, 'new_sentence', 'She goes to school every day.', 1, '2026-07-16T10:00:00', 0)",
            (mid,),
        )
        in_memory_db.commit()
        r = client.post(f"/api/remediate/{mid}/complete", json={})
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["remediation_status"] == "engaged"
        row = in_memory_db.execute(
            "SELECT remediation_status FROM grammar_mistakes WHERE id=?", (mid,)
        ).fetchone()
        assert row[0] == "engaged"

    def test_complete_not_found(self, client: TestClient):
        r = client.post("/api/remediate/9999/complete", json={})
        assert r.status_code == 404


# ── Focus Drills ──────────────────────────────────────────────────────────────

class TestFocusDrillsEndpoints:

    def test_collocation_items_empty(self, client: TestClient):
        r = client.get("/api/focus-drills/collocation/items")
        assert r.status_code == 200
        data = r.json()
        assert data["items"] == []
        assert data["due_count"] == 0

    def test_collocation_add(self, client: TestClient):
        r = client.post("/api/focus-drills/collocation/add", json={"phrase": "carry out", "source": "test"})
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["id"] is not None

    def test_collocation_add_empty_phrase(self, client: TestClient):
        r = client.post("/api/focus-drills/collocation/add", json={"phrase": "  "})
        assert r.status_code == 400

    def test_collocation_items_after_add(self, client: TestClient, in_memory_db):
        in_memory_db.execute(
            "INSERT INTO collocation_items (phrase, source, date_added, box_level, next_review_date, review_count) "
            "VALUES ('carry out', 'test', '2026-07-16 10:00:00', 1, '2026-07-16', 0)"
        )
        in_memory_db.commit()
        r = client.get("/api/focus-drills/collocation/items")
        assert r.status_code == 200
        assert len(r.json()["items"]) == 1

    def test_collocation_due_empty(self, client: TestClient):
        r = client.get("/api/focus-drills/collocation/due")
        assert r.status_code == 200
        assert r.json()["found"] is False

    def test_phrase_bank(self, client: TestClient):
        r = client.get("/api/focus-drills/phrase-bank")
        assert r.status_code == 200
        data = r.json()
        # phrase bank is static JSON — just verify shape
        assert isinstance(data, (dict, list))


# ── Admin Endpoints ───────────────────────────────────────────────────────────

class TestAdminEndpoints:

    def test_answer_stats_empty(self, client: TestClient):
        r = client.get("/api/admin/answer-stats")
        assert r.status_code == 200
        assert r.json()["rows"] == []

    def test_list_tasks_empty(self, client: TestClient):
        r = client.get("/api/admin/tasks")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 0
        assert data["rows"] == []

    def test_create_task(self, client: TestClient):
        r = client.post("/api/admin/tasks", json={
            "task_type": "Listen and Repeat",
            "question": "Hello world",
            "answer": "Hello world",
            "tags": "speaking,test",
        })
        assert r.status_code == 201
        data = r.json()
        assert data["task_type"] == "Listen and Repeat"
        assert data["question"] == "Hello world"
        assert data["task_id"] is not None

    def test_update_task(self, client: TestClient, in_memory_db):
        in_memory_db.execute(
            "INSERT INTO task_bank (task_type, question, answer, tags) VALUES (?,?,?,?)",
            ("Listen and Repeat", "Old question", "Old answer", "test"),
        )
        in_memory_db.commit()
        tid = in_memory_db.execute("SELECT last_insert_rowid()").fetchone()[0]
        r = client.put(f"/api/admin/tasks/{tid}", json={"answer": "New answer"})
        assert r.status_code == 200
        assert r.json()["answer"] == "New answer"

    def test_update_task_not_found(self, client: TestClient):
        r = client.put("/api/admin/tasks/9999", json={"answer": "x"})
        assert r.status_code == 404

    def test_delete_task(self, client: TestClient, in_memory_db):
        in_memory_db.execute(
            "INSERT INTO task_bank (task_type, question, answer, tags) VALUES (?,?,?,?)",
            ("Listen and Repeat", "Q", "A", "test"),
        )
        in_memory_db.commit()
        tid = in_memory_db.execute("SELECT last_insert_rowid()").fetchone()[0]
        r = client.delete(f"/api/admin/tasks/{tid}")
        assert r.status_code == 204
        row = in_memory_db.execute("SELECT task_id FROM task_bank WHERE task_id=?", (tid,)).fetchone()
        assert row is None

    def test_delete_task_not_found(self, client: TestClient):
        r = client.delete("/api/admin/tasks/9999")
        assert r.status_code == 404

    def test_bulk_create_tasks(self, client: TestClient):
        r = client.post("/api/admin/tasks/bulk", json={"tasks": [
            {"task_type": "Take an Interview", "question": "Q1", "answer": "A1"},
            {"task_type": "Take an Interview", "question": "Q2", "answer": "A2"},
        ]})
        assert r.status_code == 201
        data = r.json()
        assert data["inserted"] == 2
        assert data["errors"] == []

    def test_list_tasks_filter_by_type(self, client: TestClient, in_memory_db):
        in_memory_db.executemany(
            "INSERT INTO task_bank (task_type, question, answer) VALUES (?,?,?)",
            [("Listen and Repeat", "Q1", "A1"), ("Take an Interview", "Q2", "A2")],
        )
        in_memory_db.commit()
        r = client.get("/api/admin/tasks?task_type=Listen+and+Repeat")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 1
        assert data["rows"][0]["task_type"] == "Listen and Repeat"


# ── Grammar — SRS, Recommendations, Detail, Filter ───────────────────────────

class TestGrammarSRSEndpoints:

    def _insert_engaged(self, db, grammar_type="Article Error"):
        db.execute(
            "INSERT INTO grammar_mistakes "
            "(date, grammar_type, wrong, correct, recurrence_count, remediation_status, review_stage, next_review_date) "
            "VALUES ('2026-07-16', ?, 'a apple', 'an apple', 1, 'engaged', 1, '2026-01-01')",
            (grammar_type,),
        )
        db.commit()
        return db.execute("SELECT last_insert_rowid()").fetchone()[0]

    def test_srs_due_count_empty(self, client: TestClient):
        r = client.get("/api/grammar/srs/due-count")
        assert r.status_code == 200
        assert r.json()["count"] == 0

    def test_srs_due_count_with_item(self, client: TestClient, in_memory_db):
        self._insert_engaged(in_memory_db)
        r = client.get("/api/grammar/srs/due-count")
        assert r.status_code == 200
        assert r.json()["count"] == 1

    def test_srs_queue_empty(self, client: TestClient):
        r = client.get("/api/grammar/srs/queue")
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 0
        assert data["items"] == []

    def test_srs_queue_with_item(self, client: TestClient, in_memory_db):
        self._insert_engaged(in_memory_db)
        r = client.get("/api/grammar/srs/queue")
        assert r.status_code == 200
        assert r.json()["count"] == 1

    def test_srs_rate_passed(self, client: TestClient, in_memory_db):
        mid = self._insert_engaged(in_memory_db)
        r = client.post(f"/api/grammar/srs/rate/{mid}", json={"passed": True})
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert "review_stage" in data

    def test_srs_rate_failed(self, client: TestClient, in_memory_db):
        mid = self._insert_engaged(in_memory_db)
        r = client.post(f"/api/grammar/srs/rate/{mid}", json={"passed": False})
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_srs_rate_not_found(self, client: TestClient):
        r = client.post("/api/grammar/srs/rate/9999", json={"passed": True})
        assert r.status_code == 404

    def test_srs_writing_focus_empty(self, client: TestClient):
        r = client.get("/api/grammar/srs/writing-focus")
        assert r.status_code == 200
        assert "hints" in r.json()

    def test_recommendations_empty(self, client: TestClient):
        r = client.get("/api/grammar/recommendations")
        assert r.status_code == 200
        data = r.json()
        assert "top_categories" in data
        assert "total_mistakes" in data

    def test_remediation_trends_empty(self, client: TestClient):
        r = client.get("/api/grammar/remediation-trends")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_filter_options_empty(self, client: TestClient):
        r = client.get("/api/grammar/filter-options")
        assert r.status_code == 200

    def test_filter_options_with_data(self, client: TestClient, in_memory_db):
        in_memory_db.execute(
            "INSERT INTO grammar_mistakes (date, grammar_type, wrong, correct, section, recurrence_count) "
            "VALUES ('2026-07-16', 'Article Error', 'a apple', 'an apple', 'Writing', 1)"
        )
        in_memory_db.commit()
        r = client.get("/api/grammar/filter-options?section=Writing")
        assert r.status_code == 200


class TestGrammarMistakeDetail:

    def _insert(self, db):
        db.execute(
            "INSERT INTO grammar_mistakes "
            "(date, grammar_type, sub_type, wrong, correct, section, task_type, recurrence_count) "
            "VALUES ('2026-07-16', 'Article Error', NULL, 'a apple', 'an apple', 'Writing', 'Write an Email', 1)"
        )
        db.commit()
        return db.execute("SELECT last_insert_rowid()").fetchone()[0]

    def test_detail_ok(self, client: TestClient, in_memory_db):
        mid = self._insert(in_memory_db)
        r = client.get(f"/api/grammar/mistakes/{mid}")
        assert r.status_code == 200
        data = r.json()
        assert data["wrong"] == "a apple"
        assert data["correct"] == "an apple"

    def test_detail_not_found(self, client: TestClient):
        r = client.get("/api/grammar/mistakes/9999")
        assert r.status_code == 404

    def test_adjacent_no_neighbours(self, client: TestClient, in_memory_db):
        mid = self._insert(in_memory_db)
        r = client.get(f"/api/grammar/mistakes/{mid}/adjacent")
        assert r.status_code == 200
        data = r.json()
        assert data["prev_id"] is None
        assert data["next_id"] is None

    def test_adjacent_with_neighbours(self, client: TestClient, in_memory_db):
        m1 = self._insert(in_memory_db)
        m2 = self._insert(in_memory_db)
        m3 = self._insert(in_memory_db)
        r = client.get(f"/api/grammar/mistakes/{m2}/adjacent")
        assert r.status_code == 200
        data = r.json()
        assert data["prev_id"] == m1
        assert data["next_id"] == m3

    def test_delete_mistake_ok(self, client: TestClient, in_memory_db):
        mid = self._insert(in_memory_db)
        r = client.post("/api/grammar/mistakes/delete", json={"id": mid})
        assert r.status_code == 200
        assert r.json()["ok"] is True
        row = in_memory_db.execute(
            "SELECT id FROM grammar_mistakes WHERE id=?", (mid,)
        ).fetchone()
        assert row is None

    def test_delete_mistake_not_found(self, client: TestClient):
        r = client.post("/api/grammar/mistakes/delete", json={"id": 9999})
        assert r.status_code == 404

    def test_delete_mistake_missing_id(self, client: TestClient):
        r = client.post("/api/grammar/mistakes/delete", json={})
        assert r.status_code == 400

    def test_evaluate_empty_answer(self, client: TestClient):
        r = client.post("/api/grammar/evaluate", json={
            "user_answer": "",
            "correct": "She goes to school.",
            "wrong": "She go to school.",
            "category": "Subject-Verb Agreement",
        })
        assert r.status_code == 200
        assert r.json()["verdict"] == "wrong"

    def test_evaluate_with_mock(self, client: TestClient, monkeypatch):
        monkeypatch.setattr(
            "app.api.routers.grammar.evaluate_grammar",
            lambda **_kw: {"verdict": "correct", "feedback": ""},
        )
        r = client.post("/api/grammar/evaluate", json={
            "user_answer": "She goes to school.",
            "correct": "She goes to school.",
            "wrong": "She go to school.",
            "category": "Subject-Verb Agreement",
        })
        assert r.status_code == 200
        assert r.json()["verdict"] == "correct"


# ── Guides (static files) ─────────────────────────────────────────────────────

class TestGuidesEndpoints:

    def test_bas_guide_missing(self, client: TestClient):
        # Guide files don't exist in test env — expect 200 with fallback text
        r = client.get("/api/writing/guide/bas")
        assert r.status_code in (200, 404)

    def test_email_guide_missing(self, client: TestClient):
        r = client.get("/api/writing/guide/email")
        assert r.status_code in (200, 404)

    def test_discussion_guide_missing(self, client: TestClient):
        r = client.get("/api/writing/guide/discussion")
        assert r.status_code in (200, 404)


# ── Writing — Sessions, Checklist, Task Bank, Features ───────────────────────

class TestWritingSessionsEndpoints:

    def _insert_writing_session(self, db):
        db.execute(
            "INSERT INTO practice_log (date, section, task_type, prompt, response, score, feedback, tags) "
            "VALUES ('2026-07-16', 'Writing', 'Write an Email', 'Prompt', 'Response', 4.0, 'Good', 'writing,email')"
        )
        db.commit()
        return db.execute("SELECT last_insert_rowid()").fetchone()[0]

    def test_sessions_empty(self, client: TestClient):
        r = client.get("/api/writing/sessions")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 0
        assert data["rows"] == []

    def test_sessions_with_data(self, client: TestClient, in_memory_db):
        self._insert_writing_session(in_memory_db)
        r = client.get("/api/writing/sessions")
        assert r.status_code == 200
        assert r.json()["total"] == 1

    def test_sessions_filter_by_type(self, client: TestClient, in_memory_db):
        self._insert_writing_session(in_memory_db)
        r = client.get("/api/writing/sessions?task_type=Write+an+Email")
        assert r.status_code == 200
        assert r.json()["total"] == 1
        r2 = client.get("/api/writing/sessions?task_type=Write+for+an+Academic+Discussion")
        assert r2.json()["total"] == 0

    def test_session_detail_ok(self, client: TestClient, in_memory_db):
        mid = self._insert_writing_session(in_memory_db)
        r = client.get(f"/api/writing/sessions/{mid}")
        assert r.status_code == 200
        data = r.json()
        assert data["task_type"] == "Write an Email"
        assert data["section"] == "Writing"

    def test_session_detail_not_found(self, client: TestClient):
        r = client.get("/api/writing/sessions/9999")
        assert r.status_code == 404

    def test_session_grammar_mistakes_empty(self, client: TestClient, in_memory_db):
        mid = self._insert_writing_session(in_memory_db)
        r = client.get(f"/api/writing/sessions/{mid}/grammar-mistakes")
        assert r.status_code == 200
        assert r.json()["mistakes"] == []

    def test_session_grammar_mistakes_not_found(self, client: TestClient):
        r = client.get("/api/writing/sessions/9999/grammar-mistakes")
        assert r.status_code == 404

    def test_latest_features_empty(self, client: TestClient):
        r = client.get("/api/writing/latest-features")
        assert r.status_code == 200
        assert r.json()["found"] is False

    def test_features_detail_not_found(self, client: TestClient):
        r = client.get("/api/writing/features/9999")
        assert r.status_code == 404

    def test_task_bank_empty(self, client: TestClient):
        r = client.get("/api/task/bank")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 0

    def test_task_bank_groups_empty(self, client: TestClient):
        r = client.get("/api/task/bank/groups")
        assert r.status_code == 200

    def test_writing_recommended_no_tasks(self, client: TestClient):
        r = client.get("/api/writing/recommended?task_type=Write+an+Email")
        assert r.status_code == 200
        data = r.json()
        assert "task_id" in data

    def test_checklist_history_empty(self, client: TestClient):
        r = client.get("/api/writing/checklist")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 0

    def test_checklist_detail_not_found(self, client: TestClient):
        r = client.get("/api/writing/checklist/9999")
        assert r.status_code == 404

    def test_checklist_detail_ok(self, client: TestClient, in_memory_db):
        mid = self._insert_writing_session(in_memory_db)
        in_memory_db.execute(
            "INSERT INTO writing_checklist_log (date, practice_log_id, task_type, essay, results, passed_count, total_count) "
            "VALUES ('2026-07-16', ?, 'Write an Email', 'My essay', '[]', 0, 5)",
            (mid,),
        )
        in_memory_db.commit()
        lid = in_memory_db.execute("SELECT last_insert_rowid()").fetchone()[0]
        r = client.get(f"/api/writing/checklist/{lid}")
        assert r.status_code == 200
        data = r.json()
        assert data["task_type"] == "Write an Email"
        assert isinstance(data["results"], list)


# ── Speaking — Sessions ───────────────────────────────────────────────────────

class TestSpeakingSessionsEndpoints:

    def _insert_speaking_session(self, db):
        db.execute(
            "INSERT INTO practice_log (date, section, task_type, prompt, response, score, feedback, tags) "
            "VALUES ('2026-07-16', 'Speaking', 'Take an Interview', 'Q', 'A', 3.5, 'Good', 'speaking,interview')"
        )
        db.commit()
        return db.execute("SELECT last_insert_rowid()").fetchone()[0]

    def test_session_detail_not_found(self, client: TestClient):
        r = client.get("/api/speaking/sessions/9999")
        assert r.status_code == 404

    def test_session_detail_ok(self, client: TestClient, in_memory_db):
        mid = self._insert_speaking_session(in_memory_db)
        r = client.get(f"/api/speaking/sessions/{mid}")
        assert r.status_code == 200
        data = r.json()
        assert data["task_type"] == "Take an Interview"

    def test_session_grammar_mistakes_empty(self, client: TestClient, in_memory_db):
        mid = self._insert_speaking_session(in_memory_db)
        r = client.get(f"/api/speaking/sessions/{mid}/grammar-mistakes")
        assert r.status_code == 200
        assert r.json()["mistakes"] == []

    def test_session_grammar_mistakes_not_found(self, client: TestClient):
        r = client.get("/api/speaking/sessions/9999/grammar-mistakes")
        assert r.status_code == 404

    def test_speaking_recommended_no_tasks(self, client: TestClient):
        r = client.get("/api/speaking/recommended?task_type=Take+an+Interview")
        assert r.status_code == 200
        assert "task_id" in r.json()


# ── Dashboard — Grammar KPI ───────────────────────────────────────────────────

class TestDashboardGrammarKPI:

    def test_dashboard_grammar_empty(self, client: TestClient):
        r = client.get("/api/dashboard/grammar")
        assert r.status_code == 200

    def test_dashboard_grammar_with_data(self, client: TestClient, in_memory_db):
        in_memory_db.executemany(
            "INSERT INTO grammar_mistakes (date, grammar_type, wrong, correct, section, recurrence_count, remediation_status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                ("2026-07-16", "Article Error", "a apple", "an apple", "Writing", 2, "new"),
                ("2026-07-16", "Verb Tense Error", "I goed", "I went", "Speaking", 1, "engaged"),
            ],
        )
        in_memory_db.commit()
        r = client.get("/api/dashboard/grammar")
        assert r.status_code == 200


# ── Speaking — Checklist Save ─────────────────────────────────────────────────

class TestSpeakingChecklistEndpoints:

    def test_checklist_save_empty(self, client: TestClient):
        r = client.post("/api/speaking/checklist", json={
            "task_type": "Take an Interview",
            "results": [],
        })
        assert r.status_code == 200
        data = r.json()
        assert "id" in data
        assert data["passed_count"] == 0
        assert data["total_count"] == 0

    def test_checklist_save_with_results(self, client: TestClient):
        r = client.post("/api/speaking/checklist", json={
            "task_type": "Take an Interview",
            "results": [
                {"item": "fluency", "text": "Spoke fluently", "passed": True},
                {"item": "grammar", "text": "Used correct grammar", "passed": False},
            ],
        })
        assert r.status_code == 200
        data = r.json()
        assert data["passed_count"] == 1
        assert data["total_count"] == 2


# ── Writing Submit + BAS Submit + Checklist Eval ──────────────────────────────

class TestWritingSubmitEndpoints:

    def test_writing_submit_blank_essay(self, client: TestClient, in_memory_db):
        # submit_writing raises ValueError for blank essay → 400
        in_memory_db.execute(
            "INSERT INTO task_bank (task_type, question, answer, tags) VALUES (?,?,?,?)",
            ("Write an Email", "Write a complaint email.", "Sample", "writing,email"),
        )
        in_memory_db.commit()
        tid = in_memory_db.execute("SELECT last_insert_rowid()").fetchone()[0]
        r = client.post("/api/practice/writing/submit", json={
            "task_id": tid,
            "task_type": "Write an Email",
            "essay": "   ",
            "time_spent_sec": 60,
        })
        assert r.status_code == 400

    def test_writing_submit_ok(self, client: TestClient, in_memory_db, monkeypatch):
        in_memory_db.execute(
            "INSERT INTO task_bank (task_type, question, answer, tags) VALUES (?,?,?,?)",
            ("Write an Email", "Q", "A", "writing,email"),
        )
        in_memory_db.commit()
        tid = in_memory_db.execute("SELECT last_insert_rowid()").fetchone()[0]

        monkeypatch.setattr(
            "app.api.routers.writing.submit_writing",
            lambda **_kw: {
                "practice_id": 1, "score": 4.0, "feedback": "Good",
                "strengths": ["clear"], "improvements": ["add more detail"],
                "corrected_version": None, "word_count": 100, "time_spent_sec": 60,
                "_nlp_features": None, "prompt": "Q",
            },
        )
        monkeypatch.setattr("app.api.routers.writing.run_nlp_background", lambda **_kw: None)
        r = client.post("/api/practice/writing/submit", json={
            "task_id": tid,
            "task_type": "Write an Email",
            "essay": "This is a test essay with enough content.",
            "time_spent_sec": 60,
        })
        assert r.status_code == 200
        data = r.json()
        assert data["practice_id"] == 1
        assert data["score"] == 4.0

    def test_bas_submit_empty(self, client: TestClient):
        r = client.post("/api/practice/writing/bas/submit", json={"results": []})
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        assert data["saved"] == 0

    def test_bas_submit_with_results(self, client: TestClient, in_memory_db, monkeypatch):
        in_memory_db.execute(
            "INSERT INTO task_bank (task_type, question, answer, tags) VALUES (?,?,?,?)",
            ("Build a Sentence", "Rearrange: [go / I / school / to]", "I go to school", "writing,bas"),
        )
        in_memory_db.commit()
        tid = in_memory_db.execute("SELECT last_insert_rowid()").fetchone()[0]

        monkeypatch.setattr(
            "app.api.routers.writing.submit_bas",
            lambda **_kw: {"status": "ok", "saved": 1},
        )
        r = client.post("/api/practice/writing/bas/submit", json={
            "results": [{"task_id": tid, "checked": True, "correct": False, "your_answer": "I go school", "answer": "I go to school"}]
        })
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_writing_checklist_eval(self, client: TestClient, monkeypatch):
        monkeypatch.setattr(
            "app.api.routers.writing.run_checklist",
            lambda **_kw: {
                "checklist_log_id": 1, "task_type": "Write an Email",
                "passed_count": 3, "total_count": 5,
                "results": [], "improvement_note": "Add a closing.",
            },
        )
        r = client.post("/api/writing/checklist", json={
            "task_type": "Write an Email",
            "essay": "Dear sir, I am writing to complain.",
        })
        assert r.status_code == 200
        data = r.json()
        assert data["passed_count"] == 3
        assert data["total_count"] == 5


# ── Grammar Weakspot Submit ───────────────────────────────────────────────────

class TestGrammarWeakspotSubmit:

    def test_weakspot_submit_empty(self, client: TestClient):
        r = client.post("/api/grammar/weakspot/submit", json={
            "category": "Article Error",
            "results": [],
        })
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["logged"] == 0

    def test_weakspot_submit_with_correct(self, client: TestClient):
        r = client.post("/api/grammar/weakspot/submit", json={
            "category": "Article Error",
            "results": [
                {"user_answer": "an apple", "correct": "an apple", "is_correct": True, "hint": ""},
            ],
        })
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["logged"] == 1

    def test_weakspot_submit_wrong_logs_mistake(self, client: TestClient, in_memory_db):
        r = client.post("/api/grammar/weakspot/submit", json={
            "category": "Article Error",
            "results": [
                {"user_answer": "a apple", "correct": "an apple", "is_correct": False, "hint": "Use 'an' before vowel sounds."},
            ],
        })
        assert r.status_code == 200
        data = r.json()
        assert data["logged"] == 1
        row = in_memory_db.execute(
            "SELECT grammar_type FROM grammar_mistakes WHERE wrong='a apple'"
        ).fetchone()
        assert row is not None


# ── Grammar — Transcribe, WS Fix, Weakspot Generate ──────────────────────────

class TestGrammarLLMEndpoints:

    def test_transcribe_no_audio(self, client: TestClient):
        r = client.post("/api/grammar/transcribe", data={})
        assert r.status_code == 400

    def test_transcribe_with_audio(self, client: TestClient, monkeypatch):
        monkeypatch.setattr(
            "app.services.speech.stt.transcribe_simple_bytes",
            lambda audio_bytes, filename: {"text": "She goes to school."},
        )
        r = client.post(
            "/api/grammar/transcribe",
            files={"audio": ("test.webm", b"fake-audio-bytes", "audio/webm")},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["text"] == "She goes to school."

    def test_transcribe_evaluate_no_audio(self, client: TestClient):
        r = client.post("/api/grammar/transcribe-evaluate", data={"wrong": "She go", "correct": "She goes"})
        assert r.status_code == 400

    def test_transcribe_evaluate_no_correct(self, client: TestClient):
        r = client.post(
            "/api/grammar/transcribe-evaluate",
            files={"audio": ("t.webm", b"bytes", "audio/webm")},
            data={"wrong": "She go", "correct": ""},
        )
        assert r.status_code == 400

    def test_transcribe_evaluate_ok(self, client: TestClient, monkeypatch):
        monkeypatch.setattr(
            "app.services.speech.stt.transcribe_simple_bytes",
            lambda audio_bytes, filename: {"text": "She goes to school."},
        )
        monkeypatch.setattr(
            "app.api.routers.grammar.evaluate_grammar",
            lambda **_kw: {"verdict": "correct", "feedback": "Well done!"},
        )
        r = client.post(
            "/api/grammar/transcribe-evaluate",
            files={"audio": ("t.webm", b"bytes", "audio/webm")},
            data={"wrong": "She go", "correct": "She goes to school.", "category": "Subject-Verb Agreement"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["verdict"] == "correct"
        assert data["transcript"] == "She goes to school."

    def test_transcribe_evaluate_empty_transcript(self, client: TestClient, monkeypatch):
        monkeypatch.setattr(
            "app.services.speech.stt.transcribe_simple_bytes",
            lambda audio_bytes, filename: {"text": ""},
        )
        r = client.post(
            "/api/grammar/transcribe-evaluate",
            files={"audio": ("t.webm", b"bytes", "audio/webm")},
            data={"wrong": "She go", "correct": "She goes.", "category": "SVA"},
        )
        assert r.status_code == 422

    def test_ws_fix_ok(self, client: TestClient, monkeypatch):
        monkeypatch.setattr(
            "app.api.routers.grammar.fix_weakspot_card",
            lambda **_kw: ("She go to school.", "She goes to school."),
        )
        r = client.post("/api/grammar/ws/fix", json={
            "wrong": "She go", "correct": "She goes",
            "category": "SVA", "description": "fix verb agreement",
        })
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["wrong"] == "She go to school."

    def test_weakspot_generate_no_category(self, client: TestClient):
        r = client.get("/api/grammar/weakspot/generate?category=")
        assert r.status_code == 400

    def test_weakspot_generate_ok(self, client: TestClient, monkeypatch):
        monkeypatch.setattr(
            "app.api.routers.grammar.generate_drill_sentences",
            lambda *args, **kwargs: [{"wrong": "a apple", "correct": "an apple", "hint": ""}],
        )
        r = client.get("/api/grammar/weakspot/generate?category=Article+Error&count=1")
        assert r.status_code == 200
        assert len(r.json()["sentences"]) == 1


# ── Speaking — Analyzer History, Record, Analyze ─────────────────────────────

class TestSpeakingAnalyzerEndpoints:

    def test_analyzer_history_with_data(self, client: TestClient, in_memory_db):
        in_memory_db.execute(
            "INSERT INTO speech_analysis_log "
            "(date, audio_filename, transcript, task_type, overall_score, pronunciation_score, "
            "fluency_score, grammar_score, vocabulary_score, intonation_score, wpm, cefr_level) "
            "VALUES ('2026-07-16', 'rec.webm', 'Hello', 'Take an Interview', "
            "3.5, 3.0, 3.5, 4.0, 3.5, 3.0, 120.0, 'B1')"
        )
        in_memory_db.commit()
        r = client.get("/api/speaking/analyzer/history")
        assert r.status_code == 200
        data = r.json()
        assert len(data["sessions"]) == 1
        assert data["sessions"][0]["task_type"] == "Take an Interview"

    def test_analyzer_history_session_detail(self, client: TestClient, in_memory_db):
        in_memory_db.execute(
            "INSERT INTO speech_analysis_log "
            "(date, transcript, task_type, overall_score) "
            "VALUES ('2026-07-16', 'Hello world', 'Take an Interview', 3.5)"
        )
        in_memory_db.commit()
        sid = in_memory_db.execute("SELECT last_insert_rowid()").fetchone()[0]
        r = client.get(f"/api/speaking/analyzer/history/{sid}")
        assert r.status_code == 200
        assert r.json()["transcript"] == "Hello world"

    def test_record_no_audio(self, client: TestClient):
        r = client.post("/api/speaking/record", data={"task_id": "1"})
        assert r.status_code == 400

    def test_analyze_no_audio(self, client: TestClient):
        r = client.post("/api/speaking/analyze", data={"task_id": "1"})
        assert r.status_code == 400

    def test_analyze_ok(self, client: TestClient, monkeypatch):
        import asyncio
        async def _mock_analyze(**_kw):
            return {
                "status": "ok", "practice_id": 1, "overall_score": 3.5,
                "transcript": "Hello", "wpm": 120.0, "cefr_level": "B1",
            }
        monkeypatch.setattr("app.api.routers.speaking.analyze_speaking", _mock_analyze)
        r = client.post(
            "/api/speaking/analyze",
            files={"audio": ("t.webm", b"fake-audio", "audio/webm")},
            data={"task_id": "1", "task_type": "Take an Interview"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_upload_analyze_no_file(self, client: TestClient):
        r = client.post("/api/speaking/upload-analyze", data={})
        assert r.status_code == 400

    def test_upload_analyze_empty_file(self, client: TestClient):
        r = client.post(
            "/api/speaking/upload-analyze",
            files={"file": ("t.webm", b"tiny", "audio/webm")},
        )
        assert r.status_code == 400  # < 100 bytes → "Recording empty"


# ── Learn Router (Murphy grammar topics) ─────────────────────────────────────

class TestLearnEndpoints:
    """learn router uses its own _grammar_db() context manager → grammar_content.db.
    Monkeypatch app.api.routers.learn._grammar_db to inject an in-memory fixture.
    """

    def _make_grammar_db(self):
        """Return a fresh in-memory SQLite with grammar_topics table."""
        import sqlite3
        conn = sqlite3.connect(":memory:", check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("""
            CREATE TABLE grammar_topics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                section TEXT,
                title TEXT,
                page INTEGER,
                page_range TEXT,
                content TEXT,
                lesson_html TEXT
            )
        """)
        conn.commit()
        return conn

    def _patch_grammar_db(self, monkeypatch, conn):
        from contextlib import contextmanager
        @contextmanager
        def _mock():
            yield conn
        monkeypatch.setattr("app.api.routers.learn._grammar_db", _mock)

    def test_list_topics_empty(self, client: TestClient, monkeypatch):
        conn = self._make_grammar_db()
        self._patch_grammar_db(monkeypatch, conn)
        r = client.get("/api/learn/topics")
        assert r.status_code == 200
        assert r.json() == []

    def test_list_topics_with_data(self, client: TestClient, monkeypatch):
        conn = self._make_grammar_db()
        conn.execute("INSERT INTO grammar_topics (section, title, page, page_range) VALUES ('Unit 1', 'Present Simple', 1, '2-3')")
        conn.commit()
        self._patch_grammar_db(monkeypatch, conn)
        r = client.get("/api/learn/topics")
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 1
        assert data[0]["title"] == "Present Simple"
        assert data[0]["has_lesson"] == 0

    def test_get_topic_ok(self, client: TestClient, monkeypatch):
        conn = self._make_grammar_db()
        conn.execute("INSERT INTO grammar_topics (section, title, page, content) VALUES ('Unit 1', 'Present Simple', 1, 'Content here')")
        conn.commit()
        tid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        self._patch_grammar_db(monkeypatch, conn)
        r = client.get(f"/api/learn/topics/{tid}")
        assert r.status_code == 200
        data = r.json()
        assert data["title"] == "Present Simple"
        assert data["content"] == "Content here"

    def test_get_topic_not_found(self, client: TestClient, monkeypatch):
        conn = self._make_grammar_db()
        self._patch_grammar_db(monkeypatch, conn)
        r = client.get("/api/learn/topics/9999")
        assert r.status_code == 404

    def test_get_lesson_no_html(self, client: TestClient, monkeypatch):
        conn = self._make_grammar_db()
        conn.execute("INSERT INTO grammar_topics (title) VALUES ('Present Simple')")
        conn.commit()
        tid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        self._patch_grammar_db(monkeypatch, conn)
        r = client.get(f"/api/learn/topics/{tid}/lesson")
        assert r.status_code == 404

    def test_get_lesson_with_html(self, client: TestClient, monkeypatch):
        conn = self._make_grammar_db()
        conn.execute("INSERT INTO grammar_topics (title, lesson_html) VALUES ('Present Simple', '<h1>Lesson</h1>')")
        conn.commit()
        tid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        self._patch_grammar_db(monkeypatch, conn)
        r = client.get(f"/api/learn/topics/{tid}/lesson")
        assert r.status_code == 200
        assert "<h1>Lesson</h1>" in r.text

    def test_get_lesson_topic_not_found(self, client: TestClient, monkeypatch):
        conn = self._make_grammar_db()
        self._patch_grammar_db(monkeypatch, conn)
        r = client.get("/api/learn/topics/9999/lesson")
        assert r.status_code == 404

    def test_upsert_lesson_ok(self, client: TestClient, monkeypatch):
        conn = self._make_grammar_db()
        conn.execute("INSERT INTO grammar_topics (title) VALUES ('Present Simple')")
        conn.commit()
        tid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        self._patch_grammar_db(monkeypatch, conn)
        r = client.put(f"/api/learn/topics/{tid}/lesson", json={"html": "<p>New lesson</p>"})
        assert r.status_code == 200
        assert r.json()["ok"] is True
        row = conn.execute("SELECT lesson_html FROM grammar_topics WHERE id=?", (tid,)).fetchone()
        assert row[0] == "<p>New lesson</p>"

    def test_upsert_lesson_empty_html(self, client: TestClient, monkeypatch):
        conn = self._make_grammar_db()
        conn.execute("INSERT INTO grammar_topics (title) VALUES ('Present Simple')")
        conn.commit()
        tid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        self._patch_grammar_db(monkeypatch, conn)
        r = client.put(f"/api/learn/topics/{tid}/lesson", json={"html": ""})
        assert r.status_code == 400

    def test_upsert_lesson_topic_not_found(self, client: TestClient, monkeypatch):
        conn = self._make_grammar_db()
        self._patch_grammar_db(monkeypatch, conn)
        r = client.put("/api/learn/topics/9999/lesson", json={"html": "<p>x</p>"})
        assert r.status_code == 404

    def test_lesson_prompt_not_found(self, client: TestClient, monkeypatch):
        monkeypatch.setattr(
            "app.api.routers.learn.LESSON_PROMPT_PATH",
            "/nonexistent/path/prompt.md",
        )
        r = client.get("/api/learn/lesson-prompt")
        assert r.status_code == 404

    def test_lesson_prompt_ok(self, client: TestClient, monkeypatch, tmp_path):
        prompt_file = tmp_path / "prompt.md"
        prompt_file.write_text("You are a grammar teacher.")
        monkeypatch.setattr(
            "app.api.routers.learn.LESSON_PROMPT_PATH",
            str(prompt_file),
        )
        r = client.get("/api/learn/lesson-prompt")
        assert r.status_code == 200
        assert "grammar teacher" in r.text
