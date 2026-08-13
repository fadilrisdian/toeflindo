"""
Pronunciation module.
Uses faster-whisper locally for per-word probability scores.
Groq doesn't return per-word confidence, so we run faster-whisper base
on CPU to get word.probability for each word.
Score: weighted avg of word probabilities mapped to 1-6 scale.

Uses the shared fw_model singleton so the model is only loaded once
even when both stt.py and pronunciation.py call it in the same request.
"""
from app.services.speech.fw_model import get_word_timestamps


def analyze(wav_path: str, groq_transcript: str) -> dict:
    """
    Returns pronunciation score (1-6) and per-word feedback.
    """
    fw_words = get_word_timestamps(wav_path)

    word_probs = []
    low_confidence_words = []

    for w in fw_words:
        prob = w["probability"]
        word_probs.append(prob)
        if prob < 0.75:
            low_confidence_words.append({
                "word": w["word"],
                "confidence": prob,
                "time": w["start"],
            })

    if not word_probs:
        return {
            "score": 1.0,
            "feedback": ["Could not analyze pronunciation — no speech detected."],
            "low_confidence_words": [],
        }

    avg_prob = sum(word_probs) / len(word_probs)
    # Map 0.5-1.0 probability range → 1.0-6.0 score
    # Below 0.5 avg = score 1.0, 1.0 avg = score 6.0
    score = round(max(1.0, min(6.0, (avg_prob - 0.5) / 0.5 * 5 + 1)), 2)

    # Build feedback
    feedback = []
    if score >= 5.0:
        feedback.append("Pronunciation is very clear and easy to understand.")
    elif score >= 4.0:
        feedback.append("Pronunciation is generally clear with minor unclear sounds.")
    elif score >= 3.0:
        feedback.append("Pronunciation is understandable but several words are unclear.")
    else:
        feedback.append("Pronunciation needs significant improvement — many words are difficult to understand.")

    if low_confidence_words:
        worst = sorted(low_confidence_words, key=lambda w: w["confidence"])[:5]
        word_list = ", ".join(f'"{w["word"]}"' for w in worst)
        feedback.append(f"Words to improve: {word_list}")

    return {
        "score": score,
        "feedback": feedback,
        "low_confidence_words": low_confidence_words[:10],
        "avg_word_confidence": round(avg_prob, 3),
    }
