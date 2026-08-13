"""JWT helpers and credential verification."""
import hmac
from datetime import datetime, timedelta, timezone
from typing import Optional

from joserfc import jwt
from joserfc.jwk import OctKey
import joserfc.errors

from app.core.config import (
    ACCESS_TOKEN_EXPIRE_HOURS,
    ALGORITHM,
    AUTH_PASS,
    AUTH_USER,
    SECRET_KEY,
)


def _jwt_key() -> OctKey:
    return OctKey.import_key(SECRET_KEY.encode())


def check_credentials(username: str, password: str) -> bool:
    user_ok = hmac.compare_digest(username, AUTH_USER)
    pass_ok = hmac.compare_digest(password, AUTH_PASS)
    return user_ok and pass_ok


def create_access_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"alg": ALGORITHM},
        {"sub": username, "exp": int(expire.timestamp())},
        _jwt_key(),
    )


def verify_token(token: str) -> Optional[str]:
    try:
        decoded = jwt.decode(token, _jwt_key())
        claims = decoded.claims
        exp = claims.get("exp")
        # Reject tokens with no exp — a crafted token without exp would never expire
        if exp is None:
            return None
        if datetime.fromtimestamp(exp, tz=timezone.utc) < datetime.now(timezone.utc):
            return None
        return claims.get("sub")
    except joserfc.errors.JoseError:
        return None
