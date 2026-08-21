"""Chat assistant router — context-aware page helper."""
from __future__ import annotations

import asyncio
import json as _json
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, field_validator

from app.api.dependencies import get_current_user
from app.clients.llm import FALLBACK_MODELS, call_llm, completion
from app.core.exceptions import LLMError
from app.core.logging import get_logger

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = get_logger(__name__)

# Keep context and history bounded so we don't blow the token budget
MAX_CONTEXT_CHARS = 3000
MAX_HISTORY_TURNS = 10  # last N messages (user + assistant pairs)

TTS_URL = os.environ.get("TTS_URL", "http://toefl-tts:8000")


class ChatMessage(BaseModel):
    role: str
    content: str

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v: str) -> str:
        if v not in {"user", "assistant"}:
            raise ValueError("role must be 'user' or 'assistant'")
        return v


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    context: str = ""
    tts_mode: bool = False  # True when the reply will be read aloud via TTS


class ChatResponse(BaseModel):
    reply: str


def _build_messages(body: ChatRequest) -> list[dict]:
    """Build the full messages list (system prompt + history) from a ChatRequest."""
    ctx = body.context.strip()[:MAX_CONTEXT_CHARS]

    system_lines = [
        "You are a helpful TOEFL study assistant embedded inside a TOEFL practice app called toeflindo.",
        "Help the user understand content on the current page, answer questions about TOEFL concepts,",
        "grammar rules, vocabulary, reading/listening/speaking/writing strategies.",
        "Be concise and clear. Use plain English. Avoid overly long responses unless asked.",
    ]

    if body.tts_mode:
        system_lines += [
            "",
            "IMPORTANT: Your response will be read aloud by a text-to-speech engine.",
            "You MUST follow these rules strictly:",
            "- Write in plain spoken sentences only. No markdown whatsoever.",
            "- No tables, bullet points, numbered lists, or dashes.",
            "- No bold (**text**), italic (*text*), or backtick code formatting.",
            "- No headers or section titles (no # marks).",
            "- No URLs or links.",
            "- Do not use special characters like asterisks, pipes, or underscores for formatting.",
            "- If you need to enumerate things, use natural speech: 'First... Second... Third...' or 'For example...'.",
            "- Keep the response conversational and natural to listen to.",
        ]

    if ctx:
        system_lines += [
            "",
            "The user is currently on a page that contains the following content:",
            "---",
            ctx,
            "---",
            "Refer to this context when answering their questions.",
        ]

    system_prompt = "\n".join(system_lines)
    history = body.messages[-MAX_HISTORY_TURNS:]
    return [{"role": "system", "content": system_prompt}] + [
        {"role": m.role, "content": m.content} for m in history
    ]


@router.post("", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    _user: str = Depends(get_current_user),
):
    messages = _build_messages(body)

    try:
        reply = call_llm(
            messages=messages,
            temperature=0.5,
            max_tokens=1000,
            json_mode=False,
            label="chat/assistant",
        )
    except LLMError as exc:
        logger.error("chat: LLM failed — %s", exc)
        raise HTTPException(status_code=503, detail="AI assistant temporarily unavailable.")

    return ChatResponse(reply=reply)


@router.post("/stream")
async def chat_stream(
    body: ChatRequest,
    _user: str = Depends(get_current_user),
):
    """Get full LLM reply then stream it sentence-by-sentence as SSE.

    Each event: data: {"sentence": "...", "index": N}
    Final event: data: {"done": true, "full": "<complete reply>"}
    Error event: data: {"error": "..."}

    This gives the frontend each sentence the moment it's ready so text and
    TTS can fire together — the LLM models here are reasoning models that
    batch all content tokens so true token streaming isn't possible anyway.
    """
    import re as _re

    messages = _build_messages(body)

    async def generate():
        # 1. Get full reply (fast — typically <2s for short chat responses)
        try:
            loop = asyncio.get_event_loop()
            reply = await loop.run_in_executor(
                None,
                lambda: call_llm(
                    messages=messages,
                    temperature=0.5,
                    max_tokens=1000,
                    json_mode=False,
                    label="chat/stream",
                ),
            )
        except LLMError as exc:
            logger.error("chat/stream: LLM failed — %s", exc)
            yield f"data: {_json.dumps({'error': 'AI assistant temporarily unavailable.'})}\n\n"
            return

        # 2. Split into sentences — split on . ! ? keeping the punctuation
        raw_sentences = _re.split(r'(?<=[.!?])\s+', reply.strip())
        sentences = [s.strip() for s in raw_sentences if s.strip()]

        # 3. Stream each sentence — small delay between them feels natural
        for i, sentence in enumerate(sentences):
            yield f"data: {_json.dumps({'sentence': sentence, 'index': i})}\n\n"
            # Give the browser ~80ms head-start before the next sentence
            # so TTS fetch for sentence N is in-flight before N+1 arrives
            await asyncio.sleep(0.08)

        yield f"data: {_json.dumps({'done': True, 'full': reply})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )




@router.post("/tts")
async def chat_tts(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Convert an assistant reply to speech via the Pocket TTS sidecar.

    POST /api/chat/tts  { text: str, voice?: str }
    Returns audio/wav.  The sidecar strips markdown before synthesis.
    """
    body = await request.json()
    text = (body.get("text") or "").strip()
    voice = (body.get("voice") or "anna").strip()

    if not text:
        return JSONResponse({"error": "text is required"}, status_code=400)

    tts_endpoint = TTS_URL.rstrip("/") + "/tts"
    # TTS on a 4-core ARM CPU: 200 words ≈ ~15s; give 90s before giving up
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(tts_endpoint, json={"text": text, "voice": voice})
    except httpx.ConnectError:
        logger.warning("chat tts: TTS service unreachable at %s", tts_endpoint)
        return JSONResponse({"error": "TTS service unavailable"}, status_code=503)
    except httpx.TimeoutException:
        logger.warning("chat tts: TTS service timed out")
        return JSONResponse({"error": "TTS timed out — text may be too long"}, status_code=504)
    except Exception as exc:
        logger.error("chat tts: unexpected error — %s", exc)
        return JSONResponse({"error": "TTS failed"}, status_code=500)

    if resp.status_code == 503:
        return JSONResponse({"error": "TTS model not ready yet — retry in a moment"}, status_code=503)
    if resp.status_code != 200:
        logger.warning("chat tts: sidecar returned %d", resp.status_code)
        return JSONResponse({"error": "TTS synthesis failed"}, status_code=502)

    logger.info("chat tts: ok bytes=%d voice=%s", len(resp.content), voice)
    return Response(
        content=resp.content,
        media_type="audio/wav",
        headers={"Content-Disposition": "inline; filename=reply.wav"},
    )


@router.post("/tts/stream")
async def chat_tts_stream(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Stream TTS audio as raw float32 PCM chunks.

    POST /api/chat/tts/stream  { text: str, voice?: str }

    Returns application/octet-stream with framed float32 PCM:
      First 4 bytes:  LE uint32 sample_rate
      Per chunk:      LE uint32 n_samples, then n_samples × LE float32
    First chunk arrives in ~300ms enabling near-realtime playback.
    """
    body = await request.json()
    text = (body.get("text") or "").strip()
    voice = (body.get("voice") or "anna").strip()

    if not text:
        return JSONResponse({"error": "text is required"}, status_code=400)

    stream_endpoint = TTS_URL.rstrip("/") + "/tts/stream"

    async def proxy_stream():
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, read=90.0)) as client:
                async with client.stream("POST", stream_endpoint,
                                         json={"text": text, "voice": voice}) as resp:
                    if resp.status_code != 200:
                        return
                    async for chunk in resp.aiter_bytes(chunk_size=None):
                        yield chunk
        except Exception as exc:
            logger.error("chat tts/stream: proxy error — %s", exc)

    return StreamingResponse(
        proxy_stream(),
        media_type="application/octet-stream",
        headers={"X-TTS-Stream": "1"},
    )


@router.post("/transcribe")
async def chat_transcribe(
    request: Request,
    _user: str = Depends(get_current_user),
):
    """Transcribe audio to text for chatbot voice input.

    Accepts multipart/form-data with an 'audio' field (any format the STT
    chain accepts: webm, ogg, mp4, wav).  Returns {text: str}.

    Reuses transcribe_simple_bytes() — no ffmpeg conversion needed since
    Groq and LiteLLM both accept webm/ogg natively, saving ~700 ms on short
    chat recordings.
    """
    from app.core.exceptions import SpeechAnalyzerError
    from app.services.speech.stt import transcribe_simple_bytes

    form = await request.form()
    audio_file = form.get("audio")
    if not audio_file or isinstance(audio_file, str):
        return JSONResponse({"error": "No audio file provided"}, status_code=400)

    audio_bytes = await audio_file.read()
    if len(audio_bytes) < 100:
        return JSONResponse({"error": "Recording too short — please try again"}, status_code=400)
    if len(audio_bytes) > 10 * 1024 * 1024:
        return JSONResponse({"error": "Recording too long — maximum 10 MB"}, status_code=400)

    filename = getattr(audio_file, "filename", None) or "audio.webm"

    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: transcribe_simple_bytes(audio_bytes, filename),
        )
        text = result.get("text", "").strip()
        if not text:
            return JSONResponse({"error": "No speech detected — please try again"}, status_code=422)
        logger.info("chat transcribe: ok length=%d", len(text))
        return JSONResponse({"text": text})
    except SpeechAnalyzerError as exc:
        logger.error("chat transcribe: STT failed — %s", exc)
        return JSONResponse({"error": "Transcription unavailable — please type your message"}, status_code=503)
    except Exception as exc:
        logger.error("chat transcribe: unexpected error — %s", exc)
        return JSONResponse({"error": "Transcription failed"}, status_code=500)
