"""Grammar type normalisation, sub_type normalisation, and task display text helpers."""
import sqlite3

# ── Canonical grammar_type normalisation ──────────────────────────────────────

_GRAMMAR_MAP: dict[str, str] = {
    # ── Canonical LLM types (new constrained prompts) ────────────────────────
    "Article Error": "Articles",
    "Preposition Error": "Prepositions",
    "Verb Form Error": "Verb Forms",
    "Verb Tense Error": "Tenses",
    "Subject-Verb Agreement": "Subject-Verb Agreement",
    "Word Choice": "Vocabulary",
    "Pronoun Error": "Pronouns",
    "Modal Error": "Modals",
    "Plural/Singular Error": "Plurals",
    "Phrasal Verb Error": "Phrasal Verbs",
    "Run-on Sentence": "Sentence Structure",
    "Word Order": "Word Order",
    # ── Legacy/variant LLM labels ─────────────────────────────────────────────
    "Article/Pronoun Drop": "Articles",
    "Article Drop": "Articles",
    "Word Form Error": "Verb Forms",       # old name
    "Verb Form": "Verb Forms",
    "Tense Error": "Tenses",
    "Singular/Plural Error": "Plurals",
    "Plural/Singular": "Plurals",
    "Plural -s Dropped": "Plurals",
    "Punctuation Error": "Sentence Structure",
    "Sentence structure": "Sentence Structure",
    "Question Formation": "Questions",
    "Question formation": "Questions",
    "Relative Clause Error": "Relative Clauses",
    "Pronoun reference": "Pronouns",
    "Preposition": "Prepositions",
    "Word Substitution": "Vocabulary",
    "Word Substitution (Similar Sound)": "Vocabulary",
    "Word choice": "Vocabulary",
    "Idiomatic expression": "Vocabulary",
    "Word order": "Word Order",
    "Register": "Vocabulary",
    "Spelling Error": "Vocabulary",
    "Missing closing name": "Vocabulary",
}


def normalize_grammar_type(ai_type: str) -> str:
    if not ai_type:
        return ""
    return _GRAMMAR_MAP.get(ai_type, ai_type)


# Reverse map: normalized category name → canonical LLM grammar_type key
# Used by normalize_sub_type() to handle callers that pass the category name
# ("Tenses") instead of the LLM string ("Verb Tense Error").
_CATEGORY_TO_LLM_TYPE: dict[str, str] = {}

def _build_category_to_llm_map() -> None:
    seen: dict[str, str] = {}
    for llm_key, category in _GRAMMAR_MAP.items():
        # Keep the first (canonical) LLM key for each category
        if category not in seen:
            seen[category] = llm_key
    _CATEGORY_TO_LLM_TYPE.update(seen)

_build_category_to_llm_map()


# ── Single source of truth for sub_type lists ─────────────────────────────────
#
# Keys = LLM-constrained grammar_type strings.
# Values = list of canonical sub_type strings (must match grammar_topic_map seed).
# All three services (writing, speaking, BAS) generate their prompts from this dict.

VALID_SUB_TYPES: dict[str, list[str]] = {
    "Article Error": [
        "a/an", "the", "no article", "countable uncountable",
    ],
    "Preposition Error": [
        "preposition of time", "preposition of place",
        "preposition after noun", "preposition after adjective",
        "preposition after verb",
    ],
    "Verb Form Error": [
        "verb + ing", "verb + infinitive", "verb ing or infinitive",
        "passive voice", "reported speech", "ing clause",
    ],
    "Verb Tense Error": [
        "present simple", "present continuous", "present simple vs continuous",
        "past simple", "past continuous",
        "present perfect", "present perfect continuous", "present perfect vs past",
        "past perfect", "past perfect continuous",
        "future going to", "future will", "future continuous",
        "used to",
        "conditional",          # e.g. "If I will go" → wrong tense inside conditional clause
    ],
    "Subject-Verb Agreement": ["subject-verb agreement"],
    "Word Choice": ["adjective form", "adverb form", "comparison", "collocation", "word register", "idiomatic expression"],
    "Pronoun Error": ["reflexive pronoun"],
    "Modal Error": [
        "can/could ability", "must/can't certainty", "may/might possibility",
        "have to/must obligation", "should advice", "would",
        "requests/offers/permission",
    ],
    "Plural/Singular Error": ["singular/plural"],
    "Phrasal Verb Error": [
        "phrasal verb in/out", "phrasal verb on/off",
        "phrasal verb up/down", "phrasal verb away/back",
    ],
    "Run-on Sentence": ["run-on sentence", "connectors", "conditional"],
    "Word Order": ["verb object place time", "adverb position"],
}

# ── sub_type variant → canonical map ─────────────────────────────────────────
#
# Handles common LLM capitalization/spacing deviations from the canonical strings.
# Lookup key = stripped lowercase of whatever the LLM returns.

_SUB_TYPE_NORMALIZE_MAP: dict[str, str] = {}

def _build_sub_type_map() -> None:
    """Populate _SUB_TYPE_NORMALIZE_MAP from VALID_SUB_TYPES + known variants."""
    for sub_types in VALID_SUB_TYPES.values():
        for s in sub_types:
            _SUB_TYPE_NORMALIZE_MAP[s.lower()] = s

    # Spacing variants around "+"
    for raw, canonical in [
        ("verb+ing",                 "verb + ing"),
        ("verb+infinitive",          "verb + infinitive"),
        ("verb + to infinitive",     "verb + infinitive"),
        ("verb to infinitive",       "verb + infinitive"),
        ("to infinitive",            "verb + infinitive"),
        ("verb ing/infinitive",      "verb ing or infinitive"),
        ("verb ing / infinitive",    "verb ing or infinitive"),
        # Tense aliases
        ("present simple/continuous",       "present simple vs continuous"),
        ("present simple / continuous",     "present simple vs continuous"),
        ("pres simple vs cont",             "present simple vs continuous"),
        ("present perfect/past",            "present perfect vs past"),
        ("present perfect / past simple",   "present perfect vs past"),
        ("past perfect cont",               "past perfect continuous"),
        ("future (will)",                   "future will"),
        ("future (going to)",               "future going to"),
        ("future: will",                    "future will"),
        ("future: going to",                "future going to"),
        # Modal aliases
        ("have to / must",          "have to/must obligation"),
        ("must/can't",              "must/can't certainty"),
        ("can / could",             "can/could ability"),
        ("may / might",             "may/might possibility"),
        # Misc
        ("subject verb agreement",  "subject-verb agreement"),
        ("subject-verb",            "subject-verb agreement"),
        ("singular plural",         "singular/plural"),
        ("plural singular",         "singular/plural"),
        ("a / an",                  "a/an"),
        ("a or an",                 "a/an"),
        ("no article needed",       "no article"),
        ("countable/uncountable",   "countable uncountable"),
        ("reflexive",               "reflexive pronoun"),
        ("adverb placement",        "adverb position"),
        ("place time order",        "verb object place time"),
        ("svo order",               "verb object place time"),
        ("conditional sentence",        "conditional"),
        ("if clause",                   "conditional"),
        ("if-clause",                   "conditional"),
        # Word Choice extras
        ("collocation error",           "collocation"),
        ("collocations",                "collocation"),
        ("word collocation",            "collocation"),
        ("register",                    "word register"),
        ("formal/informal",             "word register"),
        ("formal informal",             "word register"),
        ("idiom",                       "idiomatic expression"),
        ("idiomatic",                   "idiomatic expression"),
        ("idioms",                      "idiomatic expression"),
        ("idiomatic usage",             "idiomatic expression"),
    ]:
        _SUB_TYPE_NORMALIZE_MAP[raw.lower()] = canonical

_build_sub_type_map()


def normalize_sub_type(grammar_type: str, sub_type: str) -> str:
    """Return the canonical sub_type string, or '' if unrecognised or mismatched.

    Steps:
    1. Normalise spelling/spacing variants via _SUB_TYPE_NORMALIZE_MAP.
    2. Cross-validate: the canonical value must belong to VALID_SUB_TYPES[grammar_type].
       If it doesn't (LLM returned a sub_type from the wrong category), return '' so
       the caller falls back to broad category Murphy units rather than storing junk.
    Returns '' for empty input or any unrecognised/mismatched value.
    """
    if not sub_type:
        return ""
    cleaned = sub_type.strip()

    # Step 1 — normalise to canonical form
    canonical = (
        _SUB_TYPE_NORMALIZE_MAP.get(cleaned)
        or _SUB_TYPE_NORMALIZE_MAP.get(cleaned.lower())
    )
    if canonical is None:
        # Already canonical if it lives in the flat valid set
        all_valid = {s for sub_types in VALID_SUB_TYPES.values() for s in sub_types}
        canonical = cleaned if cleaned in all_valid else None

    if canonical is None:
        return ""

    # Step 2 — cross-validate against the grammar_type bucket.
    # VALID_SUB_TYPES keys are LLM-constrained strings ("Article Error").
    # Callers may pass the LLM string ("Article Error"), the normalized category
    # name ("Articles"), or an alias — try all three lookups.
    allowed = VALID_SUB_TYPES.get(grammar_type)              # direct LLM key hit
    if allowed is None:
        allowed = VALID_SUB_TYPES.get(_CATEGORY_TO_LLM_TYPE.get(grammar_type, ""), [])
    if canonical not in allowed:
        import logging as _logging
        _logging.getLogger(__name__).warning(
            "sub_type cross-validation mismatch: grammar_type=%r sub_type=%r "
            "(canonical=%r not in allowed values) — clearing",
            grammar_type, sub_type, canonical,
        )
        return ""

    return canonical


# ── Prompt-block generator ────────────────────────────────────────────────────

def sub_type_prompt_block(exclude_grammar_types: set[str] | None = None) -> str:
    """Return the sub_type constraint bullet list for LLM prompts.

    exclude_grammar_types: omit those keys (e.g. {"Word Order"} for scoring prompts
    that don't include Word Order as a valid grammar_type).
    """
    lines = []
    for gtype, sub_types in VALID_SUB_TYPES.items():
        if exclude_grammar_types and gtype in exclude_grammar_types:
            continue
        values = " / ".join(f'"{s}"' for s in sub_types)
        lines.append(f"- {gtype} → {values}")
    return "\n".join(lines)


def sub_type_prompt_block_inline(exclude_grammar_types: set[str] | None = None) -> str:
    """Compact single-string version for inline prompt use (speaking service)."""
    parts = []
    for gtype, sub_types in VALID_SUB_TYPES.items():
        if exclude_grammar_types and gtype in exclude_grammar_types:
            continue
        values = " / ".join(f'"{s}"' for s in sub_types)
        parts.append(f"{gtype} → {values}")
    return "; ".join(parts)


# ── Remediation helpers ────────────────────────────────────────────────────────
#
# TREATABILITY: rule-governed errors get an explicit rule + generation practice.
# Untreatable: idiomatic/collocational errors get model sentences + exposure only.

_TREATABILITY_MAP: dict[str, str] = {
    # treatable — rule-governed
    "Article Error":           "treatable",
    "Verb Tense Error":        "treatable",
    "Verb Form Error":         "treatable",
    "Subject-Verb Agreement":  "treatable",
    "Plural/Singular Error":   "treatable",
    "Pronoun Error":           "treatable",
    "Modal Error":             "treatable",
    "Run-on Sentence":         "treatable",
    "Word Order":              "treatable",
    # untreatable — collocational / idiomatic / register
    "Word Choice":             "untreatable",
    "Phrasal Verb Error":      "untreatable",
    "Preposition Error":       "untreatable",
}

# Canonical category names (post-normalization) → same classification
_TREATABILITY_CATEGORY_MAP: dict[str, str] = {
    "Articles":               "treatable",
    "Tenses":                 "treatable",
    "Verb Forms":             "treatable",
    "Subject-Verb Agreement": "treatable",
    "Plurals":                "treatable",
    "Pronouns":               "treatable",
    "Modals":                 "treatable",
    "Sentence Structure":     "treatable",
    "Word Order":             "treatable",
    "Questions":              "treatable",
    "Relative Clauses":       "treatable",
    "Vocabulary":             "untreatable",
    "Phrasal Verbs":          "untreatable",
    "Prepositions":           "untreatable",
}


def get_treatability(grammar_type: str) -> str:
    """Return 'treatable' or 'untreatable' for a grammar_type string.

    Accepts both LLM strings ('Article Error') and canonical category names ('Articles').
    Falls back to 'treatable' for unknown types (rule-of-thumb: default to explicit feedback).
    """
    result = (
        _TREATABILITY_MAP.get(grammar_type)
        or _TREATABILITY_CATEGORY_MAP.get(grammar_type)
    )
    if result is None:
        # Try normalized category name
        normalized = normalize_grammar_type(grammar_type)
        result = _TREATABILITY_CATEGORY_MAP.get(normalized, "treatable")
    return result


# RUBRIC_DIMENSION: which ETS rubric dimension this error type belongs to.
# Scoped to Grammar/Language Use and Vocabulary (the two linguistic dimensions
# that fit a sentence-level wrong/correct pair). Coherence & Cohesion and
# Task/Development are paragraph-level and handled separately by the scoring rubric.

_RUBRIC_DIMENSION_MAP: dict[str, str] = {
    # Grammar & Language Use dimension
    "Article Error":           "grammar",
    "Verb Tense Error":        "grammar",
    "Verb Form Error":         "grammar",
    "Subject-Verb Agreement":  "grammar",
    "Plural/Singular Error":   "grammar",
    "Pronoun Error":           "grammar",
    "Modal Error":             "grammar",
    "Run-on Sentence":         "grammar",
    "Word Order":              "grammar",
    # Vocabulary dimension
    "Word Choice":             "vocabulary",
    "Phrasal Verb Error":      "vocabulary",
    "Preposition Error":       "vocabulary",
}

_RUBRIC_DIMENSION_CATEGORY_MAP: dict[str, str] = {
    "Articles":               "grammar",
    "Tenses":                 "grammar",
    "Verb Forms":             "grammar",
    "Subject-Verb Agreement": "grammar",
    "Plurals":                "grammar",
    "Pronouns":               "grammar",
    "Modals":                 "grammar",
    "Sentence Structure":     "grammar",
    "Word Order":             "grammar",
    "Questions":              "grammar",
    "Relative Clauses":       "grammar",
    "Vocabulary":             "vocabulary",
    "Phrasal Verbs":          "vocabulary",
    "Prepositions":           "vocabulary",
}


def get_rubric_dimension(grammar_type: str) -> str:
    """Return 'grammar' or 'vocabulary' for a grammar_type string."""
    result = (
        _RUBRIC_DIMENSION_MAP.get(grammar_type)
        or _RUBRIC_DIMENSION_CATEGORY_MAP.get(grammar_type)
    )
    if result is None:
        normalized = normalize_grammar_type(grammar_type)
        result = _RUBRIC_DIMENSION_CATEGORY_MAP.get(normalized, "grammar")
    return result


# ── Writing elicitation map ───────────────────────────────────────────────────
#
# Maps grammar_type (canonical category name) → a dict with:
#   "context":  1-sentence hint for what writing scenario elicits this structure
#   "tip":      student-facing instruction to embed in writing
#   "prompt_note": extra note injected into the LLM scoring prompt so it pays
#                  attention to this structure when evaluating the essay
#
# Used by get_writing_focus() to build the daily grammar focus callout.

_GRAMMAR_ELICITATION_MAP: dict[str, dict] = {
    "Tenses": {
        "context": "narrative or sequence-of-events writing",
        "tip": "Try writing about a sequence of events — this will naturally require switching between past, present perfect, and past perfect tenses.",
        "prompt_note": "The student is actively working on verb tense accuracy. Pay particular attention to tense consistency, correct use of past simple vs present perfect, and past perfect for completed-before-another-past-action sequences.",
    },
    "Verb Forms": {
        "context": "process description or advice writing",
        "tip": "Try writing about a process (how to do something) or giving advice — this will require gerunds, infinitives, and passive voice.",
        "prompt_note": "The student is working on verb form accuracy (gerunds, infinitives, passive voice, reported speech). Note any verb form errors carefully.",
    },
    "Articles": {
        "context": "descriptive or argumentative writing about specific things",
        "tip": "When you introduce a new noun, use 'a/an'. When you refer to it again or it's specific, use 'the'. Uncountable nouns get no article.",
        "prompt_note": "The student is actively working on article usage (a/an/the/zero article). Flag any article errors explicitly in your grammar_mistakes output.",
    },
    "Modals": {
        "context": "opinion, advice, or hypothetical writing",
        "tip": "Express recommendations (should/ought to), possibilities (might/could), and certainty (must/can't) where appropriate.",
        "prompt_note": "The student is working on modal verb accuracy. Note misuse of modals for obligation, possibility, certainty, or advice.",
    },
    "Prepositions": {
        "context": "descriptive writing about places, times, or relationships",
        "tip": "Pay extra attention to prepositions of time (at/on/in), place, and verb collocations (depend on, interested in, good at).",
        "prompt_note": "The student is working on preposition accuracy. Flag preposition errors in time expressions, place expressions, and fixed collocations.",
    },
    "Subject-Verb Agreement": {
        "context": "any formal writing with complex noun phrases",
        "tip": "When your subject is separated from the verb by a clause or phrase, re-read the sentence to confirm your verb agrees with the main subject.",
        "prompt_note": "The student is working on subject-verb agreement. Note any agreement errors, especially with complex subjects or intervening phrases.",
    },
    "Pronouns": {
        "context": "argumentative or narrative writing referencing people",
        "tip": "When using pronouns (he/she/they/it), make sure the reference is unambiguous — the reader should always know who/what the pronoun refers to.",
        "prompt_note": "The student is working on pronoun reference clarity. Note ambiguous or incorrect pronoun references.",
    },
    "Plurals": {
        "context": "any descriptive or argumentative writing",
        "tip": "Double-check count nouns — irregular plurals (data, phenomena, criteria) and nouns that look singular but are plural.",
        "prompt_note": "The student is working on plural/singular accuracy. Flag missing plural -s, irregular plurals, and uncountable-noun errors.",
    },
    "Vocabulary": {
        "context": "any writing requiring precise or academic word choice",
        "tip": "Try to use precise collocations (make a decision, carry out research) rather than approximate substitutes.",
        "prompt_note": "The student is working on lexical accuracy and collocation. Note word choice errors and awkward collocations.",
    },
    "Phrasal Verbs": {
        "context": "informal or semi-formal writing involving actions",
        "tip": "Where natural, try using phrasal verbs correctly (carry out, come up with, look into) — but only where they fit the register.",
        "prompt_note": "The student is working on phrasal verb usage. Note incorrect or awkward use of phrasal verbs.",
    },
    "Sentence Structure": {
        "context": "argumentative or expository writing",
        "tip": "Vary your sentence structure — mix short direct sentences with longer complex ones using connectors (although, whereas, which).",
        "prompt_note": "The student is working on sentence structure and run-on sentences. Note run-ons, comma splices, and unclear connectors.",
    },
    "Word Order": {
        "context": "any writing",
        "tip": "In English, adverbs of frequency go before the main verb but after 'be'. Time/place phrases usually go at the end.",
        "prompt_note": "The student is working on word order. Note misplaced adverbs, inverted word order, and verb-object-place-time sequencing.",
    },
    "Questions": {
        "context": "academic discussion writing that references others' views",
        "tip": "If embedding questions as indirect speech, use statement word order ('I wonder whether X is true', not 'I wonder whether is X true').",
        "prompt_note": "The student is working on question formation. Note incorrect auxiliary use or word order in direct/indirect questions.",
    },
    "Relative Clauses": {
        "context": "descriptive or argumentative writing with complex noun phrases",
        "tip": "Use relative clauses to add information about a noun (who/that for people, which for things, whose for possession). Use commas for non-defining clauses.",
        "prompt_note": "The student is working on relative clause formation. Note which/who/that confusion and comma usage in non-defining clauses.",
    },
}


def get_grammar_focus_hints(grammar_types: list[str]) -> list[dict]:
    """Given a list of canonical grammar_type names due for review,
    return the elicitation data for each one that has an entry in the map.

    Returns up to 3 items ordered by specificity (most specific first).
    """
    results = []
    for gt in grammar_types:
        entry = (
            _GRAMMAR_ELICITATION_MAP.get(gt)
            or _GRAMMAR_ELICITATION_MAP.get(normalize_grammar_type(gt))
        )
        if entry:
            results.append({"grammar_type": gt, **entry})
        if len(results) >= 3:
            break
    return results


# ── Task display text ──────────────────────────────────────────────────────────


def task_display_text(task: sqlite3.Row) -> str:
    """Return human-readable snippet for a task bank row.

    For L&R / Interview rows the question field holds an audio file path —
    the actual sentence/topic text is in the answer field.
    Falls back to a title-cased filename stem when answer is empty or a
    placeholder like 'Audio prompt - no text answer'.
    """
    import os as _os
    question = task["question"] or ""
    try:
        answer = task["answer"] or ""
    except IndexError:
        answer = ""

    if "/" in question and (question.endswith(".mp3") or question.endswith(".wav")):
        _PLACEHOLDER = "Audio prompt - no text answer"
        if answer and answer != _PLACEHOLDER:
            return answer[:80].replace("\n", " ").strip()
        # Derive readable label from filename stem
        stem = _os.path.splitext(_os.path.basename(question))[0]
        return stem.replace("_", " ").replace("-", " ").title()[:80]

    return question[:80].replace("\n", " ").strip()
