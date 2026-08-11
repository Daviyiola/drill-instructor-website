"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {readinessV31: readiness, DIRI_FORMULA_VERSION} =
  require("./diriV31Reference");
const {buildCatalog} = require("../../functions/handlers/_studentDrill");

const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const DAY_MS = 86400000;
const CATALOGS = {
  act: buildCatalog("act"),
  sat: buildCatalog("sat"),
};

function splitInteger(total, buckets) {
  const rows = Array.from({length: buckets}, () => Math.floor(total / buckets));
  for (let index = 0; index < total % buckets; index += 1) rows[index] += 1;
  return rows;
}

function expectedDistinct(volume, cadence, available) {
  return available ? Math.min(available,
      1 + Math.floor(Math.max(0, volume - 1) / cadence)) : 0;
}

function buildHistory(options) {
  const catalog = CATALOGS[options.bootcamp || "act"];
  const catalogBySubject = Object.fromEntries(
      catalog.subjects.map((subject) => [subject.name, subject]),
  );
  const selectedSubjects = options.subjects || catalog.subjects.map((row) => row.name);
  const sessionCount = Math.max(1, Number(options.sessions || 1));
  const attempted = Math.max(0, Number(options.attempted || 0));
  const sessionSizes = splitInteger(attempted, sessionCount);
  const daysAgo = options.daysAgo || Array.from(
      {length: sessionCount},
      (_, index) => Math.round((sessionCount - 1 - index) *
        Number(options.daySpacing === undefined ? 1 : options.daySpacing)),
  );

  const slots = [];
  let globalQuestion = 0;
  sessionSizes.forEach((size, sessionIndex) => {
    for (let index = 0; index < size; index += 1) {
      slots.push({
        sessionIndex,
        subject: selectedSubjects[globalQuestion % selectedSubjects.length],
      });
      globalQuestion += 1;
    }
  });

  const subjectTotals = {};
  const subjectSessionIndexes = {};
  slots.forEach((slot) => {
    subjectTotals[slot.subject] = (subjectTotals[slot.subject] || 0) + 1;
    if (!subjectSessionIndexes[slot.subject]) subjectSessionIndexes[slot.subject] = new Set();
    subjectSessionIndexes[slot.subject].add(slot.sessionIndex);
  });

  const moduleCounts = {};
  const testCounts = {};
  selectedSubjects.forEach((subject) => {
    const descriptor = catalogBySubject[subject];
    const requestedModuleBreadth = options.moduleBreadthBySubject &&
      options.moduleBreadthBySubject[subject] !== undefined ?
      options.moduleBreadthBySubject[subject] : options.moduleBreadth;
    const requestedTestBreadth = options.testBreadthBySubject &&
      options.testBreadthBySubject[subject] !== undefined ?
      options.testBreadthBySubject[subject] : options.testBreadth;
    const adaptiveModules = expectedDistinct(
        subjectTotals[subject] || 0,
        20,
        descriptor.modules.length,
    );
    const adaptiveTests = expectedDistinct(
        (subjectSessionIndexes[subject] || new Set()).size,
        5,
        descriptor.practiceYears.length,
    );
    moduleCounts[subject] = Math.max(1, Math.min(
        descriptor.modules.length,
        requestedModuleBreadth === "all" ? descriptor.modules.length :
        requestedModuleBreadth === "adaptive" || requestedModuleBreadth === undefined ?
          adaptiveModules : Number(requestedModuleBreadth),
    ));
    testCounts[subject] = Math.max(1, Math.min(
        descriptor.practiceYears.length,
        requestedTestBreadth === "all" ? descriptor.practiceYears.length :
        requestedTestBreadth === "adaptive" || requestedTestBreadth === undefined ?
          adaptiveTests : Number(requestedTestBreadth),
    ));
  });

  const subjectQuestionIndex = {};
  const subjectSessionOrdinal = {};
  selectedSubjects.forEach((subject) => {
    subjectQuestionIndex[subject] = 0;
    subjectSessionOrdinal[subject] = {};
    [...(subjectSessionIndexes[subject] || [])].sort((a, b) => a - b)
        .forEach((sessionIndex, ordinal) => {
          subjectSessionOrdinal[subject][sessionIndex] = ordinal;
        });
  });

  const correctTarget = Math.round(attempted * Number(options.accuracy || 0) / 100);
  slots.forEach((slot, index) => {
    const descriptor = catalogBySubject[slot.subject];
    const subjectIndex = subjectQuestionIndex[slot.subject]++;
    slot.module = descriptor.modules[subjectIndex % moduleCounts[slot.subject]];
    slot.practiceYear = descriptor.practiceYears[
        subjectSessionOrdinal[slot.subject][slot.sessionIndex] % testCounts[slot.subject]
    ];
    slot.correct = index < correctTarget;
  });

  return sessionSizes.map((size, sessionIndex) => {
    const sessionSlots = slots.filter((slot) => slot.sessionIndex === sessionIndex);
    const subjectNames = [...new Set(sessionSlots.map((slot) => slot.subject))];
    const subjects = subjectNames.map((subject) => {
      const rows = sessionSlots.filter((slot) => slot.subject === subject);
      const correct = rows.filter((slot) => slot.correct).length;
      return {
        subject,
        totalQuestions: rows.length,
        attempted: rows.length,
        correct,
        wrong: rows.length - correct,
        unanswered: 0,
        activeTimeSec: rows.length * Number(options.secondsPerQuestion || 60),
        allocatedTimeSec: rows.length * Number(options.allocatedSecondsPerQuestion || 60),
      };
    });
    const moduleKeys = [...new Set(sessionSlots.map((slot) =>
      `${slot.subject}\u0000${slot.module}`))];
    const modules = moduleKeys.map((key) => {
      const [subject, module] = key.split("\u0000");
      const rows = sessionSlots.filter((slot) =>
        slot.subject === subject && slot.module === module);
      const correct = rows.filter((slot) => slot.correct).length;
      return {
        subject,
        module,
        totalQuestions: rows.length,
        attempted: rows.length,
        correct,
        wrong: rows.length - correct,
        unanswered: 0,
        activeTimeSec: rows.length * Number(options.secondsPerQuestion || 60),
        allocatedTimeSec: rows.length * Number(options.allocatedSecondsPerQuestion || 60),
      };
    });
    const practiceYearsBySubject = Object.fromEntries(subjectNames.map((subject) => [
      subject,
      [...new Set(sessionSlots.filter((slot) => slot.subject === subject)
          .map((slot) => slot.practiceYear))],
    ]));
    const correct = sessionSlots.filter((slot) => slot.correct).length;
    const activeTimeSec = size * Number(options.secondsPerQuestion || 60);
    return {
      attemptId: `${options.id || "persona"}-${sessionIndex + 1}`,
      studentId: `synthetic-${options.id || "persona"}`,
      bootcamp: catalog.bootcamp,
      source: "solo",
      sourceId: `${options.id || "persona"}-${sessionIndex + 1}`,
      submittedAt: new Date(NOW - Number(daysAgo[sessionIndex] || 0) * DAY_MS).toISOString(),
      activity: {
        totalQuestions: size,
        attempted: size,
        activeTimeSec,
        elapsedTimeSec: activeTimeSec,
      },
      performance: {
        correct,
        wrong: size - correct,
        unanswered: 0,
        points: correct * 3 + size - correct,
      },
      subjects,
      modules,
      practiceYears: [...new Set(sessionSlots.map((slot) => slot.practiceYear))],
      practiceYearsBySubject,
      release: null,
      scoreVisible: true,
    };
  });
}

function evaluate(options, focusedSubject = "") {
  const attempts = buildHistory(options);
  const result = readiness(attempts, CATALOGS[options.bootcamp || "act"], NOW,
      focusedSubject);
  return {
    id: options.id,
    label: options.label,
    bootcamp: options.bootcamp || "act",
    focusedSubject: focusedSubject || null,
    inputs: {
      attempted: options.attempted,
      accuracy: options.accuracy,
      sessions: options.sessions,
      activeDays: new Set(attempts.map((row) => row.submittedAt.slice(0, 10))).size,
      latestDaysAgo: Math.min(...attempts.map((row) =>
        Math.round((NOW - Date.parse(row.submittedAt)) / DAY_MS))),
      subjects: options.subjects || CATALOGS[options.bootcamp || "act"]
          .subjects.map((row) => row.name),
      moduleBreadth: options.moduleBreadth || "adaptive",
      testBreadth: options.testBreadth || "adaptive",
      moduleBreadthBySubject: options.moduleBreadthBySubject || null,
      testBreadthBySubject: options.testBreadthBySubject || null,
      secondsPerQuestion: options.secondsPerQuestion || 60,
      allocatedSecondsPerQuestion: options.allocatedSecondsPerQuestion || 60,
    },
    result,
  };
}

const scenarios = [
  {id: "insufficient-99", label: "99 attempts at 90% accuracy", attempted: 99,
    accuracy: 90, sessions: 5},
  {id: "minimum-balanced", label: "Minimum evidence, balanced, one fresh session",
    attempted: 100, accuracy: 90, sessions: 1},
  {id: "minimum-narrow", label: "Minimum evidence, one subject/module/test",
    attempted: 100, accuracy: 90, sessions: 1, subjects: ["Mathematics"],
    moduleBreadth: 1, testBreadth: 1},
  {id: "balanced-200", label: "Balanced 90%, 200 questions across 10 days",
    attempted: 200, accuracy: 90, sessions: 10},
  {id: "balanced-300", label: "Balanced 90%, 300 questions across 15 days",
    attempted: 300, accuracy: 90, sessions: 15},
  {id: "balanced-500", label: "Balanced 90%, 500 questions across 24 days",
    attempted: 500, accuracy: 90, sessions: 24},
  {id: "accuracy-70-max", label: "Balanced 70%, maximum consistency and coverage",
    attempted: 500, accuracy: 70, sessions: 24},
  {id: "accuracy-80-max", label: "Balanced 80%, maximum consistency and coverage",
    attempted: 500, accuracy: 80, sessions: 24},
  {id: "accuracy-85-max", label: "Balanced 85%, maximum consistency and coverage",
    attempted: 500, accuracy: 85, sessions: 24},
  {id: "fresh-cram", label: "Balanced 90% crammed into one day",
    attempted: 500, accuracy: 90, sessions: 1},
  {id: "stale-60", label: "Balanced 90%, latest practice 60 days ago",
    attempted: 500, accuracy: 90, sessions: 24,
    daysAgo: Array.from({length: 24}, (_, index) => 83 - index)},
  {id: "one-subject-broad", label: "90% practice confined to Mathematics",
    attempted: 500, accuracy: 90, sessions: 24, subjects: ["Mathematics"]},
  {id: "all-subjects-narrow", label: "90% across subjects but one module/test each",
    attempted: 500, accuracy: 90, sessions: 24, moduleBreadth: 1, testBreadth: 1},
  {id: "cross-subsidized-coverage",
    label: "One subject's extra breadth offsets narrow practice elsewhere",
    attempted: 300, accuracy: 90, sessions: 15,
    moduleBreadthBySubject: {English: "all", Mathematics: 1, Science: 1},
    testBreadthBySubject: {English: "all", Mathematics: "all", Science: 1}},
  {id: "fast-90", label: "90% accuracy at 10 seconds per question",
    attempted: 300, accuracy: 90, sessions: 15, secondsPerQuestion: 10},
  {id: "slow-90", label: "90% accuracy at 120 seconds against 60 allocated",
    attempted: 300, accuracy: 90, sessions: 15, secondsPerQuestion: 120,
    allocatedSecondsPerQuestion: 60},
  {id: "timer-generous", label: "Same slow work with a generous timer allocation",
    attempted: 300, accuracy: 90, sessions: 15, secondsPerQuestion: 120,
    allocatedSecondsPerQuestion: 360},
  {id: "sat-balanced", label: "SAT balanced 90%, 300 questions across 15 days",
    bootcamp: "sat", attempted: 300, accuracy: 90, sessions: 15},
].map((options) => evaluate(options));

const focusedBase = {
  id: "focused-math-only-days",
  label: "Focused Math DIRI with Math activity only",
  attempted: 40,
  accuracy: 90,
  sessions: 1,
  subjects: ["Mathematics"],
};
const focusedMathOnly = evaluate(focusedBase, "Mathematics");
const focusedInflatedAttempts = buildHistory(focusedBase).concat(buildHistory({
  id: "unrelated-science",
  attempted: 230,
  accuracy: 50,
  sessions: 23,
  subjects: ["Science"],
  daysAgo: Array.from({length: 23}, (_, index) => 22 - index),
}));
const focusedInflatedResult = readiness(
    focusedInflatedAttempts,
    CATALOGS.act,
    NOW,
    "Mathematics",
);
scenarios.push(focusedMathOnly, {
  id: "focused-math-plus-other-days",
  label: "Same Math evidence plus 23 unrelated Science days",
  bootcamp: "act",
  focusedSubject: "Mathematics",
  inputs: {
    ...focusedMathOnly.inputs,
    activeDays: 24,
    note: "Math evidence is unchanged; only unrelated Science activity was added.",
  },
  result: focusedInflatedResult,
});

const weightModels = [
  {id: "current-40-30-30", performance: 0.40, consistency: 0.30, coverage: 0.30},
  {id: "balanced-50-25-25", performance: 0.50, consistency: 0.25, coverage: 0.25},
  {id: "performance-60-20-20", performance: 0.60, consistency: 0.20, coverage: 0.20},
];

const theoreticalAccuracyFloors = weightModels.flatMap((weights) =>
  [85, 90].map((target) => ({
    model: weights.id,
    target,
    minAccuracyWithCurrentPerformance: Math.round(Math.max(0, Math.min(100,
        (target - (weights.consistency + weights.coverage) * 100 -
         weights.performance * 20) / (weights.performance * 0.8),
    )) * 10) / 10,
    minAccuracyWithPenaltyOnlyPacing: Math.round(Math.max(0, Math.min(100,
        (target - (weights.consistency + weights.coverage) * 100) /
        weights.performance,
    )) * 10) / 10,
  })),
);

const breakpoints = {
  evidence: {overallAttempts: 100, focusedAttempts: 40, windowDays: 90},
  confidence: {
    initialAtMinimumOverall: 0.65,
    maximumAttempts: 450,
    calculation: "min(1, 0.55 + attempted / 1000)",
  },
  consistency: {
    volumeMaximumAttempts: 500,
    activeDaysMaximum: 24,
    recencyPointsLostPerDay: 2.5,
    recencyReachesZeroDays: 40,
  },
  coverage: {
    meaningfulSubjectAttempts: 10,
    additionalSubjectEveryAttempts: 40,
    meaningfulModuleAttempts: 5,
    additionalModuleEverySubjectAttempts: 20,
    additionalPracticeTestEverySubjectSessions: 5,
  },
};

const weightedScenarios = scenarios.filter((row) => row.result.pillars).flatMap((row) =>
  weightModels.map((weights) => ({
    scenarioId: row.id,
    model: weights.id,
    score: Math.round((
      row.result.pillars.performance * weights.performance +
      row.result.pillars.consistency * weights.consistency +
      row.result.pillars.coverage * weights.coverage
    ) * 10) / 10,
  })),
);

const accuracySweep = [];
for (let accuracy = 40; accuracy <= 100; accuracy += 5) {
  const row = evaluate({
    id: `accuracy-${accuracy}`,
    label: `${accuracy}% accuracy with maximum consistency and adaptive coverage`,
    attempted: 500,
    accuracy,
    sessions: 24,
  });
  accuracySweep.push({
    accuracy,
    currentScore: row.result.score,
    performance: row.result.pillars.performance,
    consistency: row.result.pillars.consistency,
    coverage: row.result.pillars.coverage,
    ...Object.fromEntries(weightModels.slice(1).map((weights) => [
      weights.id,
      Math.round((
        row.result.pillars.performance * weights.performance +
        row.result.pillars.consistency * weights.consistency +
        row.result.pillars.coverage * weights.coverage
      ) * 10) / 10,
    ])),
  });
}

const attainability = [];
for (const accuracy of [60, 70, 75, 80, 85, 90, 95]) {
  let first90 = null;
  let firstReady = null;
  for (let attempted = 100; attempted <= 600; attempted += 10) {
    for (let sessions = 1; sessions <= 24; sessions += 1) {
      const row = evaluate({
        id: `grid-${accuracy}-${sessions}-${attempted}`,
        label: "grid",
        attempted,
        accuracy,
        sessions,
      });
      if (!firstReady && row.result.score >= 85) {
        firstReady = {attempted, sessions, score: row.result.score};
      }
      if (!first90 && row.result.score >= 90) {
        first90 = {attempted, sessions, score: row.result.score};
      }
    }
    if (firstReady && first90) break;
  }
  attainability.push({accuracy, firstReady, first90});
}

const catalogs = Object.fromEntries(["act", "sat"].map((bootcamp) => {
  const catalog = CATALOGS[bootcamp];
  return [bootcamp, catalog.subjects.map((subject) => ({
    name: subject.name,
    moduleCount: subject.modules.length,
    practiceTestCount: subject.practiceYears.length,
    questionCount: subject.questionCount,
  }))];
}));

const checks = {
  accuracyMonotonic: accuracySweep.every((row, index) =>
    index === 0 || row.currentScore >= accuracySweep[index - 1].currentScore),
  scoreBounds: scenarios.every((row) => row.result.score === null ||
    (row.result.score >= 0 && row.result.score <= 100)),
  pillarsPresentWhenEstimated: scenarios.every((row) =>
    row.result.status !== "estimated" || Boolean(row.result.pillars)),
  minimumEvidenceGate: scenarios.find((row) => row.id === "insufficient-99")
      .result.status === "insufficient_data",
};

const output = {
  generatedAt: new Date().toISOString(),
  simulationNow: new Date(NOW).toISOString(),
  formulaVersion: DIRI_FORMULA_VERSION,
  catalogs,
  breakpoints,
  weightModels,
  theoreticalAccuracyFloors,
  scenarios,
  weightedScenarios,
  accuracySweep,
  attainability,
  checks,
};

const outputDir = path.resolve(__dirname);
fs.mkdirSync(outputDir, {recursive: true});
fs.writeFileSync(path.join(outputDir, "simulation-results.json"),
    JSON.stringify(output, null, 2));

const scenarioHeaders = [
  "id", "label", "bootcamp", "focusedSubject", "attempted", "accuracy", "sessions",
  "activeDays", "latestDaysAgo", "status", "score", "band", "confidence",
  "performance", "consistency", "coverage",
];
const csvEscape = (value) => `"${String(value === null || value === undefined ? "" : value)
    .replaceAll('"', '""')}"`;
const scenarioCsv = [scenarioHeaders.join(",")].concat(scenarios.map((row) =>
  scenarioHeaders.map((key) => csvEscape({
    ...row,
    ...row.inputs,
    status: row.result.status,
    score: row.result.score,
    band: row.result.band,
    confidence: row.result.confidence,
    performance: row.result.pillars && row.result.pillars.performance,
    consistency: row.result.pillars && row.result.pillars.consistency,
    coverage: row.result.pillars && row.result.pillars.coverage,
  }[key])).join(","),
)).join("\n");
fs.writeFileSync(path.join(outputDir, "scenario-results.csv"), scenarioCsv);

console.log(JSON.stringify({
  formulaVersion: output.formulaVersion,
  scenarios: scenarios.map((row) => ({
    id: row.id,
    score: row.result.score,
    band: row.result.band,
    pillars: row.result.pillars,
  })),
  attainability,
}, null, 2));
