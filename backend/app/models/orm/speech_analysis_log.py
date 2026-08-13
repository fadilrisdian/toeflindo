"""ORM dataclass for the speech_analysis_log table."""
from dataclasses import dataclass
from typing import Optional


@dataclass
class SpeechAnalysisLog:
    id: Optional[int] = None
    date: str = ""
    audio_filename: Optional[str] = None
    duration_seconds: Optional[float] = None
    processing_time_seconds: Optional[float] = None
    transcript: Optional[str] = None
    overall_score: Optional[float] = None
    pronunciation_score: Optional[float] = None
    fluency_score: Optional[float] = None
    grammar_score: Optional[float] = None
    vocabulary_score: Optional[float] = None
    intonation_score: Optional[float] = None
    discourse_score: Optional[float] = None
    wpm: Optional[float] = None
    cefr_level: Optional[str] = None
    avg_word_confidence: Optional[float] = None
    pause_count: Optional[int] = None
    filler_count: Optional[int] = None
    pronunciation_data: Optional[str] = None  # JSON TEXT
    fluency_data: Optional[str] = None        # JSON TEXT
    grammar_data: Optional[str] = None        # JSON TEXT
    vocabulary_data: Optional[str] = None     # JSON TEXT
    intonation_data: Optional[str] = None     # JSON TEXT
    practice_log_id: Optional[int] = None
    task_type: Optional[str] = None
    topic: Optional[str] = None
    expected_answer: Optional[str] = None
    words_json: Optional[str] = None     # JSON TEXT — [{word, start, end}, ...]
    task_raw_score: Optional[float] = None   # 0-5 official ETS raw score
    estimated_band: Optional[float] = None  # 1.0-6.0 band from lookup table

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    @classmethod
    def from_row(cls, row: dict) -> "SpeechAnalysisLog":
        return cls(**{k: row[k] for k in row.keys() if k in cls.__dataclass_fields__})
