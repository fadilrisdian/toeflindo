"""Social conventions feature extraction — hedge words, modals, politeness, register."""
from __future__ import annotations

import re
from collections import Counter

# ── Word lists ────────────────────────────────────────────────────────────────

HEDGE_WORDS = frozenset([
    "perhaps", "maybe", "possibly", "probably", "likely", "unlikely",
    "somewhat", "arguably", "apparently", "seemingly", "roughly",
    "approximately", "generally", "typically", "usually", "often",
    "sometimes", "occasionally", "rarely", "tend", "tends",
    "suggest", "suggests", "might", "may", "could",
    "in my opinion", "i think", "i believe", "it seems", "it appears",
    "to some extent", "more or less", "sort of", "kind of",
])

# Single-word hedges for token matching
HEDGE_TOKENS = frozenset([
    "perhaps", "maybe", "possibly", "probably", "likely", "unlikely",
    "somewhat", "arguably", "apparently", "seemingly", "roughly",
    "approximately", "generally", "typically", "usually", "often",
    "sometimes", "occasionally", "rarely", "tend", "tends",
    "suggest", "suggests",
])

# Multi-word hedges (checked via regex on full text)
HEDGE_PHRASES = [
    r"\bin my opinion\b",
    r"\bi think\b",
    r"\bi believe\b",
    r"\bit seems\b",
    r"\bit appears\b",
    r"\bto some extent\b",
    r"\bmore or less\b",
    r"\bsort of\b",
    r"\bkind of\b",
]

MODAL_VERBS = frozenset([
    "could", "would", "should", "might", "may", "can", "will", "shall", "must",
])

POLITENESS_MARKERS = frozenset([
    "please", "thank", "thanks", "grateful", "appreciate", "appreciated",
    "kindly", "sincerely", "regards", "respectfully",
])

GREETING_PATTERNS = [
    r"^(dear|hi|hello|hey|good morning|good afternoon|good evening)\b",
    r"^(to whom it may concern)\b",
]

CLOSING_PATTERNS = [
    r"(sincerely|regards|best regards|kind regards|best wishes|thank you|thanks)\s*[,.]?\s*$",
    r"(yours truly|respectfully|warm regards|cheers)\s*[,.]?\s*$",
    r"(looking forward to|hope to hear)\b.*$",
]

# Informality indicators
INFORMAL_MARKERS = frozenset([
    "gonna", "wanna", "gotta", "kinda", "sorta", "dunno", "yeah", "yep",
    "nope", "ok", "okay", "lol", "omg", "btw", "imo", "tbh", "idk",
])

CONTRACTION_PATTERN = re.compile(r"\b\w+n't\b|\b\w+'(re|ve|ll|d|s|m)\b", re.IGNORECASE)


def extract_conventions(text: str) -> dict:
    """Extract social convention features from essay text.

    Returns dict with keys: hedge_count, modal_count, has_greeting, has_closing,
    politeness_score, register_formality, hedge_words_found, modal_words_found.
    """
    text_lower = text.lower().strip()
    tokens = re.findall(r"\b[a-z']+\b", text_lower)
    token_count = len(tokens) or 1  # avoid division by zero

    # ── Hedge words ───────────────────────────────────────────────────────
    hedge_count = 0
    hedge_words_found: list[str] = []

    # Single-word hedges
    for token in tokens:
        if token in HEDGE_TOKENS:
            hedge_count += 1
            hedge_words_found.append(token)

    # Multi-word hedges
    for pattern in HEDGE_PHRASES:
        matches = re.findall(pattern, text_lower)
        hedge_count += len(matches)
        hedge_words_found.extend(matches)

    # ── Modal verbs ───────────────────────────────────────────────────────
    modal_count = 0
    modal_words_found: list[str] = []
    for token in tokens:
        if token in MODAL_VERBS:
            modal_count += 1
            modal_words_found.append(token)

    # ── Politeness markers ────────────────────────────────────────────────
    politeness_count = sum(1 for t in tokens if t in POLITENESS_MARKERS)

    # ── Greeting detection ────────────────────────────────────────────────
    first_line = text_lower.split("\n")[0].strip()
    has_greeting = any(re.search(p, first_line) for p in GREETING_PATTERNS)

    # ── Closing detection ─────────────────────────────────────────────────
    last_lines = "\n".join(text_lower.split("\n")[-3:])
    has_closing = any(re.search(p, last_lines, re.MULTILINE) for p in CLOSING_PATTERNS)

    # ── Politeness score (0-1) ────────────────────────────────────────────
    # Combines: greeting, closing, politeness words, modals used politely
    politeness_signals = [
        1.0 if has_greeting else 0.0,
        1.0 if has_closing else 0.0,
        min(politeness_count / 3.0, 1.0),
        min(modal_count / 3.0, 1.0),
    ]
    politeness_score = sum(politeness_signals) / len(politeness_signals)

    # ── Register formality (0-1, higher = more formal) ────────────────────
    informal_count = sum(1 for t in tokens if t in INFORMAL_MARKERS)
    contraction_count = len(CONTRACTION_PATTERN.findall(text))

    # Formality = 1 - (informal signals normalized)
    informal_density = (informal_count + contraction_count) / token_count
    # Cap at 0.2 density (20% informal = fully informal)
    register_formality = max(0.0, 1.0 - informal_density / 0.2)

    return {
        "hedge_count": hedge_count,
        "hedge_words_found": hedge_words_found,
        "modal_count": modal_count,
        "modal_words_found": modal_words_found,
        "has_greeting": has_greeting,
        "has_closing": has_closing,
        "politeness_score": round(politeness_score, 3),
        "register_formality": round(register_formality, 3),
    }
