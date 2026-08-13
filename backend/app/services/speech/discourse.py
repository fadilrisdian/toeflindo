"""
Discourse module — ETS "Organization" dimension.
Evaluates two sub-criteria via LLM:
  1. Discourse Coherence  — structure, personal example, narrative arc
  2. Discourse Markers    — connectors like 'for example', 'additionally', 'to start'
"""
from __future__ import annotations

from app.clients.llm import call_llm_json
from app.core.logging import get_logger

logger = get_logger(__name__)

# ETS-aligned markers (lowercase)
DISCOURSE_MARKERS = {
    # Sequencing
    "first", "second", "third", "firstly", "secondly", "thirdly",
    "to start", "to begin", "to begin with", "next", "then", "finally",
    "last", "lastly", "in the end",
    # Adding
    "also", "additionally", "in addition", "furthermore", "moreover",
    "besides", "as well",
    # Contrasting
    "however", "on the other hand", "but", "although", "even though",
    "despite", "nevertheless", "whereas", "while",
    # Exemplifying
    "for example", "for instance", "such as", "like", "specifically",
    # Concluding / summarising
    "in conclusion", "to conclude", "in summary", "overall", "to sum up",
    # Opinion / stance
    "in my opinion", "i think", "i believe", "i feel", "personally",
    "from my perspective", "in my view",
    # Cause / result
    "because", "since", "therefore", "as a result", "that is why",
    "due to", "consequently",
}

DISCOURSE_PROMPT = """\
You are an ETS TOEFL speaking examiner evaluating the Organization dimension.

Analyze this spoken English transcript for:
1. Discourse Coherence — Does the response have a clear beginning, middle, and end?
   Does it include a personal example or elaboration? Is the argument/answer well-supported?
2. Discourse Marker Quality — Are transition words used naturally and appropriately
   (e.g., "for example", "additionally", "on the other hand", "in my opinion")?

Transcript:
"{transcript}"

Discourse markers already detected algorithmically (may be incomplete): {detected_markers}
Marker count (algorithmic): {marker_count}

Return a JSON object with this exact structure:
{{
  "coherence_score": <float 1.0-6.0>,
  "marker_score": <float 1.0-6.0>,
  "score": <float 1.0-6.0>,
  "feedback": [<string>, ...],
  "has_structure": <true|false>,
  "has_example": <true|false>,
  "coherence_tip": <one actionable tip string>,
  "marker_tip": <one actionable tip string>
}}

Scoring guide for overall "score" (average of coherence + marker quality):
- 6.0: Clear structure with intro/body/conclusion, natural transitions, personal example
- 5.0: Good structure, 2+ markers used naturally, partial elaboration
- 4.0: Attempted structure, 1-2 markers, limited example or support
- 3.0: Loose structure, few or no markers, rambling or list-like
- 2.0: No discernible structure, single-clause responses
- 1.0: Incoherent or too short to judge

Return ONLY the JSON object, no markdown, no extra text.\
"""


def _detect_markers(transcript: str) -> tuple[list[str], int]:
    """Fast algorithmic scan — catches multi-word phrases too."""
    text = transcript.lower()
    found = [marker for marker in DISCOURSE_MARKERS if marker in text]
    return found, len(found)


def analyze(transcript: str) -> dict:
    """Returns discourse score (1-6), coherence + marker feedback."""
    if not transcript or len(transcript.strip()) < 10:
        return {
            "score": 1.0,
            "coherence_score": 1.0,
            "marker_score": 1.0,
            "feedback": ["Response too short to evaluate discourse organization."],
            "has_structure": False,
            "has_example": False,
            "coherence_tip": "Try to include an opening statement, a supporting example, and a brief conclusion.",
            "marker_tip": "Use at least two discourse markers such as 'for example' or 'in addition'.",
            "markers_found": [],
            "marker_count": 0,
        }

    detected, count = _detect_markers(transcript)

    try:
        result = call_llm_json(
            messages=[{
                "role": "user",
                "content": DISCOURSE_PROMPT.format(
                    transcript=transcript,
                    detected_markers=detected[:10],
                    marker_count=count,
                ),
            }],
            temperature=0.2,
            max_tokens=4000,
            models=["openai/gpt-oss-120b"],
            label="speech/discourse",
        )
    except Exception:
        # Algorithmic fallback — crude but better than nothing
        score = 2.0
        if count >= 3:
            score += 1.5
        elif count >= 1:
            score += 0.5
        if len(transcript.split()) >= 80:
            score += 0.5
        score = round(max(1.0, min(6.0, score)), 2)
        return {
            "score": score,
            "coherence_score": score,
            "marker_score": min(6.0, 1.0 + count * 0.8),
            "feedback": ["Discourse analysis unavailable — retry later."],
            "has_structure": count >= 2,
            "has_example": False,
            "coherence_tip": "Plan your response: opening, 1-2 support points, closing.",
            "marker_tip": "Try using 'for example', 'additionally', or 'on the other hand'.",
            "markers_found": detected[:10],
            "marker_count": count,
        }

    result["score"]           = round(max(1.0, min(6.0, float(result.get("score", 3.0)))), 2)
    result["coherence_score"] = round(max(1.0, min(6.0, float(result.get("coherence_score", 3.0)))), 2)
    result["marker_score"]    = round(max(1.0, min(6.0, float(result.get("marker_score", 3.0)))), 2)
    result.setdefault("feedback", [])
    result.setdefault("has_structure", False)
    result.setdefault("has_example", False)
    result.setdefault("coherence_tip", "")
    result.setdefault("marker_tip", "")
    result["markers_found"] = detected[:10]
    result["marker_count"]  = count

    return result
