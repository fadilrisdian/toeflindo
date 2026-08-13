"""ORM dataclass for the practice_log table."""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class PracticeLog:
    id: Optional[int] = None
    date: str = ""
    section: str = ""
    task_type: Optional[str] = None
    prompt: Optional[str] = None
    response: Optional[str] = None
    score: Optional[float] = None
    feedback: Optional[str] = None
    duration_minutes: Optional[int] = None
    tags: Optional[str] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    @classmethod
    def from_row(cls, row: dict) -> "PracticeLog":
        return cls(**{k: row[k] for k in row.keys() if k in cls.__dataclass_fields__})
