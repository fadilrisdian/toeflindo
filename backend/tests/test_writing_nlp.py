"""Tests for writing NLP feature extraction modules.

These tests validate the pure-computation modules (conventions, lexical, accuracy)
without requiring heavy ML models (spaCy, sentence-transformers).
"""
import pytest
from unittest.mock import patch, MagicMock


# ── Conventions tests ─────────────────────────────────────────────────────────

class TestConventions:
    def test_hedge_words_detected(self):
        from app.services.writing_nlp.conventions import extract_conventions
        text = "Perhaps the government should probably consider this approach. Maybe it could work."
        result = extract_conventions(text)
        assert result["hedge_count"] >= 3  # perhaps, probably, maybe
        assert result["modal_count"] >= 2  # should, could

    def test_greeting_detected(self):
        from app.services.writing_nlp.conventions import extract_conventions
        text = "Dear Professor Smith,\n\nI am writing to request an extension.\n\nSincerely,\nFadil"
        result = extract_conventions(text)
        assert result["has_greeting"] is True
        assert result["has_closing"] is True
        assert result["politeness_score"] > 0.5

    def test_no_greeting(self):
        from app.services.writing_nlp.conventions import extract_conventions
        text = "The main argument is that education improves society."
        result = extract_conventions(text)
        assert result["has_greeting"] is False
        assert result["has_closing"] is False

    def test_formality_high_for_formal_text(self):
        from app.services.writing_nlp.conventions import extract_conventions
        text = "Furthermore, it is imperative that the committee considers all perspectives before reaching a conclusion."
        result = extract_conventions(text)
        assert result["register_formality"] > 0.8

    def test_formality_low_for_informal_text(self):
        from app.services.writing_nlp.conventions import extract_conventions
        text = "Yeah so I'm gonna wanna tell you that it's kinda sorta okay lol"
        result = extract_conventions(text)
        assert result["register_formality"] < 0.5

    def test_modals_counted(self):
        from app.services.writing_nlp.conventions import extract_conventions
        text = "You could try this. It would be helpful. We should consider it."
        result = extract_conventions(text)
        assert result["modal_count"] == 3


# ── Lexical tests ─────────────────────────────────────────────────────────────

class TestLexical:
    def test_ttr_basic(self):
        from app.services.writing_nlp.lexical import compute_ttr
        # Repetitive text = low TTR
        repetitive = "the cat sat on the mat the cat sat on the mat the cat sat on the mat"
        varied = "university students should investigate environmental sustainability through rigorous methodology"
        ttr_rep = compute_ttr(repetitive)
        ttr_var = compute_ttr(varied)
        assert ttr_var > ttr_rep

    def test_lexical_sophistication(self):
        from app.services.writing_nlp.lexical import compute_lexical_sophistication
        simple = "I like dogs and cats. They are good animals. I have a big house."
        advanced = "The unprecedented proliferation of misinformation necessitates systematic intervention by authoritative institutions."
        soph_simple = compute_lexical_sophistication(simple)
        soph_adv = compute_lexical_sophistication(advanced)
        assert soph_adv > soph_simple

    def test_frequency_bands(self):
        from app.services.writing_nlp.lexical import compute_frequency_bands
        text = "The important consideration is that methodology enhances epistemological frameworks."
        bands = compute_frequency_bands(text)
        assert "top_1k" in bands
        assert "academic" in bands
        assert "rare" in bands
        # All values should sum to ~1.0
        total = sum(bands.values())
        assert 0.99 <= total <= 1.01

    def test_extract_lexical_all_keys(self):
        from app.services.writing_nlp.lexical import extract_lexical
        text = "Education is fundamental to societal development. It empowers individuals to contribute meaningfully."
        result = extract_lexical(text)
        assert "ttr" in result
        assert "lexical_sophistication" in result
        assert "frequency_band_dist" in result
        assert "collocation_score" in result
        assert 0 <= result["ttr"] <= 1
        assert 0 <= result["lexical_sophistication"] <= 1


# ── Accuracy tests ────────────────────────────────────────────────────────────

class TestAccuracy:
    def test_mechanical_errors_double_space(self):
        from app.services.writing_nlp.accuracy import check_mechanical_errors
        text = "This has  double  spaces in it."
        errors = check_mechanical_errors(text)
        assert any("Double spaces" in e for e in errors)

    def test_mechanical_errors_missing_cap(self):
        from app.services.writing_nlp.accuracy import check_mechanical_errors
        text = "First sentence. second sentence should be capitalized."
        errors = check_mechanical_errors(text)
        assert any("capitalization" in e.lower() for e in errors)

    def test_mechanical_errors_clean(self):
        from app.services.writing_nlp.accuracy import check_mechanical_errors
        text = "This is a well-formatted sentence. It has proper capitalization."
        errors = check_mechanical_errors(text)
        assert len(errors) == 0

    def test_extract_accuracy_returns_all_keys(self):
        from app.services.writing_nlp.accuracy import extract_accuracy
        text = "This is a properly written sentence. It should have no errors."
        result = extract_accuracy(text)
        assert "spelling_error_rate" in result
        assert "spelling_errors" in result
        assert "mechanical_error_count" in result
        assert "mechanical_errors" in result


# ── Models tests ──────────────────────────────────────────────────────────────

class TestFeatureReport:
    def test_dimension_scores_email(self):
        from app.services.writing_nlp.models import FeatureReport
        report = FeatureReport(
            prompt_similarity=0.8,
            discourse_coherence=0.7,
            elaboration_score=0.9,
            sentence_variety=0.6,
            clause_complexity=1.5,
            tree_depth_variety=0.4,
            sentence_length_variance=0.5,
            ttr=0.7,
            lexical_sophistication=0.5,
            collocation_score=0.6,
            hedge_count=3,
            modal_count=2,
            has_greeting=True,
            has_closing=True,
            politeness_score=0.8,
            register_formality=0.9,
            spelling_error_rate=1.0,
            mechanical_error_count=1,
        )
        report.compute_dimension_scores(task_type="Write an Email")
        # Email has all 5 dimensions
        assert "content" in report.dimension_scores
        assert "syntax" in report.dimension_scores
        assert "lexical" in report.dimension_scores
        assert "conventions" in report.dimension_scores
        assert "accuracy" in report.dimension_scores
        for dim, score in report.dimension_scores.items():
            assert 0 <= score <= 1, f"{dim} = {score} not in [0,1]"

    def test_dimension_scores_discussion(self):
        from app.services.writing_nlp.models import FeatureReport
        report = FeatureReport(
            prompt_similarity=0.8,
            discourse_coherence=0.7,
            elaboration_score=0.9,
            sentence_variety=0.6,
            clause_complexity=1.5,
            tree_depth_variety=0.4,
            sentence_length_variance=0.5,
            ttr=0.7,
            lexical_sophistication=0.5,
            collocation_score=0.6,
            hedge_count=3,
            modal_count=2,
            politeness_score=0.8,
            register_formality=0.9,
            spelling_error_rate=1.0,
            mechanical_error_count=1,
        )
        report.compute_dimension_scores(task_type="Write for an Academic Discussion")
        # Discussion has 4 dimensions — no conventions
        assert "content" in report.dimension_scores
        assert "syntax" in report.dimension_scores
        assert "lexical" in report.dimension_scores
        assert "conventions" not in report.dimension_scores
        assert "accuracy" in report.dimension_scores
        for dim, score in report.dimension_scores.items():
            assert 0 <= score <= 1, f"{dim} = {score} not in [0,1]"

    def test_discussion_content_score_higher_than_email_given_same_elaboration(self):
        """Discussion weights elaboration 1.5x so its content score should be
        higher than Email when elaboration is strong."""
        from app.services.writing_nlp.models import FeatureReport

        email_r = FeatureReport(
            prompt_similarity=0.5,
            discourse_coherence=0.5,
            elaboration_score=1.0,
        )
        email_r.compute_dimension_scores(task_type="Write an Email")

        disc_r = FeatureReport(
            prompt_similarity=0.5,
            discourse_coherence=0.5,
            elaboration_score=1.0,
        )
        disc_r.compute_dimension_scores(task_type="Write for an Academic Discussion")

        assert disc_r.dimension_scores["content"] > email_r.dimension_scores["content"]

    def test_to_dict(self):
        from app.services.writing_nlp.models import FeatureReport
        report = FeatureReport(prompt_similarity=0.5)
        d = report.to_dict()
        assert isinstance(d, dict)
        assert d["prompt_similarity"] == 0.5


# ── Integration test (mocked heavy deps) ─────────────────────────────────────

class TestOrchestrator:
    def test_extract_all_features_graceful_on_import_failure(self):
        """Even if spacy/sentence-transformers aren't installed, it shouldn't crash."""
        from app.services.writing_nlp.models import FeatureReport
        from app.services.writing_nlp import extract_all_features

        essay = "Dear Dr. Johnson, I would like to request a meeting. Perhaps we could discuss the project. Thank you."

        # Patch the heavy modules to simulate import failure
        with patch("app.services.writing_nlp.conventions.extract_conventions") as mock_conv, \
             patch.dict("sys.modules", {"spacy": None}):
            mock_conv.return_value = {
                "hedge_count": 1, "hedge_words_found": ["perhaps"],
                "modal_count": 1, "modal_words_found": ["could"],
                "has_greeting": True, "has_closing": True,
                "politeness_score": 0.75, "register_formality": 0.9,
            }
            # This should not raise even if some extractors fail
            report = extract_all_features(essay, "Request a meeting with professor")
            assert isinstance(report, FeatureReport)
            assert report.dimension_scores  # should still compute


# ── Repository tests ──────────────────────────────────────────────────────────

class TestWritingFeaturesRepository:
    def test_insert_and_retrieve(self, in_memory_db):
        from app.repositories.writing_features_repository import WritingFeaturesRepository
        from app.repositories.practice_repository import PracticeRepository

        practice_repo = PracticeRepository(in_memory_db)
        practice_id = practice_repo.insert_practice(
            section="Writing", task_type="Write an Email",
            prompt="Test prompt", response="Test essay",
            score=4.5, feedback="Good job",
        )

        repo = WritingFeaturesRepository(in_memory_db)
        features = {
            "prompt_similarity": 0.75,
            "discourse_coherence": 0.8,
            "elaboration_score": 0.7,
            "sentence_variety": 0.6,
            "clause_complexity": 1.5,
            "tree_depth_variety": 0.4,
            "sentence_length_variance": 0.5,
            "ttr": 0.65,
            "lexical_sophistication": 0.4,
            "collocation_score": 0.55,
            "hedge_count": 2,
            "modal_count": 3,
            "has_greeting": True,
            "has_closing": True,
            "politeness_score": 0.8,
            "register_formality": 0.9,
            "spelling_error_rate": 0.5,
            "mechanical_error_count": 1,
            "dimension_scores": {
                "content": 0.75,
                "syntax": 0.5,
                "lexical": 0.53,
                "conventions": 0.72,
                "accuracy": 0.85,
            },
        }

        feature_id = repo.insert_features(
            practice_log_id=practice_id,
            task_type="Write an Email",
            features=features,
        )
        in_memory_db.commit()

        assert feature_id is not None
        retrieved = repo.get_by_practice_id(practice_id)
        assert retrieved is not None
        assert retrieved["prompt_similarity"] == 0.75
        assert retrieved["dimension_content"] == 0.75
        assert "features" in retrieved
