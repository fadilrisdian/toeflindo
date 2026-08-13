"""ORM dataclasses for grammar-related tables."""
from dataclasses import dataclass
from typing import Optional


@dataclass
class GrammarMistake:
    id: Optional[int] = None
    date: str = ""
    grammar_type: str = ""
    sub_type: Optional[str] = None
    section: Optional[str] = None
    task_type: Optional[str] = None
    wrong: str = ""
    correct: str = ""
    explanation: Optional[str] = None
    exercise_id: Optional[int] = None
    reviewed: int = 0
    recurrence_count: int = 1

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    @classmethod
    def from_row(cls, row: dict) -> "GrammarMistake":
        return cls(**{k: row[k] for k in row.keys() if k in cls.__dataclass_fields__})


@dataclass
class GrammarPerformance:
    id: Optional[int] = None
    date: str = ""
    grammar_type: str = ""
    attempts: int = 0
    correct: int = 0
    notes: Optional[str] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    @classmethod
    def from_row(cls, row: dict) -> "GrammarPerformance":
        return cls(**{k: row[k] for k in row.keys() if k in cls.__dataclass_fields__})


@dataclass
class GrammarTopicMap:
    id: Optional[int] = None
    category: str = ""
    sub_type: Optional[str] = None
    murphy_unit: Optional[int] = None
    murphy_title: Optional[str] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    @classmethod
    def from_row(cls, row: dict) -> "GrammarTopicMap":
        return cls(**{k: row[k] for k in row.keys() if k in cls.__dataclass_fields__})
