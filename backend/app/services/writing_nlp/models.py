"""Data models for NLP feature extraction."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class FeatureReport:
    """All extracted NLP features for a writing submission."""

    # ── Content ──────────────────────────────────────────────────────────────
    prompt_similarity: float = 0.0        # 0-1 cosine similarity essay↔prompt
    discourse_coherence: float = 0.0      # 0-1 avg adjacent-sentence similarity
    elaboration_score: float = 0.0        # 0-1 proxy (sentence count × avg length)

    # ── Syntax ───────────────────────────────────────────────────────────────
    sentence_variety: float = 0.0         # 0-1 entropy of sentence types
    clause_complexity: float = 0.0        # avg clauses per sentence
    tree_depth_variety: float = 0.0       # stdev of parse depths, normalized
    sentence_length_variance: float = 0.0 # normalized stdev of words per sentence

    # ── Lexical ──────────────────────────────────────────────────────────────
    ttr: float = 0.0                      # corrected type-token ratio
    lexical_sophistication: float = 0.0   # % words beyond top-2000
    sophisticated_words: list = field(default_factory=list)  # actual sophisticated words
    frequency_band_dist: dict = field(default_factory=dict)  # {band: pct}
    collocation_score: float = 0.0        # 0-1 avg bigram PMI normalized

    # ── Conventions ──────────────────────────────────────────────────────────
    hedge_count: int = 0
    hedge_words_found: list = field(default_factory=list)  # actual hedge words used
    modal_count: int = 0
    modal_words_found: list = field(default_factory=list)  # actual modal verbs used
    has_greeting: bool = False
    has_closing: bool = False
    politeness_score: float = 0.0         # 0-1
    register_formality: float = 0.0       # 0-1 (1 = very formal)

    # ── Accuracy ─────────────────────────────────────────────────────────────
    spelling_error_rate: float = 0.0      # errors per 100 words
    spelling_errors: list = field(default_factory=list)  # list of misspelled words
    mechanical_error_count: int = 0
    mechanical_errors: list = field(default_factory=list)  # descriptions

    # ── Composite dimension scores (0-1 each) ───────────────────────────────
    dimension_scores: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    def compute_dimension_scores(self, task_type: str = "Write an Email") -> None:
        """Aggregate individual features into per-dimension 0-1 scores.

        Task-type aware per ETS rubric:
        - Write an Email:                  Content · Syntax · Lexical · Social Conventions · Accuracy
        - Write for an Academic Discussion: Content · Syntax · Lexical · Accuracy
          (Social Conventions is NOT a scored dimension for Discussion)
        """
        is_email = task_type == "Write an Email"

        # ── Content ──────────────────────────────────────────────────────────
        # Discussion weights elaboration more (academic depth is central to the rubric)
        if is_email:
            self.dimension_scores["content"] = round(
                (self.prompt_similarity + self.discourse_coherence + self.elaboration_score) / 3, 3
            )
        else:
            # Elaboration carries 1.5× weight for Discussion (claim-evidence depth)
            self.dimension_scores["content"] = round(
                (self.prompt_similarity + self.discourse_coherence + self.elaboration_score * 1.5) / 3.5, 3
            )

        # ── Syntax ───────────────────────────────────────────────────────────
        self.dimension_scores["syntax"] = round(
            (self.sentence_variety + min(self.clause_complexity / 3.0, 1.0)
             + self.tree_depth_variety + self.sentence_length_variance) / 4, 3
        )

        # ── Lexical ──────────────────────────────────────────────────────────
        # lexical_sophistication (Zipf < 5.0 content words) gets 2× weight
        # because CTTR is less reliable at TOEFL essay lengths (80-150 words)
        # and the collocation PMI proxy is a rough estimate.
        self.dimension_scores["lexical"] = round(
            (self.ttr + self.lexical_sophistication * 2 + self.collocation_score) / 4, 3
        )

        # ── Social Conventions (Email only) ──────────────────────────────────
        # Not a scored ETS dimension for Discussion — omit from dimension_scores.
        # Convention features are still extracted and surfaced as informational signals.
        if is_email:
            convention_signals = [
                self.politeness_score,
                self.register_formality,
                min(self.hedge_count / 3.0, 1.0),   # 3+ hedges = full marks
                min(self.modal_count / 2.0, 1.0),   # 2+ modals = full marks
                1.0 if self.has_greeting else 0.0,
                1.0 if self.has_closing else 0.0,
            ]
            self.dimension_scores["conventions"] = round(
                sum(convention_signals) / len(convention_signals), 3
            )

        # ── Accuracy ─────────────────────────────────────────────────────────
        spelling_penalty = min(self.spelling_error_rate / 5.0, 1.0)  # 5+ per 100w = 0
        mechanical_penalty = min(self.mechanical_error_count / 5.0, 1.0)
        self.dimension_scores["accuracy"] = round(
            1.0 - (spelling_penalty + mechanical_penalty) / 2, 3
        )
