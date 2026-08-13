"""Tests for app/clients/llm.py — call_llm, call_llm_json, _parse_json.

All tests mock litellm.completion / the proxy so no real HTTP calls are made.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.clients.llm import _parse_json, call_llm, call_llm_json
from app.core.exceptions import LLMError


# ── helpers ───────────────────────────────────────────────────────────────────

def _mock_resp(content: str):
    """Build a fake litellm response with choices[0].message.content."""
    msg = SimpleNamespace(content=content)
    choice = SimpleNamespace(message=msg)
    return SimpleNamespace(choices=[choice])


def _patch_completion(content: str):
    """Patch app.clients.llm.completion to return a fixed response."""
    return patch("app.clients.llm.completion", return_value=_mock_resp(content))


# ── _parse_json ───────────────────────────────────────────────────────────────

class TestParseJson:
    def test_plain_json(self):
        assert _parse_json('{"a": 1}') == {"a": 1}

    def test_code_fence(self):
        assert _parse_json('```json\n{"a": 1}\n```') == {"a": 1}

    def test_embedded_in_prose(self):
        assert _parse_json('Here is the result: {"a": 1} done.') == {"a": 1}

    def test_think_tags_stripped(self):
        assert _parse_json('<think>reasoning</think>{"a": 1}') == {"a": 1}

    def test_think_tag_only_json_inside(self):
        assert _parse_json('<think>{"a": 1}</think>') == {"a": 1}

    def test_raises_on_no_json(self):
        with pytest.raises(ValueError, match="No valid JSON"):
            _parse_json("This has no JSON at all")

    def test_nested_object(self):
        data = {"score": 4.5, "items": [{"a": 1}]}
        assert _parse_json(json.dumps(data)) == data


# ── call_llm ──────────────────────────────────────────────────────────────────

class TestCallLlm:
    def test_returns_content_string(self):
        with _patch_completion("hello world"):
            result = call_llm(messages=[{"role": "user", "content": "hi"}])
        assert result == "hello world"

    def test_strips_think_blocks(self):
        with _patch_completion("<think>hidden</think>actual content"):
            result = call_llm(messages=[{"role": "user", "content": "hi"}])
        assert result == "actual content"

    def test_skips_empty_tries_next_model(self):
        call_count = 0
        responses = ["", "second model response"]

        def fake_completion(**kwargs):
            nonlocal call_count
            resp = responses[call_count]
            call_count += 1
            return _mock_resp(resp)

        with patch("app.clients.llm.completion", side_effect=fake_completion):
            result = call_llm(
                messages=[{"role": "user", "content": "hi"}],
                models=["openai/model-a", "openai/model-b"],
            )
        assert result == "second model response"
        assert call_count == 2

    def test_raises_llmerror_when_all_fail(self):
        with patch("app.clients.llm.completion", side_effect=Exception("boom")):
            with pytest.raises(LLMError, match="All LLM models failed"):
                call_llm(
                    messages=[{"role": "user", "content": "hi"}],
                    models=["openai/model-a"],
                )

    def test_raises_llmerror_when_all_empty(self):
        with _patch_completion(""):
            with pytest.raises(LLMError, match="All LLM models failed"):
                call_llm(
                    messages=[{"role": "user", "content": "hi"}],
                    models=["openai/model-a"],
                )

    def test_json_mode_false_skips_response_format(self):
        """json_mode=False must not add response_format kwarg."""
        captured = {}

        def fake_completion(**kwargs):
            captured.update(kwargs)
            return _mock_resp("plain text")

        with patch("app.clients.llm.completion", side_effect=fake_completion):
            call_llm(
                messages=[{"role": "user", "content": "hi"}],
                models=["openai/gpt-oss-120b"],
                json_mode=False,
            )
        assert "response_format" not in captured

    def test_json_mode_true_adds_response_format_for_supported_model(self):
        """json_mode=True + gpt-oss tag → response_format injected."""
        captured = {}

        def fake_completion(**kwargs):
            captured.update(kwargs)
            return _mock_resp('{"ok": true}')

        with patch("app.clients.llm.completion", side_effect=fake_completion):
            call_llm(
                messages=[{"role": "user", "content": "hi"}],
                models=["openai/gpt-oss-120b"],
                json_mode=True,
            )
        assert captured.get("response_format") == {"type": "json_object"}

    def test_custom_models_override_fallback_chain(self):
        called_models = []

        def fake_completion(**kwargs):
            called_models.append(kwargs["model"])
            return _mock_resp("ok")

        with patch("app.clients.llm.completion", side_effect=fake_completion):
            call_llm(
                messages=[{"role": "user", "content": "hi"}],
                models=["openai/custom-a"],
            )
        assert called_models == ["openai/custom-a"]


# ── call_llm_json ─────────────────────────────────────────────────────────────

class TestCallLlmJson:
    def test_returns_parsed_dict(self):
        with _patch_completion('{"score": 4.0, "feedback": "good"}'):
            result = call_llm_json(
                messages=[{"role": "user", "content": "score this"}],
                models=["openai/gpt-oss-120b"],
            )
        assert result == {"score": 4.0, "feedback": "good"}

    def test_raises_llmerror_on_invalid_json(self):
        with _patch_completion("not json at all"):
            with pytest.raises(LLMError, match="non-JSON"):
                call_llm_json(
                    messages=[{"role": "user", "content": "hi"}],
                    models=["openai/gpt-oss-120b"],
                )

    def test_handles_code_fenced_json(self):
        with _patch_completion('```json\n{"verdict": "correct"}\n```'):
            result = call_llm_json(
                messages=[{"role": "user", "content": "hi"}],
                models=["openai/gpt-oss-120b"],
            )
        assert result == {"verdict": "correct"}

    def test_raises_llmerror_when_all_models_fail(self):
        with patch("app.clients.llm.completion", side_effect=Exception("network error")):
            with pytest.raises(LLMError):
                call_llm_json(
                    messages=[{"role": "user", "content": "hi"}],
                    models=["openai/model-a"],
                )


# ── service integration (mocked LLM) ─────────────────────────────────────────

class TestGrammarServiceLlm:
    def test_explain_mistake_returns_string(self):
        from app.services.grammar_service import explain_mistake
        with _patch_completion("The verb tense is wrong because past simple requires 'went'."):
            result = explain_mistake(
                wrong="I go to school yesterday",
                correct="I went to school yesterday",
                grammar_type="Verb Tense Error",
            )
        assert isinstance(result, str)
        assert len(result) > 0

    def test_evaluate_grammar_correct_verdict(self):
        from app.services.grammar_service import evaluate_grammar
        with _patch_completion('{"verdict": "correct", "feedback": "Well done!"}'):
            result = evaluate_grammar(
                user_answer="She goes to school every day.",
                correct="She goes to school every day.",
                wrong="She go to school every day.",
                category="Subject-Verb Agreement",
            )
        assert result["verdict"] == "correct"

    def test_evaluate_grammar_fallback_on_llm_error(self):
        from app.services.grammar_service import evaluate_grammar
        with patch("app.clients.llm.completion", side_effect=Exception("down")):
            result = evaluate_grammar(
                user_answer="She goes to school every day.",
                correct="She goes to school every day.",
                wrong="She go to school every day.",
                category="Subject-Verb Agreement",
            )
        # fallback: exact string match → correct
        assert result["verdict"] in ("correct", "wrong")
        assert result.get("fallback") is True


class TestWritingServiceLlm:
    def test_score_essay_returns_dict(self):
        from app.services.writing_service import score_essay
        payload = {
            "score": 4.0,
            "feedback": "Good job.",
            "strengths": ["Clear structure"],
            "improvements": ["Add more detail"],
            "corrected_version": "...",
            "grammar_mistakes": [],
        }
        with _patch_completion(json.dumps(payload)):
            result = score_essay(
                task_type="Write an Email",
                prompt_text="Write to your professor.",
                essay="Dear Professor, I am writing to ask about the deadline.",
            )
        assert result["score"] == 4.0
        assert "feedback" in result

    def test_score_essay_raises_llmerror_on_failure(self):
        from app.services.writing_service import score_essay
        from app.core.exceptions import LLMError
        with patch("app.clients.llm.completion", side_effect=Exception("timeout")):
            with pytest.raises(LLMError):
                score_essay(
                    task_type="Write an Email",
                    prompt_text="Write to your professor.",
                    essay="Dear Professor, I am writing.",
                )


class TestFocusDrillServiceLlm:
    def test_evaluate_sentence_combining_returns_dict(self):
        from app.services.focus_drill_service import evaluate_sentence_combining
        payload = {"correct": True, "clause_count": 2, "feedback": "Great!", "error_type": None}
        with _patch_completion(json.dumps(payload)):
            result = evaluate_sentence_combining(
                sentences=["The student studied.", "She passed the exam."],
                user_answer="The student studied because she wanted to pass the exam.",
                connector_used="because",
            )
        assert result["correct"] is True

    def test_evaluate_collocation_returns_dict(self):
        from app.services.focus_drill_service import evaluate_collocation
        payload = {"correct": True, "feedback": "Well used!", "register_ok": True}
        with _patch_completion(json.dumps(payload)):
            result = evaluate_collocation(
                phrase="take into account",
                user_sentence="We should take into account all the factors.",
                task_type="discussion",
            )
        assert result["correct"] is True


class TestSpeechModulesLlm:
    def test_grammar_analyze_returns_score(self):
        from app.services.speech.grammar import analyze
        payload = {
            "score": 4.0,
            "feedback": ["Good"],
            "corrections": [],
            "complexity_note": "OK",
            "grammatical_range": {
                "score": 3.5,
                "conjunctions_used": ["because"],
                "has_complex_sentence": True,
                "has_conditional": False,
                "range_tip": "Use more variety.",
            },
        }
        with _patch_completion(json.dumps(payload)):
            result = analyze("I go to school every day because I like learning.")
        assert result["score"] == 4.0
        assert "grammatical_range" in result

    def test_grammar_analyze_fallback_on_error(self):
        from app.services.speech.grammar import analyze
        with patch("app.clients.llm.completion", side_effect=Exception("down")):
            result = analyze("I go to school every day.")
        assert result["score"] == 3.0  # fallback default
        assert "Grammar analysis unavailable" in result["feedback"][0]

    def test_vocabulary_analyze_returns_score(self):
        from app.services.speech.vocabulary import analyze
        payload = {
            "score": 4.5,
            "feedback": ["Good range"],
            "cefr_level": "B2",
            "suggestions": [],
            "repeated_words": [],
            "synonym_suggestions": [],
            "vocabulary_diversity": {"score": 4.0, "type_token_ratio": 0.6, "diversity_tip": "Good."},
        }
        with _patch_completion(json.dumps(payload)):
            result = analyze("The research demonstrates significant improvements in academic performance.")
        assert result["score"] == 4.5
        assert result["cefr_level"] == "B2"

    def test_discourse_analyze_returns_score(self):
        from app.services.speech.discourse import analyze
        payload = {
            "score": 4.0,
            "coherence_score": 4.0,
            "marker_score": 4.0,
            "feedback": ["Good structure"],
            "has_structure": True,
            "has_example": True,
            "coherence_tip": "Keep it up.",
            "marker_tip": "Use more markers.",
        }
        with _patch_completion(json.dumps(payload)):
            result = analyze("In my opinion, education is important. For example, it helps people get jobs.")
        assert result["score"] == 4.0
        assert result["has_structure"] is True
        assert result["marker_count"] >= 1  # "for example" detected algorithmically

    def test_discourse_analyze_fallback_on_error(self):
        from app.services.speech.discourse import analyze
        with patch("app.clients.llm.completion", side_effect=Exception("down")):
            result = analyze("In my opinion, education is important. For example, it helps.")
        assert "score" in result
        assert result["score"] >= 1.0
