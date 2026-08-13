"""
Speech client — calls local analysis functions directly.
Replaces the old HTTP sidecar client.
"""
from app.core.exceptions import SpeechAnalyzerError
from app.services.speech import analyzer


async def analyze(audio_bytes: bytes, filename: str) -> dict:
    """Full 5-dimension analysis, no practice context."""
    try:
        return await analyzer.analyze(audio_bytes=audio_bytes, filename=filename)
    except Exception as exc:
        raise SpeechAnalyzerError(f"Analysis failed: {exc}") from exc


async def transcribe(audio_bytes: bytes, filename: str) -> dict:
    """Lightweight STT — text only."""
    try:
        return await analyzer.transcribe_audio(audio_bytes=audio_bytes, filename=filename)
    except Exception as exc:
        raise SpeechAnalyzerError(f"Transcription failed: {exc}") from exc


async def analyze_practice(
    audio_bytes: bytes,
    filename: str,
    task_type: str,
    topic: str,
    expected_answer: str,
) -> dict:
    """Full analysis with practice context."""
    try:
        return await analyzer.analyze_practice(
            audio_bytes=audio_bytes,
            filename=filename,
            task_type=task_type,
            topic=topic,
            expected_answer=expected_answer,
        )
    except Exception as exc:
        raise SpeechAnalyzerError(f"Practice analysis failed: {exc}") from exc
