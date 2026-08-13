"""FastAPI dependency: resolve current authenticated user from Bearer header or cookie."""
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException

from app.services.auth_service import authenticate_token
from app.core.exceptions import AuthError


async def get_current_user(
    authorization: Optional[str] = Header(default=None),
    toefl_token: Optional[str] = Cookie(default=None),
) -> str:
    token: Optional[str] = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:]
    elif toefl_token:
        token = toefl_token
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        return authenticate_token(token)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
