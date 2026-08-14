# How to run the API smoke test

A self-contained Python smoke test lives at `/tmp/toefl_qa.py` (regenerate it if needed — see below). It exercises all major API endpoints from inside the `toefl-v2-api` container, where environment variables are already set.

## Run the test

```bash
docker cp /tmp/toefl_qa.py toefl-v2-api:/tmp/toefl_qa.py
docker exec toefl-v2-api python3 /tmp/toefl_qa.py
```

Expected output ends with:

```
Results: 29 passed, 0 failed  (total 29)
```

## What it tests

- `GET /health` → `{ status: ok }`
- Login → token returned
- `/api/auth/me` with token
- Lowercase `bearer` scheme accepted (case-insensitive)
- JWT without `exp` claim rejected
- Grammar mistakes list, filter-options, recommendations
- `srs_delete` with `id=0` → 404 not found (not "missing id")
- `srs_delete` with no id → 400 missing id
- Weakspot generate
- Dashboard summary, writing, speaking, grammar
- `sal_weekly` date format is `YYYY-MM-DD` (not `YYYY-W03`)
- Task bank (Email Writing)
- Writing latest-features (returns `found` key)
- Tags LIKE filter (`?tags=campus`)
- Speaking sessions (listen-repeat, interview)
- Speaking recommended
- Learn topics list
- Writing features DB SELECT includes all 5 dimensions
- Logout returns `{ ok: true }`

## Regenerate the test script

The script is saved at `~/.hermes/toefl_tracker_v2/docs/` as a reference. To recreate it from scratch, have Kiro regenerate it — all test cases are documented in the list above.

## Running a full browser QA

For UI-level testing of all 38 frontend pages:

1. Start the stack: `docker compose up -d`
2. Ask Kiro: "test my app" — it will use the browser tool to navigate all pages and verify correct rendering, no JS errors, and that key fixes are working (topics sorted weakest first, writing dimensions showing, checklist auth working, etc.).

The browser can't advance past the speaking `/go` page loading state (no audio output in headless mode) — this is expected, not a bug.
