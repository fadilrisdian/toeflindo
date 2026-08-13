"""Syntactic variety feature extraction — parse tree, clauses, sentence types."""
from __future__ import annotations

import math
import re
from collections import Counter
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import spacy.tokens

# ── Lazy spaCy loader ─────────────────────────────────────────────────────────

_nlp = None


def _get_nlp():
    """Lazy-load spaCy model (one-time ~1s init)."""
    global _nlp
    if _nlp is None:
        import spacy
        _nlp = spacy.load("en_core_web_sm")
    return _nlp


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tree_depth(token) -> int:
    """Compute depth of a token in the dependency tree (root = 0)."""
    depth = 0
    current = token
    while current.head != current:
        depth += 1
        current = current.head
        if depth > 50:  # safety guard
            break
    return depth


def _count_clauses(sent) -> int:
    """Count clauses in a sentence by counting clause-introducing deps."""
    clause_deps = {"advcl", "relcl", "acl", "ccomp", "xcomp", "csubj", "csubjpass"}
    count = 1  # main clause
    for token in sent:
        if token.dep_ in clause_deps:
            count += 1
    return count


def _classify_sentence(sent) -> str:
    """Classify sentence as simple/compound/complex/compound-complex."""
    has_coordinating = False
    has_subordinating = False

    clause_deps = {"advcl", "relcl", "acl", "ccomp", "xcomp", "csubj"}
    coord_deps = {"conj"}

    for token in sent:
        if token.dep_ in clause_deps:
            has_subordinating = True
        if token.dep_ in coord_deps and token.pos_ == "VERB":
            has_coordinating = True
        # Also check for coordinating conjunctions connecting clauses
        if token.dep_ == "cc" and token.head.pos_ == "VERB":
            has_coordinating = True

    if has_coordinating and has_subordinating:
        return "compound-complex"
    elif has_subordinating:
        return "complex"
    elif has_coordinating:
        return "compound"
    else:
        return "simple"


def _entropy(distribution: dict) -> float:
    """Compute Shannon entropy of a distribution (normalized 0-1)."""
    total = sum(distribution.values())
    if total == 0:
        return 0.0
    n_categories = len(distribution)
    if n_categories <= 1:
        return 0.0

    probs = [v / total for v in distribution.values() if v > 0]
    raw_entropy = -sum(p * math.log2(p) for p in probs)
    max_entropy = math.log2(n_categories)
    return raw_entropy / max_entropy if max_entropy > 0 else 0.0


def _normalize_stdev(stdev: float, max_expected: float) -> float:
    """Normalize a standard deviation to 0-1 range."""
    return min(stdev / max_expected, 1.0)


# ── Main extraction ───────────────────────────────────────────────────────────

def extract_syntax(text: str) -> dict:
    """Extract syntactic variety features using spaCy.

    Returns: sentence_variety, clause_complexity, tree_depth_variety,
    sentence_length_variance, sentence_types.
    """
    nlp = _get_nlp()
    doc = nlp(text)

    sentences = list(doc.sents)
    if not sentences:
        return {
            "sentence_variety": 0.0,
            "clause_complexity": 0.0,
            "tree_depth_variety": 0.0,
            "sentence_length_variance": 0.0,
            "sentence_types": {},
        }

    # ── Sentence type distribution & entropy ──────────────────────────────
    type_counts: Counter = Counter()
    for sent in sentences:
        stype = _classify_sentence(sent)
        type_counts[stype] += 1

    # Ensure all types are represented (even at 0) for proper entropy calc
    all_types = {"simple", "compound", "complex", "compound-complex"}
    type_dist = {t: type_counts.get(t, 0) for t in all_types}
    sentence_variety = _entropy(type_dist)

    # ── Clause complexity (avg clauses per sentence) ──────────────────────
    clause_counts = [_count_clauses(sent) for sent in sentences]
    clause_complexity = sum(clause_counts) / len(clause_counts) if clause_counts else 0.0

    # ── Parse tree depth variety ──────────────────────────────────────────
    max_depths = []
    for sent in sentences:
        depths = [_tree_depth(token) for token in sent]
        max_depths.append(max(depths) if depths else 0)

    if len(max_depths) > 1:
        mean_depth = sum(max_depths) / len(max_depths)
        stdev_depth = math.sqrt(sum((d - mean_depth) ** 2 for d in max_depths) / len(max_depths))
        tree_depth_variety = _normalize_stdev(stdev_depth, 4.0)  # stdev of 4+ is very varied
    else:
        tree_depth_variety = 0.0

    # ── Sentence length variance ──────────────────────────────────────────
    sent_lengths = [len(sent) for sent in sentences]
    if len(sent_lengths) > 1:
        mean_len = sum(sent_lengths) / len(sent_lengths)
        stdev_len = math.sqrt(sum((l - mean_len) ** 2 for l in sent_lengths) / len(sent_lengths))
        sentence_length_variance = _normalize_stdev(stdev_len, 10.0)  # stdev of 10+ words is very varied
    else:
        sentence_length_variance = 0.0

    return {
        "sentence_variety": round(sentence_variety, 3),
        "clause_complexity": round(clause_complexity, 2),
        "tree_depth_variety": round(tree_depth_variety, 3),
        "sentence_length_variance": round(sentence_length_variance, 3),
        "sentence_types": dict(type_dist),
    }
