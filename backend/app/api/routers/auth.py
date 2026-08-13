"""Auth router — login, logout, me."""
import os
from fastapi import APIRouter, Depends, Form, HTTPException, Response
from fastapi.responses import JSONResponse

from app.api.dependencies import get_current_user
from app.core.config import ACCESS_TOKEN_EXPIRE_HOURS, SESSION_COOKIE
from app.core.exceptions import AuthError
from app.services.auth_service import login

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
async def login_endpoint(
    response: Response,
    username: str = Form(...),
    password: str = Form(...),
):
    try:
        token = login(username, password)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    # Set cookie directly on the JSONResponse — FastAPI does NOT merge cookies
    # from the injected Response parameter when returning a Response subclass.
    resp = JSONResponse({"access_token": token, "token_type": "bearer"})
    resp.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=ACCESS_TOKEN_EXPIRE_HOURS * 3600,
        httponly=True,
        samesite="lax",
        secure=os.environ.get("IS_PRODUCTION", "").lower() in ("1", "true", "yes"),
    )
    return resp


@router.post("/logout")
async def logout(response: Response):
    # Must match the same attributes used in set_cookie so browsers honour the deletion
    response.delete_cookie(
        SESSION_COOKIE,
        httponly=True,
        samesite="lax",
        secure=os.environ.get("IS_PRODUCTION", "").lower() in ("1", "true", "yes"),
    )
    return {"ok": True}


@router.get("/me")
async def me(username: str = Depends(get_current_user)):
    return {"username": username}
