"""Chat assistant router — context-aware page helper."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from app.api.dependencies import get_current_user
from app.clients.llm import call_llm
from app.core.exceptions import LLMError
from app.core.logging import get_logger

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = get_logger(__name__)

# Keep context and history bounded so we don't blow the token budget
MAX_CONTEXT_CHARS = 3000
MAX_HISTORY_TURNS = 10  # last N messages (user + assistant pairs)


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


class ChatResponse(BaseModel):
    reply: str


@router.post("", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    _user: str = Depends(get_current_user),
):
    # Trim context to avoid token bloat
    ctx = body.context.strip()[:MAX_CONTEXT_CHARS]

    system_lines = [
        "You are a helpful TOEFL study assistant embedded inside a TOEFL practice app called toeflindo.",
        "Help the user understand content on the current page, answer questions about TOEFL concepts,",
        "grammar rules, vocabulary, reading/listening/speaking/writing strategies.",
        "Be concise and clear. Use plain English. Avoid overly long responses unless asked.",
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

    # Build message list: system + bounded history
    history = body.messages[-MAX_HISTORY_TURNS:]
    messages = [{"role": "system", "content": system_prompt}] + [
        {"role": m.role, "content": m.content} for m in history
    ]

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
