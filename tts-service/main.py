"""Kyutai Pocket TTS sidecar service.

Keeps the model in memory between requests.
Binds 0.0.0.0 inside the container but only reachable via toefl-v2-internal Docker network.

POST /tts       { text, voice }  -> audio/wav
GET  /health    -> { status: ok }
GET  /ready     -> { status: ready } | 503
"""
from __future__ import annotations

import asyncio
import io
import logging
import re
import threading
from contextlib import asynccontextmanager

import numpy as np
import scipy.io.wavfile
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("pocket-tts")

# ── Model singleton ──────────────────────────────────────────────────────────

_model = None
_init_lock = threading.Lock()
_voice_cache: dict = {}   # voice name → voice_state
_ready = False
_SAMPLE_RATE = 24000      # pocket-tts default; overwritten after load

DEFAULT_VOICE = "anna"

# ── Markdown → plain text ────────────────────────────────────────────────────

def _strip_markdown(text: str) -> str:
    """Remove markdown so TTS reads clean prose, not punctuation."""
    # Fenced code blocks → skip entirely (code should not be read aloud)
    text = re.sub(r"```.*?```", ".", text, flags=re.DOTALL)
    # Inline code
    text = re.sub(r"`[^`]+`", "", text)
    # ATX headers — keep the text, drop the # marks
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    # Bold / italic
    text = re.sub(r"\*{1,3}([^*\n]+)\*{1,3}", r"\1", text)
    text = re.sub(r"_{1,3}([^_\n]+)_{1,3}", r"\1", text)
    # Markdown links [label](url) → label
    text = re.sub(r"\[([^\]]+)\]\([^\)]*\)", r"\1", text)
    # Bullet / numbered list markers
    text = re.sub(r"^[\s]*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[\s]*\d+\.\s+", "", text, flags=re.MULTILINE)
    # Horizontal rules
    text = re.sub(r"^[-*_]{3,}\s*$", "", text, flags=re.MULTILINE)
    # Collapse excess blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

# ── Model loading ────────────────────────────────────────────────────────────

def _load_model() -> None:
    global _model, _ready, _SAMPLE_RATE
    logger.info("pocket-tts: loading model (first run downloads from HuggingFace)…")
    from pocket_tts import TTSModel
    with _init_lock:
        if _model is not None:
            return
        _model = TTSModel.load_model()
        _SAMPLE_RATE = _model.sample_rate
        # Pre-warm default voice so the first real request is fast
        _voice_cache[DEFAULT_VOICE] = _model.get_state_for_audio_prompt(DEFAULT_VOICE)
        _ready = True
    logger.info("pocket-tts: model ready — sample_rate=%d", _SAMPLE_RATE)


def _get_voice_state(voice: str):
    """Return cached voice state; create if missing (model lock not needed — semaphore ensures serial access)."""
    if voice not in _voice_cache:
        logger.info("pocket-tts: loading voice state '%s'", voice)
        _voice_cache[voice] = _model.get_state_for_audio_prompt(voice)
    return _voice_cache[voice]


def _synthesize_wav(text: str, voice: str) -> bytes:
    """Run synthesis and return WAV bytes. Called from a thread executor."""
    voice_state = _get_voice_state(voice)
    audio_tensor = _model.generate_audio(voice_state, text)
    audio_np = audio_tensor.numpy()
    # Convert float32 → int16 for broad player compatibility
    audio_int16 = (np.clip(audio_np, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    scipy.io.wavfile.write(buf, _SAMPLE_RATE, audio_int16)
    return buf.getvalue()

# ── App lifecycle ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _load_model)
    yield


app = FastAPI(title="Pocket TTS", lifespan=lifespan)

# One synthesis at a time — pocket-tts already uses 2 cores; serialise to
# avoid memory spikes on a 4-core ARM box.
_sem = asyncio.Semaphore(1)

# ── Schemas ──────────────────────────────────────────────────────────────────

class TTSRequest(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    if not _ready:
        raise HTTPException(status_code=503, detail="Model still loading")
    return {"status": "ready"}


@app.post("/tts")
async def synthesize(req: TTSRequest):
    if not _ready:
        raise HTTPException(status_code=503, detail="Model not ready yet — retry in a moment")

    text = _strip_markdown(req.text)
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty after cleaning")
    if len(text) > 4000:
        # Truncate gracefully rather than error — chat replies should be short
        text = text[:4000]

    voice = req.voice or DEFAULT_VOICE

    async with _sem:
        loop = asyncio.get_running_loop()
        try:
            wav_bytes = await loop.run_in_executor(
                None, lambda: _synthesize_wav(text, voice)
            )
        except Exception as exc:
            logger.error("pocket-tts: synthesis failed — %s: %s", type(exc).__name__, exc)
            raise HTTPException(status_code=500, detail="Synthesis failed")

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"Content-Disposition": "inline; filename=reply.wav"},
    )
