"""Build the reader-facing DIRI calibration notebook and report artifact."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "analysis" / "diri_calibration"
RESULTS = OUT / "simulation-results.json"


def scenario_row(row: dict) -> dict:
    result = row["result"]
    pillars = result.get("pillars") or {}
    inputs = row["inputs"]
    return {
        "id": row["id"],
        "scenario": row["label"],
        "shortLabel": {
            "minimum-balanced": "100 Q / 1 day",
            "balanced-200": "200 Q / 10 days",
            "balanced-300": "300 Q / 15 days",
            "balanced-500": "500 Q / 24 days",
            "accuracy-70-max": "70% / max breadth",
            "fresh-cram": "500 Q / 1-day cram",
            "stale-60": "Latest work 60d ago",
            "one-subject-broad": "Math only",
            "cross-subsidized-coverage": "Cross-subsidized breadth",
            "slow-90": "120 sec / strict timer",
            "timer-generous": "120 sec / generous timer",
            "focused-math-only-days": "Focused Math only",
            "focused-math-plus-other-days": "Math + unrelated days",
        }.get(row["id"], row["id"]),
        "attempted": inputs.get("attempted"),
        "accuracy": inputs.get("accuracy"),
        "sessions": inputs.get("sessions"),
        "activeDays": inputs.get("activeDays"),
        "latestDaysAgo": inputs.get("latestDaysAgo"),
        "score": result.get("score"),
        "band": result.get("band") or result.get("status"),
        "confidence": result.get("confidence"),
        "performance": pillars.get("performance"),
        "consistency": pillars.get("consistency"),
        "coverage": pillars.get("coverage"),
    }


def notebook(results: dict, selected_rows: list[dict]) -> dict:
    summary = [
        "DIRI 90 is achievable: 90% accuracy, 300 questions, and 15 active days scored 91.8.",
        "The current model can also award 90.4 at 70% accuracy when consistency and coverage are perfect.",
        "A 500-question one-day cram scored Ready (86.7), while equally strong work ending 60 days ago still scored 90.8.",
        "Focused Math rose from 81.3 to 90.9 when unrelated Science activity was added, without changing Math evidence.",
    ]
    preview = "\n".join(
        f"{row['shortLabel']:<28} score={str(row['score']):>5} "
        f"P/C/C={row['performance']}/{row['consistency']}/{row['coverage']}"
        for row in selected_rows
    )
    cells = [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "# DIRI 3.1 calibration\n",
                "\n",
                "## tl;dr\n",
                *[f"- {line}\n" for line in summary],
            ],
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## Context & Methods\n",
                "\n",
                "This notebook reads deterministic outputs produced by the exact server `readiness()` function. "
                "Synthetic histories use the live ACT/SAT catalogs and a fixed clock so results are repeatable. "
                "These are calibration cases, not real-world predictive validation.\n",
                "\n",
                "### Key Assumptions\n",
                "- DIRI uses the trailing 90 days.\n",
                "- Overall estimates require 100 answered questions; focused estimates require 40.\n",
                "- Current weights are Performance 40%, Consistency 30%, Coverage 30%.\n",
                "- Unless a scenario says otherwise, pacing is 60 seconds used against 60 seconds allocated.\n",
            ],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "import json\n",
                "from pathlib import Path\n",
                "results = json.loads(Path('simulation-results.json').read_text(encoding='utf-8'))\n",
                "results['formulaVersion'], results['checks']\n",
            ],
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": ["## Data\n", "\n", "Selected scenario output from the executed simulation harness:\n"],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "selected = {row['id']: row for row in results['scenarios']}\n",
                "for key in ['minimum-balanced', 'balanced-300', 'accuracy-70-max', "
                "'fresh-cram', 'stale-60', 'one-subject-broad', 'timer-generous', "
                "'focused-math-plus-other-days']:\n",
                "    row = selected[key]\n",
                "    print(key, row['result']['score'], row['result'].get('pillars'))\n",
            ],
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": ["## Results\n", "\n", "```text\n", preview, "\n```\n"],
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "for row in results['theoreticalAccuracyFloors']:\n",
                "    print(row)\n",
            ],
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "## Takeaways\n",
                "\n",
                "1. DIRI is monotonic in accuracy, but current weights allow activity and breadth to rescue weak performance too aggressively.\n",
                "2. Recency and active-day breakpoints do not prevent cramming or stale high scores from remaining Ready.\n",
                "3. Coverage must be computed within each subject before aggregation; current global numerators permit cross-subsidization.\n",
                "4. Pacing should use canonical exam allocations, not a timer selected for an individual drill.\n",
                "5. Native offline mode should stop recomputing a different formula and instead show the cached canonical DIRI.\n",
            ],
        },
    ]
    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


def artifact(results: dict) -> dict:
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    all_rows = [scenario_row(row) for row in results["scenarios"]]
    selected_ids = [
        "minimum-balanced", "balanced-200", "balanced-300", "balanced-500",
        "accuracy-70-max", "fresh-cram", "stale-60", "one-subject-broad",
        "cross-subsidized-coverage", "slow-90", "timer-generous",
        "focused-math-only-days", "focused-math-plus-other-days",
    ]
    selected = [next(row for row in all_rows if row["id"] == row_id) for row_id in selected_ids]
    pillars_long = [
        {"scenario": row["shortLabel"], "pillar": pillar.title(), "pillarScore": row[pillar]}
        for row in selected
        for pillar in ("performance", "consistency", "coverage")
    ]
    sweep_long = []
    model_labels = {
        "currentScore": "Current 40/30/30",
        "balanced-50-25-25": "Performance 50%",
        "performance-60-20-20": "Performance 60%",
    }
    for row in results["accuracySweep"]:
        for field, label in model_labels.items():
            sweep_long.append({
                "accuracy": row["accuracy"],
                "model": label,
                "diriScore": row[field],
                "attempted": 500,
                "activeDays": 24,
            })
    attainability = []
    for row in results["attainability"]:
        attainability.append({
            "accuracy": row["accuracy"],
            "readyAttempts": row["firstReady"]["attempted"] if row["firstReady"] else None,
            "readySessions": row["firstReady"]["sessions"] if row["firstReady"] else None,
            "diri90Attempts": row["first90"]["attempted"] if row["first90"] else None,
            "diri90Sessions": row["first90"]["sessions"] if row["first90"] else None,
        })
    floors = [{
        "model": row["model"],
        "target": row["target"],
        "currentPacingFloor": row["minAccuracyWithCurrentPerformance"],
        "penaltyOnlyPacingFloor": row["minAccuracyWithPenaltyOnlyPacing"],
    } for row in results["theoreticalAccuracyFloors"]]
    breakpoints = [
        {"component": "Evidence", "breakpoint": "Overall estimate", "value": "100 answered questions"},
        {"component": "Evidence", "breakpoint": "Focused estimate", "value": "40 answered questions"},
        {"component": "Window", "breakpoint": "Lookback", "value": "90 trailing days"},
        {"component": "Consistency", "breakpoint": "Volume maximum", "value": "500 attempts"},
        {"component": "Consistency", "breakpoint": "Active-day maximum", "value": "24 active days"},
        {"component": "Consistency", "breakpoint": "Freshness reaches zero", "value": "40 days since practice"},
        {"component": "Coverage", "breakpoint": "Meaningful subject", "value": "10 attempts"},
        {"component": "Coverage", "breakpoint": "Additional subject expected", "value": "Every 40 attempts"},
        {"component": "Coverage", "breakpoint": "Meaningful module", "value": "5 attempts"},
        {"component": "Coverage", "breakpoint": "Additional module expected", "value": "Every 20 subject attempts"},
        {"component": "Coverage", "breakpoint": "Additional test expected", "value": "Every 5 subject sessions"},
        {"component": "Confidence", "breakpoint": "Maximum", "value": "450 attempted questions"},
    ]
    platform = [
        {"surface": "Web", "online": "Server diri-3.1", "offline": "No offline analytics recomputation", "risk": "Low"},
        {"surface": "Native online", "online": "Server diri-3.1 after sync", "offline": "Local fallback shown first", "risk": "Transient drift"},
        {"surface": "Native offline", "online": "Not available", "offline": "Older QML formula", "risk": "Material formula drift"},
        {"surface": "Educator web", "online": "Server diri-3.1", "offline": "Not supported", "risk": "Low"},
    ]

    sources = [
        {
            "id": "server_formula",
            "label": "Canonical DIRI 3.1 implementation",
            "path": "functions/handlers/_analytics.js",
            "query": {
                "sql": "SELECT content FROM read_text('functions/handlers/_analytics.js');",
                "description": "Executes the canonical server-owned readiness calculation.",
                "engine": "duckdb",
                "language": "sql",
                "tables_used": ["functions/handlers/_analytics.js"],
                "filters": ["Trailing 90 days", "Canonical graded analytics attempts"],
                "metric_definitions": {
                    "DIRI": "0.40 * Performance + 0.30 * Consistency + 0.30 * Coverage",
                    "Performance": "0.80 * accuracy percentage + 0.20 * pacing percentage",
                },
            },
        },
        {
            "id": "simulation",
            "label": "Deterministic DIRI simulation results",
            "path": "analysis/diri_calibration/simulation-results.json",
            "query": {
                "sql": "SELECT * FROM read_csv_auto('analysis/diri_calibration/scenario-results.csv');",
                "description": "Loads the bounded synthetic-account outputs produced by the exact server formula.",
                "engine": "duckdb",
                "language": "sql",
                "tables_used": ["analysis/diri_calibration/simulation-results.json"],
                "filters": ["Fixed simulation clock: 2026-08-11T12:00:00Z", "ACT and SAT live catalogs"],
                "metric_definitions": {
                    "scenario score": "Exact return value from readiness() for one deterministic synthetic history",
                    "accuracy": "Correct answers divided by attempted questions",
                },
            },
        },
        {"id": "scenario_csv", "label": "Scenario result extract", "path": "analysis/diri_calibration/scenario-results.csv"},
        {
            "id": "native_formula",
            "label": "Native online and offline analytics behavior",
            "path": "Drill_Instructor/qml/Student/Bootcamps/Analytics.qml",
            "query": {
                "sql": "SELECT content FROM read_text('Drill_Instructor/qml/Student/Bootcamps/Analytics.qml');",
                "description": "Identifies the canonical online response path and the separate native offline formula.",
                "engine": "duckdb",
                "language": "sql",
                "tables_used": ["Drill_Instructor/qml/Student/Bootcamps/Analytics.qml"],
                "filters": ["Student analytics page", "Connectivity-dependent execution path"],
                "metric_definitions": {"parity risk": "Whether the displayed DIRI uses server diri-3.1"},
            },
        },
        {"id": "catalog", "label": "Live ACT and SAT catalog construction", "path": "functions/handlers/_studentDrill.js"},
    ]
    charts = [
        {
            "id": "scenario_scores",
            "title": "DIRI across calibration scenarios",
            "subtitle": "Exact diri-3.1 results; Ready begins at 85 and DIRI 90 is shown as a stronger reference point.",
            "type": "bar",
            "dataset": "selected_scenarios",
            "sourceId": "simulation",
            "encodings": {
                "x": {"field": "shortLabel", "type": "nominal", "label": "Synthetic account"},
                "y": {"field": "score", "type": "quantitative", "label": "DIRI"},
                "tooltip": [
                    {"field": "accuracy", "type": "quantitative", "label": "Accuracy"},
                    {"field": "attempted", "type": "quantitative", "label": "Questions"},
                    {"field": "sessions", "type": "quantitative", "label": "Sessions"},
                    {"field": "band", "type": "nominal", "label": "Band"},
                ],
            },
        },
        {
            "id": "accuracy_weight_sweep",
            "title": "DIRI sensitivity to accuracy and pillar weights",
            "subtitle": "500 attempts over 24 active days with full adaptive coverage; only accuracy and the outer pillar weights change.",
            "type": "line",
            "dataset": "accuracy_weight_sweep",
            "sourceId": "simulation",
            "encodings": {
                "x": {"field": "accuracy", "type": "quantitative", "label": "Accuracy (%)"},
                "y": {"field": "diriScore", "type": "quantitative", "label": "DIRI"},
                "color": {"field": "model", "type": "nominal", "label": "Weight model"},
                "tooltip": [
                    {"field": "attempted", "type": "quantitative", "label": "Questions"},
                    {"field": "activeDays", "type": "quantitative", "label": "Active days"},
                ],
            },
        },
        {
            "id": "pillar_scenarios",
            "title": "Pillar scores reveal how weak signals are rescued",
            "subtitle": "Performance, Consistency, and Coverage for selected hypothetical accounts.",
            "type": "bar",
            "dataset": "pillars_long",
            "sourceId": "simulation",
            "encodings": {
                "x": {"field": "scenario", "type": "nominal", "label": "Synthetic account"},
                "y": {"field": "pillarScore", "type": "quantitative", "label": "Pillar score"},
                "color": {"field": "pillar", "type": "nominal", "label": "Pillar"},
            },
        },
    ]
    tables = [
        {
            "id": "scenario_table",
            "title": "Selected calibration accounts",
            "subtitle": "Exact production-formula outputs for the scenarios discussed in the report.",
            "dataset": "selected_scenarios",
            "sourceId": "simulation",
            "defaultSort": {"field": "score", "direction": "desc"},
            "columns": [
                {"field": "scenario", "label": "Scenario", "type": "text"},
                {"field": "accuracy", "label": "Accuracy", "format": "number", "unit": "%"},
                {"field": "attempted", "label": "Questions", "format": "number"},
                {"field": "sessions", "label": "Sessions", "format": "number"},
                {"field": "score", "label": "DIRI", "format": "number"},
                {"field": "band", "label": "Band", "type": "text"},
            ],
        },
        {
            "id": "floor_table",
            "title": "Theoretical minimum accuracy when other pillars are perfect",
            "subtitle": "These are mathematical lower bounds, not expected student journeys.",
            "dataset": "accuracy_floors",
            "sourceId": "simulation",
            "defaultSort": {"field": "target", "direction": "asc"},
            "columns": [
                {"field": "model", "label": "Weight model", "type": "text"},
                {"field": "target", "label": "DIRI target", "format": "number"},
                {"field": "currentPacingFloor", "label": "Current pacing formula", "format": "number", "unit": "%"},
                {"field": "penaltyOnlyPacingFloor", "label": "Penalty-only pacing", "format": "number", "unit": "%"},
            ],
        },
        {
            "id": "attainability_table",
            "title": "Lowest question volume found in the calibration grid",
            "subtitle": "For each accuracy, sessions were varied from 1 to 24 and questions from 100 to 600 with adaptive full breadth.",
            "dataset": "attainability",
            "sourceId": "simulation",
            "defaultSort": {"field": "accuracy", "direction": "asc"},
            "columns": [
                {"field": "accuracy", "label": "Accuracy", "format": "number", "unit": "%"},
                {"field": "readyAttempts", "label": "Questions for Ready", "format": "number"},
                {"field": "readySessions", "label": "Sessions for Ready", "format": "number"},
                {"field": "diri90Attempts", "label": "Questions for DIRI 90", "format": "number"},
                {"field": "diri90Sessions", "label": "Sessions for DIRI 90", "format": "number"},
            ],
        },
        {
            "id": "breakpoint_table",
            "title": "Current DIRI breakpoints",
            "subtitle": "Production thresholds in diri-3.1.",
            "dataset": "breakpoints",
            "sourceId": "server_formula",
            "defaultSort": {"field": "component", "direction": "asc"},
            "columns": [
                {"field": "component", "label": "Component", "type": "text"},
                {"field": "breakpoint", "label": "Breakpoint", "type": "text"},
                {"field": "value", "label": "Current value", "type": "text"},
            ],
        },
        {
            "id": "platform_table",
            "title": "DIRI delivery differs by platform state",
            "subtitle": "Server responses are canonical online; native offline mode still calculates an older formula.",
            "dataset": "platform_parity",
            "sourceId": "native_formula",
            "defaultSort": {"field": "surface", "direction": "asc"},
            "columns": [
                {"field": "surface", "label": "Surface", "type": "text"},
                {"field": "online", "label": "Online", "type": "text"},
                {"field": "offline", "label": "Offline", "type": "text"},
                {"field": "risk", "label": "Parity risk", "type": "text"},
            ],
        },
    ]
    source_by_id = {source["id"]: source for source in sources}
    for item in charts + tables:
        item["source"] = source_by_id[item["sourceId"]]
    blocks = [
        {"id": "title", "type": "markdown", "body": "# Can DIRI 3.1 reliably represent readiness?"},
        {
            "id": "technical_summary", "type": "markdown", "sourceId": "simulation",
            "body": "## Technical summary\n\n- **A DIRI of 90 is achievable without extreme volume.** A balanced synthetic ACT student at 90% accuracy reached 91.8 after 300 questions across 15 active days; 200 questions across 10 days reached 88.7.\n- **The current score is too easy to rescue with non-performance pillars.** With perfect Consistency and Coverage, 70% accuracy produced DIRI 90.4, and the mathematical accuracy floor for the Ready band is 53.1%.\n- **The main weaknesses are structural, not cosmetic.** A one-day 500-question cram scored Ready, practice ending 60 days ago still scored 90.8, a user-selected generous timer added four DIRI points, and extra breadth in one subject fully offset narrow coverage in others.\n- **Recommendation: do not market DIRI as calibrated readiness yet.** Keep the Estimated Readiness label and disclaimer, then move to a performance-led, penalty-only pacing model with readiness gates, per-subject coverage normalization, filtered focused-subject activity, and one canonical online/offline formula."
        },
        {
            "id": "attainable", "type": "markdown", "sourceId": "simulation",
            "body": "## DIRI 90 is realistic, but it measures more than 90% accuracy\n\nFor a genuinely strong, balanced student, 90 is not prohibitively difficult. At 90% accuracy, 100 answered questions in one session scored 83.3, 200 over 10 days scored 88.7, and 300 over 15 days scored 91.8. The formula therefore rewards sustained breadth as intended. The important caveat is that **DIRI 90 does not require 90% accuracy**: with maximum Consistency and Coverage, 70% accuracy also reached 90.4."
        },
        {"id": "scenario_chart_block", "type": "chart", "chartId": "scenario_scores"},
        {"id": "scenario_table_block", "type": "table", "tableId": "scenario_table"},
        {
            "id": "weight_result", "type": "markdown", "sourceId": "simulation",
            "body": "## Weight changes help, but weights alone cannot fix the model\n\nUnder the current 40/30/30 mix, perfect non-performance pillars contribute 60 DIRI points before performance is considered. Because pacing supplies up to 20% of Performance even when accuracy is weak, the theoretical accuracy floor is only 53.1% for Ready and 68.7% for DIRI 90. Raising Performance to 50% moves those floors to 62.5% and 75%, while 60% Performance moves them to 68.8% and 79.2%. However, increasing Performance weight also raises scores for high-accuracy cramming and one-subject practice. The better fix combines a moderate weight shift with gates and better component definitions."
        },
        {"id": "weight_chart_block", "type": "chart", "chartId": "accuracy_weight_sweep"},
        {"id": "floor_table_block", "type": "table", "tableId": "floor_table"},
        {"id": "attainability_table_block", "type": "table", "tableId": "attainability_table"},
        {
            "id": "breakpoint_result", "type": "markdown", "sourceId": "simulation",
            "body": "## Several breakpoints behave correctly in isolation but fail in combination\n\nThe 100-question overall and 40-question focused evidence gates work: 99 overall attempts return insufficient data. Volume has diminishing returns and caps at 500; active-day credit caps at 24. Yet a 500-question one-day cram still scored 86.7 because high Performance and Coverage outweighed weak Consistency. Conversely, a strong history whose latest practice was 60 days ago retained DIRI 90.8 because recency is only 20% of Consistency. The 90-day boundary also creates an unavoidable cliff when a large history expires."
        },
        {"id": "pillar_chart_block", "type": "chart", "chartId": "pillar_scenarios"},
        {"id": "breakpoint_table_block", "type": "table", "tableId": "breakpoint_table"},
        {
            "id": "pacing_result", "type": "markdown", "sourceId": "simulation",
            "body": "## Pacing currently rewards timer configuration, not exam pacing\n\nServer pacing compares active seconds per question with the time allocated inside that specific drill. The same 90%-accurate student working at 120 seconds per question scored 87.8 when allocated 60 seconds and 91.8 when allocated 360 seconds. Because students can configure drill timers, pacing can shift the final score by four points in an otherwise identical history. Fast work is never penalized; allocation divided by actual time is simply capped at 100%. Pacing should use canonical subject targets and act only as a modest penalty when the student is too slow, rather than adding a standing bonus that can rescue weak accuracy."
        },
        {
            "id": "coverage_result", "type": "markdown", "sourceId": "simulation",
            "body": "## Coverage can be cross-subsidized across subjects\n\nCoverage correctly expands expected breadth as practice grows: another subject every 40 attempts, another module every 20 subject attempts, and another practice test every five subject sessions. The flaw is aggregation. Meaningful modules and tests are summed globally, so extra English breadth can offset narrow Mathematics or Science practice. The cross-subsidized synthetic account received Coverage 100 and DIRI 91.8 despite using only one module in both Mathematics and Science. Coverage should be capped within each subject before subject scores are combined."
        },
        {
            "id": "focused_result", "type": "markdown", "sourceId": "simulation",
            "body": "## Focused DIRI leaks unrelated activity into Consistency\n\nWith 40 Math questions at 90% accuracy, focused Math DIRI was 81.3. Adding 23 active Science days raised focused Math DIRI to 90.9 without changing Math accuracy, volume, modules, tests, or timing. Graded rows are filtered to Math, but active days and freshness are calculated from every recent bootcamp attempt. A focused calculation must filter the activity history before computing all three pillars."
        },
        {
            "id": "platform_result", "type": "markdown", "sourceId": "native_formula",
            "body": "## Native offline DIRI is not the same metric\n\nWeb and online native analytics eventually consume the server-owned diri-3.1 response. Before that response arrives—and whenever the phone is offline—the native page computes a separate QML formula with different accuracy scaling, an ideal 30–90 second pacing band, different Consistency targets, entropy-based practice-test diversity, and different coverage logic. The same student can therefore see a different readiness value by connectivity state. Native offline mode should display the last cached canonical DIRI and mark it with its generated date, rather than recomputing a competing formula."
        },
        {"id": "platform_table_block", "type": "table", "tableId": "platform_table"},
        {
            "id": "definitions", "type": "markdown", "sourceId": "server_formula",
            "body": "## Scope, definitions, and method\n\nDIRI 3.1 evaluates canonical analytics attempts from the trailing 90 days. Overall readiness requires 100 graded attempts; focused readiness requires 40. Performance is 80% accuracy plus 20% pacing. Consistency is 45% logarithmic volume, 35% active days, and 20% freshness. Coverage is 40% subject breadth, 30% module breadth, and 30% practice-test breadth. The final score is 40% Performance, 30% Consistency, and 30% Coverage. Bands begin at 55 Building, 70 Almost, and 85 Ready. Confidence is evidence volume only: it starts at 65% at the overall minimum and reaches 100% at 450 attempts."
        },
        {
            "id": "recommendations", "type": "markdown",
            "body": "## Recommended DIRI 3.2 calibration\n\n1. **Use Performance 50%, Consistency 25%, Coverage 25%.** This makes exam performance primary without erasing disciplined practice.\n2. **Make pacing penalty-only.** Start Performance from accuracy and subtract at most 10 points for subject-specific slow pacing. Never derive the target from a user-selected drill timer.\n3. **Add provisional band gates.** Ready should require at least 75% accuracy, five active days, practice within 30 days, and meaningful work in every included subject. DIRI 90 should additionally require at least 85% accuracy, ten active days, practice within 21 days, and Coverage of at least 75. Keep these thresholds explicitly provisional until real outcomes can calibrate them.\n4. **Normalize Coverage per subject.** Calculate subject, module, and test breadth inside each subject, cap each subject at 100, then combine subjects using equal or bounded weights.\n5. **Filter focused activity end to end.** Accuracy, volume, active days, freshness, modules, and tests must all use the selected subject.\n6. **Keep one canonical formula.** Cache the last server DIRI for offline display; do not calculate a second native score.\n7. **Version and monitor the cutover.** Release as diri-3.2 and monitor score distributions, band transitions, attempts-to-Ready, time since last activity, and later official-exam outcomes before calling the model calibrated."
        },
        {
            "id": "limitations", "type": "markdown",
            "body": "## Limitations and robustness\n\nThese results are deterministic counterfactuals, not evidence that DIRI predicts ACT or SAT performance. They validate arithmetic, monotonicity, thresholds, and failure modes against synthetic histories. The simulation uses the live catalogs and exact server function, but it assumes answered questions are distributed deterministically and does not model question difficulty, guessing, score reliability, or official exam outcomes. Formula checks passed for score bounds, minimum evidence, pillar availability, and monotonic accuracy. Real calibration requires consented, privacy-safe outcome data or at minimum stable internal benchmarks across a meaningful student cohort."
        },
        {
            "id": "further_questions", "type": "markdown",
            "body": "## Further questions\n\n- Should DIRI be calibrated separately for ACT and SAT once outcome samples exist?\n- Should assignment attempts carry the same readiness weight as self-directed practice?\n- Should question difficulty or repeated-question exposure affect Performance confidence?\n- What official or educator-reviewed outcome can serve as the calibration target without overclaiming prediction?"
        },
    ]
    return {
        "surface": "report",
        "manifest": {
            "version": 1,
            "surface": "report",
            "title": "Can DIRI 3.1 reliably represent readiness?",
            "description": "A deterministic calibration audit of the Drill Instructor Readiness Index.",
            "generatedAt": generated_at,
            "cards": [],
            "charts": charts,
            "tables": tables,
            "sources": sources,
            "blocks": blocks,
        },
        "snapshot": {
            "version": 1,
            "generatedAt": generated_at,
            "status": "ready",
            "datasets": {
                "all_scenarios": all_rows,
                "selected_scenarios": selected,
                "pillars_long": pillars_long,
                "accuracy_weight_sweep": sweep_long,
                "attainability": attainability,
                "accuracy_floors": floors,
                "breakpoints": breakpoints,
                "platform_parity": platform,
            },
        },
        "sources": sources,
        "package_info": {"version": 1, "status": "ready"},
    }


def main() -> None:
    results = json.loads(RESULTS.read_text(encoding="utf-8"))
    selected_rows = [scenario_row(row) for row in results["scenarios"] if row["id"] in {
        "minimum-balanced", "balanced-300", "accuracy-70-max", "fresh-cram",
        "stale-60", "one-subject-broad", "timer-generous",
        "focused-math-plus-other-days",
    }]
    (OUT / "diri_calibration_analysis.ipynb").write_text(
        json.dumps(notebook(results, selected_rows), indent=2), encoding="utf-8"
    )
    (OUT / "artifact.json").write_text(
        json.dumps(artifact(results), indent=2), encoding="utf-8"
    )
    print(f"Wrote DIRI artifacts to {OUT}")


if __name__ == "__main__":
    main()
