# Explanation

Background on how TOEFL Tracker v2 works and why it's built the way it is.

---

## Why v2 exists: moving HTML out of Python

v1 of this tracker was a single Flask/FastAPI app that server-rendered every page as HTML using Jinja2 templates. That worked fine until the UI grew complex enough — animated score charts, audio recording, real-time feedback — that rendering it server-side became painful. Every interaction required a full page reload; adding a React component meant fighting the template boundary.

v2 splits the stack cleanly in two: FastAPI is a pure JSON API, and Next.js owns all HTML. The backend doesn't know what the UI looks like; the frontend doesn't care how the database is structured. The boundary between them is the API contract documented in the [reference](reference.md).

This is a standard separation that makes the frontend and backend independently deployable and independently testable, at the cost of more moving parts and an nginx proxy layer to join them.

---

## Authentication: JWT over an httpOnly cookie

The auth model issues a JWT at login and delivers it in two ways: as a JSON body field (`access_token`) and as an **httpOnly cookie** (`toefl_token`).

In practice, the frontend relies exclusively on the **cookie**. All fetch calls use `credentials: 'include'`, which causes the browser to attach the cookie automatically on every request to the same origin — including server-side Next.js requests. The `access_token` from the JSON body is available if you ever need it from JavaScript, but nothing in the UI reads from `localStorage`.

The reason for the cookie-first approach:

- **Browser-initiated API calls** (from React components) go through the Next.js server-side proxy at `/api/*`. These requests pass the cookie automatically — no JavaScript involvement needed.
- **Server-side rendering** — Next.js server components also read the cookie automatically because it's httpOnly and sent with every request.
- Using `localStorage` for auth would require explicit `Authorization: Bearer` headers on every fetch, would break in SSR contexts (no `window`), and would expose the token to XSS.

The JWT is signed with HS256 using `SECRET_KEY`. There is no refresh token — when the 8-hour token expires, the user is redirected to `/login`. This is intentional: the app is single-user, and a daily login is an acceptable trade-off for not managing token refresh logic.

Tokens without an `exp` claim are rejected at validation time — a crafted token without an expiry cannot bypass authentication.

---

## How practice sessions feed SRS

When you submit a writing or speaking session, any grammar errors the LLM identifies are extracted and stored as *mistake cards* in the `grammar_mistakes` table. These cards are accessible for review at `/practice/grammar/all-mistakes` and can be drilled via the weakspot drill at `/practice/grammar/weakspot`.

The SRS backend endpoints exist (`/api/grammar/srs/review` etc.) for spaced-repetition scheduling, but the dedicated SRS practice UI page (`/practice/grammar/srs`) was never built — navigating there returns 404.

Each card has an interval (days until next review), an ease factor (how quickly the interval grows), and a due date. When you rate a card:

- **Easy**: interval multiplies by the ease factor, ease factor increases slightly.
- **Hard**: interval stays short, ease factor decreases.
- **Again**: card resets to a 1-day interval.

This is a simplified SM-2 algorithm — the same approach used by Anki. The goal is to surface mistakes you're likely to forget just before you'd forget them, which is more efficient than random drilling.

Weakspot drills work differently: they don't track intervals. Instead, they generate a fresh sentence containing the same grammar pattern and ask you to correct it. The LLM generates the sentence using the `grammar-lesson-prompt.md` template, which provides it with the category name and example mistakes to imitate.

---

## The two databases

The app uses two SQLite files for a deliberate reason.

`toefl.db` is the operational database: all user data — practice sessions, mistakes, SRS state, scores, task bank. It changes constantly and must be backed up.

`grammar_content.db` is a content database: it holds grammar lesson text and reference material that was authored separately from practice sessions. It changes rarely (only when lesson content is updated) and can be restored from source rather than a backup if lost.

SQLite was chosen over PostgreSQL because this is a single-user app running on a single server. There's no concurrency pressure that would benefit from a full database server, and SQLite is simpler to back up (it's a file), simpler to restore, and has no separate process to manage. The one trade-off is that SQLite's write locking could cause contention if multiple requests wrote simultaneously — but in practice, the LLM and speech analysis calls (which take seconds) happen outside the database transaction, so write contention is negligible.

---

## TLS and the nginx layer

nginx sits in front of both the frontend and the API for one specific reason: `getUserMedia` (the browser API for microphone access) requires a secure context — either `localhost` or an HTTPS origin. Without TLS, the speaking practice features simply won't work.

Rather than terminating TLS in the Next.js process or the FastAPI process, nginx handles it at the edge. This also means the frontend and API containers don't need certificates configured, and rotating the certificate only requires restarting one container.

The certificate is self-signed by default. The browser will warn on first visit. For a production deployment with a real domain, replace `certs/cert.pem` and `certs/key.pem` with a CA-signed certificate — see [how to replace the TLS certificate](how-to/replace-tls-certificate.md).

---

## Why the Next.js frontend proxies API calls server-side

In `next.config.js`, all `/api/*` requests are rewritten to `http://toefl-api:8000/api/*`. This means API calls from the browser actually go to the Next.js server process first, which then forwards them to the FastAPI container on the internal Docker network.

The benefit: the browser never makes cross-origin requests to the API. This avoids exposing the API port publicly (it's not bound to any host port — only the nginx container on port 8888 is), and it sidesteps the class of CORS-related bugs that come from browsers blocking credentialed cross-origin requests.

The trade-off: every API call has an extra hop through the Next.js server. For this app's usage pattern, the latency is negligible.

---

## LLM integration

Grammar explanation, weakspot drill generation, writing feedback, and speaking analysis all call an LLM. Rather than calling the Anthropic API directly, the app routes requests through a LiteLLM proxy on the `litellm-shared` Docker network.

This indirection makes it easy to switch models (change the LiteLLM config, not the app code), add rate limiting or caching at the proxy layer, and share the proxy with other tools running on the same host.

The app never holds or logs the content of LLM responses beyond what's stored in the database as session feedback. Audio recordings are processed and then discarded unless explicitly saved to `/recordings`.
