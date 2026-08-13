"""Unit tests for speech analysis modules — no audio files, no external calls."""
import pytest


# ── fluency.analyze ───────────────────────────────────────────────────────────

class TestFluencyAnalyze:

    def _words(self, texts: list[str], gap: float = 0.1) -> list[dict]:
        """Build synthetic word list with tight timing."""
        words = []
        t = 0.0
        for w in texts:
            dur = 0.3
            words.append({"word": w, "start": round(t, 3), "end": round(t + dur, 3)})
            t += dur + gap
        return words

    def test_empty_words_returns_score_1(self):
        from app.services.speech.fluency import analyze
        result = analyze([], total_duration=1.0)
        assert result["score"] == 1.0
        assert result["wpm"] == 0

    def test_normal_speech_score_range(self):
        from app.services.speech.fluency import analyze
        words = self._words(["the"] * 20, gap=0.05)  # ~120 WPM
        result = analyze(words)
        assert 1.0 <= result["score"] <= 6.0
        assert result["wpm"] > 0

    def test_slow_speech_penalised(self):
        from app.services.speech.fluency import analyze
        # Very slow: 10 words over 20 seconds = 30 WPM
        words = [{"word": "the", "start": float(i * 2), "end": float(i * 2 + 0.3)} for i in range(10)]
        result = analyze(words)
        assert result["score"] <= 4.0

    def test_fast_speech_slight_penalty(self):
        from app.services.speech.fluency import analyze
        # Very fast: 30 words in 3 seconds = 600 WPM
        words = [{"word": "word", "start": i * 0.1, "end": i * 0.1 + 0.08} for i in range(30)]
        result = analyze(words)
        assert 1.0 <= result["score"] <= 6.0

    def test_pauses_detected(self):
        from app.services.speech.fluency import analyze
        words = [
            {"word": "hello", "start": 0.0, "end": 0.5},
            {"word": "world", "start": 2.0, "end": 2.5},  # 1.5s gap — long pause
        ]
        result = analyze(words)
        assert result["pause_count"] >= 1

    def test_filler_words_detected(self):
        from app.services.speech.fluency import analyze
        words = self._words(["um", "uh", "I", "think"])
        result = analyze(words)
        assert result["filler_count"] >= 2

    def test_feedback_list_not_empty(self):
        from app.services.speech.fluency import analyze
        words = self._words(["hello", "world", "this", "is", "a", "test"])
        result = analyze(words)
        assert isinstance(result["feedback"], list)
        assert len(result["feedback"]) >= 1

    def test_repetition_detected(self):
        from app.services.speech.fluency import analyze
        words = self._words(["hello", "hello", "world", "world", "world"])
        result = analyze(words)
        assert result["repetition_count"] >= 1

    def test_score_clamped_to_range(self):
        from app.services.speech.fluency import analyze
        # Pathological input: max penalties
        words = [
            {"word": "um", "start": 0.0, "end": 0.1},
            {"word": "uh", "start": 5.0, "end": 5.1},
            {"word": "um", "start": 10.0, "end": 10.1},
        ]
        result = analyze(words)
        assert 1.0 <= result["score"] <= 6.0


# ── pronunciation.analyze ─────────────────────────────────────────────────────

class TestPronunciationAnalyze:

    def test_no_words_returns_score_1(self, mocker):
        mocker.patch(
            "app.services.speech.pronunciation.get_word_timestamps",
            return_value=[],
        )
        from app.services.speech.pronunciation import analyze
        result = analyze("/fake/path.wav", "hello world")
        assert result["score"] == 1.0
        assert result["low_confidence_words"] == []

    def test_high_confidence_gives_high_score(self, mocker):
        mocker.patch(
            "app.services.speech.pronunciation.get_word_timestamps",
            return_value=[
                {"word": "hello", "start": 0.0, "end": 0.4, "probability": 0.98},
                {"word": "world", "start": 0.5, "end": 0.9, "probability": 0.97},
                {"word": "today", "start": 1.0, "end": 1.4, "probability": 0.99},
            ],
        )
        from app.services.speech.pronunciation import analyze
        result = analyze("/fake/path.wav", "hello world today")
        assert result["score"] >= 5.0
        assert result["avg_word_confidence"] >= 0.97

    def test_low_confidence_gives_low_score(self, mocker):
        mocker.patch(
            "app.services.speech.pronunciation.get_word_timestamps",
            return_value=[
                {"word": "hello", "start": 0.0, "end": 0.4, "probability": 0.45},
                {"word": "world", "start": 0.5, "end": 0.9, "probability": 0.40},
            ],
        )
        from app.services.speech.pronunciation import analyze
        result = analyze("/fake/path.wav", "hello world")
        assert result["score"] <= 2.0

    def test_low_confidence_words_flagged(self, mocker):
        mocker.patch(
            "app.services.speech.pronunciation.get_word_timestamps",
            return_value=[
                {"word": "clear",  "start": 0.0, "end": 0.3, "probability": 0.95},
                {"word": "mumble", "start": 0.4, "end": 0.7, "probability": 0.50},
            ],
        )
        from app.services.speech.pronunciation import analyze
        result = analyze("/fake/path.wav", "clear mumble")
        flagged = [w["word"] for w in result["low_confidence_words"]]
        assert "mumble" in flagged
        assert "clear" not in flagged

    def test_score_clamped(self, mocker):
        mocker.patch(
            "app.services.speech.pronunciation.get_word_timestamps",
            return_value=[
                {"word": "x", "start": 0.0, "end": 0.1, "probability": 0.0},
            ],
        )
        from app.services.speech.pronunciation import analyze
        result = analyze("/fake/path.wav", "x")
        assert 1.0 <= result["score"] <= 6.0


# ── speech.analyzer pipeline ──────────────────────────────────────────────────

class TestAnalyzerPipeline:

    @pytest.mark.asyncio
    async def test_analyze_practice_stt_failure_returns_score_1(self, mocker):
        """If STT fails, analyze_practice returns graceful 1.0 fallback."""
        mocker.patch(
            "app.services.speech.analyzer.save_upload",
            return_value="/tmp/fake.webm",
        )
        mocker.patch(
            "app.services.speech.analyzer.convert_to_wav",
            return_value="/tmp/fake.wav",
        )
        mocker.patch("app.services.speech.analyzer.cleanup")
        mocker.patch(
            "app.services.speech.analyzer.quality_check",
            return_value={"status": "OK"},
        )
        mocker.patch(
            "app.services.speech.analyzer.transcribe",
            side_effect=RuntimeError("Groq unavailable"),
        )

        from app.services.speech.analyzer import analyze_practice
        result = await analyze_practice(
            audio_bytes=b"x" * 600,
            filename="test.webm",
            task_type="Listen and Repeat",
            topic="test",
            expected_answer="Hello world",
        )
        assert result["overall"] == 1.0
        assert result["transcript"] == ""
        assert result["fluency"]["score"] == 1.0

    @pytest.mark.asyncio
    async def test_analyze_returns_5_dimensions(self, mocker):
        """Successful pipeline populates all 5 dimension keys."""
        mocker.patch("app.services.speech.analyzer.save_upload", return_value="/tmp/f.webm")
        mocker.patch("app.services.speech.analyzer.convert_to_wav", return_value="/tmp/f.wav")
        mocker.patch("app.services.speech.analyzer.cleanup")
        mocker.patch("app.services.speech.analyzer.get_duration", return_value=3.0)
        mocker.patch("app.services.speech.analyzer.transcribe", return_value={
            "text": "Welcome to the library.",
            "words": [
                {"word": "Welcome", "start": 0.0, "end": 0.4},
                {"word": "to",      "start": 0.5, "end": 0.6},
                {"word": "the",     "start": 0.7, "end": 0.8},
                {"word": "library", "start": 0.9, "end": 1.3},
            ],
            "segments": [], "language": "en",
        })
        mocker.patch("app.services.speech.analyzer.analyze_fluency", return_value={
            "score": 4.5, "feedback": ["Good"], "wpm": 130, "pause_count": 0,
            "long_pause_count": 0, "filler_count": 0, "filler_instances": [], "pauses": [],
        })
        mocker.patch("app.services.speech.analyzer.analyze_pronunciation", return_value={
            "score": 4.8, "feedback": ["Clear"], "low_confidence_words": [],
            "avg_word_confidence": 0.95,
        })
        mocker.patch("app.services.speech.analyzer.analyze_intonation", return_value={
            "score": 4.0, "feedback": ["Natural"], "pitch_stats": {},
            "energy_variation": 0.3, "tempo_bpm": 120.0,
        })
        mocker.patch("app.services.speech.analyzer.analyze_grammar", return_value={
            "score": 5.0, "feedback": ["No errors"], "corrections": [], "complexity_note": "",
            "grammatical_range": {"score": 5.0, "conjunctions_used": ["because"], "has_complex_sentence": True, "has_conditional": False, "range_tip": ""},
        })
        mocker.patch("app.services.speech.analyzer.analyze_vocabulary", return_value={
            "score": 4.0, "feedback": ["Good range"], "cefr_level": "B2",
            "suggestions": [], "repeated_words": [], "synonym_suggestions": [],
            "vocabulary_diversity": {"score": 4.0, "type_token_ratio": 0.7, "diversity_tip": ""},
        })
        mocker.patch("app.services.speech.analyzer.analyze_discourse", return_value={
            "score": 4.0, "coherence_score": 4.0, "marker_score": 4.0,
            "feedback": ["Good structure"], "has_structure": True, "has_example": False,
            "coherence_tip": "", "marker_tip": "", "markers_found": ["for example"], "marker_count": 1,
        })

        from app.services.speech.analyzer import analyze
        result = await analyze(audio_bytes=b"x" * 1100, filename="test.webm")

        assert "overall" in result
        assert 1.0 <= result["overall"] <= 6.0
        for dim in ["pronunciation", "fluency", "grammar", "vocabulary", "intonation", "discourse"]:
            assert dim in result
            assert "score" in result[dim]

    @pytest.mark.asyncio
    async def test_word_accuracy_computed(self, mocker):
        """analyze_practice computes word accuracy when expected_answer is given."""
        mocker.patch("app.services.speech.analyzer.save_upload", return_value="/tmp/f.webm")
        mocker.patch("app.services.speech.analyzer.convert_to_wav", return_value="/tmp/f.wav")
        mocker.patch("app.services.speech.analyzer.cleanup")
        mocker.patch("app.services.speech.analyzer.get_duration", return_value=2.0)
        mocker.patch(
            "app.services.speech.analyzer.quality_check",
            return_value={"status": "OK"},
        )
        mocker.patch("app.services.speech.analyzer.transcribe", return_value={
            "text": "hello world",
            "words": [
                {"word": "hello", "start": 0.0, "end": 0.4},
                {"word": "world", "start": 0.5, "end": 0.9},
            ],
            "segments": [], "language": "en",
        })
        for fn in ["analyze_fluency", "analyze_pronunciation", "analyze_intonation",
                   "analyze_grammar", "analyze_vocabulary"]:
            mocker.patch(f"app.services.speech.analyzer.{fn}", return_value={
                "score": 4.0, "feedback": [], "wpm": 120, "pause_count": 0,
                "long_pause_count": 0, "filler_count": 0, "filler_instances": [],
                "pauses": [], "repetition_count": 0, "repetitions": [],
                "low_confidence_words": [], "avg_word_confidence": 0.9,
                "corrections": [], "complexity_note": "", "cefr_level": "B2",
                "suggestions": [], "repeated_words": [], "synonym_suggestions": [],
                "vocabulary_diversity": {"score": 4.0, "type_token_ratio": 0.7, "diversity_tip": ""},
                "grammatical_range": {"score": 4.0, "conjunctions_used": [], "has_complex_sentence": False, "has_conditional": False, "range_tip": ""},
                "pitch_stats": {}, "energy_variation": 0.3, "tempo_bpm": 120.0,
            })
        mocker.patch("app.services.speech.analyzer.analyze_discourse", return_value={
            "score": 4.0, "coherence_score": 4.0, "marker_score": 4.0,
            "feedback": [], "has_structure": True, "has_example": False,
            "coherence_tip": "", "marker_tip": "", "markers_found": [], "marker_count": 0,
        })

        from app.services.speech.analyzer import analyze_practice
        result = await analyze_practice(
            audio_bytes=b"x" * 600,
            filename="test.webm",
            task_type="Listen and Repeat",
            topic="greeting",
            expected_answer="hello world",
        )

        assert "accuracy" in result
        assert result["accuracy"]["word_accuracy"] == 100.0
