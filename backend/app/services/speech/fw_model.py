"""
Shared faster-whisper model singleton.
Both stt.py and pronunciation.py use this to avoid loading the model twice.

Result cache: within a single request both modules call get_word_timestamps()
on the same temp wav path. We cache the last result by path so the
transcription only runs once per file.

Thread-safety: a Lock guards both model init and cache mutation so
concurrent ThreadPoolExecutor calls don't race on _cache.clear().
"""
import threading
from faster_whisper import WhisperModel

_model = None
_cache: dict = {}   # {wav_path: [words]}  — bounded to last 4 entries
_lock = threading.Lock()
_MAX_CACHE = 4


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        with _lock:
            if _model is None:  # double-checked locking
                _model = WhisperModel("base", device="cpu", compute_type="int8")
    return _model


def get_word_timestamps(wav_path: str) -> list:
    """
    Run faster-whisper on wav_path and return word timestamps.
    Returns list of {word, start, end, probability}.
    Result is cached by path so multiple callers in the same request
    pay only one transcription cost.
    """
    with _lock:
        if wav_path in _cache:
            return _cache[wav_path]

    model = get_model()
    segments, _ = model.transcribe(
        wav_path,
        word_timestamps=True,
        language="en",
        beam_size=1,
        vad_filter=True,
    )
    words = []
    for seg in segments:
        if seg.words:
            for w in seg.words:
                words.append({
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "probability": round(w.probability, 3),
                })

    with _lock:
        # Evict oldest entry if cache is full, then store result
        if len(_cache) >= _MAX_CACHE:
            oldest = next(iter(_cache))
            del _cache[oldest]
        _cache[wav_path] = words
    return words

