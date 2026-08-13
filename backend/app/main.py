"""
TOEFL Tracker v2 — FastAPI application entry point.

Auth:  JWT via Bearer header or httpOnly cookie.
CORS:  configured for the Next.js frontend origin.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.middleware import AccessLogMiddleware
from app.api.routers.admin import router as admin_router
from app.api.routers.auth import router as auth_router
from app.api.routers.dashboard import router as dashboard_router
from app.api.routers.focus_drills import router as focus_drills_router
from app.api.routers.grammar import router as grammar_router
from app.api.routers.guides import router as guides_router
from app.api.routers.learn import router as learn_router
from app.api.routers.remediate import router as remediate_router
from app.api.routers.speaking import router as speaking_router
from app.api.routers.writing import router as writing_router
from app.clients.llm import completion  # noqa: F401 — triggers proxy setup at startup
from app.core.config import FRONTEND_ORIGIN
from app.core.logging import configure_logging
from app.db.session import run_migrations

configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    await asyncio.get_event_loop().run_in_executor(None, run_migrations)
    yield


app = FastAPI(title="TOEFL Tracker API v2", docs_url=None, redoc_url=None, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AccessLogMiddleware)

app.include_router(admin_router)
app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(focus_drills_router)
app.include_router(grammar_router)
app.include_router(guides_router)
app.include_router(learn_router)
app.include_router(remediate_router)
app.include_router(speaking_router)
app.include_router(writing_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
