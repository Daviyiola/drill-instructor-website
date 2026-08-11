"""Build and execute the rank-analysis notebook and report artifact."""

from __future__ import annotations

import contextlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path

from rank_progression_analysis import build_outputs


ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "rank_progression"


def execute_notebook(cells: list[dict]) -> dict:
    namespace: dict = {}
    count = 0
    for cell in cells:
        if cell["cell_type"] != "code":
            continue
        count += 1
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            exec("".join(cell["source"]), namespace)
        text = stream.getvalue()
        cell["execution_count"] = count
        cell["outputs"] = ([{"name": "stdout", "output_type": "stream", "text": text}] if text else [])
    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


def notebook() -> dict:
    cells = [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "# Drill Instructor rank progression audit\n",
                "\n",
                "## TL;DR\n",
                "The curve is defensible as an engagement ladder, but not as a mastery scale. "
                "At 70% accuracy, 20 questions per practice day reaches General in 146 practice days; "
                "40 questions reaches it in 73. The final promotion accounts for 35.7% of the journey.\n",
            ],
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## Context & Methods\n",
                "This is a theoretical model based on the source thresholds, 3 points per correct answer, "
                "1 per wrong answer, 0 per unanswered question, and the current free-credit constraints. "
                "No production student behavior is used. One bootcamp means 20 questions/day; two bootcamps "
                "means 20 questions in each, or 40 total. Practice cadence is five days/week.\n",
            ],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "from rank_progression_analysis import build_outputs\n",
                "results = build_outputs()\n",
                "print(results['assumptions'])\n",
            ],
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": ["## Results\n"],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "for row in results['journey']:\n",
                "    print(row['rank'], row['threshold'], row['one_bootcamp_practice_days'], row['two_bootcamp_practice_days'])\n",
            ],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "assert results['journey'][-1]['one_bootcamp_practice_days'] == 146\n",
                "assert results['journey'][-1]['two_bootcamp_practice_days'] == 73\n",
                "assert results['journey'][-1]['promotion_gap'] / 7000 > 0.35\n",
                "assert results['accuracy_sensitivity'][3]['points_per_attempt'] == 2.6\n",
                "print('Validation checks passed')\n",
            ],
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## Takeaways\n",
                "Keep the thresholds for v1 if rank is explicitly framed as practice progression. "
                "Add progress milestones inside the 2,500-point final gap and disclose the free-credit stop. "
                "Do not describe the rank itself as proof of mastery; DIRI and accuracy should carry that meaning.\n",
            ],
        },
    ]
    return execute_notebook(cells)


def artifact(results: dict) -> dict:
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    journey_long = []
    for row in results["journey"][1:]:
        for scenario, label, qpd in (
            ("one_bootcamp_practice_days", "1 bootcamp · 20 questions/day", 20),
            ("two_bootcamp_practice_days", "2 bootcamps · 40 questions/day", 40),
        ):
            journey_long.append({
                "rank": row["rank"],
                "threshold": row["threshold"],
                "scenario": label,
                "questions_per_day": qpd,
                "practice_days": row[scenario],
                "calendar_weeks_at_5d": row[scenario.replace("practice_days", "calendar_weeks_at_5d")],
                "promotion_gap": row["promotion_gap"],
                "attempts_for_gap_at_70pct": row["attempts_for_gap_at_70pct"],
            })

    source = {
        "id": "rank_model_analysis",
        "label": "Rank thresholds, scoring rules, and modeled progression",
        "path": "analysis/rank_progression/results.json",
    }
    journey_source = {
        "id": "rank_journey_model",
        "label": "Rank journey model",
        "path": "analysis/rank_progression/journey.csv",
    }
    accuracy_source = {
        "id": "accuracy_sensitivity_model",
        "label": "Accuracy sensitivity model",
        "path": "analysis/rank_progression/accuracy_sensitivity.csv",
    }
    return {
        "surface": "report",
        "manifest": {
            "version": 1,
            "surface": "report",
            "title": "Is the rank progression defensible?",
            "description": "A theoretical audit of the Drill Instructor student rank curve.",
            "generatedAt": generated_at,
            "cards": [],
            "charts": [
                {
                    "id": "rank_pace_chart",
                    "title": "Practice days needed to reach each rank",
                    "subtitle": "Modeled at 70% accuracy and five practice days per week; the two-bootcamp case assumes twice the daily question volume.",
                    "type": "bar",
                    "dataset": "journey_long",
                    "sourceId": "rank_journey_model",
                    "encodings": {
                        "x": {"field": "rank", "type": "nominal", "label": "Rank"},
                        "y": {"field": "practice_days", "type": "quantitative", "label": "Practice days"},
                        "color": {"field": "scenario", "type": "nominal", "label": "Daily workload"},
                        "tooltip": [
                            {"field": "threshold", "type": "quantitative", "label": "Point threshold"},
                            {"field": "calendar_weeks_at_5d", "type": "quantitative", "label": "Calendar weeks"},
                            {"field": "questions_per_day", "type": "quantitative", "label": "Questions/day"},
                        ],
                    },
                },
                {
                    "id": "promotion_gap_chart",
                    "title": "Answered questions needed for each promotion",
                    "subtitle": "Expected attempts at 70% accuracy; unanswered questions earn no points.",
                    "type": "bar",
                    "dataset": "journey",
                    "sourceId": "rank_journey_model",
                    "encodings": {
                        "x": {"field": "rank", "type": "nominal", "label": "Rank reached"},
                        "y": {"field": "attempts_for_gap_at_70pct", "type": "quantitative", "label": "Answered questions"},
                        "tooltip": [
                            {"field": "promotion_gap", "type": "quantitative", "label": "Point gap"},
                            {"field": "threshold", "type": "quantitative", "label": "Cumulative threshold"},
                        ],
                    },
                },
            ],
            "tables": [
                {
                    "id": "rank_table",
                    "title": "Rank-by-rank progression",
                    "subtitle": "Cumulative thresholds and modeled time at 70% accuracy.",
                    "dataset": "journey",
                    "sourceId": "rank_journey_model",
                    "defaultSort": {"field": "threshold", "direction": "asc"},
                    "columns": [
                        {"field": "rank", "label": "Rank", "type": "text"},
                        {"field": "threshold", "label": "Points", "format": "number"},
                        {"field": "promotion_gap", "label": "Gap", "format": "number"},
                        {"field": "attempts_for_gap_at_70pct", "label": "Questions for promotion", "format": "number"},
                        {"field": "one_bootcamp_practice_days", "label": "Days · 20/day", "format": "number"},
                        {"field": "two_bootcamp_practice_days", "label": "Days · 40/day", "format": "number"},
                    ],
                },
                {
                    "id": "accuracy_table",
                    "title": "Accuracy sensitivity",
                    "subtitle": "How accuracy changes points per attempt and the full journey to General.",
                    "dataset": "accuracy_sensitivity",
                    "sourceId": "accuracy_sensitivity_model",
                    "defaultSort": {"field": "accuracy_pct", "direction": "asc"},
                    "columns": [
                        {"field": "accuracy_pct", "label": "Accuracy", "format": "number", "unit": "%"},
                        {"field": "points_per_attempt", "label": "Points/attempt", "format": "number"},
                        {"field": "attempts_to_general", "label": "Attempts to General", "format": "number"},
                        {"field": "days_at_20_questions", "label": "Days · 20/day", "format": "number"},
                        {"field": "days_at_40_questions", "label": "Days · 40/day", "format": "number"},
                    ],
                },
            ],
            "sources": [source, journey_source, accuracy_source],
            "blocks": [
                {"id": "title", "type": "markdown", "body": "# Is the rank progression defensible?"},
                {
                    "id": "executive_summary",
                    "type": "markdown",
                    "sourceId": "rank_model_analysis",
                    "body": "## Executive Summary\n\n- **Yes, for engagement.** The curve is broadly defensible if rank represents accumulated practice and persistence, not exam mastery. At 70% accuracy, a student answering 20 questions on each of five days per week reaches General in about 29 weeks.\n- **Two bootcamps do not create a multiplier.** If the student answers 20 questions in each bootcamp, the doubled 40-question workload halves the journey to about 15 weeks. If total daily questions stay at 20, splitting them across two bootcamps changes nothing.\n- **The final promotion is very back-loaded.** Major General to General requires 2,500 points, 35.7% of the entire journey, or about 1,042 answered questions at 70% accuracy.\n- **Accuracy matters, but activity dominates.** Moving from 50% to 80% accuracy raises earnings from 2.0 to 2.6 points per answer, only a 30% advantage. The current rank descriptions therefore overstate mastery relative to what the formula measures.",
                },
                {
                    "id": "pace_heading",
                    "type": "markdown",
                    "sourceId": "rank_model_analysis",
                    "body": "## A steady student can complete the ladder within one school year\n\nAt 70% accuracy, 20 answered questions produce about 48 points. That is roughly 30 minutes of answering time, or around 40 minutes when brief review is included. The same workload across five days per week reaches Corporal in the first week, Captain in about six weeks, Colonel in about thirteen weeks, and General in about twenty-nine weeks. A two-bootcamp student doing 20 questions in each bootcamp doubles the workload and roughly halves those times. The bootcamp count itself has no mathematical effect.",
                },
                {"id": "pace_chart", "type": "chart", "chartId": "rank_pace_chart"},
                {
                    "id": "curve_heading",
                    "type": "markdown",
                    "sourceId": "rank_model_analysis",
                    "body": "## Early momentum is strong, but the last rank risks feeling distant\n\nThe first three promotions require about 42, 63, and 84 answered questions at 70% accuracy, so new students receive useful early reinforcement. The final promotion alone requires more answered questions than the first seven promotions combined through Major. That preserves General as a prestigious endpoint, but it creates a long motivational stretch unless the UI shows progress and smaller milestones inside the gap.",
                },
                {"id": "gap_chart", "type": "chart", "chartId": "promotion_gap_chart"},
                {"id": "rank_table_block", "type": "table", "tableId": "rank_table"},
                {
                    "id": "accuracy_heading",
                    "type": "markdown",
                    "sourceId": "rank_model_analysis",
                    "body": "## The formula rewards showing up more than being excellent\n\nBecause every attempted question earns at least one point, even 0% accuracy eventually reaches General after 7,000 attempts; perfect accuracy needs 2,334. More realistically, 50% accuracy needs 3,500 attempts while 80% needs 2,693. This is a reasonable anti-discouragement mechanic for a practice product, but it means rank should not be presented as proof of readiness. Accuracy, analytics, and DIRI should own the mastery story.",
                },
                {"id": "accuracy_table_block", "type": "table", "tableId": "accuracy_table"},
                {
                    "id": "recommendations",
                    "type": "markdown",
                    "body": "## Recommended v1 decision\n\n1. **Keep the thresholds for launch.** The overall pace is reasonable for a year-round engagement ladder.\n2. **Frame rank as practice progression.** Rewrite descriptions that currently imply accuracy, speed, or mastery unless those qualities are separately required.\n3. **Show percentage progress inside each rank.** This preserves momentum without exposing the exact promotion thresholds.\n4. **Explain the free limit.** Free accounts receive points for at most 20 sessions and cannot earn more than 2,000 free points. Without clear copy, an unexplained points freeze will look broken.\n5. **Calibrate after launch.** Monitor median questions per active day, days between promotions, rank distribution, and the share of active students stalled for 30 days before changing thresholds.",
                },
                {
                    "id": "further_questions",
                    "type": "markdown",
                    "body": "## What real usage should answer next\n\n- Do students usually complete 10, 20, or 40 questions on an active day?\n- Does the Major General-to-General gap improve retention or produce abandonment?\n- Do students farm easier questions or repeated content for points?\n- Should assignment practice and solo practice carry identical engagement rewards?",
                },
                {
                    "id": "caveats",
                    "type": "markdown",
                    "body": "## Caveats and assumptions\n\nThis is a deterministic model, not a forecast from production behavior. It assumes 70% accuracy for the main scenarios, five practice days per week, 90 seconds of answering time per question, and roughly two minutes per question when brief review is included. The two-bootcamp scenario assumes twice the daily work. Unanswered questions earn zero. Licensed sessions are credited idempotently to one global student total; free accounts are additionally constrained by the current 20-session and 2,000-point limits.",
                },
            ],
        },
        "snapshot": {
            "version": 1,
            "generatedAt": generated_at,
            "status": "ready",
            "datasets": {
                "journey": results["journey"][1:],
                "journey_long": journey_long,
                "accuracy_sensitivity": results["accuracy_sensitivity"],
            },
            "accessIssues": [],
        },
        "sources": [
            {
                "id": "rank_model_analysis",
                "path": "analysis/rank_progression/results.json",
            },
            {
                "id": "rank_journey_model",
                "path": "analysis/rank_progression/journey.csv",
                "query": {
                    "engine": "postgresql",
                    "language": "sql",
                    "sql": "WITH ranks(rank_name, threshold, rank_order) AS (VALUES ('Corporal',100,2),('Sergeant',250,3),('Warrant Officer',450,4),('Lieutenant',800,5),('Captain',1300,6),('Major',1950,7),('Colonel',3000,8),('Major General',4500,9),('General',7000,10)), gaps AS (SELECT rank_name, threshold, rank_order, threshold - LAG(threshold,1,0) OVER (ORDER BY rank_order) AS promotion_gap FROM ranks), scenarios(scenario, questions_per_day) AS (VALUES ('1 bootcamp · 20 questions/day',20),('2 bootcamps · 40 questions/day',40)) SELECT rank_name AS rank, threshold, promotion_gap, CEIL(promotion_gap / 2.4) AS attempts_for_gap_at_70pct, scenario, questions_per_day, CEIL(threshold / (questions_per_day * 2.4)) AS practice_days FROM gaps CROSS JOIN scenarios ORDER BY rank_order, questions_per_day;",
                    "description": "Computes promotion gaps and modeled practice days for the one- and two-bootcamp workloads.",
                    "tables_used": ["modeled_rank_thresholds"],
                    "filters": ["Accuracy fixed at 70%", "Five practice days per week for calendar-week interpretation"],
                    "metric_definitions": {
                        "points_per_attempt": "1 + 2 × accuracy; correct=3, wrong=1, unanswered=0",
                        "practice_days": "ceil(rank threshold / (questions per day × expected points per attempt))",
                    },
                },
            },
            {
                "id": "accuracy_sensitivity_model",
                "path": "analysis/rank_progression/accuracy_sensitivity.csv",
                "query": {
                    "engine": "postgresql",
                    "language": "sql",
                    "sql": "WITH accuracies(accuracy) AS (VALUES (0.0),(0.5),(0.7),(0.8),(0.9),(1.0)) SELECT accuracy * 100 AS accuracy_pct, 1 + 2 * accuracy AS points_per_attempt, CEIL(7000 / (1 + 2 * accuracy)) AS attempts_to_general, CEIL(7000 / (20 * (1 + 2 * accuracy))) AS days_at_20_questions, CEIL(7000 / (40 * (1 + 2 * accuracy))) AS days_at_40_questions FROM accuracies ORDER BY accuracy;",
                    "description": "Computes the sensitivity of the General journey to answer accuracy.",
                    "tables_used": ["modeled_accuracy_levels"],
                    "metric_definitions": {
                        "points_per_attempt": "1 + 2 × accuracy",
                        "attempts_to_general": "ceil(7,000 / expected points per attempt)",
                    },
                },
            }
        ],
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    results = build_outputs()
    (OUT / "rank_progression_analysis.ipynb").write_text(
        json.dumps(notebook(), indent=2), encoding="utf-8"
    )
    (OUT / "artifact.json").write_text(
        json.dumps(artifact(results), indent=2), encoding="utf-8"
    )
    print(f"Wrote artifacts to {OUT}")


if __name__ == "__main__":
    main()
