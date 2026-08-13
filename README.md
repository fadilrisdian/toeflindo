# TOEFL Tracker v2

Next.js 15 frontend + FastAPI JSON backend for TOEFL practice tracking.

## Documentation

- [Tutorial](docs/tutorial.md) — get the stack running and complete your first drill
- [How-to guides](docs/how-to/) — back up the database, rebuild after a code change, rotate credentials, and more
- [Reference](docs/reference.md) — all API endpoints, environment variables, frontend routes, and service topology
- [Explanation](docs/explanation.md) — why it's built the way it is (auth design, SRS, two databases, TLS, LLM integration)

## Quick start

Create `.env` in the project root (see [environment variables](docs/reference.md#environment-variables)), then:

```bash
cd ~/toeflindo
docker compose build
docker compose up -d
```

Open `https://<your-server-ip>:8888`.

After any backend change:

```bash
docker compose build toefl-api && docker compose up -d toefl-api
```

After any frontend change:

```bash
docker compose build toefl-frontend && docker compose up -d toefl-frontend
```
