"""Domain-level exception hierarchy."""


class AppError(Exception):
    """Base application error."""


class NotFoundError(AppError):
    """Requested resource not found."""


class AuthError(AppError):
    """Authentication / authorisation failure."""


class LLMError(AppError):
    """LLM call failed."""


class SpeechAnalyzerError(AppError):
    """Speech analyzer service error."""
