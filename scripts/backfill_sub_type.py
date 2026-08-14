"""
Backfill script — Fix 5.

Sets sub_type to '' for grammar_mistakes rows where sub_type contains
a stale broad category name or a task_type string.  These values never
match grammar_topic_map entries and cause silent fallback to broad Murphy
units with no diagnostic visibility.

Run from the repo root:
    python scripts/backfill_sub_type.py [--db /path/to/toefl.db] [--dry-run]
"""
import argparse
import sqlite3
import sys
from pathlib import Path

# ── Stale values to clear ─────────────────────────────────────────────────────
# 1. Old broad category names (what normalize_grammar_type() used to store as sub_type)
STALE_CATEGORY_NAMES = {
    "Articles", "Prepositions", "Verb Forms", "Tenses",
    "Subject-Verb Agreement", "Vocabulary", "Pronouns",
    "Modals", "Plurals", "Phrasal Verbs", "Sentence Structure",
    "Word Order", "Questions", "Relative Clauses",
    # legacy lower-case variants
    "articles", "prepositions", "verb forms", "tenses",
    "vocabulary", "pronouns", "modals", "plurals",
    "phrasal verbs", "sentence structure", "word order",
}

# 2. Task type strings accidentally stored as sub_type (old line 243 bug)
STALE_TASK_TYPE_NAMES = {
    "Write an Email",
    "Write for an Academic Discussion",
    "Build a Sentence",
    "Take an Interview",
    "Listen and Repeat",
}

STALE_VALUES = STALE_CATEGORY_NAMES | STALE_TASK_TYPE_NAMES


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill stale sub_type values in grammar_mistakes.")
    parser.add_argument(
        "--db",
        default=str(Path(__file__).parent.parent / "toefl.db"),
        help="Path to toefl.db (default: ../toefl.db relative to this script)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would change without writing anything.",
    )
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"ERROR: DB not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Count affected rows per stale value
    placeholders = ",".join("?" * len(STALE_VALUES))
    rows = conn.execute(
        f"SELECT sub_type, COUNT(*) as n FROM grammar_mistakes "
        f"WHERE sub_type IN ({placeholders}) GROUP BY sub_type ORDER BY n DESC",
        list(STALE_VALUES),
    ).fetchall()

    if not rows:
        print("Nothing to backfill — no stale sub_type values found.")
        conn.close()
        return

    total = sum(r["n"] for r in rows)
    print(f"Found {total} rows with stale sub_type values:")
    for r in rows:
        print(f"  {r['sub_type']!r:40s}  {r['n']} rows")

    if args.dry_run:
        print("\nDry-run mode — no changes written.")
        conn.close()
        return

    conn.execute(
        f"UPDATE grammar_mistakes SET sub_type='' WHERE sub_type IN ({placeholders})",
        list(STALE_VALUES),
    )
    conn.commit()
    print(f"\nCleared sub_type for {total} rows. Done.")
    conn.close()


if __name__ == "__main__":
    main()
