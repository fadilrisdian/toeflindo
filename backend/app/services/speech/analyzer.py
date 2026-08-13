"""
Speech analysis pipeline — runs all 6 dimensions locally.
No HTTP calls, no DB access. Pure in-process analysis.

Used by app/clients/speech.py which replaces the old HTTP sidecar client.

Dimensions:
  pronunciation  — faster-whisper word probability
  fluency        — WPM, pauses, fillers, repetitions
  grammar        — LLM accuracy + grammatical range
  vocabulary     — LLM richness + diversity + synonym suggestions
  intonation     — librosa pitch/energy/rhythm
  discourse      — LLM coherence + discourse markers (ETS Organization dimension)
"""
from __future__ import annotations

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor

from app.services.speech.audio_utils import save_upload, convert_to_wav, cleanup, get_duration
from app.services.speech.stt import transcribe, transcribe_simple
from app.services.speech.fluency import analyze as analyze_fluency
from app.services.speech.grammar import analyze as analyze_grammar
from app.services.speech.vocabulary import analyze as analyze_vocabulary
from app.services.speech.pronunciation import analyze as analyze_pronunciation
from app.services.speech.intonation import analyze as analyze_intonation
from app.services.speech.discourse import analyze as analyze_discourse
from app.services.speech.lexical import align as lexical_align
from app.services.speech.quality import check as quality_check

logger = logging.getLogger("speech_analyzer")

_executor = ThreadPoolExecutor(max_workers=6)


# ── Fallbacks ────────────────────────────────────────────────────────────────

def _fallback_fluency() -> dict:
    return {"score": 3.0, "feedback": ["Analysis unavailable."], "wpm": 0,
            "pause_count": 0, "long_pause_count": 0, "filler_count": 0,
            "filler_instances": [], "pauses": [], "repetition_count": 0, "repetitions": []}


def _fallback_pron() -> dict:
    return {"score": 3.0, "feedback": ["Analysis unavailable."],
            "low_confidence_words": [], "avg_word_confidence": None}


def _fallback_inton() -> dict:
    return {"score": 3.0, "feedback": ["Analysis unavailable."],
            "pitch_stats": {}, "energy_variation": None, "tempo_bpm": None}


def _fallback_gram() -> dict:
    return {"score": 3.0, "feedback": ["Analysis unavailable."],
            "corrections": [], "complexity_note": "",
            "grammatical_range": {
                "score": 3.0, "conjunctions_used": [],
                "has_complex_sentence": False, "has_conditional": False,
                "range_tip": "Try using conjunctions like 'although' or 'because'.",
            }}


def _fallback_vocab() -> dict:
    return {"score": 3.0, "feedback": ["Analysis unavailable."],
            "cefr_level": "B1", "suggestions": [], "repeated_words": [],
            "synonym_suggestions": [],
            "vocabulary_diversity": {
                "score": 3.0, "type_token_ratio": 0.5,
                "diversity_tip": "Vary word choice with synonyms.",
            }}


def _fallback_discourse() -> dict:
    return {"score": 3.0, "coherence_score": 3.0, "marker_score": 3.0,
            "feedback": ["Analysis unavailable."],
            "has_structure": False, "has_example": False,
            "coherence_tip": "Plan your response with a clear beginning, middle, and end.",
            "marker_tip": "Use discourse markers like 'for example' or 'additionally'.",
            "markers_found": [], "marker_count": 0}


# ── ETS-aligned dimension weighting ──────────────────────────────────────────
#
# "Take an Interview" — 4 ETS dimensions (equal weight):
#   Fluency (0.25), Intelligibility (0.25), Language Use (0.25), Organization (0.25)
#
# "Listen and Repeat" — 3 ETS dimensions:
#   Fluency (0.30), Intelligibility (0.35), Repeat Accuracy (0.35)
#
# Fallback (generic / unknown task_type) — flat 6-dimension (legacy behaviour)

WEIGHTS_LEGACY = {
    "pronunciation": 0.22,
    "fluency":       0.22,
    "grammar":       0.18,
    "vocabulary":    0.13,
    "intonation":    0.13,
    "discourse":     0.12,
}


def _overall(pron, flu, gram, vocab, inton, disc,
             task_type: str = "", repeat_accuracy: float | None = None) -> float:
    """Compute ETS-aligned overall score based on task type."""
    if task_type == "Take an Interview":
        # ETS 4 dimensions — equal weight
        intelligibility = (pron + inton) / 2       # pronunciation + prosody
        language_use    = (gram + vocab) / 2       # grammar + vocabulary
        organization    = disc                     # discourse coherence + markers
        fluency         = flu

        raw = (fluency * 0.25
               + intelligibility * 0.25
               + language_use * 0.25
               + organization * 0.25)

    elif task_type == "Listen and Repeat":
        # ETS 3 dimensions
        intelligibility = (pron + inton) / 2
        fluency         = flu
        # repeat_accuracy comes as 0-100 percentage; map to 1-6 scale
        if repeat_accuracy is not None:
            acc_score = max(1.0, min(6.0, 1.0 + (repeat_accuracy / 100) * 5))
        else:
            # If no expected answer / no accuracy data, fall back to pron+gram average
            acc_score = (pron + gram) / 2

        raw = (fluency * 0.30
               + intelligibility * 0.35
               + acc_score * 0.35)

    else:
        # Legacy flat weighting for unknown task types
        raw = sum([
            pron  * WEIGHTS_LEGACY["pronunciation"],
            flu   * WEIGHTS_LEGACY["fluency"],
            gram  * WEIGHTS_LEGACY["grammar"],
            vocab * WEIGHTS_LEGACY["vocabulary"],
            inton * WEIGHTS_LEGACY["intonation"],
            disc  * WEIGHTS_LEGACY["discourse"],
        ])

    return round(max(1.0, min(6.0, raw)), 2)


def _ets_dimensions(pron, flu, gram, vocab, inton, disc,
                    task_type: str = "", repeat_accuracy: float | None = None) -> dict:
    """Return the ETS-aligned dimension scores for frontend display."""
    if task_type == "Take an Interview":
        intelligibility = round((pron + inton) / 2, 2)
        language_use    = round((gram + vocab) / 2, 2)
        return {
            "fluency": round(flu, 2),
            "intelligibility": intelligibility,
            "language_use": language_use,
            "organization": round(disc, 2),
        }
    elif task_type == "Listen and Repeat":
        intelligibility = round((pron + inton) / 2, 2)
        if repeat_accuracy is not None:
            acc_score = round(max(1.0, min(6.0, 1.0 + (repeat_accuracy / 100) * 5)), 2)
        else:
            acc_score = round((pron + gram) / 2, 2)
        return {
            "fluency": round(flu, 2),
            "intelligibility": intelligibility,
            "repeat_accuracy": acc_score,
        }
    else:
        return {
            "pronunciation": round(pron, 2),
            "fluency": round(flu, 2),
            "grammar": round(gram, 2),
            "vocabulary": round(vocab, 2),
            "intonation": round(inton, 2),
            "discourse": round(disc, 2),
        }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pack_result(transcript, duration, t0,
                 pron_r, fluency_r, inton_r, gram_r, vocab_r, disc_r,
                 extra: dict | None = None,
                 words: list | None = None,
                 task_type: str = "",
                 repeat_accuracy: float | None = None) -> dict:
    overall = _overall(
        pron_r["score"], fluency_r["score"], gram_r["score"],
        vocab_r["score"], inton_r["score"], disc_r["score"],
        task_type=task_type,
        repeat_accuracy=repeat_accuracy,
    )
    out = {
        "overall": overall,
        "transcript": transcript,
        "duration_seconds": round(duration, 2),
        "processing_time_seconds": round(time.time() - t0, 2),
        "scoring_mode": (
            "ets_interview" if task_type == "Take an Interview"
            else "ets_listen_repeat" if task_type == "Listen and Repeat"
            else "legacy"
        ),
        "ets_dimensions": _ets_dimensions(
            pron_r["score"], fluency_r["score"], gram_r["score"],
            vocab_r["score"], inton_r["score"], disc_r["score"],
            task_type=task_type,
            repeat_accuracy=repeat_accuracy,
        ),
        "pronunciation": {
            "score": pron_r["score"],
            "feedback": pron_r["feedback"],
            "low_confidence_words": pron_r.get("low_confidence_words", []),
            "avg_word_confidence": pron_r.get("avg_word_confidence"),
        },
        "fluency": {
            "score": fluency_r["score"],
            "feedback": fluency_r["feedback"],
            "wpm": fluency_r["wpm"],
            "pause_count": fluency_r["pause_count"],
            "long_pause_count": fluency_r["long_pause_count"],
            "filler_count": fluency_r["filler_count"],
            "filler_instances": fluency_r.get("filler_instances", []),
            "pauses": fluency_r.get("pauses", []),
            "repetition_count": fluency_r.get("repetition_count", 0),
            "repetitions": fluency_r.get("repetitions", []),
        },
        "grammar": {
            "score": gram_r["score"],
            "feedback": gram_r["feedback"],
            "corrections": gram_r.get("corrections", []),
            "complexity_note": gram_r.get("complexity_note", ""),
            "grammatical_range": gram_r.get("grammatical_range", {}),
        },
        "vocabulary": {
            "score": vocab_r["score"],
            "feedback": vocab_r["feedback"],
            "cefr_level": vocab_r.get("cefr_level", "B1"),
            "suggestions": vocab_r.get("suggestions", []),
            "repeated_words": vocab_r.get("repeated_words", []),
            "synonym_suggestions": vocab_r.get("synonym_suggestions", []),
            "vocabulary_diversity": vocab_r.get("vocabulary_diversity", {}),
        },
        "intonation": {
            "score": inton_r["score"],
            "feedback": inton_r["feedback"],
            "pitch_stats": inton_r.get("pitch_stats", {}),
            "energy_variation": inton_r.get("energy_variation"),
            "tempo_bpm": inton_r.get("tempo_bpm"),
        },
        "discourse": {
            "score": disc_r["score"],
            "coherence_score": disc_r.get("coherence_score", disc_r["score"]),
            "marker_score": disc_r.get("marker_score", disc_r["score"]),
            "feedback": disc_r["feedback"],
            "has_structure": disc_r.get("has_structure", False),
            "has_example": disc_r.get("has_example", False),
            "coherence_tip": disc_r.get("coherence_tip", ""),
            "marker_tip": disc_r.get("marker_tip", ""),
            "markers_found": disc_r.get("markers_found", []),
            "marker_count": disc_r.get("marker_count", 0),
        },
    }
    if extra:
        out.update(extra)
    return out


# ── Public API ───────────────────────────────────────────────────────────────

async def analyze(audio_bytes: bytes, filename: str) -> dict:
    """
    Full 6-dimension analysis. No practice context, no DB write.
    """
    raw_path = None
    wav_path = None
    try:
        t0 = time.time()
        if len(audio_bytes) < 1000:
            raise ValueError("File too small — please upload a valid audio file.")
        if len(audio_bytes) > 50 * 1024 * 1024:
            raise ValueError("File too large — maximum 50MB.")

        suffix = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ".webm"
        raw_path = save_upload(audio_bytes, suffix=suffix)
        wav_path = convert_to_wav(raw_path)

        loop = asyncio.get_running_loop()
        stt_result = await loop.run_in_executor(_executor, lambda: transcribe(wav_path))
        transcript = stt_result["text"]
        words      = stt_result["words"]
        duration   = words[-1]["end"] if words else get_duration(wav_path)

        results = await asyncio.gather(
            loop.run_in_executor(_executor, lambda: analyze_fluency(words, duration)),
            loop.run_in_executor(_executor, lambda: analyze_pronunciation(wav_path, transcript)),
            loop.run_in_executor(_executor, lambda: analyze_intonation(wav_path)),
            loop.run_in_executor(_executor, lambda: analyze_grammar(transcript)),
            loop.run_in_executor(_executor, lambda: analyze_vocabulary(transcript)),
            loop.run_in_executor(_executor, lambda: analyze_discourse(transcript)),
            return_exceptions=True,
        )

        names = ["fluency", "pron", "inton", "gram", "vocab", "discourse"]
        for name, r in zip(names, results):
            if isinstance(r, Exception):
                logger.error("analyze: %s FAILED — %s: %s", name, type(r).__name__, r)

        fluency_r = results[0] if not isinstance(results[0], Exception) else _fallback_fluency()
        pron_r    = results[1] if not isinstance(results[1], Exception) else _fallback_pron()
        inton_r   = results[2] if not isinstance(results[2], Exception) else _fallback_inton()
        gram_r    = results[3] if not isinstance(results[3], Exception) else _fallback_gram()
        vocab_r   = results[4] if not isinstance(results[4], Exception) else _fallback_vocab()
        disc_r    = results[5] if not isinstance(results[5], Exception) else _fallback_discourse()

        return _pack_result(transcript, duration, t0,
                            pron_r, fluency_r, inton_r, gram_r, vocab_r, disc_r)
    finally:
        cleanup(raw_path or "", wav_path or "")


async def transcribe_audio(audio_bytes: bytes, filename: str) -> dict:
    """
    Lightweight STT — text only, no full analysis.
    Used by Grammar SRS speaking practice.
    """
    raw_path = None
    wav_path = None
    try:
        if len(audio_bytes) < 100:
            raise ValueError("File too small.")
        suffix = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ".webm"
        raw_path = save_upload(audio_bytes, suffix=suffix)
        wav_path = convert_to_wav(raw_path)
        loop = asyncio.get_running_loop()
        stt_result = await loop.run_in_executor(
            _executor, lambda: transcribe_simple(wav_path)
        )
        return {"text": stt_result["text"], "language": stt_result.get("language", "en")}
    finally:
        cleanup(raw_path or "", wav_path or "")


async def analyze_practice(
    audio_bytes: bytes,
    filename: str,
    task_type: str,
    topic: str,
    expected_answer: str,
) -> dict:
    """
    Full 6-dimension analysis with practice context (word accuracy comparison).
    """
    raw_path = None
    wav_path = None
    try:
        t0 = time.time()
        if len(audio_bytes) < 500:
            raise ValueError("File too small.")
        if len(audio_bytes) > 50 * 1024 * 1024:
            raise ValueError("File too large — max 50MB.")

        suffix = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ".webm"
        raw_path = save_upload(audio_bytes, suffix=suffix)
        logger.info("analyze-practice: file=%s size=%d suffix=%s", filename, len(audio_bytes), suffix)
        wav_path = convert_to_wav(raw_path)
        logger.info("analyze-practice: converted to wav=%s", wav_path)

        # Audio quality gate — must pass before any scoring
        quality = quality_check(wav_path)
        if quality["status"] == "RECORD_AGAIN":
            logger.info("analyze-practice: quality gate failed reason=%s", quality.get("reason"))
            return {"quality": quality, "status": "RECORD_AGAIN", "message": quality["reason"]}

        loop = asyncio.get_running_loop()
        try:
            stt_result = await loop.run_in_executor(_executor, lambda: transcribe(wav_path))
            transcript = stt_result["text"]
            logger.info("analyze-practice: STT transcript=%s", repr(transcript[:80]))
        except Exception as stt_err:
            logger.error("analyze-practice: STT FAILED — %s: %s", type(stt_err).__name__, stt_err)
            _stt_fb = {"score": 1.0, "feedback": ["STT unavailable — retry later."]}
            return {
                "overall": 1.0, "transcript": "",
                "duration_seconds": 0,
                "processing_time_seconds": round(time.time() - t0, 2),
                "task_type": task_type, "topic": topic, "expected_answer": expected_answer,
                "pronunciation": {**_stt_fb, "low_confidence_words": [], "avg_word_confidence": None},
                "fluency":  {**_stt_fb, "wpm": 0, "pause_count": 0, "long_pause_count": 0,
                             "filler_count": 0, "filler_instances": [], "pauses": [],
                             "repetition_count": 0, "repetitions": []},
                "grammar":  {**_stt_fb, "corrections": [], "complexity_note": "",
                             "grammatical_range": {"score": 1.0, "conjunctions_used": [],
                                                   "has_complex_sentence": False,
                                                   "has_conditional": False, "range_tip": ""}},
                "vocabulary": {**_stt_fb, "cefr_level": "B1", "suggestions": [],
                               "repeated_words": [], "synonym_suggestions": [],
                               "vocabulary_diversity": {"score": 1.0, "type_token_ratio": 0.0,
                                                        "diversity_tip": ""}},
                "intonation": {**_stt_fb, "pitch_stats": {}, "energy_variation": None, "tempo_bpm": None},
                "discourse": {**_stt_fb, "coherence_score": 1.0, "marker_score": 1.0,
                              "has_structure": False, "has_example": False,
                              "coherence_tip": "", "marker_tip": "",
                              "markers_found": [], "marker_count": 0},
                "session_id": 0, "practice_log_id": 0,
            }

        words    = stt_result["words"]
        duration = words[-1]["end"] if words else get_duration(wav_path)

        results = await asyncio.gather(
            loop.run_in_executor(_executor, lambda: analyze_fluency(words, duration)),
            loop.run_in_executor(_executor, lambda: analyze_pronunciation(wav_path, transcript)),
            loop.run_in_executor(_executor, lambda: analyze_intonation(wav_path)),
            loop.run_in_executor(_executor, lambda: analyze_grammar(transcript)),
            loop.run_in_executor(_executor, lambda: analyze_vocabulary(transcript)),
            loop.run_in_executor(_executor, lambda: analyze_discourse(transcript)),
            return_exceptions=True,
        )

        names = ["fluency", "pron", "inton", "gram", "vocab", "discourse"]
        for name, r in zip(names, results):
            if isinstance(r, Exception):
                logger.error("analyze-practice: %s FAILED — %s: %s", name, type(r).__name__, r)

        fluency_r = results[0] if not isinstance(results[0], Exception) else _fallback_fluency()
        pron_r    = results[1] if not isinstance(results[1], Exception) else _fallback_pron()
        inton_r   = results[2] if not isinstance(results[2], Exception) else _fallback_inton()
        gram_r    = results[3] if not isinstance(results[3], Exception) else _fallback_gram()
        vocab_r   = results[4] if not isinstance(results[4], Exception) else _fallback_vocab()
        disc_r    = results[5] if not isinstance(results[5], Exception) else _fallback_discourse()

        extra = {"task_type": task_type, "topic": topic, "expected_answer": expected_answer}

        # Word accuracy comparison (used for Listen and Repeat scoring)
        repeat_accuracy_pct: float | None = None
        if expected_answer and transcript:
            lex = lexical_align(expected_answer, transcript)
            repeat_accuracy_pct = round(lex["accuracy"] * 100, 1)
            extra["accuracy"] = {
                # legacy keys kept for backward compat with speaking_service.py
                "word_accuracy":  repeat_accuracy_pct,
                "missing_words":  lex["deletions"],
                "extra_words":    lex["insertions"],
                "matched_count":  lex["matched_count"],
                # richer WER evidence
                "wer":            lex["wer"],
                "deletions":      lex["deletions"],
                "substitutions":  lex["substitutions"],
                "insertions":     lex["insertions"],
                "asr_transcript": transcript,
            }

        return _pack_result(transcript, duration, t0,
                            pron_r, fluency_r, inton_r, gram_r, vocab_r, disc_r,
                            extra=extra,
                            task_type=task_type,
                            repeat_accuracy=repeat_accuracy_pct)

    except Exception as e:
        logger.error("analyze-practice: UNHANDLED EXCEPTION — %s: %s", type(e).__name__, e, exc_info=True)
        raise
    finally:
        cleanup(raw_path or "", wav_path or "")
