# How to access logs

## View live logs

```bash
# All services
docker compose logs -f

# API only
docker compose logs -f toefl-api

# Frontend only
docker compose logs -f toefl-frontend
```

Press `Ctrl-C` to stop tailing.

## View recent logs without following

```bash
docker compose logs --tail=100 toefl-api
```

## What the API logs contain

Every HTTP request is logged by the `AccessLogMiddleware` in the format:

```
INFO  method=GET path=/api/dashboard/summary status=200 duration_ms=42
```

LLM calls, speech analysis, and database errors are logged at `ERROR` level with enough context to identify the failing request (e.g., `grammar_type=`, `task_id=`).

## Filter for errors only

```bash
docker compose logs toefl-api 2>&1 | grep ERROR
```

## Persist logs beyond container lifetime

By default Docker stores logs in its own journal. To write them to a file on the host, add a logging driver to `docker-compose.yaml`:

```yaml
services:
  toefl-api:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

Then rebuild with `docker compose up -d --force-recreate toefl-api`.
