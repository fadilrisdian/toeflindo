"""ORM dataclass for the task_bank table."""
from dataclasses import dataclass
from typing import Optional


@dataclass
class TaskBank:
    task_id: Optional[int] = None
    category: Optional[str] = None
    task_type: Optional[str] = None
    question: Optional[str] = None
    tags: Optional[str] = None
    answer: Optional[str] = None
    source: str = "https://www.toeflresources.com/"
    reference_only: int = 0
    question_type: Optional[str] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    @classmethod
    def from_row(cls, row: dict) -> "TaskBank":
        return cls(**{k: row[k] for k in row.keys() if k in cls.__dataclass_fields__})
