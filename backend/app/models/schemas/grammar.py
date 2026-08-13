"""Pydantic schemas for grammar endpoints."""
from pydantic import BaseModel


class WSFixRequest(BaseModel):
    wrong: str = ""
    correct: str = ""
    category: str = ""
    description: str


class GrammarEvaluateRequest(BaseModel):
    user_answer: str
    correct: str
    wrong: str = ""
    category: str = "Grammar"


class GrammarEvaluateResponse(BaseModel):
    verdict: str
    feedback: str
    fallback: bool = False


class WeakspotSubmitItem(BaseModel):
    user_answer: str = ""
    correct: str = ""
    is_correct: bool = False
    hint: str = ""
    sub_type: str = ""


class WeakspotSubmitRequest(BaseModel):
    category: str = "Grammar"
    results: list[WeakspotSubmitItem] = []


class DueCountResponse(BaseModel):
    count: int


# ── Remediation loop schemas ──────────────────────────────────────────────────

class SelfCorrectRequest(BaseModel):
    attempt_text: str
    hint_level_used: int = 0


class SelfCorrectResponse(BaseModel):
    attempt_id: int
    verdict: str          # "correct" | "partial" | "wrong"
    feedback: str
    # After attempt, always expose the full feedback (spec: attempting is the point)
    rule: str             # treatable: 1-line rule; untreatable: empty
    model_sentences: list[str]  # untreatable: 1-2 native phrasings; treatable: empty
    correct: str          # always reveal correct version after attempt


class GeneratePromptsResponse(BaseModel):
    prompts: list[str]    # 2-3 new-sentence generation prompts for the student


class CheckSentenceRequest(BaseModel):
    student_sentence: str
    prompt: str           # which of the generation prompts was this for


class CheckSentenceResponse(BaseModel):
    attempt_id: int
    verdict: str          # "correct" | "wrong"
    feedback: str


class CompleteRemediationRequest(BaseModel):
    pass  # body-less, just marks the mistake as engaged


class FreeTextAnalyzeRequest(BaseModel):
    text: str
    save_mistakes: bool = True


class RemediateDetailResponse(BaseModel):
    id: int
    grammar_type: str
    sub_type: str | None
    wrong: str
    correct: str
    explanation: str | None
    treatability: str        # "treatable" | "untreatable"
    rubric_dimension: str    # "grammar" | "vocabulary"
    review_stage: int
    remediation_status: str  # "new" | "engaged" | "mastered"
    review_attempts: list[dict]

