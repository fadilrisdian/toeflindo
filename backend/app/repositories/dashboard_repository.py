"""Dashboard read-only queries."""
import sqlite3
from datetime import datetime, timedelta

from app.utils.time import today_wib

EXCLUDED_TASK_TYPES = {"Weak Spot Drill", "Grammar Drill"}


def _fill_date_range(rows: list[dict], date_key: str = "day") -> list[dict]:
    if not rows:
        return []
    start = datetime.strptime(rows[0][date_key], "%Y-%m-%d")
    end = datetime.strptime(rows[-1][date_key], "%Y-%m-%d")
    lookup = {r[date_key]: r for r in rows}
    result = []
    d = start
    while d <= end:
        ds = d.strftime("%Y-%m-%d")
        result.append(dict(lookup[ds]) if ds in lookup else {date_key: ds})
        d += timedelta(days=1)
    return result


def _rolling_avg(values: list, window: int = 7) -> list:
    result = []
    for i in range(len(values)):
        win = [v for v in values[max(0, i - window + 1):i + 1] if v is not None]
        result.append(round(sum(win) / len(win), 2) if win else None)
    return result


def _avg(lst: list) -> float | None:
    return round(sum(lst) / len(lst), 2) if lst else None


class DashboardRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._c = conn

    def summary(self) -> dict:
        today = today_wib()

        # Writing KPIs
        writing_rows = self._c.execute(
            "SELECT task_type, score FROM practice_log WHERE LOWER(section)='writing' AND score IS NOT NULL"
        ).fetchall()
        writing_all  = [r["score"] for r in writing_rows]
        email_scores = [r["score"] for r in writing_rows if r["task_type"] == "Write an Email"]
        disc_scores  = [r["score"] for r in writing_rows if r["task_type"] == "Write for an Academic Discussion"]

        # Speaking KPIs
        speaking_rows = self._c.execute(
            "SELECT task_type, score FROM practice_log WHERE LOWER(section)='speaking' AND score IS NOT NULL"
        ).fetchall()
        total_sp  = [r["score"] for r in speaking_rows]
        lr_scores = [r["score"] for r in speaking_rows if r["task_type"] == "Listen and Repeat"]
        iv_scores = [r["score"] for r in speaking_rows if r["task_type"] == "Take an Interview"]

        # Daily score trend
        daily_raw = self._c.execute("""
            SELECT DATE(date) as day, ROUND(AVG(score), 2) as avg_score, COUNT(*) as n
            FROM practice_log WHERE score IS NOT NULL
            GROUP BY DATE(date) ORDER BY day ASC
        """).fetchall()
        daily_filled = _fill_date_range([dict(r) for r in daily_raw])
        raw_vals = [d.get("avg_score") for d in daily_filled]
        rolling  = _rolling_avg(raw_vals)
        daily_scores = [
            {"day": d["day"], "avg": d.get("avg_score"), "n": d.get("n", 0), "rolling": rolling[i]}
            for i, d in enumerate(daily_filled)
        ]

        # Section KPIs
        section_kpis = [dict(r) for r in self._c.execute("""
            SELECT
                CASE WHEN LOWER(section)='speaking' THEN 'Speaking'
                     WHEN LOWER(section)='writing'  THEN 'Writing'
                     ELSE section END as skill,
                COUNT(*) as attempts,
                ROUND(AVG(score), 2) as avg_score,
                COUNT(DISTINCT DATE(date)) as study_days
            FROM practice_log WHERE score IS NOT NULL
            GROUP BY skill ORDER BY attempts DESC
        """).fetchall()]

        # Grammar accuracy
        grammar_perf = [dict(r) for r in self._c.execute("""
            SELECT grammar_type,
                   SUM(attempts) as total_attempts, SUM(correct) as total_correct,
                   ROUND(CAST(SUM(correct) AS FLOAT) / MAX(SUM(attempts), 1) * 100, 1) as accuracy
            FROM grammar_performance
            WHERE grammar_type != 'Listening Accuracy'
            GROUP BY grammar_type
            HAVING SUM(attempts) > 0
            ORDER BY accuracy ASC
        """).fetchall()]

        # Mistake trend
        mistake_raw = self._c.execute("""
            SELECT DATE(date) as day, COUNT(*) as n
            FROM grammar_mistakes GROUP BY DATE(date) ORDER BY day ASC
        """).fetchall()
        mistake_trend = []
        if mistake_raw:
            filled = _fill_date_range([dict(r) for r in mistake_raw])
            cum = 0
            for d in filled:
                cum += d.get("n", 0)
                mistake_trend.append({"day": d["day"], "n": d.get("n", 0), "cumulative": cum})

        # Top recurring mistakes
        top_mistakes = [dict(r) for r in self._c.execute("""
            SELECT grammar_type, COUNT(*) as count,
                   SUM(recurrence_count) as total_recurrence, MAX(date) as last_seen
            FROM grammar_mistakes GROUP BY grammar_type ORDER BY count DESC LIMIT 10
        """).fetchall()]

        # Task summary
        task_summary = [dict(r) for r in self._c.execute("""
            SELECT task_type, COUNT(*) as attempts,
                   ROUND(AVG(score), 2) as avg_score,
                   MIN(score) as min_score, MAX(score) as max_score
            FROM practice_log WHERE score IS NOT NULL
              AND task_type NOT IN ('Weak Spot Drill', 'Grammar Drill')
            GROUP BY task_type ORDER BY attempts DESC
        """).fetchall()]

        # Totals
        row = self._c.execute("""
            SELECT COUNT(*) as total_practices, COUNT(DISTINCT DATE(date)) as study_days
            FROM practice_log WHERE score IS NOT NULL
        """).fetchone()
        totals = dict(row) if row else {}
        row2 = self._c.execute("SELECT COUNT(*) as total FROM grammar_mistakes").fetchone()
        totals["total_mistakes"] = row2["total"] if row2 else 0
        last = self._c.execute("SELECT MAX(DATE(date)) as last FROM practice_log").fetchone()
        if last and last["last"]:
            last_dt  = datetime.strptime(last["last"], "%Y-%m-%d")
            today_dt = datetime.strptime(today, "%Y-%m-%d")
            totals["days_since_last"] = (today_dt - last_dt).days
        else:
            totals["days_since_last"] = None

        # Performance by task
        perf_rows = self._c.execute(
            "SELECT task_type, AVG(score) as avg_score, COUNT(*) as attempts "
            "FROM practice_log WHERE score IS NOT NULL GROUP BY task_type ORDER BY attempts DESC"
        ).fetchall()
        perf = [dict(r) for r in perf_rows if r["task_type"] not in EXCLUDED_TASK_TYPES]

        return {
            "writing":  {"target": 5.5, "overall": _avg(writing_all), "email": _avg(email_scores), "discussion": _avg(disc_scores)},
            "speaking": {"target": 5.0, "overall": _avg(total_sp), "listen_repeat": _avg(lr_scores), "interview": _avg(iv_scores)},
            "performance_by_task": perf,
            "daily_scores": daily_scores,
            "section_kpis": section_kpis,
            "grammar_perf": grammar_perf,
            "mistake_trend": mistake_trend,
            "top_mistakes": top_mistakes,
            "task_summary": task_summary,
            "totals": totals,
            "target": 5.0,
        }

    def writing(self) -> dict:
        summary_row = self._c.execute("""
            SELECT COUNT(*) as total_practices, COUNT(DISTINCT DATE(date)) as study_days,
                   ROUND(AVG(CASE WHEN (is_revision IS NULL OR is_revision=0) THEN score END), 2) as avg_score,
                   ROUND(AVG(score), 2) as assisted_avg
            FROM practice_log WHERE LOWER(section)='writing' AND score IS NOT NULL
        """).fetchone()
        sessions = [dict(r) for r in self._c.execute("""
            SELECT id, date, task_type, score, feedback, response, prompt FROM practice_log
            WHERE LOWER(section)='writing' AND score IS NOT NULL ORDER BY date DESC
        """).fetchall()]
        task_breakdown = [dict(r) for r in self._c.execute("""
            SELECT task_type, COUNT(*) as attempts, ROUND(AVG(score), 2) as avg_score,
                   MIN(score) as min_score, MAX(score) as max_score,
                   COUNT(DISTINCT DATE(date)) as days_practiced
            FROM practice_log WHERE LOWER(section)='writing' AND score IS NOT NULL
            GROUP BY task_type ORDER BY attempts DESC
        """).fetchall()]
        weekly_trend = [dict(r) for r in self._c.execute("""
            SELECT strftime('%Y-W%W', date) as week, COUNT(*) as sessions,
                   ROUND(AVG(score), 2) as avg_score
            FROM practice_log WHERE LOWER(section)='writing' AND score IS NOT NULL
            GROUP BY week ORDER BY week ASC
        """).fetchall()]
        error_types = [dict(r) for r in self._c.execute("""
            SELECT grammar_type, COUNT(*) as cnt FROM grammar_mistakes
            WHERE LOWER(section)='writing' GROUP BY grammar_type ORDER BY cnt DESC LIMIT 8
        """).fetchall()]
        grammar_mistakes = [dict(r) for r in self._c.execute("""
            SELECT id, date, grammar_type, wrong, correct, explanation, section, task_type, remediation_status
            FROM grammar_mistakes
            WHERE LOWER(section)='writing' ORDER BY date DESC LIMIT 30
        """).fetchall()]
        checklist_history = [dict(r) for r in self._c.execute("""
            SELECT id, date, task_type, results, passed_count, total_count, improvement_note
            FROM writing_checklist_log
            ORDER BY date ASC
            LIMIT 15
        """).fetchall()]
        # Parse JSON results for each log
        import json as _json
        for checklist_row in checklist_history:
            try:
                checklist_row["results"] = _json.loads(checklist_row["results"])
            except Exception:
                checklist_row["results"] = []
        return {
            "totals": dict(summary_row) if summary_row else {},
            "sessions": sessions,
            "task_breakdown": task_breakdown,
            "weekly_trend": weekly_trend,
            "error_types": error_types,
            "grammar_mistakes": grammar_mistakes,
            "checklist_history": checklist_history,
        }

    def speaking(self) -> dict:
        row = self._c.execute("""
            SELECT COUNT(*) as total_practices, COUNT(DISTINCT DATE(date)) as study_days,
                   ROUND(AVG(CASE WHEN (is_revision IS NULL OR is_revision=0) THEN score END), 2) as avg_score,
                   ROUND(AVG(score), 2) as assisted_avg
            FROM practice_log WHERE LOWER(section)='speaking' AND score IS NOT NULL
              AND task_type NOT IN ('Grammar SRS')
        """).fetchone()
        totals = dict(row) if row else {}
        for key, tt in [("listen_repeat", "Listen and Repeat"), ("interview", "Take an Interview")]:
            r = self._c.execute(
                "SELECT COUNT(*) as total, ROUND(AVG(score), 2) as avg_score "
                "FROM practice_log WHERE LOWER(section)='speaking' AND task_type=? AND score IS NOT NULL",
                (tt,),
            ).fetchone()
            totals[f"{key}_total"] = r["total"] if r else 0
            totals[f"{key}_avg"]   = r["avg_score"] if r else None
        sessions = [dict(r) for r in self._c.execute("""
            SELECT pl.id, pl.date, pl.task_type, pl.score, pl.feedback, pl.response, pl.prompt,
                   CASE WHEN pl.task_type='Take an Interview' THEN sal.expected_answer ELSE '' END as correct_answer
            FROM practice_log pl
            LEFT JOIN speech_analysis_log sal ON sal.practice_log_id = pl.id
            WHERE LOWER(pl.section)='speaking' AND pl.score IS NOT NULL
              AND pl.task_type NOT IN ('Grammar SRS')
            ORDER BY pl.date DESC
        """).fetchall()]
        task_breakdown = [dict(r) for r in self._c.execute("""
            SELECT task_type, COUNT(*) as attempts, ROUND(AVG(score), 2) as avg_score,
                   MIN(score) as min_score, MAX(score) as max_score
            FROM practice_log WHERE LOWER(section)='speaking' AND score IS NOT NULL
              AND task_type NOT IN ('Grammar SRS') GROUP BY task_type ORDER BY attempts DESC
        """).fetchall()]

        grammar_mistakes = [dict(r) for r in self._c.execute("""
            SELECT id, date, grammar_type, wrong, correct, explanation, task_type, remediation_status
            FROM grammar_mistakes
            WHERE LOWER(section)='speaking' AND task_type='Take an Interview'
            ORDER BY date DESC LIMIT 50
        """).fetchall()]

        checklist_history = [dict(r) for r in self._c.execute("""
            SELECT id, date, task_type, results, passed_count, total_count
            FROM speaking_checklist_log
            ORDER BY date ASC
            LIMIT 20
        """).fetchall()]
        import json as _json
        for _row in checklist_history:
            try:
                _row["results"] = _json.loads(_row["results"])
            except Exception:
                _row["results"] = []

        def daily_by_task(task_type: str) -> list[dict]:
            rows = self._c.execute("""
                SELECT DATE(date) as day, ROUND(AVG(score), 2) as avg, COUNT(*) as n
                FROM practice_log WHERE LOWER(section)='speaking' AND task_type=? AND score IS NOT NULL
                GROUP BY DATE(date) ORDER BY day ASC
            """, (task_type,)).fetchall()
            return [dict(r) for r in rows]

        return {
            "totals": totals,
            "sessions": sessions,
            "task_breakdown": task_breakdown,
            "task_daily": {"lr": daily_by_task("Listen and Repeat"), "iv": daily_by_task("Take an Interview")},
            "grammar_mistakes": grammar_mistakes,
            "checklist_history": checklist_history,
        }

    def speaking_analyzer(self) -> dict:
        """Aggregated data for the Speaking Analyzer page."""
        # Overall averages from speech_analysis_log
        sal = self._c.execute("""
            SELECT ROUND(AVG(pronunciation_score),2) as pronunciation,
                   ROUND(AVG(fluency_score),2)        as fluency,
                   ROUND(AVG(grammar_score),2)        as grammar,
                   ROUND(AVG(vocabulary_score),2)     as vocabulary,
                   ROUND(AVG(intonation_score),2)     as intonation,
                   ROUND(AVG(discourse_score),2)      as discourse,
                   ROUND(AVG(overall_score),2)        as overall,
                   ROUND(AVG(task_raw_score),2)       as avg_task_raw,
                   ROUND(AVG(estimated_band),2)       as avg_estimated_band,
                   COUNT(*) as cnt
            FROM speech_analysis_log
        """).fetchone()
        sal = dict(sal) if sal else {}
        has_real = sal.get("cnt", 0) > 0

        # Fallback dimension data from practice_log + grammar_mistakes
        lr_rows = [dict(r) for r in self._c.execute("""
            SELECT date, score, feedback FROM practice_log
            WHERE LOWER(section)='speaking' AND task_type='Listen and Repeat' AND score IS NOT NULL
            ORDER BY date DESC LIMIT 10
        """).fetchall()]
        iv_rows = [dict(r) for r in self._c.execute("""
            SELECT date, score, feedback FROM practice_log
            WHERE LOWER(section)='speaking' AND task_type='Take an Interview' AND feedback IS NOT NULL
            ORDER BY date DESC LIMIT 5
        """).fetchall()]

        all_mistakes = [dict(r) for r in self._c.execute("""
            SELECT grammar_type, wrong, correct, explanation, recurrence_count, date, section
            FROM grammar_mistakes WHERE LOWER(section)='speaking'
            ORDER BY recurrence_count DESC, date DESC
        """).fetchall()]

        if has_real:
            dimensions = {
                "pronunciation": sal.get("pronunciation"),
                "fluency":       sal.get("fluency"),
                "grammar":       sal.get("grammar"),
                "vocabulary":    sal.get("vocabulary"),
                "intonation":    sal.get("intonation"),
                "discourse":     sal.get("discourse"),
            }
            overall = sal.get("overall") or 1.0
            data_source = "speech_analysis_log"
        else:
            import re

            def _parse_acc(fb):
                if not fb:
                    return None
                m = re.search(r'(\d+)\s*/\s*(\d+)\s*correct', fb, re.IGNORECASE)
                return int(m.group(1)) / max(int(m.group(2)), 1) if m else None

            def _parse_dim(fb, dim):
                if not fb:
                    return None
                m = re.search(dim + r'\s*:\s*(Excellent|Good|Fair|Poor)', fb, re.IGNORECASE)
                return {'excellent': 5.5, 'good': 4.5, 'fair': 3.0, 'poor': 1.5}.get(m.group(1).lower()) if m else None

            pron_s = [round((_parse_acc(r["feedback"]) or 0.0) * 5 + 1, 2) if _parse_acc(r["feedback"]) is not None else r["score"] for r in lr_rows]
            pronunciation = round(sum(pron_s) / len(pron_s), 2) if pron_s else None

            flu_s = [r["score"] for r in lr_rows if r["score"] is not None]
            for r in iv_rows:
                v = _parse_dim(r["feedback"], "Fluency")
                if v: flu_s.append(v)
            fluency = round(sum(flu_s) / len(flu_s), 2) if flu_s else None

            gram_s = [v for r in iv_rows for v in [_parse_dim(r["feedback"], "Grammar")] if v]
            mistake_cnt = len(all_mistakes)
            base_g = round(sum(gram_s) / len(gram_s), 2) if gram_s else 4.0
            grammar = round(max(1.0, min(6.0, base_g - mistake_cnt * 0.05)), 2)

            vocab_kw = ["word confusion", "word choice", "phrasal verb", "vocabulary", "country vs"]
            vocab_cnt = sum(1 for m in all_mistakes if any(k in m["grammar_type"].lower() for k in vocab_kw))
            voc_s = [v for r in iv_rows for v in [_parse_dim(r["feedback"], "Vocabulary")] if v]
            base_v = round(sum(voc_s) / len(voc_s), 2) if voc_s else 3.5
            vocabulary = round(max(1.0, min(6.0, base_v - vocab_cnt * 0.1)), 2)

            if fluency and pronunciation:
                intonation = round((fluency * 0.6 + pronunciation * 0.4) * 0.9, 2)
            elif fluency:
                intonation = round(fluency * 0.85, 2)
            else:
                intonation = None

            dimensions = {"pronunciation": pronunciation, "fluency": fluency,
                          "grammar": grammar, "vocabulary": vocabulary,
                          "intonation": intonation, "discourse": None}
            vals = [v for v in dimensions.values() if v]
            overall = round(sum(vals) / len(vals), 2) if vals else 1.0
            data_source = "approximated"

        # Daily trend from speech_analysis_log (DATE() so both paths return the same key format)
        sal_weekly = [dict(r) for r in self._c.execute("""\
            SELECT DATE(date) as week,
                   ROUND(AVG(pronunciation_score),2) as pronunciation,
                   ROUND(AVG(fluency_score),2)        as fluency,
                   ROUND(AVG(grammar_score),2)        as grammar,
                   ROUND(AVG(vocabulary_score),2)     as vocabulary,
                   ROUND(AVG(intonation_score),2)     as intonation,
                   ROUND(AVG(discourse_score),2)      as discourse,
                   ROUND(AVG(overall_score),2)        as overall_score,
                   ROUND(AVG(task_raw_score),2)       as avg_task_raw,
                   ROUND(AVG(estimated_band),2)       as avg_estimated_band,
                   ROUND(AVG(wpm),1)                  as avg_wpm
            FROM speech_analysis_log
            GROUP BY week ORDER BY week ASC
        """).fetchall()]

        if not sal_weekly:
            # fallback trend from practice_log — also use DATE() for key consistency
            sal_weekly = [
                {**dict(r), "pronunciation": dict(r).get("avg_lr"), "fluency": dict(r).get("avg_lr")}
                for r in self._c.execute("""\
                    SELECT DATE(date) as week, ROUND(AVG(score),2) as avg_lr
                    FROM practice_log
                    WHERE LOWER(section)='speaking' AND task_type='Listen and Repeat' AND score IS NOT NULL
                    GROUP BY week ORDER BY week ASC
                """).fetchall()
            ]

        # Pronunciation history
        pron_history = [dict(r) for r in self._c.execute("""
            SELECT DATE(date) as date, pronunciation_score as score, avg_word_confidence as confidence, transcript
            FROM speech_analysis_log ORDER BY date DESC LIMIT 10
        """).fetchall()]
        if not pron_history:
            import re
            def _pa(fb):
                if not fb: return None
                m = re.search(r'(\d+)\s*/\s*(\d+)\s*correct', fb, re.IGNORECASE)
                return int(m.group(1)) / max(int(m.group(2)), 1) if m else None
            pron_history = [
                {"date": r["date"][:10], "score": round((_pa(r["feedback"]) or 0.0) * 5 + 1, 2) if _pa(r["feedback"]) is not None else r["score"], "confidence": None, "transcript": r["feedback"]}
                for r in lr_rows
            ]

        # Top mistake types
        top_mistakes = [dict(r) for r in self._c.execute("""
            SELECT grammar_type, COUNT(*) as count, SUM(recurrence_count) as total_rec
            FROM grammar_mistakes WHERE LOWER(section)='speaking'
            GROUP BY grammar_type ORDER BY count DESC LIMIT 12
        """).fetchall()]

        # Murphy recommendations
        murphy_map = {
            "article": ("Murphy Units 68-71", "Articles (a/an/the)"),
            "plural":  ("Murphy Unit 67",     "Singular & Plural Nouns"),
            "preposition": ("Murphy Units 119-128", "Prepositions"),
            "subject-verb": ("Murphy Unit 86", "Subject-Verb Agreement"),
            "phrasal verb": ("Murphy Units 135-140", "Phrasal Verbs"),
            "contraction":  ("Murphy Unit 47", "Contractions"),
            "word confusion": ("Minimal Pair Drills", "Pronunciation of similar words"),
            "long sentence":  ("Chunking Practice", "Break long sentences into 3-4 word chunks"),
            "gerund":   ("Murphy Units 53-54", "Gerunds after Prepositions"),
            "negation": ("Murphy Unit 42", "Negatives"),
            "possessive": ("Murphy Unit 65", "Possessives"),
            "full breakdown": ("Think in English", "Avoid translating mid-speech"),
            "modal": ("Murphy Units 25-31", "Modal Verbs"),
        }
        recs, seen = [], set()
        for m in top_mistakes[:8]:
            gt = m["grammar_type"].lower()
            for key, (unit, topic) in murphy_map.items():
                if key in gt and unit not in seen:
                    recs.append({"mistake": m["grammar_type"], "unit": unit, "topic": topic, "count": m["count"]})
                    seen.add(unit)
                    break

        totals = {
            "lr_sessions":    len(lr_rows),
            "iv_sessions":    len(iv_rows),
            "total_mistakes": len(all_mistakes),
            "analyzer_sessions": sal.get("cnt", 0),
            "avg_task_raw":   sal.get("avg_task_raw"),
            "avg_estimated_band": sal.get("avg_estimated_band"),
        }

        return {
            "dimensions":    dimensions,
            "overall":       overall,
            "data_source":   data_source,
            "weekly_trend":  sal_weekly,
            "pron_history":  pron_history,
            "all_mistakes":  all_mistakes,
            "top_mistake_types": top_mistakes,
            "recommendations": recs,
            "totals":        totals,
        }

    def grammar(self) -> dict:
        totals = dict(self._c.execute("""
            SELECT COUNT(*) as total_mistakes, SUM(recurrence_count) as total_recurrences,
                   SUM(CASE WHEN reviewed=0 THEN 1 ELSE 0 END) as pending_review,
                   SUM(CASE WHEN recurrence_count > 1 THEN 1 ELSE 0 END) as recurring
            FROM grammar_mistakes WHERE grammar_type != 'Listening Accuracy'
        """).fetchone())
        categories = [dict(r) for r in self._c.execute("""
            SELECT grammar_type as category, COUNT(*) as mistake_count,
                   SUM(recurrence_count) as total_recurrences,
                   SUM(CASE WHEN reviewed=0 THEN 1 ELSE 0 END) as unreviewed,
                   MAX(date) as last_seen
            FROM grammar_mistakes WHERE grammar_type != 'Listening Accuracy'
            GROUP BY grammar_type ORDER BY total_recurrences DESC
        """).fetchall()]
        grammar_perf = [dict(r) for r in self._c.execute("""
            SELECT grammar_type, SUM(attempts) as total_attempts, SUM(correct) as total_correct,
                   ROUND(CAST(SUM(correct) AS FLOAT) / MAX(SUM(attempts), 1) * 100, 1) as accuracy
            FROM grammar_performance GROUP BY grammar_type ORDER BY accuracy ASC
        """).fetchall()]
        unreviewed_by_cat = [dict(r) for r in self._c.execute("""
            SELECT grammar_type as category, COUNT(*) as cnt FROM grammar_mistakes
            WHERE reviewed=0 AND grammar_type != 'Listening Accuracy'
            GROUP BY grammar_type ORDER BY cnt DESC
        """).fetchall()]
        top_mistakes = [dict(r) for r in self._c.execute("""
            SELECT id, grammar_type as category, sub_type, wrong, correct, explanation,
                   recurrence_count, reviewed, date, section, remediation_status
            FROM grammar_mistakes WHERE recurrence_count > 1 AND grammar_type != 'Listening Accuracy'
            ORDER BY recurrence_count DESC LIMIT 20
        """).fetchall()]
        recent_mistakes = [dict(r) for r in self._c.execute("""
            SELECT id, date, grammar_type, sub_type, wrong, correct, explanation, section, recurrence_count, reviewed, remediation_status
            FROM grammar_mistakes WHERE grammar_type != 'Listening Accuracy'
            ORDER BY date DESC LIMIT 100
        """).fetchall()]
        try:
            murphy_map = [dict(r) for r in self._c.execute("""
                SELECT category, sub_type, json_group_array(murphy_unit) as units
                FROM grammar_topic_map WHERE murphy_unit IS NOT NULL GROUP BY category, sub_type
            """).fetchall()]
            import json as _json
            for m in murphy_map:
                try:
                    m["units"] = _json.loads(m["units"])
                except Exception:
                    m["units"] = []
        except Exception:
            murphy_map = []
        return {
            "totals": totals,
            "categories": categories,
            "grammar_perf": grammar_perf,
            "unreviewed_by_cat": unreviewed_by_cat,
            "top_mistakes": top_mistakes,
            "recent_mistakes": recent_mistakes,
            "murphy_map": murphy_map,
        }

    def writing_analyzer(self) -> dict:
        """Aggregate writing dimension data from writing_features for the analyzer page."""
        # Overall dimension averages
        avg_row = self._c.execute("""
            SELECT
                ROUND(AVG(dimension_content), 3)      as avg_content,
                ROUND(AVG(dimension_syntax), 3)       as avg_syntax,
                ROUND(AVG(dimension_lexical), 3)      as avg_lexical,
                ROUND(AVG(dimension_conventions), 3)  as avg_conventions,
                ROUND(AVG(dimension_accuracy), 3)     as avg_accuracy,
                COUNT(*) as total_sessions
            FROM writing_features
        """).fetchone()

        # Per-session dimension trend (for charts)
        session_trend = [dict(r) for r in self._c.execute("""
            SELECT
                pl.id, pl.date, pl.task_type, pl.score,
                wf.dimension_content, wf.dimension_syntax, wf.dimension_lexical,
                wf.dimension_conventions, wf.dimension_accuracy
            FROM writing_features wf
            JOIN practice_log pl ON pl.id = wf.practice_log_id
            ORDER BY pl.date ASC
        """).fetchall()]

        # Weekly dimension averages
        weekly_trend = [dict(r) for r in self._c.execute("""
            SELECT
                strftime('%Y-W%W', pl.date) as week,
                ROUND(AVG(wf.dimension_content), 3)      as content,
                ROUND(AVG(wf.dimension_syntax), 3)       as syntax,
                ROUND(AVG(wf.dimension_lexical), 3)      as lexical,
                ROUND(AVG(wf.dimension_conventions), 3)  as conventions,
                ROUND(AVG(wf.dimension_accuracy), 3)     as accuracy,
                COUNT(*) as sessions
            FROM writing_features wf
            JOIN practice_log pl ON pl.id = wf.practice_log_id
            GROUP BY week ORDER BY week ASC
        """).fetchall()]

        # Top grammar error types from writing sessions
        error_types = [dict(r) for r in self._c.execute("""
            SELECT grammar_type, COUNT(*) as cnt
            FROM grammar_mistakes
            WHERE LOWER(section)='writing'
            GROUP BY grammar_type ORDER BY cnt DESC LIMIT 10
        """).fetchall()]

        # Most recent session per task_type for current snapshot
        latest_by_task = [dict(r) for r in self._c.execute("""
            SELECT pl.task_type,
                   wf.dimension_content, wf.dimension_syntax, wf.dimension_lexical,
                   wf.dimension_conventions, wf.dimension_accuracy
            FROM writing_features wf
            JOIN practice_log pl ON pl.id = wf.practice_log_id
            WHERE pl.id IN (
                SELECT MAX(pl2.id) FROM writing_features wf2
                JOIN practice_log pl2 ON pl2.id = wf2.practice_log_id
                GROUP BY pl2.task_type
            )
        """).fetchall()]

        dimensions = dict(avg_row) if avg_row else {}
        return {
            "dimensions": dimensions,
            "session_trend": session_trend,
            "weekly_trend": weekly_trend,
            "error_types": error_types,
            "latest_by_task": latest_by_task,
        }
