"""Pydantic schemas for writing endpoints."""
from typing import Optional
from pydantic import BaseModel


class WritingSubmitRequest(BaseModel):
    task_id: int
    task_type: str
    essay: str
    time_spent_sec: int = 0
    is_revision: bool = False
    revision_of: Optional[int] = None


class GrammarMistake(BaseModel):
    grammar_type: str
    wrong: str
    correct: str
    explanation: str


class WritingSubmitResponse(BaseModel):
    practice_id: int
    score: Optional[float]
    feedback: str
    strengths: list[str]
    improvements: list[str]
    corrected_version: Optional[str]
    word_count: int
    time_spent_sec: int


class BASResult(BaseModel):
    task_id: int
    checked: bool = False
    correct: bool = False
    your_answer: str = ""
    answer: str = ""


class BASSubmitRequest(BaseModel):
    results: list[BASResult] = []


class BASSubmitResponse(BaseModel):
    status: str
    saved: int


class PaginatedResponse(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int
    rows: list[dict]


class RecommendedTask(BaseModel):
    task_id: Optional[int]
    snippet: str
    reason: str


class ChecklistEvalRequest(BaseModel):
    task_type: str          # "Write an Email" or "Write for an Academic Discussion"
    essay: str
    practice_log_id: Optional[int] = None  # link to an existing practice_log row


class ChecklistItem(BaseModel):
    item: int
    text: str
    passed: bool
    note: str


class ChecklistEvalResponse(BaseModel):
    checklist_log_id: int
    task_type: str
    passed_count: int
    total_count: int
    results: list[ChecklistItem]
    improvement_note: str
