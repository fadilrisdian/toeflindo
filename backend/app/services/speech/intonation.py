"""
Intonation module.
Uses librosa.pyin for pitch (F0) extraction — no compilation needed.
Analyzes: pitch variation, energy contour, rhythm, voiced ratio.

Scoring uses speaker-relative semitone normalization:
  F0_ST = 12 * log2(F0 / F0_median)
This makes the score independent of the speaker's absolute pitch range
(male vs female voice, non-native accent) — only variation is measured.
"""

import librosa
import numpy as np


def analyze(wav_path: str) -> dict:
    """Returns intonation score (1-6) and pitch/rhythm feedback."""
    try:
        y, sr = librosa.load(wav_path, sr=16000, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)

        if duration < 0.5:
            return {
                "score": 1.0,
                "feedback": ["Audio too short to analyze intonation."],
                "pitch_stats": {},
                "energy_variation": 0.0,
                "tempo_bpm": 0.0,
            }

        # --- Pitch (F0) via librosa pyin ---
        f0, voiced_flag, voiced_prob = librosa.pyin(
            y,
            fmin=librosa.note_to_hz("C2"),  # ~65 Hz
            fmax=librosa.note_to_hz("C7"),  # ~2093 Hz
            sr=sr,
        )

        voiced_f0 = f0[voiced_flag] if voiced_flag is not None else np.array([])
        voiced_ratio = (
            float(np.sum(voiced_flag) / max(len(voiced_flag), 1))
            if voiced_flag is not None
            else 0.0
        )

        pitch_stats = {}
        pitch_std_hz = 0.0
        pitch_std_st = 0.0  # semitone std — speaker-relative, used for scoring
        if len(voiced_f0) > 5:
            pitch_mean = float(np.nanmean(voiced_f0))
            pitch_std_hz = float(np.nanstd(voiced_f0))
            pitch_min = float(np.nanmin(voiced_f0))
            pitch_max = float(np.nanmax(voiced_f0))
            pitch_median = float(np.nanmedian(voiced_f0))

            # Semitone normalization: F0_ST = 12 * log2(F0 / F0_median)
            # Clips near-zero values to avoid log(0)
            safe_f0 = np.where(voiced_f0 > 1.0, voiced_f0, np.nan)
            f0_st = 12.0 * np.log2(safe_f0 / max(pitch_median, 1.0))
            pitch_std_st = float(np.nanstd(f0_st))

            pitch_stats = {
                "mean_hz": round(pitch_mean, 1),
                "std_hz": round(pitch_std_hz, 1),
                "std_semitones": round(pitch_std_st, 2),
                "min_hz": round(pitch_min, 1),
                "max_hz": round(pitch_max, 1),
                "range_hz": round(pitch_max - pitch_min, 1),
                "voiced_ratio": round(voiced_ratio, 3),
            }
        else:
            pitch_stats = {"note": "Insufficient voiced frames for full pitch analysis"}

        # --- Energy (RMS) variation ---
        rms = librosa.feature.rms(y=y)[0]
        rms_mean = float(np.mean(rms))
        rms_std = float(np.std(rms))
        energy_variation = round(rms_std / max(rms_mean, 1e-6), 3)

        # --- Rhythm (tempo) ---
        tempo_arr, _ = librosa.beat.beat_track(y=y, sr=sr)
        tempo = float(np.atleast_1d(tempo_arr)[0])

        # --- Score calculation ---
        score = 3.0

        # Pitch variation — scored in semitones (speaker-relative, accent-neutral)
        # Typical natural speech: ~3-6 ST std. Monotone: <2 ST. Expressive: >6 ST.
        if pitch_std_st > 6.0:
            score += 1.5  # very expressive
        elif pitch_std_st > 4.0:
            score += 1.0  # good range
        elif pitch_std_st > 2.0:
            score += 0.5  # some variation
        elif len(voiced_f0) > 5:
            score -= 0.5  # monotone

        # Voiced ratio
        if voiced_ratio > 0.6:
            score += 0.5
        elif voiced_ratio < 0.3:
            score -= 0.5

        # Energy dynamics
        if energy_variation > 0.4:
            score += 0.5
        elif energy_variation < 0.1:
            score -= 0.5

        score = round(max(1.0, min(6.0, score)), 2)

        # --- Feedback ---
        feedback = []
        if score >= 5.0:
            feedback.append(
                "Excellent intonation — natural pitch variation and expressive rhythm."
            )
        elif score >= 4.0:
            feedback.append(
                "Good intonation with clear stress and reasonable pitch range."
            )
        elif score >= 3.0:
            feedback.append(
                "Adequate intonation but speech sounds somewhat flat or monotone."
            )
        else:
            feedback.append(
                "Intonation is flat — try varying pitch on stressed words and lowering it at sentence ends."
            )

        if pitch_std_st < 2.0 and len(voiced_f0) > 5:
            feedback.append(
                f"Pitch variation is low ({round(pitch_std_st, 1)} semitones). "
                "Raise your pitch on key words and drop it at sentence ends."
            )
        if energy_variation < 0.15:
            feedback.append(
                "Volume is very even. Stress important words by speaking slightly louder."
            )
        if voiced_ratio < 0.4 and voiced_ratio > 0:
            feedback.append(
                "High proportion of silence — reduce long pauses between phrases."
            )

        return {
            "score": score,
            "feedback": feedback,
            "pitch_stats": pitch_stats,
            "energy_variation": energy_variation,
            "tempo_bpm": round(tempo, 1),
        }

    except Exception as e:
        return {
            "score": 3.0,
            "feedback": [f"Intonation analysis unavailable: {str(e)}"],
            "pitch_stats": {},
            "energy_variation": 0.0,
            "tempo_bpm": 0.0,
        }
