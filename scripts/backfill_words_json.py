"""
Backfill words_json for speech_analysis_log rows that have an audio file
but no word timestamps yet.

Run inside the toefl-api container:
  docker exec toefl-v2-api python /app/scripts/backfill_words_json.py

Skips rows where the .webm file is missing on disk.
Safe to re-run — already-populated rows are skipped.
"""
import json
import logging
import sqlite3
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backfill_words_json")

DB_PATH         = "/data/toefl.db"
RECORDINGS_DIR  = Path("/recordings")

# Import STT and audio utils from the backend
sys.path.insert(0, "/app")
from app.services.speech.stt import transcribe
from app.services.speech.audio_utils import save_upload, convert_to_wav, cleanup


def backfill():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        "SELECT id, audio_filename FROM speech_analysis_log "
        "WHERE words_json IS NULL AND audio_filename IS NOT NULL "
        "ORDER BY date DESC"
    ).fetchall()

    logger.info("Found %d rows to backfill", len(rows))
    ok = skipped = failed = 0

    for row in rows:
        sal_id   = row["id"]
        filename = row["audio_filename"]
        webm_path = RECORDINGS_DIR / filename

        if not webm_path.exists():
            logger.warning("skip id=%d — file not found: %s", sal_id, webm_path)
            skipped += 1
            continue

        wav_path = None
        try:
            audio_bytes = webm_path.read_bytes()
            wav_path    = save_upload(audio_bytes, filename)
            wav_path    = convert_to_wav(wav_path)
            result      = transcribe(wav_path)
            words       = result.get("words", [])

            if not words:
                logger.warning("id=%d — transcribe returned no words, skipping", sal_id)
                skipped += 1
                continue

            conn.execute(
                "UPDATE speech_analysis_log SET words_json=? WHERE id=?",
                (json.dumps(words), sal_id),
            )
            conn.commit()
            logger.info("ok id=%d filename=%s words=%d", sal_id, filename, len(words))
            ok += 1

        except Exception as exc:
            logger.error("FAILED id=%d filename=%s: %s", sal_id, filename, exc)
            failed += 1
        finally:
            if wav_path:
                cleanup(wav_path)

    conn.close()
    logger.info("Done — ok=%d skipped=%d failed=%d", ok, skipped, failed)


if __name__ == "__main__":
    backfill()
