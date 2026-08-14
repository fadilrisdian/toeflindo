# How to rotate credentials

All credentials live in `.env` at the project root. Edit the file, then restart the affected service.

## Rotate the JWT secret key

Changing `SECRET_KEY` immediately invalidates all existing sessions — every logged-in user will be signed out.

1. Generate a new secret:
   ```bash
   python3 -c "import secrets; print(secrets.token_hex(32))"
   ```
2. Replace `SECRET_KEY=...` in `.env` with the new value.
3. Restart the backend:
   ```bash
   docker compose up -d toefl-api
   ```

## Change the login password

1. Set `AUTH_PASS=<new-password>` in `.env`.
2. Restart the backend:
   ```bash
   docker compose up -d toefl-api
   ```

Existing sessions remain valid until they expire (default 8 hours) or `SECRET_KEY` is also rotated.

## Rotate the LiteLLM key

1. Set `LITELLM_MASTER_KEY=<new-key>` in `.env`.
2. Restart the backend:
   ```bash
   docker compose up -d toefl-api
   ```

LLM-backed features (grammar explanation, speaking analysis, writing feedback) will fail between the key rotation on the LiteLLM proxy and the restart here, so do them together.

## Change the session expiry duration

Set `SESSION_EXPIRE_HOURS=<hours>` in `.env` (default: `8`), then restart the backend. The new value applies to tokens issued after the restart; existing tokens keep their original expiry.
