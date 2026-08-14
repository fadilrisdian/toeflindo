# How to rebuild after a code change

## Backend change

```bash
cd ~/.hermes/toefl_tracker_v2
docker compose build toefl-api
docker compose up -d toefl-api
```

The frontend and nginx keep running during this — users already on the site are unaffected until the API container restarts (which takes a few seconds).

## Frontend change

```bash
docker compose build toefl-frontend
docker compose up -d toefl-frontend
```

The Next.js build runs inside the container. Because the frontend depends on the API health check, `up -d` waits for the API to be healthy before starting the new frontend container.

## Both at once

```bash
docker compose build
docker compose up -d
```

Docker Compose respects the `depends_on` order, so the API comes up first.

## Verifying the rebuild worked

```bash
docker compose ps
docker compose logs --tail=30 toefl-api
docker compose logs --tail=30 toefl-frontend
```

If either container shows `restarting`, check the logs for startup errors — the most common cause is a missing required environment variable.
