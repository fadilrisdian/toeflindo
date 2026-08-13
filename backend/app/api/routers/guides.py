"""Guides router — serve static HTML writing guide files."""
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse

from app.api.dependencies import get_current_user
from app.core.config import GUIDE_DIR

router = APIRouter(prefix="/api/writing", tags=["guides"])

_guide_dir = Path(GUIDE_DIR)


@router.get("/guide/bas", response_class=HTMLResponse)
async def bas_guide(_user: str = Depends(get_current_user)):
    f = _guide_dir / "writing-bas-guide.html"
    if not f.exists():
        return HTMLResponse("<p>Guide not found.</p>", status_code=404)
    return HTMLResponse(f.read_text(encoding="utf-8"))


@router.get("/guide/email", response_class=HTMLResponse)
async def email_guide(_user: str = Depends(get_current_user)):
    # prefer new guide file, fall back to legacy ref
    f = _guide_dir / "writing-email-guide.html"
    if not f.exists():
        f = _guide_dir / "writing-email-ref.html"
    if not f.exists():
        return HTMLResponse("<p>Guide not found.</p>", status_code=404)
    return HTMLResponse(f.read_text(encoding="utf-8"))


@router.get("/guide/discussion", response_class=HTMLResponse)
async def discussion_guide(_user: str = Depends(get_current_user)):
    # prefer new guide file, fall back to legacy
    f = _guide_dir / "writing-discussion-guide.html"
    if not f.exists():
        f = _guide_dir / "writing-discussion.html"
    if not f.exists():
        return HTMLResponse("<p>Guide not found.</p>", status_code=404)
    return HTMLResponse(f.read_text(encoding="utf-8"))
