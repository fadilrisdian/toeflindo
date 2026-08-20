"""Grammar service — weak spot, drill, evaluate."""
from __future__ import annotations

import json
import re
import time
from app.clients.llm import call_llm
from app.core.exceptions import LLMError  # noqa: F401 — re-raised by callers
from app.core.logging import get_logger
from app.repositories.grammar_repository import GrammarRepository
from app.repositories.practice_repository import PracticeRepository
from app.utils.time import now_wib

logger = get_logger(__name__)


# ── LLM helpers ───────────────────────────────────────────────────────────────

def explain_mistake(*, wrong: str, correct: str, grammar_type: str) -> str:
    prompt = "\n".join([
        "You are a concise TOEFL grammar teacher.",
        "",
        "Grammar error type: " + grammar_type,
        'Student said: "' + wrong + '"',
        'Correct version: "' + correct + '"',
        "",
        "In ONE clear sentence, explain what is grammatically wrong in what the student said "
        "and why the correct version is right. Be specific about the grammar rule. "
        "Do not praise the student.",
        "Reply with only that one sentence, no extra text.",
    ])
    raw = call_llm(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=2000,
        json_mode=False,
        label="explain/" + grammar_type,
    )
    raw = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL)
    raw = re.sub(r'<think>.*$', '', raw, flags=re.DOTALL).strip()
    return raw.strip('"')





def fix_weakspot_card(
    *, wrong: str, correct: str, category: str, description: str
) -> tuple[str, str]:
    prompt = "\n".join([
        "You are a TOEFL grammar drill editor.",
        "",
        "Grammar error type: " + category,
        'Current wrong sentence: "' + wrong + '"',
        'Current correct sentence: "' + correct + '"',
        "",
        "User instruction: " + description,
        "",
        "Produce an updated wrong/correct sentence pair that follows the user instruction.",
        "The wrong sentence must contain a clear " + category + " error.",
        "The correct sentence must fix exactly that error.",
        "",
        'Reply with only this JSON (no extra text): {"wrong": "...", "correct": "..."}',
    ])
    t0 = time.perf_counter()
    try:
        raw = call_llm(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=2000,
            json_mode=True,
            label="fix_weakspot/" + category,
        )
        ms = (time.perf_counter() - t0) * 1000
        logger.info("LLM fix_weakspot ok category=%s latency=%.0fms", category, ms)
        data = json.loads(raw)
        return (data.get("wrong") or wrong).strip(), (data.get("correct") or correct).strip()
    except LLMError as exc:
        ms = (time.perf_counter() - t0) * 1000
        logger.error("LLM fix_weakspot failed category=%s latency=%.0fms error=%s", category, ms, exc)
        raise
    except Exception as exc:
        ms = (time.perf_counter() - t0) * 1000
        logger.error("LLM fix_weakspot failed category=%s latency=%.0fms error=%s", category, ms, exc)
        raise


def generate_drill_sentences(
    categories: str | list[str],
    examples: list[dict],
    *,
    count: int = 5,
    custom_prompt: str = "",
    avoid_sentences: list[str] | None = None,
    difficulty: str = "medium",
) -> list[dict]:
    # Normalize categories
    if isinstance(categories, str):
        cats = [categories]
    else:
        cats = list(categories)
    category_label = ", ".join(cats)

    ex_lines = ""
    for i, e in enumerate(examples[:6], 1):
        ex_lines += "  %d. Wrong: %s\n     Correct: %s\n" % (i, e["wrong"], e["correct"])

    # Build sub_type list for this category so LLM can classify specifically
    SUB_TYPE_MAP: dict[str, str] = {
        "Tenses": '"present simple" / "present continuous" / "past simple" / "past continuous" / "present perfect" / "present perfect continuous" / "present perfect vs past" / "past perfect" / "future going to" / "future will" / "used to"',
        "Modals": '"can/could ability" / "must/can\'t certainty" / "may/might possibility" / "have to/must obligation" / "should advice" / "would" / "requests/offers/permission"',
        "Verb Forms": '"verb + ing" / "verb + infinitive" / "verb ing or infinitive" / "passive voice" / "reported speech" / "ing clause"',
        "Articles": '"a/an" / "the" / "no article" / "countable uncountable"',
        "Prepositions": '"preposition of time" / "preposition of place" / "preposition after noun" / "preposition after adjective" / "preposition after verb"',
        "Phrasal Verbs": '"phrasal verb in/out" / "phrasal verb on/off" / "phrasal verb up/down" / "phrasal verb away/back"',
        "Relative Clauses": '"relative clause who/that/which" / "relative clause whose/whom/where" / "relative clause extra information"',
        "Pronouns": '"reflexive pronoun"',
        "Plurals": '"singular/plural"',
        "Subject-Verb Agreement": '"subject-verb agreement"',
        "Questions": '"direct question" / "indirect question" / "question tag"',
        "Vocabulary": '"adjective form" / "adverb form" / "comparison"',
        "Word Order": '"verb object place time" / "adverb position"',
        "Sentence Structure": '"conditional" / "run-on sentence" / "connectors"',
    }
    # Collect sub_type options from all selected categories
    sub_type_parts = []
    for cat in cats:
        if cat in SUB_TYPE_MAP:
            sub_type_parts.append(SUB_TYPE_MAP[cat])
    if sub_type_parts:
        sub_type_instruction = "\nsub_type must be one of: " + " / ".join(sub_type_parts)
    else:
        sub_type_instruction = '\nsub_type should be a short specific label describing the exact sub-category of the error'

    custom_line = ""
    if custom_prompt.strip():
        custom_line = f"\n\nAdditional instruction from the student: {custom_prompt.strip()}\n"

    difficulty_map = {
        "a1": "Use very short, simple sentences with basic everyday vocabulary (A1 level). The error must be obvious — a fundamental mistake a beginner makes, such as wrong basic verb form or missing article.",
        "a2": "Use short, simple sentences about personal information, daily routines, or immediate needs (A2 level). The error should be clear and involve common high-frequency vocabulary.",
        "b1": "Use medium-length sentences on familiar and everyday topics (B1 level). The error should require solid grammar knowledge to spot, using adequate vocabulary for common situations.",
        "b2": "Use longer sentences on a wide range of topics including some abstract or unfamiliar ones (B2 level). Employ some less common words; the error may involve subtle grammar distinctions.",
        "c1": "Use complex sentences in academic or professional contexts (C1 level). Use less common lexical items and idiomatic expressions; the error should be subtle and require strong grammar awareness.",
        "c2": "Use sophisticated, nuanced sentences with idiomatic expressions, collocations, and low-frequency vocabulary (C2 level). The error should be very subtle — a precision or register issue that only an advanced learner would catch.",
    }
    diff_key = difficulty.lower() if difficulty.lower() in difficulty_map else "b1"
    difficulty_line = f"\n\nCEFR Difficulty level: {diff_key.upper()}. {difficulty_map[diff_key]}\n"

    avoid_line = ""
    if avoid_sentences:
        avoid_list = "\n".join(f"  - {s}" for s in avoid_sentences[:15])
        avoid_line = (
            "\n\nDo NOT reuse or closely paraphrase any of these recently used sentences:\n"
            + avoid_list + "\n"
        )

    prompt = (
        "You are a TOEFL grammar drill generator. "
        "The student has a recurring weakness in: " + category_label + ".\n"
        "\nExamples of their past mistakes:\n" + ex_lines + "\n"
        f"Generate exactly {count} NEW sentences containing a " + category_label + " error. "
        "Each must be different from the examples above.\n"
        "IMPORTANT: The \"wrong\" sentence must have a clear, unambiguous grammatical error. "
        "Do NOT generate pairs where both versions are grammatically correct. "
        "The error must be something a grammar teacher would mark as definitely wrong.\n"
        + sub_type_instruction + "\n"
        + avoid_line
        + difficulty_line
        + custom_line
        + 'Return JSON: {"sentences": [{"wrong": "...", "correct": "...", "hint": "one-sentence explanation", "sub_type": "..."}, ...]}'\
    )
    t0 = time.perf_counter()
    try:
        raw = call_llm(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.8,
            max_tokens=4000,
            json_mode=True,
            label="drill_gen/" + category_label,
        )
        ms = (time.perf_counter() - t0) * 1000
        data = json.loads(raw)
        sentences = data.get("sentences", [])
        if not sentences:
            logger.error("LLM drill_gen returned empty sentences category=%s latency=%.0fms", category_label, ms)
            raise LLMError("No sentences returned from drill generator")
        logger.info("LLM drill_gen ok category=%s sentences=%d latency=%.0fms", category_label, len(sentences), ms)
        return sentences
    except LLMError:
        raise
    except Exception as exc:
        ms = (time.perf_counter() - t0) * 1000
        logger.error("LLM drill_gen failed category=%s latency=%.0fms error=%s", category_label, ms, exc)
        raise LLMError(str(exc)) from exc


def evaluate_grammar(
    *, user_answer: str, correct: str, wrong: str, category: str
) -> dict:
    lines = [
        "You are a TOEFL grammar evaluator. A student was asked to correct a " + category + " error.",
        "",
        'Original sentence (contains the error): "' + wrong + '"',
        'Student answer: "' + user_answer + '"',
        "",
        "Judge the student answer on its own grammatical merit:",
        "- correct: the student answer is grammatically correct AND fixes the " + category + " error from the original",
        "- partial: the " + category + " error is only partly fixed, or a new grammar error was introduced",
        "- wrong: the " + category + " error from the original sentence is still present in the student answer",
        "",
        "IMPORTANT: Do NOT require the student to use the same wording as any reference version.",
        "If multiple correct phrasings exist, accept any grammatically correct one that fixes the error.",
        "",
        "Reply with exactly this JSON (no extra text):",
        '{"verdict": "correct", "feedback": "one sentence explaining why"}',
    ]
    t0 = time.perf_counter()
    try:
        raw = call_llm(
            messages=[{"role": "user", "content": "\n".join(lines)}],
            temperature=0.0,
            max_tokens=4000,
            json_mode=False,
            label="evaluate/" + category,
        )
        ms = (time.perf_counter() - t0) * 1000
        matches = list(re.finditer(r'\{[^{}]+\}', raw, re.DOTALL))
        if matches:
            data = json.loads(matches[-1].group(0))
            verdict  = data.get("verdict", "wrong")
            feedback = data.get("feedback", "")
            if verdict not in ("correct", "partial", "wrong"):
                verdict = "wrong"
        else:
            # "incorrect" contains "correct" — match exact word only
            verdict  = "correct" if re.search(r'\bcorrect\b', raw, re.I) and not re.search(r'\bincorrect\b', raw, re.I) else "wrong"
            feedback = ""
        logger.info("LLM evaluate ok category=%s verdict=%s latency=%.0fms", category, verdict, ms)
        return {"verdict": verdict, "feedback": feedback}
    except Exception as exc:
        ms = (time.perf_counter() - t0) * 1000
        logger.error("LLM evaluate failed category=%s latency=%.0fms error=%s", category, ms, exc)
        v = "correct" if user_answer.lower().rstrip(".!?,") == correct.lower().rstrip(".!?,") else "wrong"
        return {"verdict": v, "feedback": "", "fallback": True}


def process_weakspot_submit(
    *,
    category: str,
    results: list[dict],
    grammar_repo: GrammarRepository,
    practice_repo: PracticeRepository,
) -> dict:
    logged = 0
    correct_count = 0
    for r in results:
        wrong      = (r.get("user_answer") or "").strip()
        correct    = (r.get("correct") or "").strip()
        is_correct = bool(r.get("is_correct", False))
        hint       = r.get("hint") or ""
        sub_type   = (r.get("sub_type") or "").strip()
        score      = 6.0 if is_correct else 1.0
        practice_repo.insert_practice(
            section="Grammar", task_type="Weak Spot Drill",
            prompt=correct, response=wrong,
            score=score, feedback=hint, tags=category,
        )
        if not is_correct and wrong:
            grammar_repo.upsert_mistake_weakspot(
                wrong=wrong, correct=correct, category=category, hint=hint, sub_type=sub_type
            )
        if is_correct:
            correct_count += 1
        logged += 1

    logger.info("weakspot submit category=%s total=%d correct=%d", category, logged, correct_count)
    return {"ok": True, "logged": logged}


# ── Remediation service ────────────────────────────────────────────────────────


def build_remediation_feedback(
    *,
    grammar_type: str,
    sub_type: str,
    wrong: str,
    correct: str,
    explanation: str,
    treatability: str,
) -> dict:
    """Generate rule/model_sentences for Step 2 of the remediation loop.

    treatable   → 1-line rule explaining the grammar principle
    untreatable → 1-2 natural model phrasings, no invented rule
    """
    t0 = time.perf_counter()
    if treatability == "treatable":
        prompt = "\n".join([
            "You are a concise TOEFL grammar teacher.",
            "",
            f"Grammar error type: {grammar_type}" + (f" ({sub_type})" if sub_type else ""),
            f'Student wrote: "{wrong}"',
            f'Correct version: "{correct}"',
            "",
            "Produce two things:",
            "1. rule — one sentence stating the general grammar principle behind this error.",
            "   The rule must be broad enough to cover related correct examples, not just this one sentence.",
            "   Do NOT write a rule that only fits the specific words in the example above.",
            "   Do NOT frame the rule as 'use X word' or 'use X form' — frame it as the structural pattern.",
            "   Good example (broad): 'Use make + object + adjective to describe the state the object is put into.'",
            "   Bad example (narrow): 'Use a past participle after make + object.'",
            "2. contrast — a short phrase-level pair showing wrong vs correct structure.",
            "   Extract only the relevant weak spot — not the full sentence.",
            "   contrast_wrong: the incorrect fragment from the student's sentence.",
            "   contrast_correct: the corrected fragment.",
            "",
            'Reply with only this JSON: {"rule": "...", "contrast_wrong": "...", "contrast_correct": "..."}',
        ])
        raw = call_llm(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=2000,
            json_mode=True,
            label="remediate/rule/" + grammar_type,
        )
        raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
        raw = re.sub(r"<think>.*$", "", raw, flags=re.DOTALL).strip()
        ms = (time.perf_counter() - t0) * 1000
        try:
            data = json.loads(raw)
            rule = data.get("rule", "").strip().strip('"')
            contrast_wrong = data.get("contrast_wrong", "").strip()
            contrast_correct = data.get("contrast_correct", "").strip()
        except Exception:
            rule = raw.strip().strip('"')
            contrast_wrong = ""
            contrast_correct = ""
        logger.info("remediate rule ok grammar_type=%s latency=%.0fms", grammar_type, ms)
        return {"rule": rule, "model_sentences": [], "contrast_wrong": contrast_wrong, "contrast_correct": contrast_correct}
    else:
        # untreatable: generate 2 native model phrasings
        prompt = "\n".join([
            "You are a TOEFL writing teacher helping a student learn natural English collocations.",
            "",
            f"Error type: {grammar_type}" + (f" ({sub_type})" if sub_type else ""),
            f'Student wrote: "{wrong}"',
            f'More natural version: "{correct}"',
            "",
            "Provide exactly 2 short example sentences that demonstrate the natural/correct collocation or phrasing.",
            "These sentences should be different from the student's sentence — new contexts.",
            "Do NOT invent a grammar rule. This is about natural usage, not rules.",
            "",
            'Reply with only this JSON: {"sentences": ["sentence1", "sentence2"]}',
        ])
        raw = call_llm(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=2000,
            json_mode=True,
            label="remediate/model/" + grammar_type,
        )
        ms = (time.perf_counter() - t0) * 1000
        try:
            data = json.loads(raw)
            sentences = data.get("sentences", [])[:2]
        except Exception:
            sentences = []
        logger.info("remediate model_sentences ok grammar_type=%s latency=%.0fms", grammar_type, ms)
        return {"rule": "", "model_sentences": sentences, "contrast_wrong": "", "contrast_correct": ""}


def generate_remediation_prompts(
    *,
    grammar_type: str,
    sub_type: str,
    correct: str,
    wrong: str,
    explanation: str,
    treatability: str,
) -> list[str]:
    """Generate 2-3 writing prompts for Step 3 (generation practice).

    Each prompt asks the student to write a NEW sentence applying the same rule/pattern,
    using their own content — not edit the original.
    Prompts are grounded in TOEFL 2026 topic domains and tied to the specific mistake.
    """
    t0 = time.perf_counter()
    pattern_label = grammar_type + (f" — {sub_type}" if sub_type else "")

    TOEFL_TOPICS = (
        "Academics, Science (Life/Physical), Humanities, Social Science, Business, "
        "Technology, Environment, Health, Arts, Campus Life, University Services, "
        "Student Activities"
    )

    mistake_context = (
        f"The student's specific mistake:\n"
        f"  Wrong:   \"{wrong}\"\n"
        f"  Correct: \"{correct}\"\n"
    )
    if explanation:
        mistake_context += f"  Why it's wrong: {explanation}\n"

    if treatability == "treatable":
        instruction = (
            f"You are a TOEFL grammar practice designer.\n"
            f"Grammar pattern to practice: '{pattern_label}'\n\n"
            f"{mistake_context}\n"
            f"Generate exactly 3 writing prompts. Each prompt must:\n"
            f"1. Be in a DIFFERENT TOEFL 2026 topic domain. Choose 3 from: {TOEFL_TOPICS}\n"
            f"2. Directly ask the student to write a NEW sentence applying the '{pattern_label}' pattern correctly\n"
            f"3. Be specific enough that the student's sentence will naturally require using this grammar pattern\n"
            f"4. Be under 20 words\n\n"
            f"Each prompt must be worded differently — vary the phrasing across all 3 prompts.\n"
            f"Keep each prompt open-ended — the student can write about ANY topic or content they choose.\n"
            f"Do NOT lock the student into a specific scenario, person, or subject matter.\n"
            f"IMPORTANT: Do NOT reproduce, quote, or echo the wrong or correct example sentences (or any part of them) in your prompts. Invent entirely new contexts.\n"
            f"Do NOT ask them to fix or rewrite the original mistake sentence.\n\n"
            'Reply with only this JSON: {"prompts": ["prompt1", "prompt2", "prompt3"]}'
        )
    else:
        instruction = (
            f"You are a TOEFL grammar practice designer.\n"
            f"Natural usage pattern to practice: '{pattern_label}'\n\n"
            f"{mistake_context}\n"
            f"Generate exactly 3 writing prompts. Each prompt must:\n"
            f"1. Be in a DIFFERENT TOEFL 2026 topic domain. Choose 3 from: {TOEFL_TOPICS}\n"
            f"2. Directly ask the student to write a NEW sentence using the '{pattern_label}' pattern naturally\n"
            f"3. Be specific enough that the student's sentence will naturally require this exact collocation/usage\n"
            f"4. Be under 20 words\n\n"
            f"Each prompt must be worded differently — vary the phrasing across all 3 prompts.\n"
            f"Keep each prompt open-ended — the student can write about ANY topic or content they choose.\n"
            f"Do NOT lock the student into a specific scenario, person, or subject matter.\n"
            f"IMPORTANT: Do NOT reproduce, quote, or echo the wrong or correct example sentences (or any part of them) in your prompts. Invent entirely new contexts.\n"
            f"Do NOT ask them to fix or rewrite the original mistake sentence.\n\n"
            'Reply with only this JSON: {"prompts": ["prompt1", "prompt2", "prompt3"]}'
        )

    raw = call_llm(
        messages=[{"role": "user", "content": instruction}],
        temperature=0.8,
        max_tokens=2000,
        json_mode=True,
        label="remediate/prompts/" + grammar_type,
    )
    ms = (time.perf_counter() - t0) * 1000
    try:
        data = json.loads(raw)
        prompts = [p.strip() for p in data.get("prompts", []) if p.strip()][:3]
    except Exception:
        prompts = []
    if not prompts:
        # Hard fallback so the UI never gets stuck
        prompts = [
            f"Write a sentence of your own choice that correctly applies the {grammar_type} pattern.",
            f"Write another sentence of your own choice that correctly applies the {grammar_type} pattern.",
        ]
    logger.info("remediate prompts ok grammar_type=%s latency=%.0fms", grammar_type, ms)
    return prompts


def check_student_sentence(
    *,
    student_sentence: str,
    prompt: str,
    grammar_type: str,
    sub_type: str,
    treatability: str,
) -> dict:
    """Evaluate a student's new-sentence attempt in Step 3.

    Returns {"verdict": "correct"|"wrong", "feedback": "..."}
    """
    t0 = time.perf_counter()
    pattern_label = grammar_type + (f" — {sub_type}" if sub_type else "")

    if treatability == "treatable":
        check_instruction = (
            f"The student was asked to write a new sentence correctly using the '{pattern_label}' grammar pattern.\n"
            f"Prompt given: \"{prompt}\"\n"
            f"Student sentence: \"{student_sentence}\"\n\n"
            f"Judge ONLY on grammar — ignore topic, subject matter, or whether it fits the prompt scenario.\n"
            f"Any grammatically correct sentence that applies the '{pattern_label}' pattern is acceptable.\n\n"
            "verdict:\n"
            "  'correct' — grammar pattern applied correctly and naturally\n"
            "  'awkward' — grammar is technically correct but wording is unnatural; include a more natural suggestion in feedback\n"
            "  'wrong'   — grammar error is still present\n\n"
            "feedback: one sentence about the grammar only — what is correct or what specific grammar error remains.\n"
            "When correct: confirm compactly and name what the student did right. "
            "Example: 'Correct — you applied the pattern accurately.' "
            "Do NOT use vague praise like 'Great job!', 'Well done!', or 'Excellent!'.\n"
            "When wrong: state exactly what grammar error remains and what specific form is needed. "
            "Example: 'After make + object, use an adjective, not a base verb. Try disappointed instead of disappoint.'\n"
            'Reply with only this JSON: {"verdict": "correct", "feedback": "..."}'
        )
    else:
        check_instruction = (
            f"The student was asked to write a new sentence using the natural '{pattern_label}' pattern.\n"
            f"Prompt given: \"{prompt}\"\n"
            f"Student sentence: \"{student_sentence}\"\n\n"
            f"Judge ONLY on whether the '{pattern_label}' pattern is used naturally — ignore topic, subject matter, or whether it fits the prompt scenario.\n"
            f"Any sentence that uses the pattern naturally is acceptable regardless of content.\n\n"
            "verdict:\n"
            "  'correct' — pattern used correctly and naturally\n"
            "  'awkward' — pattern present but phrasing is unnatural; include a more natural suggestion in feedback\n"
            "  'wrong'   — same error type is still present\n\n"
            "feedback: one sentence about the pattern usage only — what is natural or what specific usage error remains.\n"
            "When correct: confirm compactly and name what the student did right. "
            "Example: 'Correct — the collocation is used naturally here.' "
            "Do NOT use vague praise like 'Great job!', 'Well done!', or 'Excellent!'.\n"
            "When wrong: state exactly what unnatural usage remains and what a better phrasing would be.\n"
            'Reply with only this JSON: {"verdict": "correct", "feedback": "..."}'
        )

    raw = call_llm(
        messages=[{"role": "user", "content": check_instruction}],
        temperature=0.0,
        max_tokens=2000,
        json_mode=False,
        label="remediate/check/" + grammar_type,
    )
    ms = (time.perf_counter() - t0) * 1000
    matches = list(re.finditer(r"\{[^{}]+\}", raw, re.DOTALL))
    if matches:
        try:
            data = json.loads(matches[-1].group(0))
            verdict  = data.get("verdict", "wrong")
            feedback = data.get("feedback", "")
            if verdict not in ("correct", "awkward", "wrong"):
                verdict = "wrong"
        except Exception:
            verdict, feedback = "wrong", ""
    else:
        verdict  = "correct" if re.search(r"\bcorrect\b", raw, re.I) and not re.search(r"\bincorrect\b", raw, re.I) else "wrong"
        feedback = ""
    logger.info("remediate check ok grammar_type=%s verdict=%s latency=%.0fms", grammar_type, verdict, ms)
    return {"verdict": verdict, "feedback": feedback}


# ── Free-text analysis ────────────────────────────────────────────────────────


def analyze_free_text(*, text: str) -> dict:
    """Analyze a free-form paragraph for grammar mistakes.

    Returns a list of mistakes, each with:
      wrong, correct, grammar_type, sub_type, explanation, treatability
    """
    prompt = "\n".join([
        "You are a TOEFL grammar teacher. Analyze the following text for grammar mistakes.",
        "Focus on mistakes that affect TOEFL Writing/Speaking scores: subject-verb agreement,",
        "tense consistency, article usage, preposition errors, relative clauses, word form,",
        "sentence structure, and collocations.",
        "",
        "TEXT:",
        text,
        "",
        "For each mistake you find, provide:",
        "  - wrong: the exact phrase or clause from the text that contains the error",
        "  - correct: the corrected version of that phrase",
        "  - grammar_type: short category label (e.g. 'Subject-Verb Agreement', 'Article Usage')",
        "  - sub_type: more specific label or empty string",
        "  - explanation: one sentence explaining the error",
        "  - treatability: 'treatable' if rule-based, 'untreatable' if collocation/usage-based",
        "",
        "If the text is error-free, return an empty mistakes array.",
        "",
        'Reply with only this JSON: {"mistakes": [...]}',
    ])
    t0 = time.perf_counter()
    raw = call_llm(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=4000,
        json_mode=True,
        label="free_text_analyze",
    )
    ms = (time.perf_counter() - t0) * 1000
    try:
        data = json.loads(raw)
        mistakes = data.get("mistakes", [])
    except Exception:
        # Try extracting JSON block
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1:
            try:
                data = json.loads(raw[start:end + 1])
                mistakes = data.get("mistakes", [])
            except Exception:
                mistakes = []
        else:
            mistakes = []
    logger.info("free_text_analyze ok mistakes=%d latency=%.0fms", len(mistakes), ms)
    return {"mistakes": mistakes}

