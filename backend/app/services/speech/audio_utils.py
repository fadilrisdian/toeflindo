"""Audio preprocessing — convert any audio to 16kHz mono WAV using FFmpeg."""
import subprocess
import tempfile
import os
from pathlib import Path


def convert_to_wav(input_path: str) -> str:
    """Convert audio file to 16kHz mono WAV. Returns path to temp WAV file."""
    base, _ = os.path.splitext(input_path)
    out_path = base + "_16k.wav"
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-ar", "16000",
        "-ac", "1",
        "-f", "wav",
        out_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg error: {result.stderr}")
    return out_path


def save_upload(data: bytes, suffix: str = ".mp3") -> str:
    """Save uploaded bytes to a temp file. Returns path."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(data)
    tmp.close()
    return tmp.name


def get_duration(wav_path: str) -> float:
    """Return duration in seconds of a WAV file without loading the full audio."""
    import wave
    try:
        with wave.open(wav_path, "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            return frames / float(rate) if rate > 0 else 0.0
    except Exception:
        return 0.0


def cleanup(*paths: str):
    """Delete temp files."""
    for p in paths:
        try:
            os.unlink(p)
        except Exception:
            pass
