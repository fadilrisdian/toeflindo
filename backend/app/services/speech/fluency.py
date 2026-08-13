"""
Fluency module.
Uses Groq word timestamps to compute:
- WPM (words per minute)
- Silent pauses (gaps > 0.3s between words)
- Filler words (um, uh, like, you know, etc.)
- Repetitions (same word twice in a row)
TOEFL speaking target: 120-150 WPM, minimal pauses/fillers.
"""

FILLER_WORDS = {
    "um", "uh", "uhh", "umm", "hmm", "hm", "er", "ah", "ahh",
    "like", "basically", "literally", "you know", "i mean",
    "sort of", "kind of", "right", "okay so", "so yeah"
}

PAUSE_THRESHOLD = 0.3   # seconds — gaps longer than this count as pauses
LONG_PAUSE_THRESHOLD = 0.8  # seconds — notably long pause


def analyze(words: list, total_duration: float = None) -> dict:
    """
    words: list of {word, start, end} from Groq STT
    Returns fluency score (1-6) and detailed feedback.
    """
    if not words:
        return {
            "score": 1.0,
            "feedback": ["No speech detected."],
            "wpm": 0,
            "pause_count": 0,
            "long_pause_count": 0,
            "pauses": [],
            "filler_count": 0,
            "filler_instances": [],
            "repetition_count": 0,
            "repetitions": [],
        }

    # --- WPM ---
    duration = words[-1]["end"] - words[0]["start"]
    if duration <= 0:
        duration = total_duration or 1.0
    wpm = round((len(words) / duration) * 60, 1)

    # --- Pauses ---
    pauses = []
    for i in range(1, len(words)):
        gap = round(words[i]["start"] - words[i - 1]["end"], 3)
        if gap >= PAUSE_THRESHOLD:
            pauses.append({
                "after_word": words[i - 1]["word"],
                "before_word": words[i]["word"],
                "duration": gap,
                "long": gap >= LONG_PAUSE_THRESHOLD,
                "time": round(words[i - 1]["end"], 2),
            })

    long_pauses = [p for p in pauses if p["long"]]

    # --- Filler words ---
    filler_instances = []
    word_list = [w["word"].lower().strip(".,!?") for w in words]
    for i, w in enumerate(word_list):
        if w in FILLER_WORDS:
            filler_instances.append({
                "word": words[i]["word"],
                "time": words[i]["start"],
            })
        # Check 2-word fillers
        if i < len(word_list) - 1:
            bigram = w + " " + word_list[i + 1]
            if bigram in FILLER_WORDS:
                filler_instances.append({
                    "word": bigram,
                    "time": words[i]["start"],
                })

    # --- Repetitions ---
    repetitions = []
    for i in range(1, len(word_list)):
        if word_list[i] == word_list[i - 1] and word_list[i] not in {"the", "a", "an"}:
            repetitions.append({
                "word": words[i]["word"],
                "time": words[i]["start"],
            })

    # --- Score calculation ---
    score = 6.0

    # WPM penalty: target 120-150 WPM
    if wpm < 80:
        score -= 2.0
    elif wpm < 100:
        score -= 1.5
    elif wpm < 120:
        score -= 0.5
    elif wpm > 180:
        score -= 0.5  # too fast

    # Pause penalty
    pause_rate = len(pauses) / max(len(words), 1) * 10
    if len(long_pauses) >= 3:
        score -= 1.5
    elif len(long_pauses) >= 2:
        score -= 1.0
    elif len(pauses) >= 5:
        score -= 0.5

    # Filler penalty
    filler_rate = len(filler_instances) / max(len(words), 1) * 100
    if filler_rate >= 10:
        score -= 1.5
    elif filler_rate >= 5:
        score -= 0.5

    # Repetition penalty
    if len(repetitions) >= 3:
        score -= 0.5

    score = round(max(1.0, min(6.0, score)), 2)

    # --- Feedback ---
    feedback = []
    if score >= 5.0:
        feedback.append(f"Speech flows naturally at {wpm} WPM with minimal interruptions.")
    elif score >= 4.0:
        feedback.append(f"Good fluency at {wpm} WPM with occasional pauses.")
    elif score >= 3.0:
        feedback.append(f"Developing fluency at {wpm} WPM — noticeable pauses and hesitations.")
    else:
        feedback.append(f"Fluency needs work — speaking at {wpm} WPM with frequent interruptions.")

    if wpm < 120:
        feedback.append(f"Pace is slow ({wpm} WPM). TOEFL target is 120–150 WPM. Try to speak more continuously.")
    elif wpm > 175:
        feedback.append(f"Pace is fast ({wpm} WPM). Slow down slightly for clarity.")

    if long_pauses:
        feedback.append(f"{len(long_pauses)} long pause(s) detected (>{LONG_PAUSE_THRESHOLD}s). Avoid stopping mid-thought.")

    if filler_instances:
        filler_words_used = list({f["word"] for f in filler_instances})
        feedback.append(f"Filler words detected: {', '.join(filler_words_used[:5])}. Replace with a brief pause instead.")

    if repetitions:
        feedback.append(f"{len(repetitions)} word repetition(s) detected. Slow down and plan before speaking.")

    return {
        "score": score,
        "feedback": feedback,
        "wpm": wpm,
        "pause_count": len(pauses),
        "long_pause_count": len(long_pauses),
        "pauses": pauses[:10],
        "filler_count": len(filler_instances),
        "filler_instances": filler_instances[:10],
        "repetition_count": len(repetitions),
        "repetitions": repetitions[:5],
    }
