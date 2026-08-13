"""Dashboard router — read-only aggregated KPI and chart data."""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.api.dependencies import get_current_user
from app.db.session import db_context
from app.repositories.dashboard_repository import DashboardRepository

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
async def dashboard_summary(_user: str = Depends(get_current_user)):
    with db_context() as conn:
        return JSONResponse(DashboardRepository(conn).summary())


@router.get("/writing")
async def dashboard_writing(_user: str = Depends(get_current_user)):
    with db_context() as conn:
        return JSONResponse(DashboardRepository(conn).writing())


@router.get("/speaking")
async def dashboard_speaking(_user: str = Depends(get_current_user)):
    with db_context() as conn:
        return JSONResponse(DashboardRepository(conn).speaking())


@router.get("/grammar")
async def dashboard_grammar(_user: str = Depends(get_current_user)):
    with db_context() as conn:
        return JSONResponse(DashboardRepository(conn).grammar())


@router.get("/writing-analyzer")
async def dashboard_writing_analyzer(_user: str = Depends(get_current_user)):
    with db_context() as conn:
        return JSONResponse(DashboardRepository(conn).writing_analyzer())
