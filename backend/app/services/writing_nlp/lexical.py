"""Lexical richness feature extraction — TTR, word frequency bands, sophistication."""
from __future__ import annotations

import math
import re
from collections import Counter
from typing import Optional

from wordfreq import zipf_frequency

# ── Frequency band thresholds (Zipf scale) ────────────────────────────────────
# Zipf scale: 7 = extremely common ("the"), 1 = very rare, 0 = not found
# We classify content words into bands based on their Zipf frequency.

BAND_THRESHOLDS = [
    ("top_1k", 5.5),      # zipf >= 5.5 → top ~1000 words
    ("top_2k", 5.0),      # zipf >= 5.0 → top ~2000 words
    ("top_5k", 4.3),      # zipf >= 4.3 → top ~5000 words
    ("academic", 3.5),    # zipf >= 3.5 → academic-level
    ("advanced", 2.5),    # zipf >= 2.5 → advanced
    ("rare", 0.0),        # zipf < 2.5 → rare/specialized
]

# Function words to exclude from lexical analysis
FUNCTION_WORDS = frozenset([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "must",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
    "us", "them", "my", "your", "his", "its", "our", "their",
    "this", "that", "these", "those", "what", "which", "who", "whom",
    "and", "or", "but", "nor", "for", "yet", "so",
    "in", "on", "at", "to", "from", "by", "with", "of", "about",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "under", "over", "up", "down", "out", "off",
    "if", "then", "than", "because", "since", "while", "although",
    "not", "no", "very", "too", "also", "just", "only", "more", "most",
    "there", "here", "when", "where", "how", "all", "each", "every",
    "both", "few", "many", "much", "some", "any", "other", "another",
    "as", "still", "already", "even",
])


def _get_content_words(text: str) -> list[str]:
    """Extract content words (nouns, verbs, adjectives, adverbs) by filtering function words."""
    tokens = re.findall(r"\b[a-z]+\b", text.lower())
    return [t for t in tokens if t not in FUNCTION_WORDS and len(t) > 2]


def _get_frequency_band(word: str) -> str:
    """Classify a word into a frequency band using Zipf scale."""
    freq = zipf_frequency(word, "en")
    for band_name, threshold in BAND_THRESHOLDS:
        if freq >= threshold:
            return band_name
    return "rare"


def compute_ttr(text: str) -> float:
    """Compute Corrected Type-Token Ratio (CTTR = types / sqrt(2 * tokens)).

    CTTR is more robust to text length than simple TTR.
    Normalized to 0-1 range (CTTR of 10+ is exceptional writing).
    """
    tokens = re.findall(r"\b[a-z]+\b", text.lower())
    if len(tokens) < 2:
        return 0.0
    types = len(set(tokens))
    cttr = types / math.sqrt(2 * len(tokens))
    # Normalize: CTTR typically ranges 4-10 for TOEFL essays
    return min(cttr / 10.0, 1.0)


def compute_lexical_sophistication(text: str) -> tuple[float, list[str]]:
    """Fraction of content words NOT in the top 2000 most frequent (zipf < 5.0).

    Returns (score, word_list) where word_list contains the actual sophisticated
    words found — same pattern as spelling_errors for frontend highlighting.
    """
    content_words = _get_content_words(text)
    if not content_words:
        return 0.0, []
    sophisticated = [
        w for w in content_words
        if zipf_frequency(w, "en") < 5.0  # below top-2k threshold
    ]
    # Deduplicate while preserving order of first occurrence
    seen: set[str] = set()
    unique_sophisticated: list[str] = []
    for w in sophisticated:
        if w not in seen:
            seen.add(w)
            unique_sophisticated.append(w)
    score = len(sophisticated) / len(content_words)
    return score, unique_sophisticated


def compute_frequency_bands(text: str) -> dict[str, float]:
    """Distribution of content words across frequency bands."""
    content_words = _get_content_words(text)
    if not content_words:
        return {band: 0.0 for band, _ in BAND_THRESHOLDS}

    band_counts: Counter = Counter()
    for word in content_words:
        band = _get_frequency_band(word)
        band_counts[band] += 1

    total = len(content_words)
    return {
        band: round(band_counts.get(band, 0) / total, 3)
        for band, _ in BAND_THRESHOLDS
    }


def compute_collocation_score(text: str) -> float:
    """Estimate collocation naturalness using bigram frequency ratios.

    For each bigram of content words, compare bigram frequency to individual
    word frequencies. High ratio = natural collocation.

    Simplified PMI proxy: uses wordfreq for individual words and checks if
    the bigram itself appears in the frequency list.
    """
    tokens = re.findall(r"\b[a-z]+\b", text.lower())
    # Filter to content words but keep order
    content_indices = [i for i, t in enumerate(tokens) if t not in FUNCTION_WORDS and len(t) > 2]

    if len(content_indices) < 2:
        return 0.5  # neutral score for very short text

    bigram_scores: list[float] = []
    for idx in range(len(content_indices) - 1):
        i, j = content_indices[idx], content_indices[idx + 1]
        if j - i > 3:  # skip if content words are too far apart
            continue
        w1, w2 = tokens[i], tokens[j]
        bigram = f"{w1} {w2}"

        # Get frequencies
        f_w1 = zipf_frequency(w1, "en")
        f_w2 = zipf_frequency(w2, "en")
        f_bigram = zipf_frequency(bigram, "en")

        if f_w1 == 0 or f_w2 == 0:
            continue

        # PMI proxy: how much more frequent is the bigram than expected?
        # If bigram frequency is close to min(w1, w2), it's a natural collocation
        expected = min(f_w1, f_w2) - 1.5  # rough expected floor
        if f_bigram > 0:
            pmi_proxy = min((f_bigram - expected + 2) / 4.0, 1.0)
        else:
            # Bigram not in frequency list — might be unusual but not necessarily wrong
            pmi_proxy = 0.4
        bigram_scores.append(max(0.0, pmi_proxy))

    if not bigram_scores:
        return 0.5
    return sum(bigram_scores) / len(bigram_scores)


def extract_lexical(text: str) -> dict:
    """Extract all lexical features.

    Returns dict with: ttr, lexical_sophistication, sophisticated_words,
    frequency_band_dist, collocation_score.
    """
    soph_score, soph_words = compute_lexical_sophistication(text)
    return {
        "ttr": round(compute_ttr(text), 3),
        "lexical_sophistication": round(soph_score, 3),
        "sophisticated_words": soph_words,
        "frequency_band_dist": compute_frequency_bands(text),
        "collocation_score": round(compute_collocation_score(text), 3),
    }
