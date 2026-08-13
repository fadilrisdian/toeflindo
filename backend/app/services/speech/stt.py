"""STT — word timestamps via Groq directly, transcript via LiteLLM proxy.

LiteLLM strips timestamp_granularities before forwarding to Groq (confirmed by test),
so we bypass it and call Groq directly for transcription with word timestamps.

Priority chain for transcribe():
  1. Groq direct (verbose_json + word timestamps) — native, accurate, fast
  2. LiteLLM proxy simple json — if Groq key missing or Groq is down
  3. faster-whisper local — last resort for word timestamps if both above fail
"""
import logging
import os

from openai import OpenAI
from app.services.speech.fw_model import get_word_timestamps

logger = logging.getLogger("speech_analyzer")

_PROXY_URL  = os.environ.get("LITELLM_PROXY_URL", "")
_MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "")
_GROQ_KEY   = os.environ.get("GROQ_API_KEY", "")
_GROQ_URL   = "https://api.groq.com/openai"


def _proxy_client() -> OpenAI:
    return OpenAI(base_url=_PROXY_URL.rstrip("/") + "/v1", api_key=_MASTER_KEY)


def _groq_client() -> OpenAI:
    return OpenAI(base_url=_GROQ_URL + "/v1", api_key=_GROQ_KEY)


def _parse_words(raw_words: list) -> list:
    words = []
    for w in raw_words:
        if isinstance(w, dict):
            words.append({
                "word":  w.get("word", "").strip(),
                "start": round(w.get("start", 0.0), 3),
                "end":   round(w.get("end",   0.0), 3),
            })
        else:
            words.append({
                "word":  w.word.strip(),
                "start": round(w.start, 3),
                "end":   round(w.end,   3),
            })
    return words


def _parse_segments(raw_segments: list) -> list:
    segments = []
    for s in raw_segments:
        if isinstance(s, dict):
            segments.append({
                "text":           s.get("text", "").strip(),
                "start":          round(s.get("start", 0.0), 3),
                "end":            round(s.get("end",   0.0), 3),
                "avg_logprob":    round(s.get("avg_logprob",    -0.2),  4),
                "no_speech_prob": round(s.get("no_speech_prob",  0.01), 4),
            })
        else:
            segments.append({
                "text":           s.text.strip(),
                "start":          round(s.start, 3),
                "end":            round(s.end,   3),
                "avg_logprob":    round(getattr(s, "avg_logprob",    -0.2),  4),
                "no_speech_prob": round(getattr(s, "no_speech_prob",  0.01), 4),
            })
    return segments


def transcribe_simple(wav_path: str) -> dict:
    """
    Lightweight transcription — text only, no timestamps.
    Used by Grammar SRS speaking practice (/transcribe endpoint).
    Goes through LiteLLM proxy (no timestamp params needed).
    """
    with open(wav_path, "rb") as f:
        response = _proxy_client().audio.transcriptions.create(
            model="whisper-large-v3",
            file=("audio.wav", f),
            response_format="json",
            language="en",
        )
    text = getattr(response, "text", None) or (response if isinstance(response, str) else "")
    return {"text": text.strip(), "language": "en"}


def transcribe_simple_bytes(audio_bytes: bytes, filename: str = "audio.webm") -> dict:
    """
    Lightweight transcription — raw bytes, no ffmpeg conversion.
    Groq/LiteLLM accepts webm/ogg/mp4 natively, so we skip the
    temp-file + ffmpeg step (~700ms saved on short recordings).
    Used by grammar mistake drill speak mode.
    """
    import io
    audio_io = io.BytesIO(audio_bytes)
    response = _proxy_client().audio.transcriptions.create(
        model="whisper-large-v3",
        file=(filename, audio_io),
        response_format="json",
        language="en",
    )
    text = getattr(response, "text", None) or (response if isinstance(response, str) else "")
    return {"text": text.strip(), "language": "en"}


def transcribe(wav_path: str) -> dict:
    """
    Transcribe audio and return transcript + word timestamps.

    Returns: {
        text: str,
        words: [{word, start, end}],
        segments: [{text, start, end, avg_logprob, no_speech_prob}],
        language: str
    }
    """
    # --- Path 1: Groq direct (native word timestamps) ---
    if _GROQ_KEY:
        try:
            with open(wav_path, "rb") as f:
                response = _groq_client().audio.transcriptions.create(
                    model="whisper-large-v3",
                    file=("audio.wav", f),
                    response_format="verbose_json",
                    timestamp_granularities=["word", "segment"],
                    language="en",
                )
            words    = _parse_words(getattr(response, "words", None) or [])
            segments = _parse_segments(getattr(response, "segments", None) or [])

            if words:
                logger.info(f"stt: groq-direct OK — {len(words)} words")
                return {
                    "text":     response.text.strip(),
                    "words":    words,
                    "segments": segments,
                    "language": getattr(response, "language", "en"),
                }
            # Groq returned no words (shouldn't happen but guard anyway)
            logger.warning("stt: groq-direct returned empty words — falling back to faster-whisper for timestamps")
            fw_words = get_word_timestamps(wav_path)
            return {
                "text":     response.text.strip(),
                "words":    [{"word": w["word"], "start": w["start"], "end": w["end"]} for w in fw_words],
                "segments": segments,
                "language": getattr(response, "language", "en"),
            }

        except Exception as e:
            logger.warning(f"stt: groq-direct failed ({type(e).__name__}: {e}) — trying LiteLLM proxy")

    # --- Path 2: LiteLLM proxy (text only) + faster-whisper (timestamps) ---
    try:
        logger.info("stt: using LiteLLM proxy for transcript + faster-whisper for word timestamps")
        result   = transcribe_simple(wav_path)
        fw_words = get_word_timestamps(wav_path)
        return {
            "text":     result["text"],
            "words":    [{"word": w["word"], "start": w["start"], "end": w["end"]} for w in fw_words],
            "segments": [],
            "language": result.get("language", "en"),
        }

    except Exception as e:
        # --- Path 3: faster-whisper only (both remote providers unavailable) ---
        logger.error(f"stt: LiteLLM proxy also failed ({type(e).__name__}: {e}) — faster-whisper only")
        fw_words = get_word_timestamps(wav_path)
        text = " ".join(w["word"] for w in fw_words).strip()
        return {
            "text":     text,
            "words":    [{"word": w["word"], "start": w["start"], "end": w["end"]} for w in fw_words],
            "segments": [],
            "language": "en",
        }
