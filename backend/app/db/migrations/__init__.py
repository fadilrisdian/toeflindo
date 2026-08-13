"""DDL migration statements applied at startup via run_migrations().

Add new migrations by appending to _MIGRATIONS.
All statements are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
"""

_MIGRATIONS: list[str] = [
    """
    CREATE TABLE IF NOT EXISTS practice_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        section TEXT NOT NULL,
        task_type TEXT,
        prompt TEXT,
        response TEXT,
        score REAL,
        feedback TEXT,
        duration_minutes INTEGER,
        tags TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS grammar_mistakes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        grammar_type TEXT NOT NULL,
        sub_type TEXT,
        section TEXT,
        task_type TEXT,
        wrong TEXT NOT NULL,
        correct TEXT NOT NULL,
        explanation TEXT,
        exercise_id INTEGER,
        reviewed INTEGER DEFAULT 0,
        recurrence_count INTEGER DEFAULT 1,
        next_review_date TEXT,
        srs_interval INTEGER DEFAULT 1,
        practice_log_id INTEGER REFERENCES practice_log(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS grammar_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        grammar_type TEXT NOT NULL,
        attempts INTEGER DEFAULT 0,
        correct INTEGER DEFAULT 0,
        notes TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS task_bank (
        task_id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT,
        task_type TEXT,
        question TEXT,
        tags TEXT,
        answer TEXT,
        source TEXT DEFAULT 'https://www.toeflresources.com/',
        reference_only INTEGER DEFAULT 0,
        question_type TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS study_logs (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id INTEGER,
        topic_title TEXT,
        status TEXT CHECK(status IN ('not_started','in_progress','mastered')),
        last_reviewed DATETIME DEFAULT CURRENT_TIMESTAMP,
        accuracy_rate REAL DEFAULT 0.0,
        attempts INTEGER DEFAULT 0,
        next_review_date DATETIME,
        retention_level INTEGER DEFAULT 0,
        source TEXT DEFAULT 'hermes'
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS speech_analysis_log (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        date                    TEXT NOT NULL,
        audio_filename          TEXT,
        duration_seconds        REAL,
        processing_time_seconds REAL,
        transcript              TEXT,
        overall_score           REAL,
        pronunciation_score     REAL,
        fluency_score           REAL,
        grammar_score           REAL,
        vocabulary_score        REAL,
        intonation_score        REAL,
        discourse_score         REAL,
        wpm                     REAL,
        cefr_level              TEXT,
        avg_word_confidence     REAL,
        pause_count             INTEGER,
        filler_count            INTEGER,
        pronunciation_data      TEXT,
        fluency_data            TEXT,
        grammar_data            TEXT,
        vocabulary_data         TEXT,
        intonation_data         TEXT,
        practice_log_id         INTEGER REFERENCES practice_log(id),
        task_type               TEXT,
        topic                   TEXT,
        expected_answer         TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS grammar_topic_map (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        category     TEXT NOT NULL,
        sub_type     TEXT,
        murphy_unit  INTEGER,
        murphy_title TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS writing_checklist_log (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        date              TEXT NOT NULL,
        practice_log_id   INTEGER REFERENCES practice_log(id),
        task_type         TEXT NOT NULL,
        essay             TEXT,
        results           TEXT NOT NULL,
        passed_count      INTEGER NOT NULL DEFAULT 0,
        total_count       INTEGER NOT NULL DEFAULT 0,
        improvement_note  TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS speaking_checklist_log (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        date              TEXT NOT NULL,
        practice_log_id   INTEGER REFERENCES practice_log(id),
        task_type         TEXT NOT NULL,
        results           TEXT NOT NULL,
        passed_count      INTEGER NOT NULL DEFAULT 0,
        total_count       INTEGER NOT NULL DEFAULT 0
    )
    """,
    """
    ALTER TABLE speech_analysis_log ADD COLUMN words_json TEXT
    """,
    """
    CREATE TABLE IF NOT EXISTS reflection_log (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        date              TEXT NOT NULL,
        practice_log_id   INTEGER REFERENCES practice_log(id),
        task_type         TEXT,
        what_went_well    TEXT,
        what_was_hard     TEXT,
        why_mistake       TEXT,
        next_time         TEXT,
        confidence_before INTEGER CHECK(confidence_before BETWEEN 1 AND 5),
        confidence_after  INTEGER CHECK(confidence_after BETWEEN 1 AND 5)
    )
    """,
    """
    CREATE VIEW IF NOT EXISTS grammar_mastery_cross_section AS
    SELECT 
        gm.grammar_type,
        COUNT(*) as total_mistakes,
        SUM(gm.recurrence_count) as total_recurrences,
        GROUP_CONCAT(DISTINCT gm.section) as affected_sections,
        COUNT(DISTINCT gm.section) as section_count,
        SUM(CASE WHEN gm.reviewed = 1 THEN 1 ELSE 0 END) as reviewed_count,
        SUM(CASE WHEN gm.reviewed = 0 THEN 1 ELSE 0 END) as unreviewed_count,
        ROUND(100.0 * SUM(CASE WHEN gm.reviewed = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as review_pct,
        COALESCE(gp.total_attempts, 0) as drill_attempts,
        COALESCE(gp.total_correct, 0) as drill_correct,
        CASE 
            WHEN COALESCE(gp.total_attempts, 0) = 0 THEN 0.0
            ELSE ROUND(100.0 * gp.total_correct / gp.total_attempts, 1)
        END as drill_accuracy_pct,
        CASE
            WHEN COALESCE(gp.total_attempts, 0) = 0 THEN 'untested'
            WHEN 100.0 * gp.total_correct / gp.total_attempts >= 90 THEN 'mastered'
            WHEN 100.0 * gp.total_correct / gp.total_attempts >= 70 THEN 'progressing'
            WHEN 100.0 * gp.total_correct / gp.total_attempts >= 50 THEN 'developing'
            ELSE 'struggling'
        END as mastery_level
    FROM grammar_mistakes gm
    LEFT JOIN (
        SELECT grammar_type, SUM(attempts) as total_attempts, SUM(correct) as total_correct
        FROM grammar_performance
        GROUP BY grammar_type
    ) gp ON gp.grammar_type = gm.grammar_type
    GROUP BY gm.grammar_type
    """,
    """
    CREATE VIEW IF NOT EXISTS speaking_skill_decomposition AS
    SELECT 
        task_type,
        COUNT(*) as total_sessions,
        ROUND(AVG(CASE WHEN rn <= 10 THEN pronunciation_score END), 2) as pronunciation_recent,
        ROUND(AVG(CASE WHEN rn <= 10 THEN fluency_score END), 2) as fluency_recent,
        ROUND(AVG(CASE WHEN rn <= 10 THEN grammar_score END), 2) as grammar_recent,
        ROUND(AVG(CASE WHEN rn <= 10 THEN vocabulary_score END), 2) as vocabulary_recent,
        ROUND(AVG(CASE WHEN rn <= 10 THEN intonation_score END), 2) as intonation_recent,
        ROUND(AVG(CASE WHEN rn <= 10 THEN wpm END), 1) as wpm_recent,
        ROUND(AVG(pronunciation_score), 2) as pronunciation_all,
        ROUND(AVG(fluency_score), 2) as fluency_all,
        ROUND(AVG(grammar_score), 2) as grammar_all,
        ROUND(AVG(vocabulary_score), 2) as vocabulary_all,
        ROUND(AVG(intonation_score), 2) as intonation_all,
        ROUND(AVG(wpm), 1) as wpm_all
    FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY task_type ORDER BY date DESC) as rn
        FROM speech_analysis_log
        WHERE overall_score IS NOT NULL AND task_type IS NOT NULL
    )
    GROUP BY task_type
    """,
    """
    CREATE TABLE IF NOT EXISTS transfer_test (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_created TEXT NOT NULL,
        grammar_type TEXT NOT NULL,
        drill_accuracy REAL NOT NULL,
        target_task_type TEXT NOT NULL,
        status TEXT CHECK(status IN ('pending', 'passed', 'failed', 'expired')) DEFAULT 'pending',
        date_tested TEXT,
        test_practice_log_id INTEGER REFERENCES practice_log(id),
        mistakes_found INTEGER DEFAULT 0,
        notes TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS plateau_alert (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_detected TEXT NOT NULL,
        task_type TEXT NOT NULL,
        topic TEXT NOT NULL,
        sessions_analyzed INTEGER NOT NULL,
        first_half_avg REAL NOT NULL,
        second_half_avg REAL NOT NULL,
        delta REAL NOT NULL,
        last5_avg REAL NOT NULL,
        status TEXT CHECK(status IN ('active', 'resolved', 'dismissed')) DEFAULT 'active',
        intervention TEXT,
        date_resolved TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS milestone_trajectory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_computed TEXT NOT NULL,
        section TEXT NOT NULL,
        current_rubric_avg REAL NOT NULL,
        target_rubric_avg REAL NOT NULL,
        target_score INTEGER NOT NULL,
        months_remaining REAL NOT NULL,
        required_monthly_gain REAL NOT NULL,
        actual_monthly_gain REAL,
        on_track INTEGER DEFAULT 0,
        notes TEXT
    )
    """,
    """
    CREATE VIEW IF NOT EXISTS transfer_test_summary AS
    SELECT 
        grammar_type,
        drill_accuracy,
        COUNT(*) as total_tests,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        CASE
            WHEN SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) >= 2 THEN 'transfer_confirmed'
            WHEN SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) >= 2 THEN 'transfer_failed'
            ELSE 'testing'
        END as transfer_status
    FROM transfer_test
    GROUP BY grammar_type
    """,
    """
    CREATE TABLE IF NOT EXISTS forgetting_curve (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grammar_type TEXT NOT NULL UNIQUE,
        stability REAL NOT NULL,
        interval_multiplier REAL NOT NULL,
        first_review_days INTEGER NOT NULL DEFAULT 1,
        second_review_days INTEGER NOT NULL DEFAULT 3,
        mastery_review_days INTEGER NOT NULL DEFAULT 7,
        drill_accuracy REAL DEFAULT 0,
        recurrence_rate REAL DEFAULT 0,
        density_per_week REAL DEFAULT 0,
        last_computed TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS writing_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        practice_log_id INTEGER REFERENCES practice_log(id),
        task_type TEXT NOT NULL,
        prompt_similarity REAL,
        discourse_coherence REAL,
        elaboration_score REAL,
        sentence_variety REAL,
        clause_complexity REAL,
        tree_depth_variety REAL,
        sentence_length_variance REAL,
        ttr REAL,
        lexical_sophistication REAL,
        collocation_score REAL,
        hedge_count INTEGER,
        modal_count INTEGER,
        has_greeting INTEGER,
        has_closing INTEGER,
        politeness_score REAL,
        register_formality REAL,
        spelling_error_rate REAL,
        mechanical_error_count INTEGER,
        dimension_content REAL,
        dimension_syntax REAL,
        dimension_lexical REAL,
        dimension_conventions REAL,
        dimension_accuracy REAL,
        features_json TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_writing_features_practice
    ON writing_features(practice_log_id)
    """,
    """
    ALTER TABLE speech_analysis_log ADD COLUMN task_raw_score REAL
    """,
    """
    ALTER TABLE speech_analysis_log ADD COLUMN estimated_band REAL
    """,
    """
    ALTER TABLE grammar_mistakes ADD COLUMN practice_log_id INTEGER REFERENCES practice_log(id)
    """,
    """
    CREATE TABLE IF NOT EXISTS collocation_items (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        phrase           TEXT NOT NULL,
        source           TEXT,
        date_added       TEXT NOT NULL,
        box_level        INTEGER NOT NULL DEFAULT 1,
        next_review_date TEXT NOT NULL,
        review_count     INTEGER NOT NULL DEFAULT 0
    )
    """,
    # ── Remediation loop (Phase 1) ────────────────────────────────────────────
    """
    ALTER TABLE grammar_mistakes ADD COLUMN treatability TEXT
    """,
    """
    ALTER TABLE grammar_mistakes ADD COLUMN rubric_dimension TEXT
    """,
    """
    ALTER TABLE grammar_mistakes ADD COLUMN review_stage INTEGER DEFAULT 0
    """,
    """
    ALTER TABLE grammar_mistakes ADD COLUMN remediation_status TEXT DEFAULT 'new'
    """,
    """
    CREATE TABLE IF NOT EXISTS review_attempts (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        grammar_mistake_id INTEGER NOT NULL REFERENCES grammar_mistakes(id) ON DELETE CASCADE,
        attempt_type       TEXT NOT NULL CHECK(attempt_type IN ('self_correct', 'new_sentence')),
        attempt_text       TEXT NOT NULL,
        is_correct         INTEGER NOT NULL DEFAULT 0,
        feedback           TEXT,
        created_at         TEXT NOT NULL
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_review_attempts_mistake
    ON review_attempts(grammar_mistake_id)
    """,
    """
    ALTER TABLE review_attempts ADD COLUMN hint_level_used INTEGER DEFAULT 0
    """,
    """
    ALTER TABLE practice_log ADD COLUMN is_revision INTEGER DEFAULT 0
    """,
    """
    ALTER TABLE practice_log ADD COLUMN revision_of INTEGER REFERENCES practice_log(id)
    """,
    # ── Scoring engine v2 — readiness + prompt versioning ────────────────────
    """
    ALTER TABLE speech_analysis_log ADD COLUMN readiness_score INTEGER
    """,
    """
    ALTER TABLE speech_analysis_log ADD COLUMN readiness_level TEXT
    """,
    """
    ALTER TABLE speech_analysis_log ADD COLUMN priority_issues TEXT
    """,
    """
    ALTER TABLE speech_analysis_log ADD COLUMN prompt_version TEXT
    """,
    # ── Speaking session detail — extra SAL fields ───────────────────────────
    """
    ALTER TABLE speech_analysis_log ADD COLUMN long_pause_count INTEGER
    """,
    """
    ALTER TABLE speech_analysis_log ADD COLUMN repetition_count INTEGER
    """,
    """
    ALTER TABLE speech_analysis_log ADD COLUMN pitch_stats TEXT
    """,
    """
    ALTER TABLE speech_analysis_log ADD COLUMN energy_variation REAL
    """,
    """
    ALTER TABLE speech_analysis_log ADD COLUMN vocabulary_diversity TEXT
    """,
    """
    ALTER TABLE speech_analysis_log ADD COLUMN repeated_words TEXT
    """,
]
