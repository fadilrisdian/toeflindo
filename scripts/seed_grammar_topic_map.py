"""Seed grammar_topic_map with category + sub_type → specific Murphy unit mappings.

Run from the toefl_tracker_v2 directory:
    python3 scripts/seed_grammar_topic_map.py

Reads titles from grammar_content.db, writes into toefl.db.
Safe to re-run — clears and re-inserts each time.

sub_type values here MUST exactly match what the LLM prompts constrain to.
"""
import sqlite3
import os

BASE       = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOEFL_DB   = os.path.join(BASE, "toefl.db")
CONTENT_DB = os.path.join(BASE, "grammar_content.db")

# ── (category, sub_type) → [murphy_unit_ids] ──────────────────────────────────
# sub_type = None means "category-level fallback" (shown when sub_type doesn't match)
MAPPINGS: list[tuple[str, str | None, list[int]]] = [

    # ── Tenses ────────────────────────────────────────────────────────────────
    ("Tenses", "present simple",              [2]),
    ("Tenses", "present continuous",          [1]),
    ("Tenses", "present simple vs continuous",[3, 4]),
    ("Tenses", "past simple",                 [5]),
    ("Tenses", "past continuous",             [6]),
    ("Tenses", "present perfect",             [7, 8]),
    ("Tenses", "present perfect continuous",  [9, 10]),
    ("Tenses", "present perfect vs past",     [13, 14]),
    ("Tenses", "past perfect",                [15]),
    ("Tenses", "past perfect continuous",     [16]),
    ("Tenses", "future going to",             [20]),
    ("Tenses", "future will",                 [21, 22, 23]),
    ("Tenses", "future continuous",           [24]),
    ("Tenses", "used to",                     [18]),
    ("Tenses", "conditional",                 [38, 39, 40]),  # Flaw 7 fix — conditional tense errors
    ("Tenses", None,                          [1, 2, 5, 7, 8, 13, 15, 21]),  # fallback

    # ── Modals ────────────────────────────────────────────────────────────────
    ("Modals", "can/could ability",           [26, 27]),
    ("Modals", "must/can't certainty",        [28]),
    ("Modals", "may/might possibility",       [29, 30]),
    ("Modals", "have to/must obligation",     [31, 32]),
    ("Modals", "should advice",               [33, 34]),
    ("Modals", "would",                       [36]),
    ("Modals", "requests/offers/permission",  [37]),
    ("Modals", None,                          [26, 28, 29, 31, 33]),  # fallback

    # ── Verb Forms ────────────────────────────────────────────────────────────
    ("Verb Forms", "verb + ing",              [53]),
    ("Verb Forms", "verb + infinitive",       [54, 55]),
    ("Verb Forms", "verb ing or infinitive",  [56, 57, 58]),
    ("Verb Forms", "passive voice",           [42, 43, 44]),
    ("Verb Forms", "reported speech",         [47, 48]),
    ("Verb Forms", "ing clause",              [68]),
    ("Verb Forms", None,                      [53, 54, 42, 47]),  # fallback

    # ── Articles ──────────────────────────────────────────────────────────────
    ("Articles", "a/an",                      [71, 72]),
    ("Articles", "the",                       [73, 74, 75, 76]),
    ("Articles", "no article",                [77, 78]),
    ("Articles", "countable uncountable",     [69, 70]),
    ("Articles", None,                        [71, 72, 73, 74]),  # fallback

    # ── Prepositions ──────────────────────────────────────────────────────────
    ("Prepositions", "preposition of time",         [121, 122]),
    ("Prepositions", "preposition of place",        [123, 124, 125, 126]),
    ("Prepositions", "preposition after noun",      [129]),
    ("Prepositions", "preposition after adjective", [130, 131]),
    ("Prepositions", "preposition after verb",      [132, 133, 134, 135, 136]),
    ("Prepositions", None,                          [121, 123, 129, 130, 132]),  # fallback

    # ── Phrasal Verbs ─────────────────────────────────────────────────────────
    ("Phrasal Verbs", "phrasal verb in/out",  [138]),
    ("Phrasal Verbs", "phrasal verb on/off",  [140, 141]),
    ("Phrasal Verbs", "phrasal verb up/down", [142, 143, 144]),
    ("Phrasal Verbs", "phrasal verb away/back",[145]),
    ("Phrasal Verbs", None,                   [137, 138, 140, 142]),  # fallback

    # ── Relative Clauses ──────────────────────────────────────────────────────
    ("Relative Clauses", "relative clause who/that/which", [92, 93]),
    ("Relative Clauses", "relative clause whose/whom/where",[94]),
    ("Relative Clauses", "relative clause extra information",[95, 96]),
    ("Relative Clauses", None,               [92, 93, 94]),  # fallback

    # ── Pronouns ──────────────────────────────────────────────────────────────
    ("Pronouns", "reflexive pronoun",         [82, 83]),
    ("Pronouns", None,                        [82]),  # fallback

    # ── Plurals ───────────────────────────────────────────────────────────────
    ("Plurals", "singular/plural",            [79]),
    ("Plurals", None,                         [79]),

    # ── Subject-Verb Agreement ────────────────────────────────────────────────
    ("Subject-Verb Agreement", "subject-verb agreement", [51, 79]),
    ("Subject-Verb Agreement", None,          [51, 79]),

    # ── Questions ─────────────────────────────────────────────────────────────
    ("Questions", "direct question",          [49]),
    ("Questions", "indirect question",        [50]),
    ("Questions", "question tag",             [52]),
    ("Questions", None,                       [49, 50]),  # fallback

    # ── Vocabulary ────────────────────────────────────────────────────────────
    ("Vocabulary", "adjective form",          [98, 99]),
    ("Vocabulary", "adverb form",             [100, 101]),
    ("Vocabulary", "comparison",              [105, 106, 107, 108]),
    # collocation / word register / idiomatic expression: no dedicated Murphy unit exists.
    # They fall through to the NULL fallback row (units 98, 100) which is correct.
    ("Vocabulary", None,                      [98, 100]),  # fallback

    # ── Word Order ────────────────────────────────────────────────────────────
    ("Word Order", "verb object place time",  [109]),
    ("Word Order", "adverb position",         [110]),
    ("Word Order", None,                      [109, 110]),

    # ── Sentence Structure ────────────────────────────────────────────────────
    ("Sentence Structure", "conditional",     [38, 39, 40]),
    ("Sentence Structure", "run-on sentence", [109, 110]),
    ("Sentence Structure", "connectors",      [113, 115, 116]),
    ("Sentence Structure", None,              [38, 109, 113]),  # fallback
]


def main() -> None:
    # Load titles from content DB
    content = sqlite3.connect(CONTENT_DB)
    content.row_factory = sqlite3.Row
    title_map: dict[int, str] = {
        row["id"]: row["title"]
        for row in content.execute(
            "SELECT id, title FROM grammar_topics ORDER BY id"
        ).fetchall()
    }
    content.close()
    print(f"Loaded {len(title_map)} Murphy unit titles from grammar_content.db")

    toefl = sqlite3.connect(TOEFL_DB)

    # Ensure sub_type column exists (idempotent)
    cols = [r[1] for r in toefl.execute("PRAGMA table_info(grammar_topic_map)").fetchall()]
    if "sub_type" not in cols:
        toefl.execute("ALTER TABLE grammar_topic_map ADD COLUMN sub_type TEXT")
        print("Added sub_type column")

    deleted = toefl.execute("DELETE FROM grammar_topic_map").rowcount
    print(f"Cleared {deleted} existing rows")

    inserted = 0
    missing  = []
    for category, sub_type, unit_ids in MAPPINGS:
        for uid in unit_ids:
            title = title_map.get(uid)
            if title is None:
                missing.append((category, sub_type, uid))
                continue
            toefl.execute(
                "INSERT INTO grammar_topic_map (category, sub_type, murphy_unit, murphy_title) "
                "VALUES (?, ?, ?, ?)",
                (category, sub_type, uid, title),
            )
            inserted += 1

    toefl.commit()
    toefl.close()

    print(f"Inserted {inserted} rows into grammar_topic_map")
    if missing:
        print(f"WARNING — {len(missing)} unit IDs not found:")
        for cat, st, uid in missing:
            print(f"  {cat}/{st}: unit {uid}")
    else:
        print("All unit IDs resolved successfully.")

    print("\nSummary by category:")
    cats: dict[str, int] = {}
    for cat, _, units in MAPPINGS:
        cats[cat] = cats.get(cat, 0) + len(units)
    for cat, count in cats.items():
        print(f"  {cat:30s} → {count} unit rows")


if __name__ == "__main__":
    main()
