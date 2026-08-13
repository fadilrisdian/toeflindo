"""LiteLLM proxy client — unified LLM call helpers.

Monkey-patches litellm.completion at import time when LITELLM_PROXY_URL is set,
routing all calls through the internal proxy so the rest of the codebase can call
`llm_client.completion(...)` without caring about transport details.

Public helpers
--------------
call_llm(messages, ...)        -> str   raw content, <think> blocks stripped
call_llm_json(messages, ...)   -> dict  parsed JSON, raises LLMError on failure
completion(**kwargs)           -> litellm response object (low-level)
"""
from __future__ import annotations

import json
import re
import time

import litellm
from openai import OpenAI as _OpenAI

from app.core.config import LITELLM_MASTER_KEY, LITELLM_PROXY_URL
from app.core.exceptions import LLMError
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── Proxy monkey-patch ─────────────────────────────────────────────────────────

if LITELLM_PROXY_URL:
    # openai SDK requires a non-empty api_key even when a custom base_url is used
    _oai = _OpenAI(
        base_url=LITELLM_PROXY_URL.rstrip("/") + "/v1",
        api_key=LITELLM_MASTER_KEY or "placeholder",
    )

    # OpenAI-SDK-accepted kwargs — filter out LiteLLM-only keys (fallbacks,
    # metadata, caching, num_retries, etc.) to avoid TypeError on create().
    _OPENAI_KWARGS = frozenset({
        "messages", "model", "temperature", "max_tokens", "top_p", "n",
        "stream", "stop", "presence_penalty", "frequency_penalty",
        "response_format", "seed", "tools", "tool_choice", "user",
        "logit_bias", "logprobs", "top_logprobs", "max_completion_tokens",
    })

    def _proxy_completion(**kwargs):
        model = kwargs.pop("model", "")
        if "/" in model:
            model = model.split("/", 1)[-1]
        safe_kwargs = {k: v for k, v in kwargs.items() if k in _OPENAI_KWARGS}
        return _oai.chat.completions.create(model=model, **safe_kwargs)

    litellm.completion = _proxy_completion


def completion(**kwargs):
    """Thin wrapper — call litellm (or the proxy) with any kwargs."""
    return litellm.completion(**kwargs)


# ── Shared constants ───────────────────────────────────────────────────────────

# Default fallback chain — tried in order until one succeeds.
FALLBACK_MODELS: list[str] = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-safeguard-20b",
    "openai/qwen3.6-27b",
]

# Model name tags that support response_format={"type": "json_object"} via the proxy.
JSON_MODE_TAGS: frozenset[str] = frozenset({"gpt-oss", "safeguard", "llama"})


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _strip_think(text: str) -> str:
    """Remove <think>...</think> reasoning blocks emitted by some models (e.g. qwen3).

    Also handles unclosed <think> blocks that get truncated at max_tokens.
    """
    # Remove closed blocks first
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    # Remove any remaining unclosed block (truncated at token limit)
    text = re.sub(r"<think>.*$", "", text, flags=re.DOTALL)
    return text.strip()


def _parse_json(raw: str) -> dict:
    """Extract and parse a JSON object from raw LLM output.

    Handles code fences, leading/trailing prose, unclosed <think> blocks,
    and JSON embedded inside think tags.
    """
    # Strip <think>/<think> TAGS but keep their content — JSON may be inside
    stripped = re.sub(r"</?think>", "", raw, flags=re.IGNORECASE).strip()

    for attempt in (stripped, raw):
        try:
            return json.loads(attempt)
        except json.JSONDecodeError:
            pass
        # Strip code fences
        cleaned = re.sub(r"```(?:json)?", "", attempt, flags=re.IGNORECASE).strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass
        # Extract outermost {...} block
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError:
                pass

    raise ValueError(f"No valid JSON found in LLM output: {raw[:200]}")


def call_llm(
    *,
    messages: list,
    temperature: float = 0.7,
    max_tokens: int = 4000,
    models: list[str] | None = None,
    label: str = "",
    json_mode: bool = True,
) -> str:
    """Try each model in order; return raw content string with <think> blocks stripped.

    Args:
        messages:    Chat messages list (OpenAI format).
        temperature: Sampling temperature.
        max_tokens:  Max tokens to generate.
        models:      Override fallback chain. Defaults to FALLBACK_MODELS.
        label:       Log label for debugging (e.g. "drill_gen/Tenses").

    Returns:
        Non-empty content string from the first successful model.

    Raises:
        LLMError: If all models fail or return empty content.
    """
    chain = models if models is not None else FALLBACK_MODELS
    for model in chain:
        t0 = time.perf_counter()
        try:
            bare = model.split("/", 1)[-1]
            use_json = json_mode and any(tag in bare for tag in JSON_MODE_TAGS)
            kwargs: dict = dict(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            if use_json:
                kwargs["response_format"] = {"type": "json_object"}
            resp = completion(**kwargs)
            raw = (resp.choices[0].message.content or "").strip()
            raw = _strip_think(raw)
            if raw:
                ms = (time.perf_counter() - t0) * 1000
                logger.info(
                    "LLM ok model=%s label=%s latency=%.0fms", model, label, ms
                )
                return raw
            logger.warning("LLM empty response model=%s label=%s", model, label)
        except Exception as exc:
            ms = (time.perf_counter() - t0) * 1000
            logger.warning(
                "LLM failed model=%s label=%s latency=%.0fms error=%s — trying next",
                model,
                label,
                ms,
                exc,
            )

    raise LLMError(f"All LLM models failed (label={label})")


def call_llm_json(
    *,
    messages: list,
    temperature: float = 0.7,
    max_tokens: int = 4000,
    models: list[str] | None = None,
    label: str = "",
) -> dict:
    """Like call_llm but parses the response as JSON.

    Returns:
        Parsed dict from the first successful model.

    Raises:
        LLMError: If all models fail, return empty content, or return unparseable JSON.
    """
    raw = call_llm(
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        models=models,
        label=label,
    )
    try:
        return _parse_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        raise LLMError(f"LLM returned non-JSON (label={label}): {exc}") from exc
