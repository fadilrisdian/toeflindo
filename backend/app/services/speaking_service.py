"""Speaking service — audio analysis, scoring, task recommendation."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Optional

from app.clients import speech as speech_client
from app.core.exceptions import LLMError, SpeechAnalyzerError
from app.core.logging import get_logger
from app.repositories.grammar_repository import GrammarRepository
from app.repositories.practice_repository import PracticeRepository
from app.utils.grammar import normalize_grammar_type, normalize_sub_type, sub_type_prompt_block_inline

logger = get_logger(__name__)

# ── Prompt versioning ─────────────────────────────────────────────────────────
# Bump when rubric text, output schema, or scoring logic changes.
# Stored in speech_analysis_log so old scores remain interpretable.
SPEAKING_PROMPT_VERSION = "speaking-evaluator-1.0.0"

# ── ETS per-dimension rubrics ─────────────────────────────────────────────────
# Source: TOEFL iBT Technical Manual RR-106 / ETS RR-25-12, Tables 5 & 6

_FLUENCY_RUBRIC = """\
5: Very fluent — natural pace (~120-160 WPM), long uninterrupted runs, no meaningful pauses or fillers.
4: Good fluency — mostly smooth, minor pausing, few fillers.
3: Adequate — some pauses/fillers interrupting flow, choppy at times.
2: Limited — frequent pauses, many fillers, halting delivery.
1: Poor — mostly halting, very frequent pauses/fillers.
0: No response or entirely unintelligible rhythm."""

_INTELLIGIBILITY_RUBRIC = """\
5: Fully intelligible — clear pronunciation, natural stress and rhythm, easy to understand.
4: Mostly intelligible — minor pronunciation issues, generally natural prosody.
3: Mostly intelligible — some unclear words, some unnatural stress, understandable with effort.
2: Partially intelligible — several unclear words, unnatural stress, requires effort.
1: Mostly unintelligible — frequent pronunciation errors, very unnatural prosody.
0: Unintelligible — pronunciation makes comprehension near-impossible."""

_LANGUAGE_USE_RUBRIC = """\
5: Rich, varied vocabulary (C1-C2), precise word choice, no grammar errors, complex varied structures.
4: Good range (B2-C1), minor imprecision, only minor grammar errors, some complex structures.
3: Adequate (B1-B2), some repetition, several grammar errors but meaning clear, mostly simple structures.
2: Limited (A2-B1), frequent word repetition, frequent grammar errors sometimes obscuring meaning.
1: Very limited (A2), mostly basic words, many errors obscuring meaning.
0: Extremely limited or incomprehensible."""

_ORGANIZATION_RUBRIC = """\
5: Clear beginning/middle/end, natural discourse markers, personal example, coherent argument.
4: Good structure, 2+ discourse markers used naturally, partial elaboration.
3: Attempted structure, 1-2 markers, limited example or support.
2: Loose structure, few or no markers, rambling or list-like.
1: No discernible structure, single-clause responses.
0: Incoherent or too short to judge."""

_REPEAT_ACCURACY_RUBRIC = """\
5: Exact repetition of the prompt, fully intelligible.
4: Captures meaning — minor word/grammar changes, 1-2 function words missing or transposed.
3: Essentially full response — majority of content words present, multiple function words missing/changed.
2: Missing a significant part — large portion missing, fragmentary, low intelligibility.
1: Very little captured — minimal response, mostly unintelligible.
0: No response, entirely unintelligible, or entirely unconnected."""

# ── Official raw-score → band lookup ─────────────────────────────────────────
# Source: TOEFL iBT official band conversion table (Speaking, max raw = 55)
# Format: (min_raw, max_raw, band)
_RAW_TO_BAND: list[tuple[int, int, float]] = [
    (52, 55, 6.0),
    (48, 51, 5.5),
    (43, 47, 5.0),
    (37, 42, 4.5),
    (32, 36, 4.0),
    (26, 31, 3.5),
    (21, 25, 3.0),
    (15, 20, 2.5),
    (10, 14, 2.0),
    ( 4,  9, 1.5),
    ( 0,  3, 1.0),
]


def raw_to_band(total_raw: int | float) -> float:
    """Convert a Speaking section total raw score (0-55) to TOEFL band (1.0-6.0)."""
    total_raw = max(0, min(55, round(total_raw)))
    for lo, hi, band in _RAW_TO_BAND:
        if lo <= total_raw <= hi:
            return band
    return 1.0


def estimated_band(task_raw: float) -> float:
    """Estimate band from a single-task raw score (0-5).

    Assumes the same score across all 11 tasks (7 LNR + 4 Interview):
        total = task_raw × 11  → lookup band table.
    Useful for per-practice feedback; not a substitute for a full session total.
    """
    return raw_to_band(round(task_raw * 11))




def _build_rubric_prompt(
    *, task_type: str, expected_answer: str, flat: dict, accuracy: dict,
    fluency_detail: dict, gram_detail: dict, vocab_detail: dict, disc_detail: dict,
) -> str:
    _speaking_sub_type_inline = sub_type_prompt_block_inline(exclude_grammar_types={"Word Order"})
    ets_dims = flat.get("ets_dimensions", {})
    word_accuracy = accuracy.get("word_accuracy")

    # ── Evidence block (acoustic measurements) ───────────────────────────────
    if task_type == "Take an Interview":
        evidence = (
            f"Acoustic dimension scores (1-6 reference scale, from audio analysis):\n"
            f"  Fluency:        {ets_dims.get('fluency', '?')}  "
            f"(WPM={flat.get('wpm')} | fillers={fluency_detail.get('filler_count',0)} "
            f"| pauses={fluency_detail.get('pause_count',0)} "
            f"[{fluency_detail.get('long_pause_count',0)} long >0.8s] "
            f"| repetitions={fluency_detail.get('repetition_count',0)})\n"
            f"  Intelligibility: {ets_dims.get('intelligibility', '?')}  "
            f"(pronunciation={flat.get('pronunciation_score')} | intonation={flat.get('intonation_score')})\n"
            f"  Language Use:   {ets_dims.get('language_use', '?')}  "
            f"(grammar={flat.get('grammar_score')} CEFR={flat.get('cefr_level')} | "
            f"vocab={flat.get('vocabulary_score')} | "
            f"conjunctions={gram_detail.get('grammatical_range',{}).get('conjunctions_used',[])} | "
            f"repeated_words={vocab_detail.get('repeated_words',[])[:4]})\n"
            f"  Organization:   {ets_dims.get('organization', '?')}  "
            f"(discourse_markers={disc_detail.get('marker_count',0)} found={disc_detail.get('markers_found',[])[:5]} | "
            f"has_structure={disc_detail.get('has_structure')} | "
            f"has_example={disc_detail.get('has_example')})\n"
            f"Note: acoustic scores above are on a 1-6 reference scale; "
            f"your scores must use the official 0-5 rubric scale below.\n"
        )
        grammar_extras = (
            ', "grammar_mistakes" (array — one object per error, each with: '
            'grammar_type, sub_type, wrong_sentence, correct_sentence, explanation; '
            '"wrong_sentence" = COMPLETE sentence from transcript containing the error; '
            '"correct_sentence" = fully corrected version; '
            '"explanation" = one short sentence about THIS error only; '
            f'grammar_type must be one of: "Article Error","Preposition Error","Verb Form Error",'
            '"Verb Tense Error","Subject-Verb Agreement","Word Choice","Pronoun Error",'
            '"Modal Error","Plural/Singular Error","Phrasal Verb Error","Run-on Sentence"; '
            'return [] if no errors; '
            f'sub_type from: {_speaking_sub_type_inline})'
            ', "model_answer" (2-3 sentence ideal TOEFL band-5 answer to the question)'
        )
        dim_block = (
            f"Dimension rubrics:\n"
            f"FLUENCY:\n{_FLUENCY_RUBRIC}\n\n"
            f"INTELLIGIBILITY:\n{_INTELLIGIBILITY_RUBRIC}\n\n"
            f"LANGUAGE USE (Vocabulary & Grammar):\n{_LANGUAGE_USE_RUBRIC}\n\n"
            f"ORGANIZATION:\n{_ORGANIZATION_RUBRIC}\n"
        )
        json_keys = (
            '"fluency_score" (int 0-5), '
            '"intelligibility_score" (int 0-5), '
            '"language_use_score" (int 0-5), '
            '"organization_score" (int 0-5), '
            '"rubric_rationale" (one sentence summarising overall performance), '
            '"readiness_score" (int 0-100), '
            '"readiness_level" (one of: early_development/developing/functional/strong/highly_ready), '
            '"strengths" (array), '
            '"priority_issues" (array)'
            + grammar_extras
        )

    else:  # Listen and Repeat
        acc_score = ets_dims.get("repeat_accuracy", "?")
        evidence = (
            f"Acoustic dimension scores (1-6 reference scale, from audio analysis):\n"
            f"  Fluency:          {ets_dims.get('fluency', '?')}  "
            f"(WPM={flat.get('wpm')} | fillers={fluency_detail.get('filler_count',0)} "
            f"| pauses={fluency_detail.get('pause_count',0)})\n"
            f"  Intelligibility:  {ets_dims.get('intelligibility', '?')}  "
            f"(pronunciation={flat.get('pronunciation_score')} | intonation={flat.get('intonation_score')})\n"
            f"  Repeat Accuracy:  {acc_score}  "
            + (
                f"(word_accuracy={word_accuracy}% | "
                f"missing={', '.join((accuracy.get('missing_words') or [])[:5])})\n"
                if word_accuracy is not None else "(no expected answer provided)\n"
            )
        )
        dim_block = (
            f"Dimension rubrics:\n"
            f"FLUENCY:\n{_FLUENCY_RUBRIC}\n\n"
            f"INTELLIGIBILITY:\n{_INTELLIGIBILITY_RUBRIC}\n\n"
            f"REPEAT ACCURACY:\n{_REPEAT_ACCURACY_RUBRIC}\n"
        )
        json_keys = (
            '"fluency_score" (int 0-5), '
            '"intelligibility_score" (int 0-5), '
            '"repeat_accuracy_score" (int 0-5), '
            '"rubric_rationale" (one sentence), '
            '"readiness_score" (int 0-100), '
            '"readiness_level" (one of: early_development/developing/functional/strong/highly_ready), '
            '"strengths" (array), '
            '"priority_issues" (array)'
        )

    return (
        f"You are an ETS TOEFL speaking examiner.\n"
        f"Task type: {task_type}\n"
        + (f"Expected: {expected_answer}\n" if task_type == "Listen and Repeat" and expected_answer else "")
        + f"Transcript: {flat['transcript'][:400]}\n\n"
        + evidence
        + f"\n{dim_block}\n"
        f"Instructions:\n"
        f"- Score each dimension independently using the rubric above.\n"
        f"- Use the acoustic scores as supporting evidence, not hard constraints — "
        f"apply your own judgement based on the transcript.\n"
        f"- The final rubric_score will be computed from your dimension scores by the system.\n"
        f"- readiness_score: integer 0-100 overall TOEFL readiness (not a raw ETS score).\n"
        f"- readiness_level: one of early_development/developing/functional/strong/highly_ready.\n"
        f"- strengths: array of at most 2 objects {{\"strength\": str, \"evidence\": str}}.\n"
        f"- priority_issues: array of at most 2 objects {{\"issue\": str, \"evidence\": str, \"priority\": \"high\"|\"medium\"}}.\n"
        f"  Select issues by: confidence × recurrence × communication_impact × trainability.\n\n"
        f"Return ONLY a JSON object with keys: {json_keys}."
    )


def _compute_rubric_score(graded: dict, task_type: str) -> float:
    """Combine LLM per-dimension scores (0-5 scale) using ETS weights.

    Returns a float 0-5 (the task raw score), or -1 to signal missing dimensions.
    Caller maps this to a band via estimated_band().
    """
    if task_type == "Take an Interview":
        flu  = graded.get("fluency_score")
        int_ = graded.get("intelligibility_score")
        lang = graded.get("language_use_score")
        org  = graded.get("organization_score")
        if any(v is None for v in [flu, int_, lang, org]):
            return -1.0
        raw = float(flu) * 0.25 + float(int_) * 0.25 + float(lang) * 0.25 + float(org) * 0.25  # type: ignore[arg-type]

    elif task_type == "Listen and Repeat":
        flu  = graded.get("fluency_score")
        int_ = graded.get("intelligibility_score")
        acc  = graded.get("repeat_accuracy_score")
        if any(v is None for v in [flu, int_, acc]):
            return -1.0
        raw = float(flu) * 0.30 + float(int_) * 0.35 + float(acc) * 0.35  # type: ignore[arg-type]

    else:
        # Unknown task type — no raw score available
        return -1.0

    return round(max(0.0, min(5.0, raw)), 2)




def _call_rubric_llm(prompt: str, task_type: str) -> dict:
    """Try each fallback model in order. Returns graded dict or {} on total failure."""
    try:
        from app.clients.llm import call_llm_json
        return call_llm_json(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=4000,
            label=f"rubric/{task_type}",
        )
    except Exception:
        logger.error("LLM rubric exhausted all fallback models task=%s", task_type)
        return {}


async def analyze_speaking(
    *,
    audio_bytes: bytes,
    task_id: str,
    task_type: str,
    expected_answer: str,
    topic: str,
    practice_repo: PracticeRepository,
    grammar_repo: GrammarRepository,
) -> dict:
    filename = f"rec_{task_id}_{int(time.time())}.webm"
    logger.info("speaking analyze task_id=%s task_type=%s audio_size=%d", task_id, task_type, len(audio_bytes))

    # Save recording to persistent volume so it can be played back later
    recordings_dir = Path("/recordings")
    recordings_dir.mkdir(parents=True, exist_ok=True)
    (recordings_dir / filename).write_bytes(audio_bytes)

    if len(audio_bytes) < 100:
        logger.warning("speaking analyze: empty recording task_id=%s", task_id)
        return {
            "status": "error",
            "message": "Recording empty — mic may not have captured audio",
            "transcript": "", "rubric_score": 1,
            "rubric_rationale": "No audio captured.",
            "pronunciation_score": 1, "fluency_score": 1,
            "grammar_score": 1, "vocabulary_score": 1,
            "intonation_score": 1, "discourse_score": 1, "_error": "empty_recording",
        }

    # Speech analysis
    t0 = time.perf_counter()
    try:
        result = await speech_client.analyze_practice(
            audio_bytes=audio_bytes,
            filename=filename,
            task_type=task_type,
            topic=topic,
            expected_answer=expected_answer,
        )
        ms = (time.perf_counter() - t0) * 1000
        logger.info("speech analyzer ok task_id=%s latency=%.0fms", task_id, ms)
    except SpeechAnalyzerError as exc:
        ms = (time.perf_counter() - t0) * 1000
        logger.error("speech analyzer failed task_id=%s latency=%.0fms error=%s", task_id, ms, exc)
        raise

    # Quality gate early-exit — do NOT score, return RECORD_AGAIN to client
    if result.get("status") == "RECORD_AGAIN":
        logger.info("speaking quality gate task_id=%s reason=%s", task_id, result.get("message"))
        return {
            "status": "RECORD_AGAIN",
            "message": result.get("message", "Please re-record."),
            "quality": result.get("quality", {}),
        }

    accuracy  = result.get("accuracy") or {}
    pron_r    = result.get("pronunciation") or {}
    fluency_r = result.get("fluency") or {}
    gram_r    = result.get("grammar") or {}
    vocab_r   = result.get("vocabulary") or {}
    inton_r   = result.get("intonation") or {}
    disc_r    = result.get("discourse") or {}

    flat = {
        "status": "ok",
        "session_id": result.get("session_id"),
        "transcript": result.get("transcript", ""),
        "recording_filename": filename,
        "overall_score": result.get("overall", 0),
        "pronunciation_score": round(pron_r.get("score", 0)),
        "fluency_score":       round(fluency_r.get("score", 0)),
        "grammar_score":       round(gram_r.get("score", 0)),
        "vocabulary_score":    round(vocab_r.get("score", 0)),
        "intonation_score":    round(inton_r.get("score", 0)),
        "discourse_score":     round(disc_r.get("score", 0)),
        "wpm":           fluency_r.get("wpm"),
        "cefr_level":    vocab_r.get("cefr_level"),
        "word_accuracy": accuracy.get("word_accuracy"),
        "missing_words": accuracy.get("missing_words", []),
        # ETS-aligned dimension groupings
        "scoring_mode":   result.get("scoring_mode", "legacy"),
        "ets_dimensions": result.get("ets_dimensions", {}),
        # Extra detail for frontend display
        "filler_count":       fluency_r.get("filler_count", 0),
        "pause_count":        fluency_r.get("pause_count", 0),
        "repetition_count":   fluency_r.get("repetition_count", 0),
        "marker_count":       disc_r.get("marker_count", 0),
        "markers_found":      disc_r.get("markers_found", []),
        "has_structure":      disc_r.get("has_structure", False),
        "has_example":        disc_r.get("has_example", False),
        "coherence_tip":      disc_r.get("coherence_tip", ""),
        "marker_tip":         disc_r.get("marker_tip", ""),
        "grammatical_range":  gram_r.get("grammatical_range", {}),
        "synonym_suggestions": vocab_r.get("synonym_suggestions", []),
        "vocabulary_diversity": vocab_r.get("vocabulary_diversity", {}),
    }

    # Rubric scoring via LLM — now with full context
    rubric_prompt = _build_rubric_prompt(
        task_type=task_type,
        expected_answer=expected_answer,
        flat=flat,
        accuracy=accuracy,
        fluency_detail=fluency_r,
        gram_detail=gram_r,
        vocab_detail=vocab_r,
        disc_detail=disc_r,
    )
    graded = _call_rubric_llm(rubric_prompt, task_type)

    if graded:
        task_raw = _compute_rubric_score(graded, task_type)
        if task_raw < 0:
            # dimension scores missing — fall back to acoustic overall
            ov = result.get("overall", 0)
            # map acoustic 1-6 scale roughly to 0-5 raw
            task_raw = round(max(0.0, min(5.0, (ov - 1) / 5 * 5)), 2) if ov else 0.0
            rubric_rationale = "LLM dimension scores incomplete — using acoustic score"
            logger.warning("speaking: LLM missing dimension scores task_id=%s", task_id)
        else:
            rubric_rationale = graded.get("rubric_rationale", "")
    else:
        ov = result.get("overall", 0)
        task_raw = round(max(0.0, min(5.0, (ov - 1) / 5 * 5)), 2) if ov else 0.0
        rubric_rationale = "LLM unavailable — using acoustic score"
        logger.warning("speaking: using fallback acoustic rubric task_id=%s", task_id)

    band_score = estimated_band(task_raw)
    # rubric_score stored as integer band×10 for backward compat with DB int column
    # but we expose the float band to the frontend
    rubric_score = round(band_score)

    flat["task_raw_score"]   = task_raw        # 0-5 per-task raw (official scale)
    flat["estimated_band"]   = band_score      # 1.0-6.0 from lookup table
    flat["rubric_score"]     = rubric_score    # integer 1-6 stored in DB
    flat["rubric_rationale"] = rubric_rationale
    flat["prompt_version"]   = SPEAKING_PROMPT_VERSION

    # Readiness fields from LLM
    if graded:
        flat["readiness_score"] = graded.get("readiness_score")
        flat["readiness_level"] = graded.get("readiness_level")
        flat["strengths"]       = graded.get("strengths", [])
        flat["priority_issues"] = graded.get("priority_issues", [])

    # Store LLM per-dimension scores for frontend display
    if graded:
        if task_type == "Take an Interview":
            flat["llm_dimension_scores"] = {
                "fluency":        graded.get("fluency_score"),
                "intelligibility": graded.get("intelligibility_score"),
                "language_use":   graded.get("language_use_score"),
                "organization":   graded.get("organization_score"),
            }
        elif task_type == "Listen and Repeat":
            flat["llm_dimension_scores"] = {
                "fluency":          graded.get("fluency_score"),
                "intelligibility":  graded.get("intelligibility_score"),
                "repeat_accuracy":  graded.get("repeat_accuracy_score"),
            }

    # Persist — core saves must propagate errors; optional enrichment is best-effort
    try:
        task_row   = practice_repo.get_task(int(task_id))
        topic_tags = task_row["tags"] if task_row else topic

        practice_id = practice_repo.insert_practice(
            section="Speaking", task_type=task_type,
            prompt=expected_answer or topic,
            response=flat.get("transcript", ""),
            score=rubric_score, feedback=rubric_rationale, tags=topic_tags,
        )
        practice_repo.insert_speech_log(
            practice_log_id=practice_id,
            filename=filename,
            transcript=flat.get("transcript", ""),
            overall_score=flat.get("overall_score", 0),
            pronunciation_score=flat.get("pronunciation_score"),
            fluency_score=flat.get("fluency_score"),
            grammar_score=flat.get("grammar_score"),
            vocabulary_score=flat.get("vocabulary_score"),
            intonation_score=flat.get("intonation_score"),
            discourse_score=disc_r.get("score"),
            wpm=flat.get("wpm"),
            cefr_level=flat.get("cefr_level"),
            task_type=task_type,
            topic=topic,
            expected_answer=expected_answer,
            task_raw_score=flat.get("task_raw_score"),
            estimated_band=flat.get("estimated_band"),
            readiness_score=flat.get("readiness_score"),
            readiness_level=flat.get("readiness_level"),
            priority_issues=json.dumps(flat.get("priority_issues", [])) if flat.get("priority_issues") else None,
            prompt_version=flat.get("prompt_version"),
        )
        flat["practice_log_id"] = practice_id
        logger.info("speaking saved practice_id=%s task_id=%s score=%d", practice_id, task_id, rubric_score)
    except Exception as exc:
        # Core DB save failed — surface this to the caller so the client knows
        logger.error("speaking DB save failed task_id=%s error=%s", task_id, exc)
        flat["db_save_error"] = str(exc)[:120]
        return flat  # return early — optional enrichment below requires practice_id

    # Optional enrichment — failures here are logged but don't fail the response
    try:
        # Save word timestamps so the detail page can seek to the exact wrong sentence
        words = result.get("words")
        if words:
            import json as _json
            practice_repo.update_words_json(practice_id, _json.dumps(words))

        if task_type == "Take an Interview":
            model_answer = (graded.get("model_answer") or "").strip() if graded else ""
            if model_answer:
                practice_repo.update_expected_answer(practice_id, model_answer)
                flat["model_answer"] = model_answer

            mistakes = graded.get("grammar_mistakes", []) if graded else []
            for mistake in mistakes:
                gtype       = normalize_grammar_type(mistake.get("grammar_type", ""))
                raw_sub     = (mistake.get("sub_type") or "").strip()
                sub_type    = normalize_sub_type(gtype, raw_sub)   # '' if unrecognised
                wrong       = (mistake.get("wrong_sentence") or "").strip()
                correct     = (mistake.get("correct_sentence") or "").strip()
                explanation = (mistake.get("explanation") or "").strip()
                if wrong and correct:
                    grammar_repo.upsert_mistake_speaking(
                        wrong=wrong, correct=correct,
                        grammar_type=gtype, sub_type=sub_type, explanation=explanation,
                        practice_log_id=practice_id,
                    )
            if mistakes:
                logger.info("speaking interview grammar_mistakes=%d task_id=%s", len(mistakes), task_id)
    except Exception as exc:
        logger.warning("speaking enrichment failed practice_id=%s error=%s", practice_id, exc)

    return flat


def get_recommended_speaking_task(
    *, task_type: str, practice_repo: PracticeRepository,
) -> dict:
    """Return the best topic to practice next."""
    topics = practice_repo.list_topic_tags_by_type(task_type)
    if not topics:
        logger.warning("no topics in task_bank task_type=%s", task_type)
        return {"task_id": None, "tags": None, "snippet": "", "reason": "No tasks available"}

    history  = practice_repo.get_practice_history_by_tags_field(task_type)
    practiced: dict = {r["tags"]: {"best": r["best_score"], "last": r["last_date"]} for r in history}

    never = [t for t in topics if t["tags"] not in practiced]
    if never:
        t    = never[0]
        name = _topic_name(t["tags"])
        return {"task_id": t["first_task_id"], "tags": t["tags"], "snippet": name, "reason": "New topic — never practiced"}

    scored = [
        (t, practiced[t["tags"]]["best"] or 0, practiced[t["tags"]]["last"])
        for t in topics if t["tags"] in practiced
    ]
    scored.sort(key=lambda x: (x[1], x[2]))
    t, best, _ = scored[0]
    name       = _topic_name(t["tags"])
    score_str  = f"{best:.1f}" if best else "unscored"
    return {"task_id": t["first_task_id"], "tags": t["tags"], "snippet": name, "reason": f"Needs improvement — best score {score_str}"}


def _topic_name(tags: str) -> str:
    parts = [p.strip() for p in tags.split(",")]
    slug  = parts[-1] if parts else tags
    return slug.replace("-", " ").title()
