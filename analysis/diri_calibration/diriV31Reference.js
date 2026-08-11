"use strict";

// Frozen reference implementation of the pre-launch DIRI 3.1 formula.
// This file is documentation/research only. Production uses
// functions/handlers/_diri.js. Do not import this file from Functions.

const DIRI_FORMULA_VERSION = "diri-3.1";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function sumRows(rows) {
  const summary = rows.reduce((total, row) => ({
    attempted: total.attempted + number(row.attempted),
    correct: total.correct + number(row.correct),
  }), {attempted: 0, correct: 0});
  return {...summary, accuracy: summary.attempted ?
    summary.correct / summary.attempted * 100 : null};
}

function readinessV31(attempts, catalog, now = Date.now(), focusedSubject = "") {
  const cutoff = now - 90 * 86400000;
  const recent = attempts.filter((attempt) => Date.parse(attempt.submittedAt) >= cutoff);
  const visible = recent.filter((attempt) => attempt.scoreVisible !== false);
  const gradedRows = visible.flatMap((attempt) => (attempt.subjects || [])
      .filter((row) => !focusedSubject || row.subject === focusedSubject));
  const totals = sumRows(gradedRows);
  const minimum = focusedSubject ? 40 : 100;
  if (totals.attempted < minimum) {
    return {
      status: "insufficient_data", score: null,
      confidence: round(Math.min(1, totals.attempted / minimum), 2),
      contributingAttempts: totals.attempted, requiredAttempts: minimum,
      includedSubjects: [...new Set(gradedRows.map((row) => row.subject))],
      formulaVersion: DIRI_FORMULA_VERSION, pillars: null,
    };
  }
  const accuracy = totals.accuracy || 0;
  const pacingRatios = gradedRows.filter((row) => row.attempted > 0).map((row) => {
    const actual = row.activeTimeSec / row.attempted;
    const allocation = row.allocatedTimeSec && row.totalQuestions ?
      row.allocatedTimeSec / row.totalQuestions : 60;
    return Math.min(1, allocation / Math.max(1, actual));
  });
  const pacing = pacingRatios.length ? pacingRatios.reduce(
      (sum, value) => sum + value, 0) / pacingRatios.length * 100 : 50;
  const performance = accuracy * .8 + pacing * .2;
  const activeDays = new Set(recent.map((row) => dayKey(row.submittedAt))).size;
  const freshDays = recent.length ? Math.max(0,
      (now - Math.max(...recent.map((row) => Date.parse(row.submittedAt)))) /
      86400000) : 90;
  const volume = Math.min(100,
      100 * Math.log1p(totals.attempted) / Math.log1p(500));
  const consistency = .45 * volume +
    .35 * Math.min(100, activeDays / 24 * 100) +
    .2 * Math.max(0, 100 - freshDays * 2.5);
  const catalogSubjects = (catalog && catalog.subjects || [])
      .filter((row) => !focusedSubject || row.name === focusedSubject);
  const includedSubjects = [...new Set(gradedRows.map((row) => row.subject))];
  const coverageAttempts = recent.reduce((sum, attempt) =>
    sum + number(attempt.activity && attempt.activity.attempted), 0);
  const expectedDistinct = (amount, cadence, available) => available ?
    Math.min(available, 1 + Math.floor(Math.max(0, amount - 1) / cadence)) : 0;
  const recentSubjectAttempts = {};
  const recentModuleAttempts = {};
  recent.forEach((attempt) => {
    (attempt.subjects || []).forEach((row) => {
      recentSubjectAttempts[row.subject] = number(recentSubjectAttempts[row.subject]) +
        number(row.attempted);
    });
    (attempt.modules || []).forEach((row) => {
      const key = `${row.subject}\u0000${row.module}`;
      recentModuleAttempts[key] = number(recentModuleAttempts[key]) +
        number(row.attempted);
    });
  });
  const subjectRequired = expectedDistinct(coverageAttempts, 40, catalogSubjects.length);
  const meaningfulSubjects = catalogSubjects.filter((row) =>
    number(recentSubjectAttempts[row.name]) >= 10).length;
  const subjectCoverage = subjectRequired ?
    Math.min(1, meaningfulSubjects / subjectRequired) : 0;
  let modulesRequired = 0;
  let meaningfulModules = 0;
  let testsRequired = 0;
  let meaningfulTests = 0;
  catalogSubjects.forEach((catalogSubject) => {
    const subject = catalogSubject.name;
    const subjectAttempts = number(recentSubjectAttempts[subject]);
    const availableModules = catalogSubject.modules || [];
    const requiredModules = expectedDistinct(subjectAttempts, 20,
        availableModules.length);
    modulesRequired += requiredModules;
    meaningfulModules += availableModules.filter((module) =>
      number(recentModuleAttempts[`${subject}\u0000${module}`]) >= 5).length;
    const subjectSessions = recent.filter((attempt) => (attempt.subjects || [])
        .some((row) => row.subject === subject && number(row.attempted) > 0));
    const availableTests = catalogSubject.practiceYears || [];
    const requiredTests = expectedDistinct(subjectSessions.length, 5,
        availableTests.length);
    testsRequired += requiredTests;
    const usedTests = new Set(subjectSessions.flatMap((attempt) =>
      (attempt.practiceYearsBySubject &&
       attempt.practiceYearsBySubject[subject]) || attempt.practiceYears || []));
    meaningfulTests += [...usedTests].filter((year) =>
      availableTests.includes(year)).length;
  });
  const moduleCoverage = modulesRequired ?
    Math.min(1, meaningfulModules / modulesRequired) : 0;
  const yearCoverage = testsRequired ?
    Math.min(1, meaningfulTests / testsRequired) : 0;
  const coverage = (subjectCoverage * .4 + moduleCoverage * .3 +
    yearCoverage * .3) * 100;
  const score = round(performance * .4 + consistency * .3 + coverage * .3);
  return {
    status: "estimated", score,
    band: score >= 85 ? "Ready" : score >= 70 ? "Almost" :
      score >= 55 ? "Building" : "Foundation",
    confidence: round(Math.min(1, .55 + totals.attempted / 1000), 2),
    contributingAttempts: totals.attempted, requiredAttempts: minimum,
    includedSubjects, formulaVersion: DIRI_FORMULA_VERSION,
    pillars: {performance: round(performance), consistency: round(consistency),
      coverage: round(coverage)},
  };
}

module.exports = {DIRI_FORMULA_VERSION, readinessV31};
