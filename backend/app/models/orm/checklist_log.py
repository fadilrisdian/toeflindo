"""ORM dataclasses for checklist log tables."""
from dataclasses import dataclass
from typing import Optional


@dataclass
class WritingChecklistLog:
    id: Optional[int] = None
    date: str = ""
    practice_log_id: Optional[int] = None
    task_type: str = ""
    essay: Optional[str] = None
    results: str = "[]"          # JSON TEXT
    passed_count: int = 0
    total_count: int = 0
    improvement_note: Optional[str] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    @classmethod
    def from_row(cls, row: dict) -> "WritingChecklistLog":
        return cls(**{k: row[k] for k in row.keys() if k in cls.__dataclass_fields__})


@dataclass
class SpeakingChecklistLog:
    id: Optional[int] = None
    date: str = ""
    practice_log_id: Optional[int] = None
    task_type: str = ""
    results: str = "[]"          # JSON TEXT
    passed_count: int = 0
    total_count: int = 0

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    @classmethod
    def from_row(cls, row: dict) -> "SpeakingChecklistLog":
        return cls(**{k: row[k] for k in row.keys() if k in cls.__dataclass_fields__})
