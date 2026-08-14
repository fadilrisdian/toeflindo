# Tutorial: Run TOEFL Tracker for the first time

In this tutorial we'll get TOEFL Tracker v2 running on your server, log in, and complete one grammar drill — so you'll have touched every layer of the stack (containers, API, and UI) and confirmed they're all talking to each other.

**Before you start**, you'll need:
- Docker and Docker Compose installed on the host
- An existing `.env` file (copied from v1, or created fresh — see the [environment variable reference](reference.md#environment-variables))
- A terminal session on the server
- Port 8888 open (or an SSH tunnel to it)

This tutorial takes about 10 minutes.

---

## Step 1 — Create the environment file

The app won't start without a `SECRET_KEY` and `AUTH_PASS`. Create `.env` in the project root with at minimum:

```
SECRET_KEY=<a-long-random-string>
AUTH_PASS=<your-password>
LITELLM_MASTER_KEY=<your-litellm-key>
```

You should now see `.env` when you run `ls ~/.hermes/toefl_tracker_v2/`.

---

## Step 2 — Build the containers

```bash
cd ~/.hermes/toefl_tracker_v2
docker compose build
```

This builds three images: the FastAPI backend, the Next.js frontend, and pulls nginx. The first build takes 2–4 minutes; subsequent builds are faster because Docker caches layers.

You'll see a stream of output as each layer is built. When it finishes you should see lines like:

```
=> => naming to docker.io/library/toefl_tracker_v2-toefl-api
=> => naming to docker.io/library/toefl_tracker_v2-toefl-frontend
```

---

## Step 3 — Start the stack

```bash
docker compose up -d
```

The `-d` flag runs everything in the background. The three containers start in order: API first, then frontend (which waits for the API health check to pass), then nginx.

To confirm everything is up:

```bash
docker compose ps
```

You should see all three containers with status `running` or `healthy`. The API container runs a health check every 15 seconds — it may show `starting` for the first minute while the Python environment initialises.

---

## Step 4 — Open the app

In your browser, go to:

```
https://<your-server-ip>:8888
```

Because nginx uses a self-signed certificate, your browser will warn you. Accept the exception (the cert is required for `getUserMedia` — microphone access for speaking practice).

You'll land on the login page.

---

## Step 5 — Log in

Enter the username and password you set in `.env` (`AUTH_USER` defaults to `fadil`; `AUTH_PASS` is what you set). Click **Login**.

You should be redirected to the dashboard. Notice it shows sections for Writing, Speaking, and Grammar — these will populate as you practise.

---

## Step 6 — Complete one grammar drill

1. Click **Practice** in the top navigation.
2. Click **Grammar**, then **Weak Spot Drill**.
3. Select a topic pill (e.g. **Articles**) and click **Generate Drill**.
4. The app generates 5 sentences with grammar errors targeting that category.
5. Type the corrected sentence in the input field and click **Check**.
6. You'll see feedback: what was wrong, what was correct, and a short explanation.

Notice the URL in the browser — it's at `/practice/grammar/weakspot`, served by the Next.js frontend, which called `GET /api/grammar/weakspot/generate` on the backend and then `POST /api/grammar/evaluate` when you submitted.

---

## You're done

The stack is running, you've authenticated, and you've completed an end-to-end practice flow through the grammar drill. From here:

- For day-to-day maintenance tasks (rebuilding after a code change, rotating credentials, running the smoke test), see the [how-to guides](how-to/).
- For a full listing of every API endpoint and environment variable, see the [reference](reference.md).
- To understand why the auth is built the way it is, or what SRS means, see the [explanation](explanation.md).
