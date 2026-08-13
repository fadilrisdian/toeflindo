"""Focus Drill service — LLM exercise generation for Sentence Combining,
Collocation review, and Phrase Bank drills."""
from __future__ import annotations

from app.clients.llm import call_llm_json
from app.core.exceptions import LLMError
from app.core.logging import get_logger

logger = get_logger(__name__)


# ── Flow 1 — Sentence Combining ───────────────────────────────────────────────

_CONNECTORS = [
    "although", "because", "while", "which", "in order to",
    "despite", "since", "whereas", "however", "even though",
]

_SC_SYSTEM = (
    "You are a TOEFL writing coach generating sentence-combining exercises. "
    "All sentences must use academic or professional email topics. "
    "Return ONLY valid JSON, no explanation."
)


def generate_sentence_combining() -> dict:
    """Generate a set of 3 simple sentences + model answer for combining.

    Returns:
        {
          sentences: [str, str, str],
          connectors: [str, ...],   # suggested chips
          model_answer: str,        # one possible combined sentence
          target_clauses: int       # clause count in model answer
        }
    """
    prompt = (
        "Create a sentence-combining exercise for a TOEFL writing student.\n\n"
        "Return a JSON object with these exact keys:\n"
        "- sentences: array of exactly 3 short simple sentences (academic/email topic, 6-12 words each)\n"
        "- connectors: array of 4 connector words the student could use (from: although, because, "
        "while, which, in order to, despite, since, whereas, however, even though)\n"
        "- model_answer: one fluent combined sentence using subordination (15-30 words)\n"
        "- target_clauses: integer count of clauses in model_answer\n\n"
        "Example topic areas: workplace communication, university deadlines, research projects, "
        "environmental policy, technology in education.\n"
        "The 3 sentences must be logically combinable.\n\n"
        "Output the JSON object immediately, no explanation."
    )
    return call_llm_json(
        messages=[
            {"role": "system", "content": _SC_SYSTEM + " Output the JSON immediately without any preamble or explanation."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.8,
        label="sentence_combining_generate",
    )


def evaluate_sentence_combining(*, sentences: list[str], user_answer: str,
                                 connector_used: str) -> dict:
    """Check user's combined sentence for grammaticality and clause count.

    Returns:
        {
          correct: bool,
          clause_count: int,
          feedback: str,          # 1-2 sentences
          error_type: str | null  # e.g. "run-on", "fragment", "wrong_subordinator"
        }
    """
    prompt = (
        f"Original sentences:\n" + "\n".join(f"  {i+1}. {s}" for i, s in enumerate(sentences)) +
        f"\n\nConnector used: {connector_used.replace(chr(10), ' ')}\n"
        f"Student's combined sentence: {user_answer.replace(chr(10), ' ')}\n\n"
        "Evaluate the combined sentence. Return JSON with:\n"
        "- correct: true if grammatically sound, connector used correctly, no run-on/fragment\n"
        "- clause_count: integer number of clauses in the student's sentence\n"
        "- feedback: 1-2 sentence explanation (encouraging tone)\n"
        "- error_type: one of [\"run-on\", \"fragment\", \"wrong_subordinator\", "
        "\"missing_information\", \"word_order\", null] — null if correct"
    )
    return call_llm_json(
        messages=[
            {"role": "system", "content": "You are a TOEFL writing evaluator. Return ONLY valid JSON."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        label="sentence_combining_evaluate",
    )


# ── Flow 2 — Collocation review ───────────────────────────────────────────────

def generate_collocation_exercise(*, phrase: str) -> dict:
    """Generate 2 context sentences the student must write using the phrase.

    Returns:
        {
          phrase: str,
          contexts: [
            {task_type: "email"|"discussion", instruction: str},
            {task_type: "email"|"discussion", instruction: str},
          ]
        }
    """
    prompt = (
        f'Generate a collocation review exercise for the phrase: "{phrase}"\n\n'
        "Return JSON with:\n"
        "- phrase: the phrase exactly as given\n"
        "- contexts: array of exactly 2 objects, each with:\n"
        "  - task_type: \"email\" or \"discussion\"\n"
        "  - instruction: a short sentence telling the student what to write "
        "(e.g. \"Write a sentence using this phrase in an email to your supervisor.\")\n\n"
        "One context should be email-register, one should be academic-discussion-register."
    )
    result = call_llm_json(
        messages=[
            {"role": "system", "content": "You are a TOEFL vocabulary coach. Return ONLY valid JSON."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.7,
        label="collocation_generate",
    )
    result["phrase"] = phrase
    return result


def evaluate_collocation(*, phrase: str, user_sentence: str, task_type: str) -> dict:
    """Check if the phrase was used correctly and naturally.

    Returns:
        {
          correct: bool,
          feedback: str,
          register_ok: bool
        }
    """
    prompt = (
        f'Phrase to use: "{phrase}"\n'
        f"Task type: {task_type.replace(chr(10), ' ')}\n"
        f"Student sentence: {user_sentence.replace(chr(10), ' ')}\n\n"
        "Evaluate. Return JSON with:\n"
        "- correct: true if the phrase is used correctly and naturally\n"
        "- feedback: 1-2 sentences (encouraging, specific)\n"
        "- register_ok: true if the register matches the task type"
    )
    return call_llm_json(
        messages=[
            {"role": "system", "content": "You are a TOEFL vocabulary evaluator. Return ONLY valid JSON."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        label="collocation_evaluate",
    )


# ── Flow 3 — Phrase Bank ──────────────────────────────────────────────────────

_PHRASE_BANK: dict[str, list[str]] = {
    "Greeting": [
        "Dear [Name],",
        "Hello [Name],",
        "Good morning [Name],",
        "Hi [Name], I hope this email finds you well.",
        "Dear Professor [Name],",
    ],
    "Purpose": [
        "I am writing to inquire about…",
        "I am writing to request…",
        "I wanted to follow up on…",
        "The purpose of this email is to…",
        "I would like to ask about…",
    ],
    "Request": [
        "Could you please…",
        "I would greatly appreciate it if you could…",
        "Would it be possible to…",
        "I kindly request that…",
        "If convenient, could you…",
    ],
    "Apology": [
        "I apologize for any inconvenience caused.",
        "I am sorry for the late reply.",
        "Please accept my apologies for…",
        "I regret to inform you that…",
        "I am afraid that I cannot…",
    ],
    "Closing": [
        "Thank you for your time and consideration.",
        "I look forward to hearing from you.",
        "Please do not hesitate to contact me if you need further information.",
        "Thank you in advance for your assistance.",
        "I appreciate your help with this matter.",
    ],
    "Sign-off": [
        "Best regards,",
        "Sincerely,",
        "Kind regards,",
        "Yours faithfully,",
        "With appreciation,",
    ],
}


def get_phrase_bank() -> dict:
    """Return the full phrase bank categorised."""
    return {"categories": [
        {"name": name, "phrases": phrases}
        for name, phrases in _PHRASE_BANK.items()
    ]}
