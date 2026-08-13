"""Accuracy feature extraction — spelling errors, mechanical errors."""
from __future__ import annotations

import re
from typing import Optional

from symspellpy import SymSpell, Verbosity

# ── Singleton SymSpell loader ─────────────────────────────────────────────────

_sym_spell: Optional[SymSpell] = None


def _get_symspell() -> SymSpell:
    """Lazy-load SymSpell with its dictionary (one-time ~200ms init)."""
    global _sym_spell
    if _sym_spell is None:
        import importlib.resources as pkg_resources
        import os

        _sym_spell = SymSpell(max_dictionary_edit_distance=2, prefix_length=7)
        # SymSpell ships a frequency dictionary inside the package
        dict_path = os.path.join(
            os.path.dirname(__import__("symspellpy").__file__),
            "frequency_dictionary_en_82_765.txt",
        )
        if os.path.exists(dict_path):
            _sym_spell.load_dictionary(dict_path, term_index=0, count_index=1)
        else:
            # Fallback: try pkg_resources
            import symspellpy
            pkg_dir = os.path.dirname(symspellpy.__file__)
            for fname in os.listdir(pkg_dir):
                if fname.startswith("frequency_dictionary") and fname.endswith(".txt"):
                    _sym_spell.load_dictionary(os.path.join(pkg_dir, fname), term_index=0, count_index=1)
                    break
    return _sym_spell


# ── Words to skip (proper nouns, abbreviations, common TOEFL terms) ───────────

SKIP_WORDS = frozenset([
    "toefl", "ets", "ibt", "email", "emails", "online", "internet",
    "covid", "smartphone", "smartphones", "website", "websites",
    "fadil",
])


def _extract_words(text: str) -> list[str]:
    """Extract individual words for spell checking."""
    # Split on whitespace, strip punctuation from edges
    raw_tokens = re.findall(r"\b[a-zA-Z']+\b", text)
    return [t for t in raw_tokens if len(t) > 1]


def check_spelling(text: str) -> list[str]:
    """Return list of likely misspelled words."""
    sym = _get_symspell()
    words = _extract_words(text)
    misspelled: list[str] = []

    for word in words:
        w_lower = word.lower().strip("'")
        if len(w_lower) <= 2:
            continue
        if w_lower in SKIP_WORDS:
            continue
        # Skip words that look like proper nouns (capitalized)
        if word[0].isupper():
            continue

        suggestions = sym.lookup(w_lower, Verbosity.CLOSEST, max_edit_distance=2)
        if suggestions:
            # If best suggestion IS the word itself, it's correct
            if suggestions[0].term == w_lower:
                continue
            # If edit distance is 0, word is in dictionary
            if suggestions[0].distance == 0:
                continue
            misspelled.append(word)
        else:
            # No suggestions at all — likely misspelled or very rare
            misspelled.append(word)

    # Deduplicate while preserving order
    seen = set()
    unique: list[str] = []
    for w in misspelled:
        wl = w.lower()
        if wl not in seen:
            seen.add(wl)
            unique.append(w)
    return unique


# ── Mechanical errors ─────────────────────────────────────────────────────────

def check_mechanical_errors(text: str) -> list[str]:
    """Detect mechanical/formatting errors in text."""
    errors: list[str] = []

    # Double spaces
    double_spaces = len(re.findall(r"  +", text))
    if double_spaces > 0:
        errors.append(f"Double spaces found ({double_spaces} occurrences)")

    # Missing capitalization after sentence-ending punctuation
    missing_caps = re.findall(r"[.!?]\s+[a-z]", text)
    if missing_caps:
        errors.append(f"Missing capitalization after punctuation ({len(missing_caps)} cases)")

    # Repeated punctuation (e.g., ".." or ",,")
    repeated_punct = re.findall(r"([.!?,;:])\1+", text)
    if repeated_punct:
        errors.append(f"Repeated punctuation ({len(repeated_punct)} cases)")

    # Missing space after punctuation
    no_space_after = re.findall(r"[.!?,;:][a-zA-Z]", text)
    # Filter out common abbreviations and decimals
    real_errors = [m for m in no_space_after if not re.match(r"\.\d", m) and m not in ["e.g", "i.e"]]
    if real_errors:
        errors.append(f"Missing space after punctuation ({len(real_errors)} cases)")

    # Comma splice detection (basic): comma + pronoun/subject starting new clause
    # This is a rough heuristic
    comma_splices = re.findall(
        r",\s+(I|he|she|it|we|they|this|that|there)\s+(is|are|was|were|have|has|had|do|does|did|will|would|can|could)\b",
        text, re.IGNORECASE
    )
    if len(comma_splices) > 1:
        errors.append(f"Possible comma splices ({len(comma_splices)} cases)")

    # Text starts without capital letter
    stripped = text.strip()
    if stripped and stripped[0].islower():
        errors.append("Text does not start with a capital letter")

    return errors


def extract_accuracy(text: str) -> dict:
    """Extract accuracy features.

    Returns: spelling_error_rate, spelling_errors, mechanical_error_count, mechanical_errors.
    """
    word_count = len(text.split()) or 1

    spelling_errors = check_spelling(text)
    spelling_error_rate = (len(spelling_errors) / word_count) * 100

    mechanical_errors = check_mechanical_errors(text)

    return {
        "spelling_error_rate": round(spelling_error_rate, 2),
        "spelling_errors": spelling_errors,
        "mechanical_error_count": len(mechanical_errors),
        "mechanical_errors": mechanical_errors,
    }
