"""
Audio quality gate — run before any analysis.

Returns PASS or RECORD_AGAIN with a reason.
Poor recording quality must not produce a lower English score.

Checks (initial engineering thresholds — tune per device):
  duration      : 0.5s – 90s
  clipping      : < 0.5% of samples near ±1.0 (amplitude > 0.98)
  snr           : estimated > 10 dB
  vad           : voiced speech must be present
"""
from __future__ import annotations

import logging

import librosa
import numpy as np

logger = logging.getLogger("speech_quality")

_MIN_DURATION_S = 0.5
_MAX_DURATION_S = 90.0
_CLIPPING_THRESH = 0.98       # samples above this are considered clipped
_MAX_CLIPPING_RATIO = 0.005   # 0.5%
_MIN_SNR_DB = 10.0
_MIN_VOICED_RATIO = 0.05      # at least 5% of frames must be voiced


def check(wav_path: str) -> dict:
    """
    Load wav_path and run all quality checks.

    Returns:
      {"status": "PASS", ...measurements}
      {"status": "RECORD_AGAIN", "reason": str, ...measurements}
    """
    try:
        y, sr = librosa.load(wav_path, sr=16000, mono=True)
    except Exception as exc:
        logger.warning("quality: failed to load %s — %s", wav_path, exc)
        return {"status": "RECORD_AGAIN", "reason": "Could not read audio file — try again."}

    duration = librosa.get_duration(y=y, sr=sr)

    # ── Duration ──────────────────────────────────────────────────────────────
    if duration < _MIN_DURATION_S:
        return {
            "status": "RECORD_AGAIN",
            "reason": f"Recording too short ({duration:.1f}s) — hold the button until you finish speaking.",
            "duration_seconds": round(duration, 2),
        }
    if duration > _MAX_DURATION_S:
        return {
            "status": "RECORD_AGAIN",
            "reason": f"Recording too long ({duration:.0f}s) — keep responses under 90 seconds.",
            "duration_seconds": round(duration, 2),
        }

    # ── Clipping ──────────────────────────────────────────────────────────────
    clipping_ratio = float(np.mean(np.abs(y) > _CLIPPING_THRESH))
    if clipping_ratio > _MAX_CLIPPING_RATIO:
        return {
            "status": "RECORD_AGAIN",
            "reason": "Microphone is too loud — move it slightly away and try again.",
            "duration_seconds": round(duration, 2),
            "clipping_ratio": round(clipping_ratio, 4),
        }

    # ── SNR (rough estimate) ──────────────────────────────────────────────────
    # Split into 20ms frames, estimate noise from the quietest 10%.
    frame_len = int(sr * 0.02)
    frames = librosa.util.frame(y, frame_length=frame_len, hop_length=frame_len)
    frame_power = np.mean(frames ** 2, axis=0)
    noise_power = float(np.percentile(frame_power, 10))
    signal_power = float(np.mean(frame_power))
    if noise_power > 0 and signal_power > 0:
        snr_db = 10.0 * np.log10(signal_power / max(noise_power, 1e-12))
    else:
        snr_db = 0.0

    if snr_db < _MIN_SNR_DB:
        return {
            "status": "RECORD_AGAIN",
            "reason": "Too much background noise — find a quieter spot and try again.",
            "duration_seconds": round(duration, 2),
            "snr_db": round(snr_db, 1),
        }

    # ── VAD (voiced speech presence) ─────────────────────────────────────────
    try:
        _, voiced_flag, _ = librosa.pyin(
            y,
            fmin=librosa.note_to_hz("C2"),
            fmax=librosa.note_to_hz("C7"),
            sr=sr,
        )
        voiced_ratio = (
            float(np.sum(voiced_flag) / max(len(voiced_flag), 1))
            if voiced_flag is not None else 0.0
        )
    except Exception:
        voiced_ratio = 1.0  # pyin failed — don't block on this

    if voiced_ratio < _MIN_VOICED_RATIO:
        return {
            "status": "RECORD_AGAIN",
            "reason": "No speech detected — check your microphone and try again.",
            "duration_seconds": round(duration, 2),
            "voiced_ratio": round(voiced_ratio, 3),
        }

    return {
        "status": "PASS",
        "duration_seconds": round(duration, 2),
        "clipping_ratio": round(clipping_ratio, 4),
        "snr_db": round(snr_db, 1),
        "voiced_ratio": round(voiced_ratio, 3),
    }
