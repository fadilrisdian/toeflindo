"""Kyutai Pocket TTS sidecar service.

Keeps the model in memory between requests.
Binds 0.0.0.0 inside the container but only reachable via toefl-v2-internal Docker network.

POST /tts         { text, voice }  -> audio/wav          (full, for manual replay)
POST /tts/stream  { text, voice }  -> application/octet-stream  (raw float32 PCM chunks)
GET  /health    -> { status: ok }
GET  /ready     -> { status: ready } | 503

Streaming format:
  4-byte little-endian uint32 sample_rate
  N × 4-byte little-endian float32 samples (1920 samples = 80ms per chunk)
"""
from __future__ import annotations

import asyncio
import io
import logging
import queue
import re
import struct
import threading
from contextlib import asynccontextmanager

import numpy as np
import scipy.io.wavfile
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response, StreamingResponse
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
    text = re.sub(r"```.*?```", ".", text, flags=re.DOTALL)
    text = re.sub(r"`[^`]+`", "", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*{1,3}([^*\n]+)\*{1,3}", r"\1", text)
    text = re.sub(r"_{1,3}([^_\n]+)_{1,3}", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^\)]*\)", r"\1", text)
    text = re.sub(r"^[\s]*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[\s]*\d+\.\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[-*_]{3,}\s*$", "", text, flags=re.MULTILINE)
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
        _voice_cache[DEFAULT_VOICE] = _model.get_state_for_audio_prompt(DEFAULT_VOICE)
        _ready = True
    logger.info("pocket-tts: model ready — sample_rate=%d", _SAMPLE_RATE)


def _get_voice_state(voice: str):
    if voice not in _voice_cache:
        logger.info("pocket-tts: loading voice state '%s'", voice)
        _voice_cache[voice] = _model.get_state_for_audio_prompt(voice)
    return _voice_cache[voice]


def _synthesize_wav(text: str, voice: str) -> bytes:
    """Full synthesis → WAV bytes (for manual replay button)."""
    voice_state = _get_voice_state(voice)
    audio_tensor = _model.generate_audio(voice_state, text)
    audio_np = audio_tensor.numpy()
    audio_int16 = (np.clip(audio_np, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    scipy.io.wavfile.write(buf, _SAMPLE_RATE, audio_int16)
    return buf.getvalue()


def _stream_pcm(text: str, voice: str, q: "queue.Queue[bytes | None]") -> None:
    """Run generate_audio_stream in a thread; push float32 chunks to queue.

    Protocol:
      First message: 4-byte LE uint32 = sample_rate
      Subsequent:    4-byte LE uint32 = chunk length in samples,
                     then N × 4-byte LE float32 samples
      Sentinel:      None  (signals end of stream)
    """
    try:
        voice_state = _get_voice_state(voice)
        # Header: sample rate
        q.put(struct.pack("<I", _SAMPLE_RATE))
        for chunk in _model.generate_audio_stream(voice_state, text):
            arr = chunk.numpy().astype(np.float32)
            # Prefix each chunk with its length so the client can frame it
            n = len(arr)
            q.put(struct.pack("<I", n) + arr.tobytes())
    except Exception as exc:
        logger.error("pocket-tts: stream failed — %s: %s", type(exc).__name__, exc)
    finally:
        q.put(None)  # sentinel

# ── App lifecycle ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _load_model)
    yield


app = FastAPI(title="Pocket TTS", lifespan=lifespan)

# Serialise synthesis — model is not thread-safe during generation
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
    """Full synthesis → WAV. Used by the manual replay button."""
    if not _ready:
        raise HTTPException(status_code=503, detail="Model not ready yet")

    text = _strip_markdown(req.text)
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty after cleaning")
    text = text[:4000]
    voice = req.voice or DEFAULT_VOICE

    async with _sem:
        loop = asyncio.get_running_loop()
        try:
            wav_bytes = await loop.run_in_executor(None, lambda: _synthesize_wav(text, voice))
        except Exception as exc:
            logger.error("pocket-tts: synthesis failed — %s: %s", type(exc).__name__, exc)
            raise HTTPException(status_code=500, detail="Synthesis failed")

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"Content-Disposition": "inline; filename=reply.wav"},
    )


@app.post("/tts/stream")
async def synthesize_stream(req: TTSRequest):
    """Streaming synthesis → raw float32 PCM.

    Yields framed chunks as the model generates them.
    First chunk arrives in ~300ms, enabling near-realtime playback.
    """
    if not _ready:
        raise HTTPException(status_code=503, detail="Model not ready yet")

    text = _strip_markdown(req.text)
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty after cleaning")
    text = text[:4000]
    voice = req.voice or DEFAULT_VOICE

    async def generate():
        # Run blocking generation in a thread, communicate via queue
        q: queue.Queue[bytes | None] = queue.Queue(maxsize=32)
        loop = asyncio.get_running_loop()

        async with _sem:
            thread = threading.Thread(
                target=_stream_pcm, args=(text, voice, q), daemon=True
            )
            thread.start()

            while True:
                # Poll queue without blocking the event loop
                try:
                    chunk = await loop.run_in_executor(None, lambda: q.get(timeout=30))
                except Exception:
                    break
                if chunk is None:
                    break
                yield chunk

    return StreamingResponse(
        generate(),
        media_type="application/octet-stream",
        headers={"X-Sample-Rate": str(_SAMPLE_RATE)},
    )
