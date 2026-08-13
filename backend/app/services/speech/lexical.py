"""
Lexical accuracy module — WER-based word alignment.

Replaces set-intersection comparison with proper Levenshtein alignment so that
substitutions, deletions, and insertions are tracked separately.

A_lexical = max(0, 1 - WER)  where WER = (S + D + I) / N
"""
from __future__ import annotations

import re


def _normalise(word: str) -> str:
    """Lowercase, strip punctuation, collapse contractions."""
    w = word.lower()
    w = re.sub(r"[^\w']", "", w)
    # can't → cannot, won't → will not etc. are kept as-is;
    # the caller's ASR transcript may already have expanded them.
    return w.strip("'")


def _edit_distance_ops(
    target: list[str], hypothesis: list[str]
) -> list[tuple[str, str | None, str | None]]:
    """
    Standard DP alignment returning one operation per target/hypothesis token.
    Returns list of (op, t_word, h_word) where op ∈ {'ok','sub','del','ins'}.
    """
    n, m = len(target), len(hypothesis)
    # dp[i][j] = min cost to align target[:i] with hypothesis[:j]
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if target[i - 1] == hypothesis[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(
                    dp[i - 1][j - 1],  # substitution
                    dp[i - 1][j],      # deletion
                    dp[i][j - 1],      # insertion
                )

    # Back-track
    ops: list[tuple[str, str | None, str | None]] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and target[i - 1] == hypothesis[j - 1]:
            ops.append(("ok", target[i - 1], hypothesis[j - 1]))
            i -= 1
            j -= 1
        elif i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
            ops.append(("sub", target[i - 1], hypothesis[j - 1]))
            i -= 1
            j -= 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            ops.append(("del", target[i - 1], None))
            i -= 1
        else:
            ops.append(("ins", None, hypothesis[j - 1]))
            j -= 1

    ops.reverse()
    return ops


def align(target_text: str, hypothesis_text: str) -> dict:
    """
    Align target sentence against ASR hypothesis using Levenshtein.

    Returns:
      accuracy      float  0-1  (1 - WER, clamped to 0)
      wer           float  0+   (may exceed 1.0 for very short targets)
      deletions     list[str]   target words absent from hypothesis
      substitutions list[dict]  {"target": ..., "recognized": ...}
      insertions    list[str]   hypothesis words not in target
      matched_count int
      target_count  int
    """
    t_words = [_normalise(w) for w in target_text.split() if w.strip()]
    h_words = [_normalise(w) for w in hypothesis_text.split() if w.strip()]

    if not t_words:
        return {
            "accuracy": 0.0, "wer": 1.0,
            "deletions": [], "substitutions": [], "insertions": [],
            "matched_count": 0, "target_count": 0,
        }

    if not h_words:
        return {
            "accuracy": 0.0, "wer": 1.0,
            "deletions": t_words, "substitutions": [], "insertions": [],
            "matched_count": 0, "target_count": len(t_words),
        }

    ops = _edit_distance_ops(t_words, h_words)

    deletions: list[str] = []
    substitutions: list[dict] = []
    insertions: list[str] = []
    matched = 0

    for op, t, h in ops:
        if op == "ok":
            matched += 1
        elif op == "del":
            deletions.append(t)  # type: ignore[arg-type]
        elif op == "sub":
            substitutions.append({"target": t, "recognized": h})
        elif op == "ins":
            insertions.append(h)  # type: ignore[arg-type]

    n = len(t_words)
    s = len(substitutions)
    d = len(deletions)
    ins = len(insertions)
    wer = (s + d + ins) / n
    accuracy = max(0.0, round(1.0 - wer, 4))

    return {
        "accuracy": accuracy,
        "wer": round(wer, 4),
        "deletions": deletions,
        "substitutions": substitutions,
        "insertions": insertions,
        "matched_count": matched,
        "target_count": n,
    }
