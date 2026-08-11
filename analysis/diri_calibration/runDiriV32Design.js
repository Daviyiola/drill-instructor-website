"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {buildCatalog} = require("../../functions/handlers/_studentDrill");

const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const DAY_MS = 86400000;
const CATALOGS = {act: buildCatalog("act"), sat: buildCatalog("sat")};
const CANONICAL_SECONDS = {
  act: {English: 42, Mathematics: 50 * 60 / 45, Science: 60},
  sat: {"Read. & Writ.": 64 * 60 / 54, Math: 70 * 60 / 44},
};

function clamp(value, low = 0, high = 100) {
  return Math.max(low, Math.min(high, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function splitInteger(total, buckets) {
  const rows = Array.from({length: buckets}, () => Math.floor(total / buckets));
  for (let index = 0; index < total % buckets; index += 1) rows[index] += 1;
  return rows;
}

function expectedDistinct(volume, cadence, available) {
  if (!available || !volume) return 0;
  return Math.min(available, 1 + Math.floor((volume - 1) / cadence));
}

function weekKey(iso) {
  const date = new Date(iso);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

function buildHistory(options) {
  const bootcamp = options.bootcamp || "act";
  const catalog = CATALOGS[bootcamp];
  const bySubject = Object.fromEntries(catalog.subjects.map((row) => [row.name, row]));
  const subjects = options.subjects || catalog.subjects.map((row) => row.name);
  const sessions = Math.max(1, Number(options.sessions || 1));
  const sessionSizes = splitInteger(Number(options.attempted || 0), sessions);
  const daysAgo = options.daysAgo || Array.from({length: sessions}, (_, index) =>
    Math.round((sessions - 1 - index) * Number(options.daySpacing ?? 1)));
  const slots = [];
  let globalIndex = 0;
  sessionSizes.forEach((size, sessionIndex) => {
    for (let index = 0; index < size; index += 1) {
      slots.push({sessionIndex, subject: subjects[globalIndex++ % subjects.length]});
    }
  });
  const subjectTotals = {};
  const subjectSessions = {};
  slots.forEach((slot) => {
    subjectTotals[slot.subject] = (subjectTotals[slot.subject] || 0) + 1;
    (subjectSessions[slot.subject] ||= new Set()).add(slot.sessionIndex);
  });
  const moduleCounts = {};
  const testCounts = {};
  subjects.forEach((subject) => {
    const descriptor = bySubject[subject];
    const moduleChoice = options.moduleBreadthBySubject?.[subject] ??
      options.moduleBreadth ?? "adaptive";
    const testChoice = options.testBreadthBySubject?.[subject] ??
      options.testBreadth ?? "adaptive";
    const adaptiveModules = expectedDistinct(subjectTotals[subject], 25,
        descriptor.modules.length);
    const adaptiveTests = expectedDistinct(subjectSessions[subject].size, 5,
        descriptor.practiceYears.length);
    moduleCounts[subject] = Math.max(1, Math.min(descriptor.modules.length,
      moduleChoice === "all" ? descriptor.modules.length :
      moduleChoice === "adaptive" ? adaptiveModules : Number(moduleChoice)));
    testCounts[subject] = Math.max(1, Math.min(descriptor.practiceYears.length,
      testChoice === "all" ? descriptor.practiceYears.length :
      testChoice === "adaptive" ? adaptiveTests : Number(testChoice)));
  });
  const subjectOrdinal = Object.fromEntries(subjects.map((subject) => [subject, 0]));
  const sessionOrdinal = {};
  subjects.forEach((subject) => {
    sessionOrdinal[subject] = {};
    [...subjectSessions[subject]].sort((a, b) => a - b).forEach((value, index) => {
      sessionOrdinal[subject][value] = index;
    });
  });
  slots.forEach((slot) => {
    const descriptor = bySubject[slot.subject];
    const ordinal = subjectOrdinal[slot.subject]++;
    slot.module = descriptor.modules[ordinal % moduleCounts[slot.subject]];
    slot.practiceYear = descriptor.practiceYears[
        sessionOrdinal[slot.subject][slot.sessionIndex] % testCounts[slot.subject]];
  });
  const accuracyBySubject = options.accuracyBySubject || {};
  subjects.forEach((subject) => {
    const subjectSlots = slots.filter((slot) => slot.subject === subject);
    const rate = Number(accuracyBySubject[subject] ?? options.accuracy ?? 0) / 100;
    subjectSlots.forEach((slot, index) => {
      slot.correct = Math.floor((index + 1) * rate) > Math.floor(index * rate);
    });
  });
  return sessionSizes.map((size, sessionIndex) => {
    const rows = slots.filter((slot) => slot.sessionIndex === sessionIndex);
    const sessionSubjects = [...new Set(rows.map((row) => row.subject))];
    const subjectRows = sessionSubjects.map((subject) => {
      const selected = rows.filter((row) => row.subject === subject);
      const correct = selected.filter((row) => row.correct).length;
      const seconds = Number(options.secondsPerQuestionBySubject?.[subject] ??
        options.secondsPerQuestion ?? CANONICAL_SECONDS[bootcamp][subject] ?? 60);
      return {subject, attempted: selected.length, correct,
        wrong: selected.length - correct, activeTimeSec: selected.length * seconds};
    });
    const moduleRows = [...new Set(rows.map((row) => `${row.subject}\u0000${row.module}`))]
        .map((key) => {
          const [subject, module] = key.split("\u0000");
          const selected = rows.filter((row) => row.subject === subject && row.module === module);
          return {subject, module, attempted: selected.length,
            correct: selected.filter((row) => row.correct).length};
        });
    const practiceYearsBySubject = Object.fromEntries(sessionSubjects.map((subject) => [
      subject, [...new Set(rows.filter((row) => row.subject === subject)
          .map((row) => row.practiceYear))],
    ]));
    return {
      submittedAt: new Date(NOW - Number(daysAgo[sessionIndex] || 0) * DAY_MS).toISOString(),
      scoreVisible: true,
      activity: {attempted: size},
      subjects: subjectRows,
      modules: moduleRows,
      practiceYearsBySubject,
      practiceYears: [...new Set(rows.map((row) => row.practiceYear))],
    };
  });
}

function readinessV32(attempts, catalog, bootcamp, focusedSubject = "") {
  const cutoff = NOW - 90 * DAY_MS;
  const recent = attempts.filter((attempt) => Date.parse(attempt.submittedAt) >= cutoff);
  const scoped = focusedSubject ? recent.filter((attempt) =>
    attempt.subjects.some((row) => row.subject === focusedSubject && row.attempted > 0)) : recent;
  const rows = scoped.filter((attempt) => attempt.scoreVisible !== false)
      .flatMap((attempt) => attempt.subjects
          .filter((row) => !focusedSubject || row.subject === focusedSubject)
          .map((row) => ({...row, submittedAt: attempt.submittedAt})));
  const attempted = rows.reduce((sum, row) => sum + row.attempted, 0);
  const minimum = focusedSubject ? 40 : 100;
  if (attempted < minimum) return {status: "insufficient_data", score: null, attempted};

  const weighted = rows.reduce((total, row) => {
    const ageDays = (NOW - Date.parse(row.submittedAt)) / DAY_MS;
    const weight = .5 ** (ageDays / 45);
    total.correct += row.correct * weight;
    total.attempted += row.attempted * weight;
    return total;
  }, {correct: 0, attempted: 0});
  const overallAccuracy = 100 * weighted.correct / weighted.attempted;
  const subjectNames = [...new Set(rows.map((row) => row.subject))];
  const subjectAccuracies = subjectNames.map((subject) => {
    const selected = rows.filter((row) => row.subject === subject);
    const total = selected.reduce((sum, row) => sum + row.attempted, 0);
    const values = selected.reduce((aggregate, row) => {
      const ageDays = (NOW - Date.parse(row.submittedAt)) / DAY_MS;
      const weight = .5 ** (ageDays / 45);
      aggregate.correct += row.correct * weight;
      aggregate.attempted += row.attempted * weight;
      return aggregate;
    }, {correct: 0, attempted: 0});
    return {subject, attempted: total, accuracy: 100 * values.correct / values.attempted};
  }).filter((row) => row.attempted >= (focusedSubject ? 10 : 20));
  const weakestSubject = subjectAccuracies.length ?
    Math.min(...subjectAccuracies.map((row) => row.accuracy)) : overallAccuracy;
  const mastery = .8 * overallAccuracy + .2 * weakestSubject;

  const activeDates = [...new Set(scoped.map((row) => row.submittedAt.slice(0, 10)))];
  const activeWeeks = new Set(scoped.map((row) => weekKey(row.submittedAt))).size;
  const latestDays = Math.min(...scoped.map((row) =>
    (NOW - Date.parse(row.submittedAt)) / DAY_MS));
  const consistency = .5 * Math.min(100, activeWeeks / 10 * 100) +
    .3 * Math.min(100, activeDates.length / 24 * 100) +
    .2 * (100 * .5 ** (latestDays / 14));

  const catalogSubjects = catalog.subjects.filter((row) =>
    !focusedSubject || row.name === focusedSubject);
  const subjectAttempts = {};
  const moduleAttempts = {};
  scoped.forEach((attempt) => {
    attempt.subjects.forEach((row) => {
      if (!focusedSubject || row.subject === focusedSubject) {
        subjectAttempts[row.subject] = (subjectAttempts[row.subject] || 0) + row.attempted;
      }
    });
    attempt.modules.forEach((row) => {
      if (!focusedSubject || row.subject === focusedSubject) {
        const key = `${row.subject}\u0000${row.module}`;
        moduleAttempts[key] = (moduleAttempts[key] || 0) + row.attempted;
      }
    });
  });
  const subjectRequired = expectedDistinct(attempted, 40, catalogSubjects.length);
  const meaningfulSubjects = catalogSubjects.filter((subject) =>
    (subjectAttempts[subject.name] || 0) >= 10);
  const subjectCoverage = subjectRequired ?
    Math.min(1, meaningfulSubjects.length / subjectRequired) : 0;
  const withinSubject = meaningfulSubjects.map((descriptor) => {
    const subject = descriptor.name;
    const count = subjectAttempts[subject] || 0;
    const requiredModules = expectedDistinct(count, 25, descriptor.modules.length);
    const usedModules = descriptor.modules.filter((module) =>
      (moduleAttempts[`${subject}\u0000${module}`] || 0) >= 5).length;
    const subjectAttemptsList = scoped.filter((attempt) => attempt.subjects
        .some((row) => row.subject === subject && row.attempted > 0));
    const requiredTests = expectedDistinct(subjectAttemptsList.length, 5,
        descriptor.practiceYears.length);
    const usedTests = new Set(subjectAttemptsList.flatMap((attempt) =>
      attempt.practiceYearsBySubject?.[subject] || []));
    return {
      module: requiredModules ? Math.min(1, usedModules / requiredModules) : 0,
      test: requiredTests ? Math.min(1, usedTests.size / requiredTests) : 0,
    };
  });
  const moduleCoverage = withinSubject.length ?
    withinSubject.reduce((sum, row) => sum + row.module, 0) / withinSubject.length : 0;
  const testCoverage = withinSubject.length ?
    withinSubject.reduce((sum, row) => sum + row.test, 0) / withinSubject.length : 0;
  const breadth = 100 * subjectCoverage *
    (.45 + .35 * moduleCoverage + .20 * testCoverage);

  let actualSeconds = 0;
  let targetSeconds = 0;
  rows.forEach((row) => {
    actualSeconds += row.activeTimeSec || 0;
    targetSeconds += row.attempted * (CANONICAL_SECONDS[bootcamp][row.subject] || 60);
  });
  const paceRatio = actualSeconds / Math.max(1, targetSeconds);
  let pacingPenalty = 0;
  if (paceRatio > 1.15 && paceRatio <= 1.5) pacingPenalty = (paceRatio - 1.15) / .35 * 3;
  else if (paceRatio > 1.5 && paceRatio <= 2) pacingPenalty = 3 + (paceRatio - 1.5) / .5 * 2;
  else if (paceRatio > 2) pacingPenalty = 5;

  const weightedComposite = .65 * mastery + .20 * consistency + .15 * breadth;
  const anchored = Math.min(weightedComposite, mastery + 5);
  const evidenceTarget = focusedSubject ? 160 : 400;
  const evidenceCeiling = 85 + 15 * clamp(
      (attempted - minimum) / (evidenceTarget - minimum), 0, 1);
  let score = clamp(Math.min(anchored - pacingPenalty, evidenceCeiling));
  const constraints = [];
  if (mastery < 80) constraints.push("mastery_below_ready_floor");
  if (consistency < 50) constraints.push("consistency_below_ready_floor");
  if (breadth < 60) constraints.push("breadth_below_ready_floor");
  if (constraints.length) score = Math.min(score, 84.9);
  if (mastery < 85 || consistency < 75 || breadth < 75 || attempted < 200) {
    score = Math.min(score, 89.9);
    constraints.push("high_readiness_evidence_incomplete");
  }
  const confidence = .5 * Math.min(1, attempted / 300) +
    .3 * Math.min(1, activeWeeks / 8) + .2 * breadth / 100;
  return {
    status: "estimated", score: round(score),
    band: score >= 85 ? "Ready" : score >= 70 ? "Almost" :
      score >= 55 ? "Building" : "Foundation",
    confidence: round(confidence, 2), attempted, evidenceCeiling: round(evidenceCeiling),
    constraints: [...new Set(constraints)],
    pillars: {mastery: round(mastery), consistency: round(consistency),
      breadth: round(breadth), pacingPenalty: round(pacingPenalty),
      activeDays: activeDates.length, activeWeeks, latestDays: round(latestDays),
      paceRatio: round(paceRatio, 2), weakestSubject: round(weakestSubject),
      accuracy: round(overallAccuracy)},
  };
}

const scenarios = [
  {id: "insufficient", attempted: 99, accuracy: 90, sessions: 10, daySpacing: 7},
  {id: "balanced-90-15-consecutive", attempted: 300, accuracy: 90, sessions: 15},
  {id: "balanced-90-15-distributed", attempted: 300, accuracy: 90, sessions: 15,
    daySpacing: 6},
  {id: "balanced-90-20-distributed", attempted: 400, accuracy: 90, sessions: 20,
    daySpacing: 4},
  {id: "balanced-85-excellent", attempted: 500, accuracy: 85, sessions: 24,
    daySpacing: 3},
  {id: "crammed-90", attempted: 500, accuracy: 90, sessions: 24,
    daysAgo: Array(24).fill(0)},
  {id: "stale-90", attempted: 500, accuracy: 90, sessions: 24,
    daysAgo: Array.from({length: 24}, (_, index) => 60 + index)},
  {id: "narrow-modules-90", attempted: 500, accuracy: 90, sessions: 24,
    daySpacing: 3, moduleBreadth: 1, testBreadth: 1},
  {id: "one-subject-90", attempted: 500, accuracy: 90, sessions: 24,
    daySpacing: 3, subjects: ["Mathematics"]},
  {id: "weak-subject", attempted: 450, accuracy: 90, sessions: 24,
    daySpacing: 3, accuracyBySubject: {English: 95, Mathematics: 95, Science: 60}},
  {id: "high-accuracy-low-volume", attempted: 100, accuracy: 100, sessions: 5,
    daySpacing: 7},
  {id: "low-accuracy-high-discipline", attempted: 500, accuracy: 70, sessions: 24,
    daySpacing: 3},
  {id: "slow-otherwise-strong", attempted: 500, accuracy: 90, sessions: 24,
    daySpacing: 3, secondsPerQuestion: 130},
  {id: "fast-low-accuracy", attempted: 500, accuracy: 60, sessions: 24,
    daySpacing: 3, secondsPerQuestion: 15},
  {id: "sat-balanced-90", bootcamp: "sat", attempted: 300, accuracy: 90,
    sessions: 16, daySpacing: 5},
];

const results = scenarios.map((scenario) => {
  const bootcamp = scenario.bootcamp || "act";
  return {id: scenario.id, inputs: scenario,
    result: readinessV32(buildHistory(scenario), CATALOGS[bootcamp], bootcamp)};
});

const attainability = [];
for (const accuracy of [60, 65, 70, 75, 80, 85, 90, 95, 100]) {
  for (const pattern of [
    {name: "consecutive", sessions: 24, daySpacing: 1},
    {name: "distributed", sessions: 24, daySpacing: 3},
  ]) {
    const scenario = {id: `grid-${accuracy}-${pattern.name}`, attempted: 500,
      accuracy, ...pattern};
    const result = readinessV32(buildHistory(scenario), CATALOGS.act, "act");
    attainability.push({accuracy, pattern: pattern.name, score: result.score,
      consistency: result.pillars.consistency, breadth: result.pillars.breadth});
  }
}

const checks = {
  bounded: results.every((row) => row.result.score === null ||
    (row.result.score >= 0 && row.result.score <= 100)),
  insufficientGate: results.find((row) => row.id === "insufficient").result.status ===
    "insufficient_data",
  accuracyMonotonic: [60, 70, 80, 90, 100].map((accuracy) => {
    const scenario = {attempted: 500, accuracy, sessions: 24, daySpacing: 3};
    return readinessV32(buildHistory(scenario), CATALOGS.act, "act").score;
  }).every((score, index, values) => index === 0 || score >= values[index - 1]),
  distributionRewarded: results.find((row) => row.id === "balanced-90-15-distributed")
      .result.score > results.find((row) => row.id === "balanced-90-15-consecutive")
      .result.score,
  crammingNotReady: results.find((row) => row.id === "crammed-90").result.score < 85,
  staleNotReady: results.find((row) => row.id === "stale-90").result.score < 85,
  weakAccuracyCannotReach90: results.find((row) => row.id ===
    "low-accuracy-high-discipline").result.score < 90,
};

const output = {generatedAt: new Date().toISOString(), formula: "proposed-diri-3.2",
  simulationNow: new Date(NOW).toISOString(), scenarios: results, attainability, checks};
if (require.main === module) {
  const outputPath = path.join(__dirname, "proposed-diri-3.2-results.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

module.exports = {readinessV32, buildHistory, CANONICAL_SECONDS};
