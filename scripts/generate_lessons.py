#!/usr/bin/env python3
"""
Batch generate grammar lesson HTML files for all topics missing lesson_html.

Usage:
    python3 generate_lessons.py [--model MODEL] [--topic TOPIC_ID] [--dry-run]

Options:
    --model MODEL     LiteLLM model name (default: gpt-oss-120b)
    --topic ID        Generate only this topic ID
    --dry-run         Print topics to generate without calling API
    --delay SECS      Seconds between requests (default: 15)
    --max-tokens N    Max output tokens (default: 24000)
"""
import sys
import os
import time
import sqlite3
import argparse
import json
import urllib.request
import urllib.error
from pathlib import Path
from textwrap import dedent

# ── paths ────────────────────────────────────────────────────────────────────
BASE      = Path(__file__).parent.parent
DB_PATH   = BASE / "grammar_content.db"
HTML_DIR  = Path(__file__).parent / "html"
PROMPT_MD = BASE / "grammar-lesson-prompt.md"
ENV_FILE  = Path.home() / ".hermes/litellm/.env"

LITELLM_URL  = "http://localhost:8080/chat/completions"

# ── load env ─────────────────────────────────────────────────────────────────
def load_env(path: Path) -> dict:
    env = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    return env

# ── LiteLLM call ─────────────────────────────────────────────────────────────
def call_litellm(prompt: str, model: str, api_key: str, max_tokens: int, retries: int = 3) -> str:
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.3,
    }).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    for attempt in range(1, retries + 1):
        req = urllib.request.Request(LITELLM_URL, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            print(f"  HTTP {e.code} on attempt {attempt}: {body[:200]}")
            if e.code in (429, 502, 503, 504) and attempt < retries:
                wait = 30 * attempt
                print(f"  Retrying in {wait}s …")
                time.sleep(wait)
            else:
                raise
        except Exception as e:
            print(f"  Error on attempt {attempt}: {e}")
            if attempt < retries:
                time.sleep(15 * attempt)
            else:
                raise
    raise RuntimeError("call_litellm exhausted retries without returning")

# ── strip markdown fences if model wrapped output ────────────────────────────
def extract_html(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # drop first line (```html or ```) and last line (```)
        if lines[-1].strip() == "```":
            lines = lines[1:-1]
        else:
            lines = lines[1:]
        text = "\n".join(lines)
    return text

# ── main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Batch generate grammar lessons")
    parser.add_argument("--model",      default="gpt-oss-120b")
    parser.add_argument("--topic",      type=int, default=None)
    parser.add_argument("--dry-run",    action="store_true")
    parser.add_argument("--delay",      type=float, default=15.0)
    parser.add_argument("--max-tokens", type=int,   default=24000)
    args = parser.parse_args()

    env = load_env(ENV_FILE)
    api_key = env.get("LITELLM_MASTER_KEY", "")
    if not api_key:
        print("ERROR: LITELLM_MASTER_KEY not found in", ENV_FILE)
        sys.exit(1)

    prompt_template = PROMPT_MD.read_text(encoding="utf-8")
    HTML_DIR.mkdir(exist_ok=True)

    conn = sqlite3.connect(DB_PATH)
    if args.topic:
        rows = conn.execute(
            "SELECT id, title, content FROM grammar_topics WHERE id=?",
            (args.topic,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, title, content FROM grammar_topics "
            "WHERE lesson_html IS NULL OR lesson_html = '' ORDER BY id"
        ).fetchall()
    conn.close()

    total = len(rows)
    if total == 0:
        print("Nothing to generate — all topics already have lesson_html.")
        return

    print(f"Topics to generate: {total}  |  model: {args.model}  |  delay: {args.delay}s")
    if args.dry_run:
        for r in rows:
            print(f"  [{r[0]:3d}] {r[1]}")
        return

    done = 0
    skipped = 0
    failed = []

    for idx, (topic_id, title, content) in enumerate(rows, 1):
        html_path = HTML_DIR / f"{topic_id}.html"
        prefix = f"[{idx}/{total}] #{topic_id}: {title[:55]}"

        # skip if HTML file already exists (resume support)
        if html_path.exists() and html_path.stat().st_size > 1000:
            print(f"{prefix}  → already saved, inserting …", end=" ", flush=True)
            # ensure it's in the DB too
            conn = sqlite3.connect(DB_PATH)
            existing = conn.execute(
                "SELECT lesson_html FROM grammar_topics WHERE id=?", (topic_id,)
            ).fetchone()
            if not existing or not existing[0]:
                html = html_path.read_text(encoding="utf-8")
                conn.execute("UPDATE grammar_topics SET lesson_html=? WHERE id=?", (html, topic_id))
                conn.commit()
                print("inserted.")
            else:
                print("already in DB, skip.")
            conn.close()
            skipped += 1
            continue

        # build prompt
        prompt = prompt_template.replace("[PASTE CHAPTER HERE]", content or "(no content)")

        print(f"{prefix}  → generating …", flush=True)
        t0 = time.time()
        try:
            raw = call_litellm(prompt, args.model, api_key, args.max_tokens)
            html = extract_html(raw)
            elapsed = time.time() - t0
            print(f"   {len(html):,} chars in {elapsed:.0f}s", flush=True)
        except Exception as e:
            print(f"   FAILED: {e}")
            failed.append((topic_id, title, str(e)))
            if idx < total:
                time.sleep(args.delay)
            continue

        # save HTML file
        html_path.write_text(html, encoding="utf-8")

        # insert into DB
        conn = sqlite3.connect(DB_PATH)
        conn.execute("UPDATE grammar_topics SET lesson_html=? WHERE id=?", (html, topic_id))
        conn.commit()
        conn.close()
        print(f"   saved → {html_path.name}  |  inserted into DB", flush=True)
        done += 1

        # rate-limit delay (skip after last item)
        if idx < total:
            time.sleep(args.delay)

    print()
    print(f"Done.  Generated: {done}  |  Skipped (already existed): {skipped}  |  Failed: {len(failed)}")
    if failed:
        print("Failed topics:")
        for fid, ftitle, ferr in failed:
            print(f"  #{fid}: {ftitle} — {ferr}")


if __name__ == "__main__":
    main()
