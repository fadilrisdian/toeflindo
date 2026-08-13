"""Auth service — credential check and token lifecycle."""
from app.core.exceptions import AuthError
from app.core.logging import get_logger
from app.core.security import check_credentials, create_access_token, verify_token

logger = get_logger(__name__)


def login(username: str, password: str) -> str:
    """Validate credentials and return a signed JWT. Raises AuthError on failure."""
    if not check_credentials(username, password):
        # WARNING: expected, handled — user just typed the wrong password
        logger.warning("login failed username=%s", username)
        raise AuthError("Invalid credentials")
    logger.info("login ok username=%s", username)
    return create_access_token(username)


def authenticate_token(token: str) -> str:
    """Decode token and return username. Raises AuthError if invalid/expired."""
    username = verify_token(token)
    if not username:
        # WARNING: invalid token is handled — caller gets 401
        logger.warning("token validation failed — invalid or expired")
        raise AuthError("Invalid or expired token")
    return username
