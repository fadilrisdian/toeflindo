"""ORM-style dataclasses — one per DB table.

These are plain Python dataclasses that mirror the SQLite schema.
They are NOT SQLAlchemy models — the project uses raw sqlite3.
Use these for type-annotated construction and dict serialisation only.
"""
from .practice_log import PracticeLog
from .grammar import GrammarMistake, GrammarPerformance, GrammarTopicMap
from .task_bank import TaskBank
from .study_log import StudyLog
from .speech_analysis_log import SpeechAnalysisLog
from .checklist_log import WritingChecklistLog, SpeakingChecklistLog

__all__ = [
    "PracticeLog",
    "GrammarMistake",
    "GrammarPerformance",
    "GrammarTopicMap",
    "TaskBank",
    "StudyLog",
    "SpeechAnalysisLog",
    "WritingChecklistLog",
    "SpeakingChecklistLog",
]
