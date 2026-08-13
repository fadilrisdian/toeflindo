"""Speaking checklist auto-grader.

Hybrid approach (same pattern as checklist_service.py):
- Code-graded items: filler count, word count, marker count, WPM, scores
- LLM-graded items: word accuracy, on-topic, strong phrases, repetitions

L&R checklist (7 items):
  1. Did I add or miss any words?                         → LLM (compare transcript vs expected)
  2. Did I utter the correct form of every word?          → LLM
  3. Did I avoid vocal fillers like 'uh' or 'um'?         → code (filler_count)
  4. Did I hesitate or repeat words?                      → LLM
  5. Did I repeat the sentence in 10 seconds or less?     → code (always pass — timer enforces 8s)
  6. Did I bring words together and speak smoothly?       → code (fluency_score)
  7. Did I clearly and correctly pronounce all the words? → code (pronunciation_score)

Interview checklist (10 items):
  1. Did I include less than three fillers?               → code (filler_count < 3)
  2. Did I stay on topic and answer the question?         → LLM
  3. Did I avoid hesitating/repeating > two times?        → code (pause_count <= 2)
  4. Did I speak for at least 42 seconds?                 → code (word count >= 90)
  5. Did I use at least two transitional words/phrases?   → code (marker_count >= 2)
  6. Did I elaborate with personal example/explanation?   → code (has_example)
  7. Did I provide a response at least 110 words long?    → code (word count >= 110)
  8. Did I include at least one strong phrase/idiom?      → LLM
  9. Did I speak at a natural pace?                       → code (wpm 90–210)
 10. Did I speak clearly enough?                         → code (pronunciation_score >= 3.5)
"""
from __future__ import annotations

from typing import Any

from app.clients.llm import call_llm_json
from app.core.exceptions import LLMError
from app.core.logging import get_logger

logger = get_logger(__name__)

LNR_CHECKLIST = [
    "Did I add or miss any words?",
    'Did I utter the correct form of every word (for example "belonged" should be "belongs")?',
    "Did I avoid vocal fillers like 'uh' or 'um'?",
    "Did I hesitate or repeat words?",
    "Did I repeat the sentence in 10 seconds or less?",
    "Did I bring words together and speak smoothly?",
    "Did I clearly and correctly pronounce all the words?",
]

IV_CHECKLIST = [
    "Did I include less than three fillers (uh, um, you know)?",
    "Did I stay on topic and answer the question?",
    "Did I avoid hesitating or repeating more than two separate times?",
    "Did I speak for at least 42 seconds?",
    "Did I use at least two transitional words or phrases?",
    "Did I elaborate on the topic with a well-developed personal example, anecdote, or explanation?",
    "Did I provide a response at least 110 words long?",
    "Did I include at least one strong phrase, idiom, or expression?",
    "Did I speak at a natural pace, not too fast or slow?",
    "Did I speak clearly enough to be easily understood? (check with speech-to-text software)",
]


def _word_count(text: str) -> int:
    return len(text.split()) if text and text.strip() else 0


# ── L&R code grading ──────────────────────────────────────────────────────────

def _grade_lnr_code(tasks: list[dict]) -> dict[int, dict]:
    """Grade L&R items 3, 5, 6, 7 in code. Returns {item_num: {passed, note}}."""
    total = len(tasks) or 1
    total_fillers = sum(t.get("filler_count") or 0 for t in tasks)
    avg_fluency = sum(t.get("fluency_score") or 0 for t in tasks) / total
    avg_pron    = sum(t.get("pronunciation_score") or 0 for t in tasks) / total

    # Item 3 — fillers (allow 0 per task on average)
    avg_fillers = total_fillers / total
    item3_pass = avg_fillers < 0.5
    item3_note = f"Avg {avg_fillers:.1f} filler(s) per sentence" + ("" if item3_pass else " — aim for 0")

    # Item 5 — always pass (8s timer already enforces this)
    item5_pass = True
    item5_note = "Timer was set to 10 seconds"

    # Item 6 — fluency (>= 3.5 / 6)
    item6_pass = avg_fluency >= 3.5
    item6_note = f"Avg fluency score {avg_fluency:.1f}/6"

    # Item 7 — pronunciation (>= 3.5 / 6)
    item7_pass = avg_pron >= 3.5
    item7_note = f"Avg pronunciation score {avg_pron:.1f}/6"

    return {
        3: {"passed": item3_pass, "note": item3_note},
        5: {"passed": item5_pass, "note": item5_note},
        6: {"passed": item6_pass, "note": item6_note},
        7: {"passed": item7_pass, "note": item7_note},
    }


# ── IV code grading ───────────────────────────────────────────────────────────

def _grade_iv_code(tasks: list[dict]) -> dict[int, dict]:
    """Grade Interview items 1, 3, 4, 5, 6, 7, 9, 10 in code."""
    total = len(tasks) or 1
    total_fillers  = sum(t.get("filler_count") or 0 for t in tasks)
    total_pauses   = sum(t.get("pause_count") or 0 for t in tasks)
    total_markers  = sum(t.get("marker_count") or 0 for t in tasks)
    has_any_example = any(t.get("has_example") for t in tasks)
    all_transcripts = " ".join(t.get("transcript") or "" for t in tasks)
    total_words    = _word_count(all_transcripts)
    avg_wpm        = sum(t.get("wpm") or 0 for t in tasks if t.get("wpm")) / max(sum(1 for t in tasks if t.get("wpm")), 1)
    avg_pron       = sum(t.get("pronunciation_score") or 0 for t in tasks) / total

    # Item 1 — fillers < 3 total
    item1_pass = total_fillers < 3
    item1_note = f"{total_fillers} filler(s) total" + ("" if item1_pass else " — aim for fewer than 3")

    # Item 3 — hesitations/pauses <= 2
    item3_pass = total_pauses <= 2
    item3_note = f"{total_pauses} hesitation(s) detected" + ("" if item3_pass else " — aim for 2 or fewer")

    # Item 4 — at least 42 seconds (~90 words at normal pace)
    item4_pass = total_words >= 90
    item4_note = f"Response has ~{total_words} words" + ("" if item4_pass else " — aim for 90+ words (~42s)")

    # Item 5 — at least 2 transitional phrases
    item5_pass = total_markers >= 2
    item5_note = f"{total_markers} transitional word(s) found" + ("" if item5_pass else " — use 2 or more")

    # Item 6 — has example/anecdote
    item6_pass = has_any_example
    item6_note = "Personal example or elaboration detected" if item6_pass else "No clear personal example found"

    # Item 7 — 110+ words
    item7_pass = total_words >= 110
    item7_note = f"Response has ~{total_words} words" + ("" if item7_pass else " — aim for 110+")

    # Item 9 — natural pace (90–210 wpm)
    item9_pass = 90 <= avg_wpm <= 210 if avg_wpm > 0 else False
    item9_note = f"Avg {avg_wpm:.0f} WPM" + ("" if item9_pass else " — aim for 90–210 WPM")

    # Item 10 — pronunciation >= 3.5
    item10_pass = avg_pron >= 3.5
    item10_note = f"Avg pronunciation score {avg_pron:.1f}/6"

    return {
        1:  {"passed": item1_pass,  "note": item1_note},
        3:  {"passed": item3_pass,  "note": item3_note},
        4:  {"passed": item4_pass,  "note": item4_note},
        5:  {"passed": item5_pass,  "note": item5_note},
        6:  {"passed": item6_pass,  "note": item6_note},
        7:  {"passed": item7_pass,  "note": item7_note},
        9:  {"passed": item9_pass,  "note": item9_note},
        10: {"passed": item10_pass, "note": item10_note},
    }


# ── LLM grading ───────────────────────────────────────────────────────────────

def _build_lnr_llm_prompt(tasks: list[dict], llm_items: list[tuple[int, str]]) -> str:
    task_block = "\n\n".join(
        f"Task {i+1}:\n  Expected: {t.get('expected_answer','(unknown)')}\n  Transcript: {t.get('transcript','(no transcript)')}"
        for i, t in enumerate(tasks[:5])  # limit to 5 tasks to keep prompt short
    )
    numbered = "\n".join(f"{num}. {text}" for num, text in llm_items)
    item_nums = [str(n) for n, _ in llm_items]
    return f"""You are a TOEFL Speaking evaluator. Evaluate the student's Listen & Repeat performance against each checklist item.

Session tasks (student repeated each sentence):
{task_block}

Checklist items to evaluate (items {', '.join(item_nums)} only):
{numbered}

For each item, decide PASSES (true) or FAILS (false). Write one short note (max 12 words).

Return ONLY a JSON object:
{{
  "results": [
    {{"item": <item_number>, "passed": true/false, "note": "<short note>"}},
    ...
  ]
}}

Return exactly {len(llm_items)} items. Return ONLY JSON, no markdown."""


def _build_iv_llm_prompt(tasks: list[dict], llm_items: list[tuple[int, str]]) -> str:
    combined = " ".join(t.get("transcript") or "" for t in tasks)
    topics   = "; ".join(t.get("topic") or t.get("prompt") or "" for t in tasks if t.get("topic") or t.get("prompt"))
    numbered = "\n".join(f"{num}. {text}" for num, text in llm_items)
    item_nums = [str(n) for n, _ in llm_items]
    return f"""You are a TOEFL Speaking evaluator. Evaluate the student's Interview response against each checklist item.

Question(s): {topics or "(not provided)"}

Student's response:
\"\"\"{combined}\"\"\"

Checklist items to evaluate (items {', '.join(item_nums)} only):
{numbered}

For each item, decide PASSES (true) or FAILS (false). Write one short note (max 12 words).

Return ONLY a JSON object:
{{
  "results": [
    {{"item": <item_number>, "passed": true/false, "note": "<short note>"}},
    ...
  ]
}}

Return exactly {len(llm_items)} items. Return ONLY JSON, no markdown."""


def _call_llm(prompt: str, n_items: int) -> dict:
    return call_llm_json(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=4000,
        models=["openai/gpt-oss-120b"],
        label=f"speaking_checklist/{n_items}",
    )


# ── Main orchestrator ─────────────────────────────────────────────────────────

def grade_speaking_checklist(task_type: str, session_results: list[dict]) -> list[dict]:
    """Grade a speaking session's checklist. Returns list of {item, text, passed, note}."""
    tasks = [r for r in session_results if r.get("transcript")]
    if not tasks:
        tasks = session_results  # fallback: use whatever we have

    is_lnr = task_type == "Listen and Repeat"
    checklist = LNR_CHECKLIST if is_lnr else IV_CHECKLIST

    # Code-graded items
    if is_lnr:
        code_results = _grade_lnr_code(tasks)
        llm_item_indices = {1, 2, 4}  # 1-indexed
    else:
        code_results = _grade_iv_code(tasks)
        llm_item_indices = {2, 8}  # 1-indexed

    # LLM-graded items
    llm_items: list[tuple[int, str]] = [
        (idx + 1, text)
        for idx, text in enumerate(checklist)
        if (idx + 1) in llm_item_indices
    ]

    llm_by_item: dict[int, dict] = {}
    try:
        if is_lnr:
            prompt = _build_lnr_llm_prompt(tasks, llm_items)
        else:
            prompt = _build_iv_llm_prompt(tasks, llm_items)
        parsed = _call_llm(prompt, len(llm_items))
        for r in parsed.get("results", []):
            llm_by_item[r.get("item", 0)] = r
    except LLMError:
        logger.warning("speaking checklist LLM failed — using fallback for LLM items")
        for num, _ in llm_items:
            llm_by_item[num] = {"passed": False, "note": "Could not evaluate — AI unavailable"}

    # Merge into final ordered list
    results: list[dict] = []
    for idx, item_text in enumerate(checklist):
        item_num = idx + 1
        if item_num in code_results:
            r = code_results[item_num]
            passed, note = r["passed"], r["note"]
        elif item_num in llm_by_item:
            raw    = llm_by_item[item_num]
            passed = bool(raw.get("passed", False))
            note   = (raw.get("note") or "").strip()
        else:
            passed, note = False, "Not evaluated"
        results.append({"item": item_num, "text": item_text, "passed": passed, "note": note})

    passed_count = sum(1 for r in results if r["passed"])
    logger.info("speaking checklist graded task_type=%s passed=%d/%d", task_type, passed_count, len(checklist))
    return results
