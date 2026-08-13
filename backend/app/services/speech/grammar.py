"""
Grammar module.
Analyzes transcript for grammatical errors, corrections, sentence complexity,
grammatical range, and overall grammar quality via the shared LLM client.
"""
from __future__ import annotations

from app.clients.llm import call_llm_json
from app.core.logging import get_logger

logger = get_logger(__name__)

GRAMMAR_PROMPT = """You are a TOEFL speaking grammar evaluator.

Analyze the following spoken English transcript for grammatical accuracy AND range.

Transcript:
"{transcript}"

Return a JSON object with this exact structure:
{{
  "score": <float 1.0-6.0>,
  "feedback": [<string>, ...],
  "corrections": [
    {{"original": <wrong phrase>, "correct": <corrected phrase>, "explanation": <brief reason>}},
    ...
  ],
  "complexity_note": <string about sentence structure complexity>,
  "grammatical_range": {{
    "score": <float 1.0-6.0>,
    "conjunctions_used": [<list of conjunctions actually found in transcript>],
    "has_complex_sentence": <true|false>,
    "has_conditional": <true|false>,
    "range_tip": <one short actionable tip to improve grammatical range>
  }}
}}

Scoring guide for "score" (grammatical accuracy, 1-6 scale):
- 6.0: No errors, varied and complex structures
- 5.0: Minor errors only, good complexity
- 4.0: Some errors but meaning clear, moderate complexity
- 3.0: Frequent errors, simple structures, meaning sometimes unclear
- 2.0: Many errors, very simple or broken structures
- 1.0: Severe errors throughout, very difficult to understand

Scoring guide for "grammatical_range.score" (1-6 scale):
- 6.0: Rich variety — conditionals, relative clauses, varied conjunctions, complex openings
- 5.0: Good range — compound + complex sentences, 3+ different conjunctions
- 4.0: Moderate range — some compound sentences, 1-2 conjunctions
- 3.0: Limited range — mostly simple sentences, one conjunction type
- 2.0: Very limited — only simple clauses, no connectors
- 1.0: Single words or fragments only

Consider for accuracy:
- Subject-verb agreement
- Verb tense consistency
- Articles (a/an/the)
- Preposition use
- Sentence completeness
- Clause structure

Consider for range:
- Use of conjunctions (and, but, or, because, although, since, while, etc.)
- Complex / compound sentences
- Conditional structures (if...then)
- Relative clauses (who, which, that)
- Variety in sentence openings

Keep feedback concise and actionable. Return at most 5 corrections.
Return ONLY the JSON object, no markdown, no extra text."""


_RANGE_DEFAULT = {
    "score": 3.0,
    "conjunctions_used": [],
    "has_complex_sentence": False,
    "has_conditional": False,
    "range_tip": "Try using conjunctions like 'although' or 'because' to build complex sentences.",
}


def analyze(transcript: str) -> dict:
    """Returns grammar score (1-6), feedback, corrections, and grammatical range."""
    if not transcript or len(transcript.strip()) < 5:
        return {
            "score": 1.0,
            "feedback": ["No speech to analyze."],
            "corrections": [],
            "complexity_note": "N/A",
            "grammatical_range": dict(_RANGE_DEFAULT),
        }

    try:
        result = call_llm_json(
            messages=[{"role": "user", "content": GRAMMAR_PROMPT.format(transcript=transcript)}],
            temperature=0.2,
            max_tokens=4000,
            models=["openai/gpt-oss-120b"],
            label="speech/grammar",
        )
    except Exception:
        return {
            "score": 3.0,
            "feedback": ["Grammar analysis unavailable — retry later."],
            "corrections": [],
            "complexity_note": "N/A",
            "grammatical_range": dict(_RANGE_DEFAULT),
        }

    result["score"] = round(max(1.0, min(6.0, float(result.get("score", 3.0)))), 2)
    result.setdefault("feedback", [])
    result.setdefault("corrections", [])
    result.setdefault("complexity_note", "")

    gr = result.get("grammatical_range")
    if not isinstance(gr, dict):
        gr = {}
    gr["score"] = round(max(1.0, min(6.0, float(gr.get("score", 3.0)))), 2)
    gr.setdefault("conjunctions_used", [])
    gr.setdefault("has_complex_sentence", False)
    gr.setdefault("has_conditional", False)
    gr.setdefault("range_tip", _RANGE_DEFAULT["range_tip"])
    result["grammatical_range"] = gr

    return result
