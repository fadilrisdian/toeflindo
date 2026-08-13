"""Embedding Service — OpenAI-compatible API serving Jina embeddings on CPU.

Exposes /v1/embeddings (OpenAI format) so LiteLLM can proxy to it directly.
Also exposes /similarity and /pairwise convenience endpoints for the TOEFL backend.
"""
from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ── Global model holder ───────────────────────────────────────────────────────

_model = None
_model_name = ""


def _load_model():
    global _model, _model_name
    from sentence_transformers import SentenceTransformer
    _model_name = os.environ.get("MODEL_NAME", "ManiacLabs/miniac-embed")
    _model = SentenceTransformer(_model_name)
    return _model


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model at startup."""
    t0 = time.perf_counter()
    _load_model()
    ms = (time.perf_counter() - t0) * 1000
    print(f"✓ Model '{_model_name}' loaded in {ms:.0f}ms")
    yield


app = FastAPI(title="Embedding Service", version="1.0.0", lifespan=lifespan)

# ── Logging ───────────────────────────────────────────────────────────────────

import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("embedding")


# ── OpenAI-compatible schemas ─────────────────────────────────────────────────

class EmbeddingRequest(BaseModel):
    input: str | list[str]
    model: str = ""
    encoding_format: str = "float"


class EmbeddingData(BaseModel):
    object: str = "embedding"
    embedding: list[float]
    index: int


class EmbeddingUsage(BaseModel):
    prompt_tokens: int = 0
    total_tokens: int = 0


class EmbeddingResponse(BaseModel):
    object: str = "list"
    data: list[EmbeddingData]
    model: str
    usage: EmbeddingUsage


# ── Convenience schemas ───────────────────────────────────────────────────────

class SimilarityRequest(BaseModel):
    text_a: str
    text_b: str


class SimilarityResponse(BaseModel):
    similarity: float


class PairwiseRequest(BaseModel):
    sentences: list[str]


class PairwiseResponse(BaseModel):
    similarities: list[float]
    average: float


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "model": _model_name, "model_loaded": _model is not None}


@app.post("/v1/embeddings", response_model=EmbeddingResponse)
async def create_embeddings(body: EmbeddingRequest):
    """OpenAI-compatible embeddings endpoint."""
    if not _model:
        raise HTTPException(503, "Model not loaded")

    # Normalize input to list
    texts = body.input if isinstance(body.input, list) else [body.input]
    if not texts:
        raise HTTPException(400, "input is empty")
    if len(texts) > 64:
        raise HTTPException(400, "Maximum 64 texts per request")

    # Log request
    previews = [t[:80] + "..." if len(t) > 80 else t for t in texts]
    logger.info("POST /v1/embeddings count=%d texts=%s", len(texts), previews)

    t0 = time.perf_counter()
    embeddings = _model.encode(texts, normalize_embeddings=True)
    ms = (time.perf_counter() - t0) * 1000

    data = [
        EmbeddingData(embedding=emb.tolist(), index=i)
        for i, emb in enumerate(embeddings)
    ]

    logger.info("  → OK dims=%d latency=%.0fms", len(embeddings[0]), ms)

    return EmbeddingResponse(
        data=data,
        model=_model_name,
        usage=EmbeddingUsage(prompt_tokens=sum(len(t.split()) for t in texts)),
    )


@app.post("/similarity", response_model=SimilarityResponse)
async def similarity(body: SimilarityRequest):
    """Cosine similarity between two texts."""
    if not _model:
        raise HTTPException(503, "Model not loaded")
    if not body.text_a.strip() or not body.text_b.strip():
        raise HTTPException(400, "Both texts must be non-empty")

    logger.info("POST /similarity a='%s' b='%s'", body.text_a[:60], body.text_b[:60])
    t0 = time.perf_counter()
    embeddings = _model.encode([body.text_a, body.text_b], normalize_embeddings=True)
    sim = float(np.dot(embeddings[0], embeddings[1]))
    ms = (time.perf_counter() - t0) * 1000
    logger.info("  → similarity=%.4f latency=%.0fms", sim, ms)
    return SimilarityResponse(similarity=sim)


@app.post("/pairwise", response_model=PairwiseResponse)
async def pairwise(body: PairwiseRequest):
    """Cosine similarity between each adjacent pair of sentences (discourse coherence)."""
    if not _model:
        raise HTTPException(503, "Model not loaded")
    if len(body.sentences) < 2:
        raise HTTPException(400, "Need at least 2 sentences")
    if len(body.sentences) > 64:
        raise HTTPException(400, "Maximum 64 sentences")

    logger.info("POST /pairwise sentences=%d", len(body.sentences))
    t0 = time.perf_counter()
    embeddings = _model.encode(body.sentences, normalize_embeddings=True)
    similarities: list[float] = []
    for i in range(len(embeddings) - 1):
        sim = float(np.dot(embeddings[i], embeddings[i + 1]))
        similarities.append(round(sim, 4))

    avg = sum(similarities) / len(similarities) if similarities else 0.0
    ms = (time.perf_counter() - t0) * 1000
    logger.info("  → avg=%.4f pairs=%d latency=%.0fms", avg, len(similarities), ms)
    return PairwiseResponse(similarities=similarities, average=round(avg, 4))
