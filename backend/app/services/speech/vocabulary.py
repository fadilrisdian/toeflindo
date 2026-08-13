"""
Vocabulary module.
Evaluates vocabulary richness, repetition, word appropriateness, CEFR level,
synonym suggestions, and improvement suggestions via the shared LLM client.
"""
from __future__ import annotations

from app.clients.llm import call_llm_json
from app.core.logging import get_logger

logger = get_logger(__name__)

VOCABULARY_PROMPT = """You are a TOEFL speaking vocabulary evaluator.

Analyze the vocabulary in this spoken English transcript.

Transcript:
"{transcript}"

Return a JSON object with this exact structure:
{{
  "score": <float 1.0-6.0>,
  "feedback": [<string>, ...],
  "cefr_level": <"A1"|"A2"|"B1"|"B2"|"C1"|"C2">,
  "suggestions": [
    {{"word": <used word>, "replacement": <better word/phrase>, "reason": <brief reason>}},
    ...
  ],
  "repeated_words": [<word>, ...],
  "synonym_suggestions": [
    {{"overused_word": <word used too often>, "synonyms": [<synonym1>, <synonym2>, <synonym3>]}},
    ...
  ],
  "vocabulary_diversity": {{
    "score": <float 1.0-6.0>,
    "type_token_ratio": <float 0.0-1.0 estimate>,
    "diversity_tip": <one short actionable tip to improve vocabulary diversity>
  }}
}}

Scoring guide (1-6 scale):
- 6.0: Rich, varied vocabulary; precise word choice; C1-C2 level
- 5.0: Good range; occasional imprecise word; B2-C1 level
- 4.0: Adequate vocabulary; some repetition; B1-B2 level
- 3.0: Limited range; frequent repetition; A2-B1 level
- 2.0: Very limited; mostly basic words; A2 level
- 1.0: Extremely limited or mostly non-English; A1 level

Consider:
- Vocabulary range and richness
- Overused/repeated content words (e.g., 'good', 'nice', 'happy', 'thing')
- Precision of word choice for the context
- Use of collocations and phrases
- Academic/formal register for TOEFL context

For synonym_suggestions: identify up to 3 overused simple words (like 'good', 'nice',
'happy', 'bad', 'thing', 'a lot') and provide 3 synonyms each.
Return at most 5 suggestions and 5 repeated words.
Return ONLY the JSON object, no markdown, no extra text."""


_VOCAB_DIVERSITY_DEFAULT = {
    "score": 3.0,
    "type_token_ratio": 0.5,
    "diversity_tip": "Find synonyms for common adjectives like 'good' or 'nice' to vary your word choice.",
}


def analyze(transcript: str) -> dict:
    """Returns vocabulary score (1-6), feedback, and improvement suggestions."""
    if not transcript or len(transcript.strip()) < 5:
        return {
            "score": 1.0,
            "feedback": ["No speech to analyze."],
            "cefr_level": "A1",
            "suggestions": [],
            "repeated_words": [],
            "synonym_suggestions": [],
            "vocabulary_diversity": dict(_VOCAB_DIVERSITY_DEFAULT),
        }

    try:
        result = call_llm_json(
            messages=[{"role": "user", "content": VOCABULARY_PROMPT.format(transcript=transcript)}],
            temperature=0.2,
            max_tokens=4000,
            models=["openai/gpt-oss-20b"],
            label="speech/vocabulary",
        )
    except Exception:
        return {
            "score": 3.0,
            "feedback": ["Vocabulary analysis unavailable — retry later."],
            "cefr_level": "B1",
            "suggestions": [],
            "repeated_words": [],
            "synonym_suggestions": [],
            "vocabulary_diversity": dict(_VOCAB_DIVERSITY_DEFAULT),
        }

    result["score"] = round(max(1.0, min(6.0, float(result.get("score", 3.0)))), 2)
    result.setdefault("feedback", [])
    result.setdefault("cefr_level", "B1")
    result.setdefault("suggestions", [])
    result.setdefault("repeated_words", [])
    result.setdefault("synonym_suggestions", [])

    vd = result.get("vocabulary_diversity")
    if not isinstance(vd, dict):
        vd = {}
    vd["score"] = round(max(1.0, min(6.0, float(vd.get("score", 3.0)))), 2)
    vd.setdefault("type_token_ratio", 0.5)
    vd.setdefault("diversity_tip", _VOCAB_DIVERSITY_DEFAULT["diversity_tip"])
    result["vocabulary_diversity"] = vd

    return result
