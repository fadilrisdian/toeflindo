"""Repository for writing NLP features."""
import json
import sqlite3
from typing import Optional


class WritingFeaturesRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._c = conn

    def insert_features(
        self,
        *,
        practice_log_id: int,
        task_type: str,
        features: dict,
    ) -> int:
        """Persist a FeatureReport dict to writing_features table."""
        dims = features.get("dimension_scores", {})
        cur = self._c.execute(
            """INSERT INTO writing_features (
                practice_log_id, task_type,
                prompt_similarity, discourse_coherence, elaboration_score,
                sentence_variety, clause_complexity, tree_depth_variety, sentence_length_variance,
                ttr, lexical_sophistication, collocation_score,
                hedge_count, modal_count, has_greeting, has_closing,
                politeness_score, register_formality,
                spelling_error_rate, mechanical_error_count,
                dimension_content, dimension_syntax, dimension_lexical,
                dimension_conventions, dimension_accuracy,
                features_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                practice_log_id,
                task_type,
                features.get("prompt_similarity"),
                features.get("discourse_coherence"),
                features.get("elaboration_score"),
                features.get("sentence_variety"),
                features.get("clause_complexity"),
                features.get("tree_depth_variety"),
                features.get("sentence_length_variance"),
                features.get("ttr"),
                features.get("lexical_sophistication"),
                features.get("collocation_score"),
                features.get("hedge_count"),
                features.get("modal_count"),
                1 if features.get("has_greeting") else 0,
                1 if features.get("has_closing") else 0,
                features.get("politeness_score"),
                features.get("register_formality"),
                features.get("spelling_error_rate"),
                features.get("mechanical_error_count"),
                dims.get("content"),
                dims.get("syntax"),
                dims.get("lexical"),
                dims.get("conventions"),
                dims.get("accuracy"),
                json.dumps(features),
            ),
        )
        return cur.lastrowid  # type: ignore[return-value]

    def get_latest(self) -> Optional[dict]:
        """Return dimension scores from the most recent non-BAS writing session."""
        row = self._c.execute(
            "SELECT practice_log_id, task_type, "
            "dimension_content, dimension_syntax, dimension_lexical, "
            "dimension_conventions, dimension_accuracy "
            "FROM writing_features "
            "WHERE task_type != 'Build a Sentence' "
            "ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return dict(row) if row else None

    def get_by_practice_id(self, practice_log_id: int) -> Optional[dict]:
        """Retrieve features for a practice_log entry."""
        row = self._c.execute(
            "SELECT * FROM writing_features WHERE practice_log_id=?",
            (practice_log_id,),
        ).fetchone()
        if not row:
            return None
        result = dict(row)
        # Parse the full JSON blob
        if result.get("features_json"):
            result["features"] = json.loads(result["features_json"])
        return result
