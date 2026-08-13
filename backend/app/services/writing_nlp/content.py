"""Content feature extraction — prompt similarity, discourse coherence, elaboration.

Uses the external embedding-service (HTTP) instead of loading the model locally.
"""
from __future__ import annotations

import math
import os
import re
from typing import Optional

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)

# ── Embedding service client ──────────────────────────────────────────────────

EMBEDDING_SERVICE_URL = os.environ.get("EMBEDDING_SERVICE_URL", "http://embedding-service:8100")


def _compute_similarity(text_a: str, text_b: str) -> float:
    """Call embedding service /similarity endpoint."""
    resp = httpx.post(
        f"{EMBEDDING_SERVICE_URL}/similarity",
        json={"text_a": text_a, "text_b": text_b},
        timeout=60.0,
    )
    resp.raise_for_status()
    return resp.json()["similarity"]


def _compute_pairwise(sentences: list[str]) -> dict:
    """Call embedding service /pairwise endpoint."""
    resp = httpx.post(
        f"{EMBEDDING_SERVICE_URL}/pairwise",
        json={"sentences": sentences},
        timeout=60.0,
    )
    resp.raise_for_status()
    return resp.json()


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences (simple regex-based)."""
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text.strip())
    sentences = [s.strip() for s in parts if s.strip() and len(s.strip()) > 5]
    return sentences


# ── Feature extractors ────────────────────────────────────────────────────────

def compute_prompt_similarity(essay: str, prompt: str) -> float:
    """Cosine similarity between essay and prompt embeddings.

    Measures how well the student addressed the given topic.
    Returns 0-1 (higher = more on-topic).
    """
    if not prompt.strip() or not essay.strip():
        return 0.0

    sim = _compute_similarity(essay, prompt)
    # Normalize: 0.3 → 0, 0.9 → 1
    normalized = max(0.0, min(1.0, (sim - 0.3) / 0.6))
    return normalized


def compute_discourse_coherence(essay: str) -> float:
    """Average cosine similarity between adjacent sentences.

    Measures how smoothly ideas flow from one sentence to the next.
    Returns 0-1 (higher = more coherent).
    """
    sentences = _split_sentences(essay)
    if len(sentences) < 2:
        return 1.0  # single sentence = trivially coherent

    result = _compute_pairwise(sentences)
    avg_sim = result["average"]
    # Normalize: 0.2 → 0, 0.8 → 1
    normalized = max(0.0, min(1.0, (avg_sim - 0.2) / 0.6))
    return normalized


def compute_elaboration(essay: str) -> float:
    """Proxy for elaboration: combination of sentence count and average sentence length.

    A well-elaborated essay has enough sentences with sufficient detail each.
    Returns 0-1.
    """
    sentences = _split_sentences(essay)
    if not sentences:
        return 0.0

    n_sentences = len(sentences)
    avg_words = sum(len(s.split()) for s in sentences) / n_sentences

    # Ideal for TOEFL: 8-12 sentences, 12-18 words per sentence
    sent_score = min(n_sentences / 8.0, 1.0)
    len_score = min(avg_words / 15.0, 1.0)

    # Combined: geometric mean
    return math.sqrt(sent_score * len_score)


def extract_content(essay: str, prompt: str) -> dict:
    """Extract all content features.

    Returns: prompt_similarity, discourse_coherence, elaboration_score.
    """
    return {
        "prompt_similarity": round(compute_prompt_similarity(essay, prompt), 3),
        "discourse_coherence": round(compute_discourse_coherence(essay), 3),
        "elaboration_score": round(compute_elaboration(essay), 3),
    }
