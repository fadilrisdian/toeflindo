"""Writing checklist evaluation service.

Evaluates a student's essay against the official TST Prep checklist.

Items 1-2 are computed in code (word count, sentence count) — no LLM needed.
Remaining items are evaluated by the LLM.

Write an Email       : 10 items
Write for an Academic Discussion : 10 items
"""
from __future__ import annotations

import re
from typing import Optional

from app.clients.llm import call_llm_json
from app.core.exceptions import LLMError
from app.core.logging import get_logger
from app.repositories.checklist_repository import ChecklistRepository

logger = get_logger(__name__)

# ── Checklist definitions ──────────────────────────────────────────────────────

# Item 11 ("grammar checker") intentionally excluded from email checklist.
EMAIL_CHECKLIST = [
    "Did I write at least 100 words?",
    "Did my response include 11 sentences or fewer?",
    "Did I use at least one transitional word or phrase?",
    "Did I address all three bullet points?",
    "Did I have at least two sentences with more than one clause?",
    "Did I include one sentence with a coordinating conjunction and one sentence with a subordinating conjunction?",
    "Did I include at least two words or phrases that show an advanced level of vocabulary?",
    "Did I include a polite opening and closing statement?",
    "Did I include the word could or would or a hedge word at least once?",
    "Did I have fewer than four typos, spelling errors or formatting mistakes?",
]

DISCUSSION_CHECKLIST = [
    "Did I write at least 120 words?",
    "Did my response include 12 sentences or fewer?",
    "Did I use at least one transitional word or phrase?",
    "Did I address the prompt and stay on topic?",
    "Did I add to the discussion with a relevant opinion, a supporting reason, and an appropriate example?",
    "Did I have at least two sentences with more than one clause?",
    "Did I include one sentence with a coordinating conjunction and one sentence with a subordinating conjunction?",
    "Did I include at least two words or phrases that show an advanced level of vocabulary?",
    "Did I have fewer than four typos, spelling errors or formatting mistakes?",
    "After using a grammar checker, did I have fewer than two grammatical mistakes?",
]

# Items 1 and 2 (1-indexed) are computed in code — not sent to LLM.
_CODE_ITEM_INDICES = {1, 2}


def _get_checklist(task_type: str) -> list[str]:
    if task_type == "Write an Email":
        return EMAIL_CHECKLIST
    return DISCUSSION_CHECKLIST


# ── Code-based item evaluation ────────────────────────────────────────────────

def _count_words(text: str) -> int:
    return len(text.split()) if text.strip() else 0


def _count_sentences(text: str) -> int:
    """Count sentences by splitting on terminal punctuation followed by whitespace + uppercase.

    Using a lookahead for uppercase avoids false splits on abbreviations like
    'e.g.', 'etc.', 'i.e.', decimal numbers, and ellipses mid-sentence.
    """
    text = text.strip()
    if not text:
        return 0
    # Split on .!? when followed by whitespace (space or newline) then a capital letter.
    # This handles: "Hello. How are you?" correctly.
    # Avoids: "e.g. this", "2.5 km", "etc. and" (all followed by lowercase or digit).
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
    return len([p for p in parts if p.strip()])


def _evaluate_code_items(task_type: str, essay: str) -> dict[int, dict]:
    """Returns {item_num (1-indexed): {passed, note}} for items computed via code."""
    wc = _count_words(essay)
    sentences = _count_sentences(essay)
    results: dict[int, dict] = {}

    if task_type == "Write an Email":
        min_words, max_sentences = 100, 11
    else:
        min_words, max_sentences = 120, 12

    # Item 1 — word count
    passed_wc = wc >= min_words
    results[1] = {
        "passed": passed_wc,
        "note": f"Essay has {wc} word{'s' if wc != 1 else ''}"
        + ("" if passed_wc else f" (need {min_words})"),
    }

    # Item 2 — sentence count
    passed_sc = sentences <= max_sentences
    results[2] = {
        "passed": passed_sc,
        "note": f"Response has {sentences} sentence{'s' if sentences != 1 else ''}"
        + ("" if passed_sc else f" (limit {max_sentences})"),
    }

    return results


# ── Prompt builder (LLM-only items) ───────────────────────────────────────────

def _checklist_prompt(task_type: str, essay: str, llm_items: list[tuple[int, str]]) -> str:
    """Build prompt only for items that require LLM evaluation."""
    numbered = "\n".join(f"{num}. {text}" for num, text in llm_items)
    item_nums = [str(num) for num, _ in llm_items]
    # Sanitize essay so an embedded triple-quote can't break the prompt delimiter
    safe_essay = essay.replace('"""', '""\\"')
    return f"""You are a TOEFL iBT Writing evaluator. Evaluate the student's essay against each checklist item.

Task type: {task_type}

Student's essay:
\"\"\"{safe_essay}\"\"\"

Checklist items to evaluate (items {', '.join(item_nums)} only):
{numbered}

For each item, decide if it PASSES (true) or FAILS (false) based on the essay text.
Write one short note (max 15 words) explaining the pass/fail for each item.

Return ONLY a JSON object with this exact structure:
{{
  "results": [
    {{"item": <item_number>, "passed": true/false, "note": "<short note>"}},
    ...
  ],
  "improvement_note": "<one sentence: the single most important thing to improve next time>"
}}
}}

Return exactly {len(llm_items)} items in results, one per checklist item listed above, in order.
Return ONLY the JSON object, no markdown, no extra text."""


# ── LLM call ──────────────────────────────────────────────────────────────────

def _call_llm_checklist(task_type: str, essay: str, llm_items: list[tuple[int, str]]) -> dict:
    """Call LLM for the non-code checklist items. Raises LLMError on failure."""
    return call_llm_json(
        messages=[{"role": "user", "content": _checklist_prompt(task_type, essay, llm_items)}],
        temperature=0.1,
        max_tokens=4000,
        models=["openai/gpt-oss-120b"],
        label=f"checklist/{task_type}",
    )


# ── Service orchestration ──────────────────────────────────────────────────────

def run_checklist(
    *,
    task_type: str,
    essay: str,
    practice_log_id: Optional[int],
    checklist_repo: ChecklistRepository,
) -> dict:
    """Evaluate essay against checklist, persist result, return full response."""
    checklist = _get_checklist(task_type)
    wc = _count_words(essay)
    logger.info(
        "checklist eval task_type=%s words=%d practice_log_id=%s",
        task_type, wc, practice_log_id,
    )

    # Step 1 — code-computed items (1-indexed)
    code_results = _evaluate_code_items(task_type, essay)

    # Step 2 — LLM items: everything not in _CODE_ITEM_INDICES
    llm_items: list[tuple[int, str]] = [
        (idx + 1, text)
        for idx, text in enumerate(checklist)
        if (idx + 1) not in _CODE_ITEM_INDICES
    ]

    llm_parsed: Optional[dict] = None
    improvement_note = "Keep practicing to improve your writing."

    try:
        llm_parsed = _call_llm_checklist(task_type, essay, llm_items)
        improvement_note = (llm_parsed or {}).get("improvement_note", improvement_note) or improvement_note
    except LLMError:
        logger.warning("checklist LLM failed — code items still recorded")

    # Build LLM result lookup by item number
    llm_by_item: dict[int, dict] = {}
    if llm_parsed:
        for r in llm_parsed.get("results", []):
            llm_by_item[r.get("item", 0)] = r

    # Step 3 — merge into final ordered list
    results: list[dict] = []
    passed_count = 0

    for idx, item_text in enumerate(checklist):
        item_num = idx + 1
        if item_num in _CODE_ITEM_INDICES:
            r = code_results[item_num]
            passed = r["passed"]
            note = r["note"]
        elif llm_parsed:
            raw = llm_by_item.get(item_num, {})
            passed = bool(raw.get("passed", False))
            note = (raw.get("note") or "").strip()
        else:
            passed = False
            note = "Could not evaluate — AI unavailable"

        results.append({
            "item": item_num,
            "text": item_text,
            "passed": passed,
            "note": note,
        })
        if passed:
            passed_count += 1

    logger.info(
        "checklist done task_type=%s passed=%d/%d",
        task_type, passed_count, len(checklist),
    )

    log_id = checklist_repo.insert_checklist_log(
        practice_log_id=practice_log_id,
        task_type=task_type,
        essay=essay,
        results=results,
        passed_count=passed_count,
        total_count=len(checklist),
        improvement_note=improvement_note,
    )

    return {
        "checklist_log_id": log_id,
        "task_type": task_type,
        "passed_count": passed_count,
        "total_count": len(checklist),
        "results": results,
        "improvement_note": improvement_note,
    }
