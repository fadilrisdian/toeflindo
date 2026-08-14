#!/usr/bin/env python3
"""
Insert or update a generated lesson HTML file into grammar_content.db.

Usage:
    python3 insert_lesson.py <topic_id> <path_to_html_file>

Example:
    python3 insert_lesson.py 129 /tmp/lesson_129.html
"""
import sys
import sqlite3
from pathlib import Path

DB_PATH = Path.home() / ".hermes/toefl_tracker_v2/grammar_content.db"

def main():
    if len(sys.argv) != 3:
        print("Usage: python3 insert_lesson.py <topic_id> <path_to_html_file>")
        sys.exit(1)

    topic_id = int(sys.argv[1])
    html_path = Path(sys.argv[2])

    if not html_path.exists():
        print(f"Error: file not found: {html_path}")
        sys.exit(1)

    html = html_path.read_text(encoding="utf-8")

    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT id, title FROM grammar_topics WHERE id=?", (topic_id,)).fetchone()
    if not row:
        print(f"Error: topic id {topic_id} not found in database")
        conn.close()
        sys.exit(1)

    conn.execute("UPDATE grammar_topics SET lesson_html=? WHERE id=?", (html, topic_id))
    conn.commit()

    check = conn.execute("SELECT length(lesson_html) FROM grammar_topics WHERE id=?", (topic_id,)).fetchone()
    conn.close()

    print(f"OK — inserted lesson for topic {topic_id}: {row[1]}")
    print(f"     HTML size: {check[0]:,} chars")


if __name__ == "__main__":
    main()
