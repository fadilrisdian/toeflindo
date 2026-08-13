"""Pydantic schemas for speaking endpoints."""
from typing import Optional
from pydantic import BaseModel


class SpeakingAnalyzeResponse(BaseModel):
    status: str
    session_id: Optional[str] = None
    transcript: str = ""
    overall_score: float = 0
    pronunciation_score: int = 0
    fluency_score: int = 0
    grammar_score: int = 0
    vocabulary_score: int = 0
    intonation_score: int = 0
    wpm: Optional[float] = None
    cefr_level: Optional[str] = None
    word_accuracy: Optional[float] = None
    missing_words: list[str] = []
    rubric_score: int = 1
    rubric_rationale: str = ""
    practice_log_id: Optional[int] = None
