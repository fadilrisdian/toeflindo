"""ORM dataclass for the study_logs table."""
from dataclasses import dataclass
from typing import Optional


@dataclass
class StudyLog:
    log_id: Optional[int] = None
    topic_id: Optional[int] = None
    topic_title: Optional[str] = None
    status: Optional[str] = None  # 'not_started' | 'in_progress' | 'mastered'
    last_reviewed: Optional[str] = None
    accuracy_rate: float = 0.0
    attempts: int = 0
    next_review_date: Optional[str] = None
    retention_level: int = 0
    source: str = "hermes"

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    @classmethod
    def from_row(cls, row: dict) -> "StudyLog":
        return cls(**{k: row[k] for k in row.keys() if k in cls.__dataclass_fields__})
