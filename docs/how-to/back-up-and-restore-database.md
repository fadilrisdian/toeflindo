# How to back up and restore the database

The app uses two SQLite databases:

| File | Contains |
|---|---|
| `toefl.db` | All practice sessions, mistakes, SRS state, speaking recordings metadata |
| `grammar_content.db` | Grammar lesson content used for drills |

## Back up

```bash
cd ~/.hermes/toefl_tracker_v2
cp toefl.db toefl.db.bak-$(date +%Y%m%d)
cp grammar_content.db grammar_content.db.bak-$(date +%Y%m%d)
```

The app reads and writes `toefl.db` continuously, but SQLite's default WAL mode makes a file copy safe while the container is running.

If you want a fully consistent snapshot, pause the backend first:

```bash
docker compose stop toefl-api
cp toefl.db toefl.db.bak-$(date +%Y%m%d)
docker compose start toefl-api
```

## Restore

```bash
docker compose stop toefl-api
cp toefl.db.bak-20260726 toefl.db
docker compose start toefl-api
```

The backend runs migrations on startup, so a backup from an older version is safe to restore — the migration run will apply any missing schema changes.

## Restore to a different server

Copy both `.db` files and the `.env` file to the new machine, then run `docker compose up -d`. The databases are bind-mounted at `/data/toefl.db` and `/data/grammar_content.db` inside the container, resolved from the project root on the host.
