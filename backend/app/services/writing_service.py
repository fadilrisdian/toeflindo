"""Writing service — scoring, BAS analysis, task recommendation."""
from __future__ import annotations

import json
import re
import time
from typing import Optional

from app.clients.llm import call_llm_json
from app.core.config import AUDIO_MOUNT_PREFIX
from app.core.exceptions import LLMError
from app.core.logging import get_logger
from app.repositories.grammar_repository import GrammarRepository
from app.repositories.practice_repository import PracticeRepository
from app.repositories.writing_features_repository import WritingFeaturesRepository
from app.utils.grammar import normalize_grammar_type, normalize_sub_type, sub_type_prompt_block, task_display_text

logger = get_logger(__name__)

# ── Prompt builders ────────────────────────────────────────────────────────────

def _format_nlp_block(task_type: str, f: dict) -> str:
    """Format extracted NLP features into a rubric-aligned block for the scoring prompt."""
    dims = f.get("dimension_scores", {})
    is_email = task_type == "Write an Email"

    def pct(v) -> str:
        return f"{max(0.0, v):.0%}" if v is not None else "n/a"

    def flt(v, decimals=2) -> str:
        return f"{v:.{decimals}f}" if v is not None else "n/a"

    spelling_errors = f.get("spelling_errors") or []
    errors_preview = ", ".join(f'"{w}"' for w in spelling_errors[:5])
    if len(spelling_errors) > 5:
        errors_preview += f" … (+{len(spelling_errors) - 5} more)"

    mech_errors = f.get("mechanical_errors") or []
    mech_preview = "; ".join(str(e) for e in mech_errors[:3])
    if len(mech_errors) > 3:
        mech_preview += f" … (+{len(mech_errors) - 3} more)"

    # Content block — Discussion uses elaboration-weighted formula
    content_note = "" if is_email else "  (elaboration weighted 1.5× for academic depth)"

    # Pre-compute word-example previews (used in multiple sections below)
    hedge_found = f.get("hedge_words_found") or []
    hedge_preview = ", ".join(f'"{w}"' for w in sorted(set(hedge_found))[:8]) if hedge_found else "none"
    modal_found = f.get("modal_words_found") or []
    modal_preview = ", ".join(f'"{w}"' for w in sorted(set(modal_found))[:8]) if modal_found else "none"
    soph_words = f.get("sophisticated_words") or []
    soph_preview = ", ".join(f'"{w}"' for w in soph_words[:10]) if soph_words else "none"
    if len(soph_words) > 10:
        soph_preview += f" … (+{len(soph_words) - 10} more)"

    lines = [
        "--- Objective NLP Features (use these as calibration anchors for your score) ---",
        "",
        "CONTENT  [rubric: elaboration, relevance, coherence]",
        f"  Prompt relevance (similarity) : {pct(f.get('prompt_similarity'))}  (0%=off-topic, 100%=fully on-topic)",
        f"  Discourse coherence           : {pct(f.get('discourse_coherence'))}  (0%=incoherent, 100%=highly coherent)",
        f"  Elaboration depth             : {pct(f.get('elaboration_score'))}  (0%=minimal, 100%=well-developed){content_note}",
        f"  → Content dimension score     : {pct(dims.get('content'))}",
        "",
        "SYNTACTIC / LEXICAL VARIETY  [rubric: syntactic variety, idiomatic word choice, collocations]",
        f"  Sentence variety (entropy)    : {pct(f.get('sentence_variety'))}  (0%=monotonous, 100%=highly varied)",
        f"  Clause complexity             : {flt(f.get('clause_complexity'))} avg clauses/sentence",
        f"  Type-token ratio (vocabulary) : {pct(f.get('ttr'))}  (0%=repetitive, 100%=rich)",
        f"  Lexical sophistication        : {pct(f.get('lexical_sophistication'))}  (fraction of words beyond top-2000)  → {soph_preview}",
        f"  Collocation accuracy          : {pct(f.get('collocation_score'))}  (0%=unnatural, 100%=native-like)",
        f"  → Syntax dimension score      : {pct(dims.get('syntax'))}",
        f"  → Lexical dimension score     : {pct(dims.get('lexical'))}",
        "",
    ]

    # Social Conventions — scored dimension for Email, informational only for Discussion
    if is_email:
        lines += [
            "SOCIAL CONVENTIONS  [rubric: politeness, register, formulation of actions — SCORED]",
            f"  Hedge words used              : {f.get('hedge_count', 0)}  → {hedge_preview}",
            f"  Modal verbs used              : {f.get('modal_count', 0)}  → {modal_preview}",
            f"  Politeness score              : {pct(f.get('politeness_score'))}",
            f"  Register formality            : {pct(f.get('register_formality'))}  (0%=casual, 100%=very formal)",
            f"  Has greeting                  : {'Yes' if f.get('has_greeting') else 'No'}",
            f"  Has closing                   : {'Yes' if f.get('has_closing') else 'No'}",
            f"  → Conventions dimension score : {pct(dims.get('conventions'))}",
            "",
        ]
    else:
        lines += [
            "SOCIAL CONVENTIONS  [informational only — NOT a scored ETS dimension for Academic Discussion]",
            f"  Hedge words used              : {f.get('hedge_count', 0)}  → {hedge_preview}",
            f"  Modal verbs used              : {f.get('modal_count', 0)}  → {modal_preview}",
            f"  Register formality            : {pct(f.get('register_formality'))}  (0%=casual, 100%=very formal)",
            "  (Do not apply an Email conventions penalty — this is an Academic Discussion task)",
            "",
        ]

    lines += [
        "ACCURACY / ERRORS  [rubric: grammatical errors, word/usage errors, mechanical errors]",
        f"  Spelling errors per 100 words : {flt(f.get('spelling_error_rate'))}",
    ]
    if errors_preview:
        lines.append(f"  Misspelled words              : {errors_preview}")
    lines += [
        f"  Mechanical error count        : {f.get('mechanical_error_count', 0)}",
    ]
    if mech_preview:
        lines.append(f"  Mechanical error details      : {mech_preview}")
    lines += [
        f"  → Accuracy dimension score    : {pct(dims.get('accuracy'))}",
        "",
        "--- End NLP Features ---",
    ]
    return "\n".join(lines)


def _scoring_prompt(task_type: str, prompt_text: str, essay: str,
                    nlp_features: dict | None = None,
                    grammar_focus: list[dict] | None = None) -> str:
    if task_type == "Write an Email":
        rubric = (
            "- 5: Fully successful. Effective elaboration, syntactic variety, precise word choice, "
            "appropriate social conventions. Almost no errors.\n"
            "- 4: Generally successful. Adequate elaboration, mostly appropriate conventions. Few errors.\n"
            "- 3: Partially successful. Partial elaboration, moderate range, some noticeable errors.\n"
            "- 2: Mostly unsuccessful. Limited/irrelevant elaboration, limited range, accumulation of errors.\n"
            "- 1: Unsuccessful. Very little elaboration, telegraphic, serious/frequent errors.\n"
            "- 0: Blank, off-topic, not in English, copied, or arbitrary keystrokes."
        )
        time_info = "7 minutes, target 120-140 words"
    else:
        rubric = (
            "- 5: Fully successful. Clearly expressed, well-elaborated, variety of structures, almost no errors.\n"
            "- 4: Generally successful. Adequately elaborated, appropriate word choice. Few errors.\n"
            "- 3: Partially successful. Mostly relevant, some elaboration missing, some errors.\n"
            "- 2: Mostly unsuccessful. Poorly elaborated, limited range, accumulation of errors.\n"
            "- 1: Unsuccessful. Few coherent ideas, severely limited range, serious/frequent errors.\n"
            "- 0: Blank, off-topic, not in English, copied, or arbitrary keystrokes."
        )
        time_info = "10 minutes, target 120-150 words"

    # Pre-compute outside f-string to avoid set-of-set brace ambiguity
    _sub_type_block = sub_type_prompt_block(exclude_grammar_types={"Word Order"})
    nlp_block = (
        "\n\n" + _format_nlp_block(task_type, nlp_features)
        if nlp_features else ""
    )

    # Grammar focus block — injected when student has patterns due for review
    focus_block = ""
    if grammar_focus:
        lines = ["\n\n--- Grammar Focus for This Session ---"]
        lines.append("The student is actively working on the following grammar patterns today.")
        lines.append("When evaluating, pay extra attention to these and include any errors of these types in grammar_mistakes even if subtle:")
        for item in grammar_focus[:3]:
            lines.append(f"- {item['grammar_type']}: {item['prompt_note']}")
        focus_block = "\n".join(lines)

    return f"""You are a TOEFL iBT Writing evaluator. Score using the official ETS rubric.

Task type: {task_type} ({time_info})

Prompt:
\"{prompt_text}\"

Student's response:
\"{essay}\"{nlp_block}{focus_block}

Scoring guide (ETS Official 0-5 scale):
{rubric}

The NLP features above are objective measurements aligned to the ETS rubric dimensions \
(Content, Syntactic/Lexical Variety, Social Conventions, Accuracy/Errors). \
Use them as calibration anchors — they should inform but not mechanically determine your score. \
Human holistic judgment on meaning, coherence, and communication effectiveness still applies.

Return a JSON object with this exact structure:
{{
  "score": <float 0.0-5.0>,
  "feedback": "<2-3 sentences of overall feedback>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<area 1>", "<area 2>", "<area 3>"],
  "corrected_version": "<polished version of the student's essay>",
  "grammar_mistakes": [
    {{"grammar_type": "<type>", "sub_type": "<sub_type>", "wrong": "<exact phrase>", "correct": "<corrected phrase>", "explanation": "<brief reason>"}},
    ...
  ]
}}

Return up to 5 grammar mistakes. If none, return [].

grammar_type must be exactly one of:
"Article Error", "Preposition Error", "Verb Form Error", "Verb Tense Error",
"Subject-Verb Agreement", "Word Choice", "Pronoun Error", "Modal Error",
"Plural/Singular Error", "Phrasal Verb Error", "Run-on Sentence".

sub_type must be chosen from the list below based on grammar_type:
{_sub_type_block}

Return ONLY the JSON object, no markdown, no extra text."""


# ── LLM call wrappers ─────────────────────────────────────────────────────────

def score_essay(*, task_type: str, prompt_text: str, essay: str,
                nlp_features: dict | None = None,
                grammar_focus: list[dict] | None = None) -> dict:
    """Call LLM to score an essay. Raises LLMError on failure."""
    return call_llm_json(
        messages=[{"role": "user", "content": _scoring_prompt(
            task_type, prompt_text, essay,
            nlp_features=nlp_features,
            grammar_focus=grammar_focus,
        )}],
        temperature=0.2,
        max_tokens=4000,
        models=["openai/gpt-oss-120b"],
        label=f"score_essay/{task_type}",
    )


def analyze_bas_mistakes(wrong_items: list[dict]) -> dict[int, dict]:
    """Classify BAS wrong answers via LLM. Returns {task_id: mistake_dict}."""
    if not wrong_items:
        return {}
    items_text = "\n".join([
        f'{i+1}. Context: "{w["context"]}"\n   Student wrote: "{w["your_answer"]}"\n   Correct answer: "{w["answer"]}"'
        for i, w in enumerate(wrong_items)
    ])
    _bas_sub_type_block = sub_type_prompt_block()
    try:
        parsed = call_llm_json(
            messages=[{"role": "user", "content": (
                "You are a TOEFL grammar analyst. A student made errors in a Build-a-Sentence exercise.\n"
                "For each item below, identify the grammar mistake.\n\n" + items_text +
                "\n\ngrammar_type must be exactly one of: "
                '"Article Error", "Preposition Error", "Verb Form Error", "Verb Tense Error", '
                '"Subject-Verb Agreement", "Word Choice", "Pronoun Error", "Modal Error", '
                '"Plural/Singular Error", "Phrasal Verb Error", "Run-on Sentence", "Word Order".\n'
                "sub_type must be chosen from the list below based on grammar_type:\n"
                + _bas_sub_type_block + "\n"
                "Each object MUST include \"item_number\" matching the number at the start of each item above.\n"
                'Return JSON: {"mistakes": [{"item_number": 1, "grammar_type": "...", "sub_type": "...", "explanation": "..."}]}\nOnly return the JSON.'
            )}],
            temperature=0.2,
            max_tokens=4000,
            models=["openai/gpt-oss-120b"],
            label="bas_mistakes",
        )
        mistakes = parsed.get("mistakes", [])
        # Map by item_number (1-based) so ordering/missing items don't corrupt results
        result: dict[int, dict] = {}
        for m in mistakes:
            item_num = m.get("item_number")
            if item_num is None:
                continue
            try:
                idx = int(item_num) - 1
            except (ValueError, TypeError):
                continue
            if 0 <= idx < len(wrong_items):
                result[wrong_items[idx]["task_id"]] = m
        return result
    except Exception as exc:
        logger.warning("LLM BAS analysis failed error=%s — continuing without classification", exc)
        return {}


# ── Service orchestration ──────────────────────────────────────────────────────

def submit_writing(
    *,
    task_id: int,
    task_type: str,
    essay: str,
    time_spent_sec: int,
    practice_repo: PracticeRepository,
    grammar_repo: GrammarRepository,
    features_repo: Optional['WritingFeaturesRepository'] = None,
    is_revision: bool = False,
    revision_of: Optional[int] = None,
) -> dict:
    word_count = len(essay.split()) if essay.strip() else 0
    logger.info("writing submit task_id=%s task_type=%s words=%d", task_id, task_type, word_count)

    if not essay.strip():
        logger.warning("writing submit rejected — blank essay task_id=%s", task_id)
        raise ValueError("Essay is blank. Please write your response before submitting.")

    # Early dedup check — if same essay was submitted for same task within 5 min, return existing
    # This prevents double-scoring from retry clicks or timer race conditions
    existing_id = practice_repo.find_recent_writing(task_id=task_id, essay=essay)
    if existing_id:
        logger.info("writing submit dedup hit task_id=%s practice_id=%s", task_id, existing_id)
        existing = practice_repo.get_practice(existing_id)
        if existing:
            fb = existing.get("feedback") or ""
            # Parse strengths / improvements back from stored feedback string
            strengths_out: list[str] = []
            improvements_out: list[str] = []
            if "\n\nStrengths:" in fb:
                parts = fb.split("\n\nStrengths:", 1)
                rest = parts[1]
                if "\n\nAreas for Improvement:" in rest:
                    s_raw, i_raw = rest.split("\n\nAreas for Improvement:", 1)
                    strengths_out    = [l.lstrip("- ").strip() for l in s_raw.strip().splitlines() if l.strip()]
                    improvements_out = [l.lstrip("- ").strip() for l in i_raw.strip().splitlines() if l.strip()]
            return {
                "practice_id": existing_id,
                "score": existing.get("score"),
                "feedback": fb.split("\n\nStrengths:")[0],
                "strengths": strengths_out,
                "improvements": improvements_out,
                "corrected_version": None,
                "word_count": len(essay.split()),
                "time_spent_sec": time_spent_sec,
            }

    task_row = practice_repo.get_task(task_id)
    prompt_txt = task_row["question"] if task_row else ""

    # ── NLP feature extraction (synchronous, before LLM scoring) ──────────
    # All 4 ETS rubric dimensions run here — miniac-embed makes content
    # extraction (Jina was 9s, miniac ~200ms) fast enough to be synchronous.
    # Features are passed as calibration anchors to the LLM prompt.
    nlp_report_dict: Optional[dict] = None
    try:
        from app.services.writing_nlp import extract_all_features
        nlp_report = extract_all_features(essay, prompt_txt, task_type=task_type)
        nlp_report_dict = nlp_report.to_dict()
        logger.info("NLP extraction ok task_id=%s dims=%s", task_id,
                    nlp_report_dict.get("dimension_scores"))
    except Exception as exc:
        logger.warning("NLP extraction failed task_id=%s — scoring without features: %s", task_id, exc)

    score_result: Optional[dict] = None
    try:
        # Fetch grammar focus hints for today's due patterns — injected into scoring prompt
        grammar_focus: list[dict] = []
        try:
            grammar_focus = grammar_repo.get_writing_focus()
        except Exception as _e:
            logger.debug("grammar focus fetch failed — scoring without focus: %s", _e)

        score_result = score_essay(
            task_type=task_type, prompt_text=prompt_txt, essay=essay,
            nlp_features=nlp_report_dict,
            grammar_focus=grammar_focus or None,
        )
    except LLMError:
        logger.warning("scoring failed task_id=%s — saving with no score", task_id)

    final_score: Optional[float] = None
    feedback_text = "Your response has been saved. AI scoring failed — try again later."
    strengths: list = []
    improvements: list = []
    corrected_version: Optional[str] = None
    grammar_mistakes: list = []

    if score_result:
        raw_scale_max = 5.0  # Email / Discussion: ETS 0-5 rubric
        final_score       = round(max(0.0, min(raw_scale_max, float(score_result.get("score", 3.0)))), 1)
        feedback_text     = score_result.get("feedback", "")
        strengths         = score_result.get("strengths", [])
        improvements      = score_result.get("improvements", [])
        corrected_version = score_result.get("corrected_version")
        grammar_mistakes  = score_result.get("grammar_mistakes", [])
        logger.info("essay scored task_id=%s score=%.1f mistakes=%d", task_id, final_score, len(grammar_mistakes))

    parts = []
    if feedback_text:
        parts.append(feedback_text)
    if strengths:
        parts.append("Strengths:\n" + "\n".join(f"- {s}" for s in strengths))
    if improvements:
        parts.append("Areas for Improvement:\n" + "\n".join(f"- {s}" for s in improvements))
    if corrected_version:
        parts.append("Polished Version:\n" + corrected_version)
    full_feedback = "\n\n".join(parts) if parts else feedback_text

    practice_id = practice_repo.insert_practice(
        section="Writing", task_type=task_type,
        prompt=prompt_txt, response=essay,
        score=final_score, feedback=full_feedback,
        duration_minutes=round(time_spent_sec / 60),
        tags=f"task_id:{task_id},words:{word_count}",
        is_revision=is_revision,
        revision_of=revision_of,
    )
    practice_repo.upsert_study_log(topic_id=task_id, topic_title=task_type, score=final_score)
    logger.info("writing saved practice_id=%s task_id=%s score=%s", practice_id, task_id, final_score)

    for m in grammar_mistakes:
        wrong       = (m.get("wrong") or "").strip()
        correct     = (m.get("correct") or "").strip()
        gtype       = m.get("grammar_type", "Unknown")
        raw_sub     = (m.get("sub_type") or "").strip()
        sub_type    = normalize_sub_type(gtype, raw_sub)
        explanation = m.get("explanation", "")
        if not wrong or not correct:
            continue
        grammar_repo.upsert_mistake(
            section="Writing", task_type=task_type,
            grammar_type=gtype, sub_type=sub_type,
            wrong=wrong, correct=correct, explanation=explanation,
            practice_log_id=practice_id,
        )

    return {
        "practice_id": practice_id,
        "score": final_score,
        "feedback": feedback_text,
        "strengths": strengths,
        "improvements": improvements,
        "corrected_version": corrected_version,
        "word_count": word_count,
        "time_spent_sec": time_spent_sec,
        "_nlp_features": nlp_report_dict,  # passed to background saver, not exposed to client
        "prompt": prompt_txt,              # consumed by router for run_nlp_background, not sent to client
    }


def run_nlp_background(
    *,
    practice_id: int,
    task_type: str,
    essay: str,
    prompt_txt: str,
    precomputed_features: Optional[dict] = None,
) -> None:
    """Persist NLP features. Reuses precomputed dict (extracted synchronously
    during scoring) to avoid double extraction. Falls back to re-extraction
    if not available. Designed to run as a FastAPI background task.
    """
    from app.db.session import db_context
    from app.repositories.writing_features_repository import WritingFeaturesRepository
    try:
        if precomputed_features is not None:
            nlp_features = precomputed_features
            logger.info("NLP features reusing precomputed practice_id=%s", practice_id)
        else:
            from app.services.writing_nlp import extract_all_features
            report = extract_all_features(essay, prompt_txt, task_type=task_type)
            nlp_features = report.to_dict()
            logger.info("NLP features re-extracted practice_id=%s", practice_id)
        with db_context() as conn:
            WritingFeaturesRepository(conn).insert_features(
                practice_log_id=practice_id,
                task_type=task_type,
                features=nlp_features,
            )
            conn.commit()
        logger.info("NLP features saved practice_id=%s dims=%s",
                    practice_id, nlp_features.get("dimension_scores"))
    except Exception as exc:
        logger.warning("NLP feature save failed practice_id=%s: %s", practice_id, exc)


def submit_bas(
    *,
    results: list[dict],
    practice_repo: PracticeRepository,
    grammar_repo: GrammarRepository,
) -> dict:
    if not results:
        return {"status": "ok", "saved": 0}

    wrong_items = []
    for item in results:
        if item.get("checked") and not item.get("correct") and item.get("your_answer"):
            prompt_row = practice_repo.get_task(item["task_id"])
            context = ""
            if prompt_row:
                context = prompt_row["question"].split("\n")[0].strip()
            wrong_items.append({
                "task_id": item["task_id"],
                "context": context,
                "your_answer": item["your_answer"].strip(),
                "answer": (item.get("answer") or "").strip(),
            })

    logger.info("BAS submit total=%d wrong=%d", len(results), len(wrong_items))
    analysis_map = analyze_bas_mistakes(wrong_items)
    saved = 0

    for item in results:
        task_id     = item.get("task_id")
        checked     = item.get("checked", False)
        correct     = item.get("correct", False)
        your_answer = (item.get("your_answer") or "").strip()
        answer      = (item.get("answer") or "").strip()
        if not task_id or not checked:
            continue

        score = 6.0 if correct else 0.0
        prompt_row = practice_repo.get_task(task_id)
        prompt = prompt_row["question"] if prompt_row else ""
        bas_practice_id = practice_repo.insert_practice(
            section="Writing", task_type="Build a Sentence",
            prompt=prompt, response=your_answer,
            score=score,
            feedback="Correct!" if correct else f"Incorrect. Correct answer: {answer}",
            duration_minutes=0,
            tags=f"task_id:{task_id},correct:{'1' if correct else '0'}",
        )
        saved += 1

        if not correct and your_answer:
            ai = analysis_map.get(task_id, {})
            raw_gtype   = ai.get("grammar_type", "Word Order")
            norm_gtype  = normalize_grammar_type(raw_gtype)
            raw_sub     = ai.get("sub_type", "")
            norm_sub    = normalize_sub_type(norm_gtype, raw_sub)
            grammar_repo.upsert_mistake_bas(
                task_id=task_id,
                wrong=your_answer, correct=answer,
                grammar_type=norm_gtype,
                sub_type=norm_sub,
                explanation=ai.get("explanation") or f"Incorrect word arrangement. Expected: {answer}",
                practice_log_id=bas_practice_id,
            )

    logger.info("BAS saved saved=%d", saved)
    return {"status": "ok", "saved": saved}


def get_recommended_task(*, task_type: str, practice_repo: PracticeRepository) -> dict:
    all_tasks = practice_repo.list_tasks_by_type(task_type)
    if not all_tasks:
        logger.warning("no tasks in task_bank task_type=%s", task_type)
        return {"task_id": None, "snippet": "", "reason": "No tasks available"}

    history = practice_repo.get_practice_history_by_type(task_type)
    practiced: dict = {}
    for r in history:
        for part in (r["tags"] or "").split(","):
            if part.startswith("task_id:"):
                try:
                    tid = int(part.split(":")[1])
                    practiced[tid] = {"best": r["best_score"], "last": r["last_date"]}
                except ValueError:
                    pass

    never = [t for t in all_tasks if t["task_id"] not in practiced]
    if never:
        t = never[0]
        snippet = task_display_text(t)
        return {"task_id": t["task_id"], "snippet": snippet, "reason": "New prompt — never attempted"}

    scored = [
        (t, practiced[t["task_id"]]["best"] or 0, practiced[t["task_id"]]["last"])
        for t in all_tasks if t["task_id"] in practiced
    ]
    scored.sort(key=lambda x: (x[1], x[2]))
    t, best, _ = scored[0]
    snippet = task_display_text(t)
    score_str = f"{best:.1f}" if best else "unscored"
    return {"task_id": t["task_id"], "snippet": snippet, "reason": f"Needs improvement — best score {score_str}"}


def enrich_task_bank_rows(rows: list[dict]) -> list[dict]:
    """Augment task bank rows with audio_file / word_bank fields."""
    SPEAKING_TYPES = {"Listen and Repeat", "Take an Interview"}
    result = []
    for row in rows:
        task_type = row.get("task_type", "")
        question  = row.get("question", "")
        answer    = row.get("answer", "")

        if task_type in SPEAKING_TYPES and AUDIO_MOUNT_PREFIX in question:
            rel_path = question.replace(AUDIO_MOUNT_PREFIX, "")
            row["audio_file"] = rel_path
            if answer and answer != "Audio prompt - no text answer":
                row["question"] = answer
            else:
                import os as _os
                stem = _os.path.splitext(_os.path.basename(rel_path))[0]
                row["question"] = stem.replace("_", " ").title()
        elif task_type == "Build a Sentence":
            words_match = re.search(r'Words:\s*(.+)$', question, re.MULTILINE | re.IGNORECASE)
            if words_match:
                words = [w.strip() for w in words_match.group(1).split('/') if w.strip()]
                row["word_bank"] = "|".join(words)
            else:
                row["word_bank"] = "|".join((answer or "").split())

        result.append(row)
    return result
