"""Reproducible theoretical audit of Drill Instructor's student rank curve.

The analysis uses the rank thresholds and scoring rules found in the source
code. It does not use production student records.
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path


RANKS = [
    ("Recruit", 0),
    ("Corporal", 100),
    ("Sergeant", 250),
    ("Warrant Officer", 450),
    ("Lieutenant", 800),
    ("Captain", 1300),
    ("Major", 1950),
    ("Colonel", 3000),
    ("Major General", 4500),
    ("General", 7000),
]


def points_per_attempt(accuracy: float) -> float:
    """Expected points per answered question: 3 correct, 1 wrong."""
    return 1 + (2 * accuracy)


def practice_days(points: int, questions_per_day: int, accuracy: float) -> int:
    return math.ceil(points / (questions_per_day * points_per_attempt(accuracy)))


def calendar_weeks(practice_day_count: int, practice_days_per_week: int = 5) -> float:
    return round(practice_day_count / practice_days_per_week, 1)


def build_outputs() -> dict:
    scenario_accuracy = 0.70
    one_bootcamp_daily_questions = 20
    two_bootcamp_daily_questions = 40
    free_session_allowance = 20
    journey = []
    previous = 0
    for name, threshold in RANKS:
        delta = threshold - previous if threshold else 0
        journey.append(
            {
                "rank": name,
                "threshold": threshold,
                "promotion_gap": delta,
                "attempts_for_gap_at_70pct": (
                    math.ceil(delta / points_per_attempt(scenario_accuracy)) if delta else 0
                ),
                "one_bootcamp_practice_days": practice_days(
                    threshold, one_bootcamp_daily_questions, scenario_accuracy
                ) if threshold else 0,
                "one_bootcamp_calendar_weeks_at_5d": calendar_weeks(
                    practice_days(threshold, one_bootcamp_daily_questions, scenario_accuracy)
                ) if threshold else 0,
                "two_bootcamp_practice_days": practice_days(
                    threshold, two_bootcamp_daily_questions, scenario_accuracy
                ) if threshold else 0,
                "two_bootcamp_calendar_weeks_at_5d": calendar_weeks(
                    practice_days(threshold, two_bootcamp_daily_questions, scenario_accuracy)
                ) if threshold else 0,
            }
        )
        previous = threshold

    sensitivity = []
    for accuracy in (0.0, 0.5, 0.7, 0.8, 0.9, 1.0):
        ppq = points_per_attempt(accuracy)
        sensitivity.append(
            {
                "accuracy_pct": int(accuracy * 100),
                "points_per_attempt": round(ppq, 1),
                "attempts_to_general": math.ceil(7000 / ppq),
                "days_at_20_questions": practice_days(7000, 20, accuracy),
                "days_at_40_questions": practice_days(7000, 40, accuracy),
            }
        )

    workloads = []
    for daily_questions in (10, 20, 40, 80):
        days = practice_days(7000, daily_questions, scenario_accuracy)
        workloads.append(
            {
                "questions_per_day": daily_questions,
                "answering_minutes_at_90_sec_each": round(daily_questions * 1.5),
                "practice_and_review_minutes_at_2_min_each": daily_questions * 2,
                "practice_days_to_general": days,
                "calendar_weeks_at_5d": calendar_weeks(days),
            }
        )

    free_examples = []
    for questions_per_session in (10, 20, 40, 80):
        expected_session_points = questions_per_session * points_per_attempt(scenario_accuracy)
        credited = min(2000, expected_session_points * free_session_allowance)
        rank = max((r for r in RANKS if r[1] <= credited), key=lambda x: x[1])[0]
        free_examples.append(
            {
                "questions_per_session": questions_per_session,
                "expected_points_after_free_sessions": round(credited),
                "expected_rank_after_free_sessions": rank,
            }
        )

    return {
        "assumptions": {
            "scenario_accuracy": scenario_accuracy,
            "one_bootcamp_questions_per_day": one_bootcamp_daily_questions,
            "two_bootcamp_questions_per_day": two_bootcamp_daily_questions,
            "practice_days_per_week": 5,
            "free_session_allowance": free_session_allowance,
            "free_points_ceiling": 2000,
        },
        "journey": journey,
        "accuracy_sensitivity": sensitivity,
        "workload_sensitivity": workloads,
        "free_account_examples": free_examples,
    }


def main() -> None:
    output_dir = Path(__file__).resolve().parent / "rank_progression"
    output_dir.mkdir(parents=True, exist_ok=True)
    results = build_outputs()
    (output_dir / "results.json").write_text(
        json.dumps(results, indent=2), encoding="utf-8"
    )
    for key in ("journey", "accuracy_sensitivity", "workload_sensitivity", "free_account_examples"):
        rows = results[key]
        with (output_dir / f"{key}.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
