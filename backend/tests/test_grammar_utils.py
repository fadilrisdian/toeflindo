"""Tests for app.utils.grammar — normalize_grammar_type and normalize_sub_type."""
import pytest

from app.utils.grammar import (
    VALID_SUB_TYPES,
    normalize_grammar_type,
    normalize_sub_type,
    sub_type_prompt_block,
    sub_type_prompt_block_inline,
)


# ── normalize_grammar_type ────────────────────────────────────────────────────

class TestNormalizeGrammarType:
    def test_canonical_types_pass_through(self):
        assert normalize_grammar_type("Article Error") == "Articles"
        assert normalize_grammar_type("Verb Tense Error") == "Tenses"
        assert normalize_grammar_type("Run-on Sentence") == "Sentence Structure"

    def test_legacy_aliases_mapped(self):
        assert normalize_grammar_type("Word Form Error") == "Verb Forms"
        assert normalize_grammar_type("Tense Error") == "Tenses"
        assert normalize_grammar_type("Singular/Plural Error") == "Plurals"
        assert normalize_grammar_type("Word choice") == "Vocabulary"
        assert normalize_grammar_type("Sentence structure") == "Sentence Structure"

    def test_unknown_type_returns_as_is(self):
        assert normalize_grammar_type("Some Unknown Type") == "Some Unknown Type"

    def test_empty_string_returns_as_is(self):
        assert normalize_grammar_type("") == ""


# ── normalize_sub_type ────────────────────────────────────────────────────────

class TestNormalizeSubType:

    # ── Happy path: canonical values ──────────────────────────────────────────

    def test_canonical_sub_type_accepted(self):
        assert normalize_sub_type("Verb Tense Error", "past simple") == "past simple"
        assert normalize_sub_type("Article Error", "a/an") == "a/an"
        assert normalize_sub_type("Modal Error", "should advice") == "should advice"

    def test_canonical_sub_type_via_category_name(self):
        # grammar_type may already be the normalized category string
        assert normalize_sub_type("Tenses", "past simple") == "past simple"
        assert normalize_sub_type("Articles", "the") == "the"

    # ── Spacing/capitalisation variants ───────────────────────────────────────

    def test_verb_plus_ing_spacing_variants(self):
        assert normalize_sub_type("Verb Form Error", "verb+ing") == "verb + ing"
        assert normalize_sub_type("Verb Form Error", "Verb + ING") == "verb + ing"

    def test_verb_plus_infinitive_variants(self):
        assert normalize_sub_type("Verb Form Error", "verb+infinitive") == "verb + infinitive"
        assert normalize_sub_type("Verb Form Error", "to infinitive") == "verb + infinitive"

    def test_tense_aliases(self):
        assert normalize_sub_type("Verb Tense Error", "present simple/continuous") == "present simple vs continuous"
        assert normalize_sub_type("Verb Tense Error", "present perfect/past") == "present perfect vs past"
        assert normalize_sub_type("Verb Tense Error", "future (will)") == "future will"
        assert normalize_sub_type("Verb Tense Error", "future (going to)") == "future going to"

    def test_modal_aliases(self):
        assert normalize_sub_type("Modal Error", "have to / must") == "have to/must obligation"
        assert normalize_sub_type("Modal Error", "can / could") == "can/could ability"

    def test_misc_aliases(self):
        assert normalize_sub_type("Subject-Verb Agreement", "subject verb agreement") == "subject-verb agreement"
        assert normalize_sub_type("Plural/Singular Error", "singular plural") == "singular/plural"
        assert normalize_sub_type("Pronoun Error", "reflexive") == "reflexive pronoun"

    # ── New sub_types (Flaw 6 + 7 fixes) ─────────────────────────────────────

    def test_conditional_maps_to_verb_tense_error(self):
        assert normalize_sub_type("Verb Tense Error", "conditional") == "conditional"
        assert normalize_sub_type("Verb Tense Error", "if clause") == "conditional"
        assert normalize_sub_type("Verb Tense Error", "if-clause") == "conditional"

    def test_word_choice_new_sub_types(self):
        assert normalize_sub_type("Word Choice", "collocation") == "collocation"
        assert normalize_sub_type("Word Choice", "collocations") == "collocation"
        assert normalize_sub_type("Word Choice", "word register") == "word register"
        assert normalize_sub_type("Word Choice", "register") == "word register"
        assert normalize_sub_type("Word Choice", "idiomatic expression") == "idiomatic expression"
        assert normalize_sub_type("Word Choice", "idiom") == "idiomatic expression"
        assert normalize_sub_type("Word Choice", "idiomatic") == "idiomatic expression"

    # ── Cross-validation: sub_type from wrong category ────────────────────────

    def test_sub_type_wrong_category_returns_empty(self):
        # past simple belongs to Tenses, not Articles
        assert normalize_sub_type("Article Error", "past simple") == ""
        # reflexive pronoun belongs to Pronouns, not Modals
        assert normalize_sub_type("Modal Error", "reflexive pronoun") == ""
        # subject-verb agreement belongs to S-V Agreement, not Verb Forms
        assert normalize_sub_type("Verb Form Error", "subject-verb agreement") == ""

    def test_conditional_under_wrong_grammar_type_returns_empty(self):
        # conditional is now in Verb Tense Error, NOT in Run-on Sentence
        # (we removed it from Sentence Structure in this fix)
        # Verify it rejects for Article Error at minimum
        assert normalize_sub_type("Article Error", "conditional") == ""

    # ── Empty / unknown ───────────────────────────────────────────────────────

    def test_empty_sub_type_returns_empty(self):
        assert normalize_sub_type("Verb Tense Error", "") == ""
        assert normalize_sub_type("Verb Tense Error", "   ") == ""

    def test_unknown_sub_type_returns_empty(self):
        assert normalize_sub_type("Verb Tense Error", "totally unknown thing") == ""
        assert normalize_sub_type("Article Error", "Write an Email") == ""
        assert normalize_sub_type("Article Error", "Vocabulary") == ""

    def test_stale_category_names_cleared(self):
        """Old broad category names accidentally stored as sub_type must not pass through."""
        for stale in ["Tenses", "Vocabulary", "Articles", "Plurals", "Word Order"]:
            result = normalize_sub_type("Verb Tense Error", stale)
            assert result == "", f"Expected '' for stale sub_type {stale!r}, got {result!r}"

    def test_task_type_strings_cleared(self):
        """Task type strings accidentally stored as sub_type must not pass through."""
        for task_type in ["Write an Email", "Build a Sentence", "Take an Interview"]:
            result = normalize_sub_type("Verb Tense Error", task_type)
            assert result == "", f"Expected '' for task_type sub_type {task_type!r}, got {result!r}"


# ── VALID_SUB_TYPES consistency ───────────────────────────────────────────────

class TestValidSubTypesConsistency:

    def test_all_grammar_types_have_sub_types(self):
        assert len(VALID_SUB_TYPES) > 0
        for gtype, sub_types in VALID_SUB_TYPES.items():
            assert len(sub_types) > 0, f"{gtype} has no sub_types"

    def test_no_duplicate_sub_types_within_category(self):
        for gtype, sub_types in VALID_SUB_TYPES.items():
            assert len(sub_types) == len(set(sub_types)), \
                f"{gtype} has duplicate sub_types: {sub_types}"

    def test_all_canonical_sub_types_round_trip(self):
        """Every value in VALID_SUB_TYPES should pass normalize_sub_type for its own category."""
        for gtype, sub_types in VALID_SUB_TYPES.items():
            for s in sub_types:
                result = normalize_sub_type(gtype, s)
                assert result == s, \
                    f"normalize_sub_type({gtype!r}, {s!r}) returned {result!r}, expected {s!r}"


# ── Prompt block generators ───────────────────────────────────────────────────

class TestPromptBlockGenerators:

    def test_sub_type_prompt_block_contains_all_types(self):
        block = sub_type_prompt_block()
        for gtype in VALID_SUB_TYPES:
            assert gtype in block, f"{gtype} missing from prompt block"

    def test_sub_type_prompt_block_exclude(self):
        block = sub_type_prompt_block(exclude_grammar_types={"Word Order"})
        assert "Word Order" not in block
        assert "Article Error" in block

    def test_sub_type_prompt_block_inline_is_single_line_style(self):
        inline = sub_type_prompt_block_inline()
        # Should use semicolons to separate categories, not newlines
        assert ";" in inline
        assert "Article Error" in inline

    def test_sub_type_prompt_block_inline_exclude(self):
        inline = sub_type_prompt_block_inline(exclude_grammar_types={"Word Order", "Pronoun Error"})
        assert "Word Order" not in inline
        assert "Pronoun Error" not in inline
        assert "Modal Error" in inline
