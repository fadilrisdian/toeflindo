"""Writing NLP feature extraction orchestrator.

Usage:
    from app.services.writing_nlp import extract_all_features
    report = extract_all_features(essay, prompt)
"""
from __future__ import annotations

from app.core.logging import get_logger
from app.services.writing_nlp.models import FeatureReport

logger = get_logger(__name__)


def extract_all_features(
    essay: str,
    prompt: str = "",
    task_type: str = "Write an Email",
) -> FeatureReport:
    """Run all NLP feature extractors and return a unified FeatureReport.

    task_type controls which ETS rubric dimensions are scored:
    - "Write an Email"                  → Content · Syntax · Lexical · Conventions · Accuracy
    - "Write for an Academic Discussion" → Content · Syntax · Lexical · Accuracy

    Each dimension is extracted independently so a failure in one doesn't
    block the others. Errors are logged and the dimension gets default values.
    """
    report = FeatureReport()
    _fill_fast_features(report, essay)
    _fill_content_features(report, essay, prompt)
    report.compute_dimension_scores(task_type=task_type)
    return report


def extract_fast_features(essay: str, task_type: str = "Write an Email") -> FeatureReport:
    """Run only fast (non-embedding) extractors. Safe to call synchronously
    during the HTTP request — completes in well under 1 second."""
    report = FeatureReport()
    _fill_fast_features(report, essay)
    report.compute_dimension_scores(task_type=task_type)
    return report


def _fill_fast_features(report: FeatureReport, essay: str) -> None:
    """Populate all dimensions that don't require embedding calls."""

    # ── Conventions (pure regex, no deps) ─────────────────────────────────
    try:
        from app.services.writing_nlp.conventions import extract_conventions
        conv = extract_conventions(essay)
        report.hedge_count = conv["hedge_count"]
        report.hedge_words_found = conv.get("hedge_words_found", [])
        report.modal_count = conv["modal_count"]
        report.modal_words_found = conv.get("modal_words_found", [])
        report.has_greeting = conv["has_greeting"]
        report.has_closing = conv["has_closing"]
        report.politeness_score = conv["politeness_score"]
        report.register_formality = conv["register_formality"]
    except Exception as exc:
        logger.warning("NLP conventions extraction failed: %s", exc)

    # ── Lexical (wordfreq) ────────────────────────────────────────────────
    try:
        from app.services.writing_nlp.lexical import extract_lexical
        lex = extract_lexical(essay)
        report.ttr = lex["ttr"]
        report.lexical_sophistication = lex["lexical_sophistication"]
        report.sophisticated_words = lex.get("sophisticated_words", [])
        report.frequency_band_dist = lex["frequency_band_dist"]
        report.collocation_score = lex["collocation_score"]
    except Exception as exc:
        logger.warning("NLP lexical extraction failed: %s", exc)

    # ── Accuracy (symspellpy) ─────────────────────────────────────────────
    try:
        from app.services.writing_nlp.accuracy import extract_accuracy
        acc = extract_accuracy(essay)
        report.spelling_error_rate = acc["spelling_error_rate"]
        report.spelling_errors = acc["spelling_errors"]
        report.mechanical_error_count = acc["mechanical_error_count"]
        report.mechanical_errors = acc["mechanical_errors"]
    except Exception as exc:
        logger.warning("NLP accuracy extraction failed: %s", exc)

    # ── Syntax (spaCy) ────────────────────────────────────────────────────
    try:
        from app.services.writing_nlp.syntax import extract_syntax
        syn = extract_syntax(essay)
        report.sentence_variety = syn["sentence_variety"]
        report.clause_complexity = syn["clause_complexity"]
        report.tree_depth_variety = syn["tree_depth_variety"]
        report.sentence_length_variance = syn["sentence_length_variance"]
    except Exception as exc:
        logger.warning("NLP syntax extraction failed: %s", exc)


def _fill_content_features(report: FeatureReport, essay: str, prompt: str) -> None:
    """Populate content dimension (requires Jina embedding service — can be slow)."""
    try:
        from app.services.writing_nlp.content import extract_content
        content = extract_content(essay, prompt)
        report.prompt_similarity = content["prompt_similarity"]
        report.discourse_coherence = content["discourse_coherence"]
        report.elaboration_score = content["elaboration_score"]
    except Exception as exc:
        logger.warning("NLP content extraction failed: %s", exc)
