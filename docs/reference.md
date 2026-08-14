# Reference

Technical facts about TOEFL Tracker v2: API endpoints, environment variables, frontend routes, and service topology.

---

## Environment variables

All variables are read from `.env` in the project root (passed to the `toefl-api` container via `env_file`).

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | yes | — | HMAC key for JWT signing. Must be a long random string. Must not be empty or falsy. |
| `AUTH_PASS` | yes | — | Login password. Must not be empty or falsy. |
| `LITELLM_MASTER_KEY` | yes | — | API key for the LiteLLM proxy. Can be any non-empty string (even `"placeholder"`) if the proxy doesn't require auth. |
| `AUTH_USER` | no | `fadil` | Login username. |
| `SESSION_EXPIRE_HOURS` | no | `8` | JWT lifetime in hours. Must be a plain integer — e.g. `8`, not `8h`. |
| `FRONTEND_ORIGIN` | no | `http://localhost:3000` | Allowed CORS origin. Set to `https://localhost:8888` in production. |
| `TOEFL_DB_PATH` | no | `/data/toefl.db` | Path to the main SQLite database inside the container. |
| `GRAMMAR_CONTENT_DB_PATH` | no | `/data/grammar_content.db` | Path to the grammar content database inside the container. |
| `LITELLM_PROXY_URL` | no | `""` | Full URL of the LiteLLM proxy, e.g. `http://toefl-litellm:4000`. |
| `EMBEDDING_SERVICE_URL` | no | — | URL of the embedding service used for semantic similarity. |
| `IS_PRODUCTION` | no | `""` | Set to `1` or `true` to mark JWT cookies as `Secure`. |

---

## Authentication

- JWT issued at login, delivered as both a JSON body field (`access_token`) and an **httpOnly cookie** (`toefl_token`).
- The frontend uses `credentials: 'include'` on all fetch calls — the cookie is sent automatically.
- **Do NOT use `localStorage` to store or read the token** — the app uses httpOnly cookies exclusively.
- On 401 the frontend redirects to `/login` (guarded with `typeof window !== 'undefined'` for SSR safety).
- JWT algorithm: `HS256`. Default expiry: 8 hours. Tokens without an `exp` claim are rejected.
- Cookie attributes: `httpOnly=True`, `samesite="lax"`, `secure` when `IS_PRODUCTION=1`.
- Logout (`POST /api/auth/logout`) clears the cookie using matching attributes — browsers silently ignore deletions that omit `httponly`/`samesite`.

---

## API endpoints

All endpoints are under the prefix `/api`. All except `/api/auth/login`, `/api/auth/logout`, and `/api/speaking/audio` require a valid JWT, passed either as `Authorization: Bearer <token>` (case-insensitive scheme) or as the `toefl_token` httpOnly cookie.

### Auth — `/api/auth`

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Accepts `username` and `password` as form fields. Returns `{ access_token, token_type }` and sets the `toefl_token` httpOnly cookie. |
| `POST` | `/api/auth/logout` | Clears the `toefl_token` cookie. |
| `GET` | `/api/auth/me` | Returns `{ username }` for the authenticated user. |

### Grammar — `/api/grammar`

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/grammar/transcribe` | Transcribe a recorded audio answer. Multipart form: `audio` (file). |
| `POST` | `/api/grammar/ws/fix` | Edit the wrong/correct sentence of a weakspot card. Body: `{ wrong, correct, category, description }`. |
| `GET` | `/api/grammar/weakspot/generate` | Generate drill sentences. Query: `?category=<string>&count=5&difficulty=b1&language=english`. |
| `POST` | `/api/grammar/weakspot/submit` | Submit weakspot drill results. Body: `{ category, results: [{...}] }`. |
| `POST` | `/api/grammar/evaluate` | Evaluate a grammar correction attempt. Body: `{ user_answer, correct, wrong, category, language? }`. |
| `GET` | `/api/grammar/mistakes` | List mistakes. Query: `?page&page_size&category&section&task_type&sort`. All LOWER() matched. |
| `GET` | `/api/grammar/mistakes/{id}` | Get full detail for one mistake including Murphy units and audio seek. |
| `GET` | `/api/grammar/mistakes/{id}/adjacent` | Get `{ prev_id, next_id }` for keyboard navigation. |
| `POST` | `/api/grammar/mistakes/{id}/review` | Mark a mistake as reviewed. |
| `POST` | `/api/grammar/mistakes/delete` | Delete a mistake card. Body: `{ id }`. Returns 404 if not found, 400 if id missing. |
| `GET` | `/api/grammar/filter-options` | Returns `{ task_types, categories }` from real DB DISTINCT values. Feed to dropdowns — never hardcode. |
| `GET` | `/api/grammar/recommendations` | Returns `{ top_categories, total_mistakes }` for hub panel. |

### Writing — `/api`

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/practice/writing/submit` | Submit a writing task response. Body: `{ task_id, task_type, essay, time_spent_sec }`. |
| `POST` | `/api/practice/writing/bas/submit` | Submit a Build-a-Sentence session. Body: `{ results: [{...}] }`. |
| `GET` | `/api/writing/sessions` | List writing sessions. Query: `?page=1&page_size=10&task_type=`. |
| `GET` | `/api/writing/sessions/{id}` | Get a single writing session with feedback and NLP features. |
| `GET` | `/api/writing/sessions/{id}/grammar-mistakes` | Grammar mistakes for a writing session. |
| `GET` | `/api/writing/latest-features` | Latest writing NLP dimension scores (content, syntax, lexical, conventions, accuracy). |
| `GET` | `/api/writing/features/{practice_id}` | Full NLP feature report for a session. |
| `GET` | `/api/writing/guide/email` | Serve the email writing guide HTML. |
| `GET` | `/api/writing/guide/discussion` | Serve the discussion writing guide HTML. |
| `GET` | `/api/task/bank` | List task bank entries. Query: `?task_type=&tags=&page=1&page_size=20`. Tags use LIKE (partial match). |
| `GET` | `/api/task/recommended` | Get a recommended next task. Query: `?task_type=`. |

### Speaking — `/api/speaking`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/speaking/audio` | Serve a practice audio file. Query: `?path=<relative>`. **No auth required.** Path-traversal guarded. |
| `GET` | `/api/speaking/recording/{filename}` | Serve a saved user recording. Auth required. |
| `POST` | `/api/speaking/analyze` | Transcribe and score a speaking response. Multipart form: `audio`, `task_id`, `task_type`, `expected_answer?`, `topic?`. |
| `POST` | `/api/speaking/transcribe` | Transcribe audio only (no scoring). Used by speaking mistakes practice. Multipart: `audio`. |
| `GET` | `/api/speaking/listen-repeat` | List L&R sessions. Query: `?page&page_size`. |
| `GET` | `/api/speaking/interview` | List Interview sessions. Query: `?page&page_size`. |
| `GET` | `/api/speaking/recommended` | Returns `{ task_id, tags, snippet, reason }`. Link to `/go?tags=...`, not `?task_id=...`. |
| `GET` | `/api/speaking/analyzer` | Pronunciation/fluency analyzer data for the dashboard. |
| `GET` | `/api/speaking/mistakes` | List speaking grammar mistakes. |
| `POST` | `/api/speaking/checklist` | Save a self-check checklist result. Body: `{ task_type, results: [{item, text, passed, note}] }`. |
| `POST` | `/api/speaking/checklist/grade` | AI-grade a checklist from session results. Body: `{ task_type, session_results }`. |

### Dashboard — `/api/dashboard`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dashboard/summary` | Full KPI + trend data across all skills. |
| `GET` | `/api/dashboard/writing` | Writing stats, sessions (with `response`, `prompt`), task breakdown, error types. |
| `GET` | `/api/dashboard/speaking` | Speaking stats, sessions (with `response`, `prompt`), `sal_weekly` trend (DATE() format: YYYY-MM-DD). |
| `GET` | `/api/dashboard/grammar` | Grammar stats, categories, Murphy map, mistake tables. |

### Learn — `/api/learn`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/learn/topics` | Returns list of all 145 Murphy units `{ id, section, title, page, page_range }`. |
| `GET` | `/api/learn/topics/{id}` | Full unit with content. |

### Admin — `/api/admin`

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/audio/upload` | Upload an MP3 for a speaking task. Multipart form: `file`, `task_type`. Returns host-side path. |
| `GET` | `/api/admin/tasks` | List task bank entries with edit/delete. |
| `POST` | `/api/admin/tasks` | Create a new task. Only known column names accepted (validated against allowlist). |
| `PUT` | `/api/admin/tasks/{task_id}` | Update a task. Column names validated against allowlist to prevent SQL injection. |
| `DELETE` | `/api/admin/tasks/{task_id}` | Delete a task. |
| `POST` | `/api/admin/tasks/bulk` | Bulk insert tasks. Per-row errors collected; failed rows rolled back individually. |
| `GET` | `/api/admin/answer-stats` | Count tasks with missing answers per task_type. |

### Focus Drills — `/api/focus`

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/focus/sentence-combining/generate` | Generate a sentence combining exercise. |
| `POST` | `/api/focus/sentence-combining/evaluate` | Evaluate a combined sentence. Body: `{ sentences, user_answer, connector_used }`. |
| `POST` | `/api/focus/collocation/generate` | Generate a collocation exercise for a phrase. |
| `POST` | `/api/focus/collocation/evaluate` | Evaluate a collocation sentence. Body: `{ phrase, user_sentence, task_type }`. |

### Other

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{ status: "ok" }`. No auth. Used by Docker health check. |
| `GET` | `/api/writing/guide/*` | Serve static writing guide HTML files. |

---

## Frontend routes (38 pages)

All routes require authentication (enforced by `<RequireAuth>` component) except `/login`.

| Path | Description |
|---|---|
| `/` | Home — links to Practice and Dashboard. |
| `/login` | Login form. |
| `/dashboard` | Overview — KPIs, score trend, grammar accuracy, mistake trend, task table. |
| `/dashboard/writing` | Writing stats, sessions, checklist history matrix. |
| `/dashboard/speaking` | Speaking stats, sessions, grammar mistakes, checklist history. |
| `/dashboard/speaking/analyzer` | 6-dimension radar, pronunciation/fluency trend, history table. |
| `/dashboard/speaking/sessions/[id]` | Single speaking session — audio player, transcript, scores. |
| `/dashboard/grammar` | Category breakdown, Murphy unit links, mistake tables. |
| `/dashboard/grammar/mistakes/[id]` | Mistake detail — wrong/correct/explanation, Murphy units, audio seek, review/delete. |
| `/dashboard/writing/sessions/[id]` | Session detail — all 5 NLP dimensions, grammar mistakes. |
| `/practice` | Practice hub — all skills + mic test. |
| `/practice/writing` | Writing practice landing — all modes + recommendations. |
| `/practice/writing/[type]` | Email or discussion overview. `[type]` = `email` or `discussion`. |
| `/practice/writing/[type]/go` | Active writing session (split-panel, v1-style). |
| `/practice/writing/[type]/browse` | Browse task bank. |
| `/practice/writing/[type]/guide` | In-app writing strategy guide. |
| `/practice/writing/build-a-sentence` | BAS test list. |
| `/practice/writing/build-a-sentence/go` | Active BAS session — word bank buttons, timer. |
| `/practice/writing/build-a-sentence/guide` | BAS 7 sentence structures guide. |
| `/practice/writing/collocation` | Collocation notebook — review + add phrase. |
| `/practice/writing/sentence-combining` | Sentence combining drill. |
| `/practice/writing/phrase-bank` | Copy-ready email/discussion phrases. |
| `/practice/speaking` | Speaking landing — recommended + manual. |
| `/practice/speaking/[mode]` | Mode overview. `[mode]` = `listen-and-repeat` or `interview`. |
| `/practice/speaking/[mode]/go` | Active session — picture-frame layout, auto-play, results overlay. |
| `/practice/speaking/[mode]/topics` | Topic grid, sorted **weakest first** (lowest avg score at top). |
| `/practice/speaking/mistakes` | Speaking mistake review list with filters. |
| `/practice/speaking/mistakes/[id]` | Single speaking mistake — record and compare. |
| `/practice/speaking/mistakes/go` | Drill speaking mistakes with recording. Transcribes via `/api/speaking/transcribe`. |
| `/practice/grammar` | Grammar hub — recommendations panel + mode cards. |
| `/practice/grammar/weakspot` | Weakspot drill — topic pills, CEFR difficulty, language toggle. |
| `/practice/grammar/all-mistakes` | Full mistake list — date-grouped cards, filters, pagination. |
| `/practice/grammar/mistake/[id]` | Grammar mistake detail — check answer, delete. |
| `/learn` | Murphy Grammar topic grid (searchable, 145 units). |
| `/learn/[id]` | Unit reader — interactive lesson or raw content, prev/next nav. |
| `/admin` | Admin hub. |
| `/admin/practice` | Task bank editor — add/edit/delete/bulk import. |
| `/admin/answers` | Answer key review — shows tasks missing model answers. |

**Note:** `/practice/grammar/srs` has no page file — the SRS backend endpoint exists but the practice UI was never built.

---

## Service topology

```
Browser
  │  HTTPS :8888
  ▼
toefl-v2-ssl  (nginx:alpine)
  │  HTTP :3000
  ▼
toefl-v2-frontend  (Next.js 15, App Router)
  │  HTTP :8000  (server-side proxy via Next.js rewrites — /api/* only)
  ▼
toefl-v2-api  (FastAPI / uvicorn)
  │
  ├── toefl.db              (SQLite — user data, bind-mounted from host)
  ├── grammar_content.db    (SQLite — lesson content, bind-mounted read-only)
  ├── /audio                (speaking practice MP3s, bind-mounted)
  ├── /recordings           (user recordings, bind-mounted — persistent)
  │
  ├── toefl-litellm         (LiteLLM proxy — external network: litellm-shared)
  └── toefl-speech-analyzer (speech analysis — external network: toefl_tracker_toefl-internal)
```

All inter-service traffic uses the `toefl-v2-internal` bridge network.
Only nginx exposes a port to the host (`0.0.0.0:8888`). The API port (8000) is internal only.

---

## JWT token details

- Algorithm: `HS256`
- Default expiry: 8 hours (configurable via `SESSION_EXPIRE_HOURS`, integer only)
- Cookie name: `toefl_token` (httpOnly, SameSite=Lax; Secure when `IS_PRODUCTION=1`)
- Tokens without an `exp` claim are **rejected** (not accepted forever — fixed July 2026)
- Bearer scheme check is **case-insensitive** (`bearer`, `Bearer`, `BEARER` all work — fixed July 2026)
- The Next.js frontend proxies all `/api/*` requests server-side — the browser never makes direct CORS requests to FastAPI
