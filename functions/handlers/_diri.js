"use strict";

/* eslint-disable require-jsdoc, max-len */

const DIRI_FORMULA_VERSION = "diri-3.2";
const DAY_MS = 86400000;
const WINDOW_DAYS = 90;

// Standard-time exam pacing. Timing can only subtract points; it never raises
// readiness. Keep aliases because canonical ACT and SAT labels differ.
const CANONICAL_SECONDS_PER_QUESTION = Object.freeze({
  "English": 35 * 60 / 50,
  "Mathematics": 50 * 60 / 45,
  "Science": 40 * 60 / 40,
  "Reading": 40 * 60 / 36,
  "Read. & Writ.": 64 * 60 / 54,
  "Reading and Writing": 64 * 60 / 54,
  "Math": 70 * 60 / 44,
});

// DIRI unlocks only after two complete section-equivalents have been answered
// in every selected subject. A third section-equivalent matures the evidence
// ceiling and is required for exceptional (90+) readiness.
const CANONICAL_QUESTIONS_PER_SECTION = Object.freeze({
  "English": 50,
  "Mathematics": 45,
  "Reading": 36,
  "Science": 40,
  "Read. & Writ.": 54,
  "Reading and Writing": 54,
  "Math": 44,
});
const MINIMUM_SECTION_EQUIVALENTS = 2;
const MATURE_SECTION_EQUIVALENTS = 3;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value, low = 0, high = 100) {
  return Math.max(low, Math.min(high, value));
}

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function weekKey(value) {
  const date = new Date(value);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function expectedDistinct(volume, cadence, available) {
  if (!available || !volume) return 0;
  return Math.min(available,
      1 + Math.floor(Math.max(0, volume - 1) / cadence));
}

function sumRows(rows) {
  const summary = rows.reduce((total, row) => ({
    attempted: total.attempted + number(row.attempted),
    correct: total.correct + number(row.correct),
  }), {attempted: 0, correct: 0});
  return {
    ...summary,
    accuracy: summary.attempted ? summary.correct / summary.attempted * 100 : null,
  };
}

function weightedAccuracy(rows, now) {
  const values = rows.reduce((total, row) => {
    const ageDays = Math.max(0, (now - Date.parse(row.submittedAt)) / DAY_MS);
    const weight = .5 ** (ageDays / 45);
    total.correct += number(row.correct) * weight;
    total.attempted += number(row.attempted) * weight;
    return total;
  }, {correct: 0, attempted: 0});
  return values.attempted ? values.correct / values.attempted * 100 : 0;
}

function sectionQuestionCount(descriptor) {
  const canonical = CANONICAL_QUESTIONS_PER_SECTION[descriptor.name];
  if (canonical) return canonical;
  const tests = Array.isArray(descriptor.practiceYears) ?
    descriptor.practiceYears.length : 0;
  const questions = number(descriptor.questionCount);
  return tests && questions ? Math.max(1, Math.round(questions / tests)) : 50;
}

function readiness(
    attempts,
    catalog,
    now = Date.now(),
    focusedSubject = "",
    selectedSubjects = [],
) {
  const cutoff = now - WINDOW_DAYS * DAY_MS;
  const selectedSet = new Set((selectedSubjects || []).map((subject) =>
    String(subject || "").trim()).filter(Boolean));
  const subjectIncluded = (subject) => focusedSubject ?
    subject === focusedSubject : !selectedSet.size || selectedSet.has(subject);
  const catalogSubjects = (catalog && catalog.subjects || [])
      .filter((row) => subjectIncluded(row.name));
  const recent = (attempts || []).filter((attempt) => {
    const submitted = Date.parse(attempt && attempt.submittedAt);
    return Number.isFinite(submitted) && submitted >= cutoff && submitted <= now;
  });
  const scoped = recent.filter((attempt) => (attempt.subjects || [])
      .some((row) => subjectIncluded(row.subject) && number(row.attempted) > 0));
  const visible = scoped.filter((attempt) => attempt.scoreVisible !== false);
  const gradedRows = visible.flatMap((attempt) => (attempt.subjects || [])
      .filter((row) => subjectIncluded(row.subject))
      .map((row) => ({...row, submittedAt: attempt.submittedAt})));
  const totals = sumRows(gradedRows);
  const gradedSubjectAttempts = {};
  gradedRows.forEach((row) => {
    gradedSubjectAttempts[row.subject] =
      number(gradedSubjectAttempts[row.subject]) + number(row.attempted);
  });
  const selectedEvidence = catalogSubjects.map((descriptor) => {
    const sectionQuestions = sectionQuestionCount(descriptor);
    return {
      subject: descriptor.name,
      attempted: number(gradedSubjectAttempts[descriptor.name]),
      requiredAttempts: sectionQuestions * MINIMUM_SECTION_EQUIVALENTS,
      matureAttempts: sectionQuestions * MATURE_SECTION_EQUIVALENTS,
    };
  });
  const minimum = selectedEvidence.reduce(
      (sum, row) => sum + row.requiredAttempts, 0);
  const everySubjectHasMinimum = selectedEvidence.length > 0 &&
    selectedEvidence.every((row) => row.attempted >= row.requiredAttempts);
  if (!everySubjectHasMinimum || totals.attempted < minimum) {
    return {
      status: "insufficient_data",
      score: null,
      confidence: round(Math.min(1, minimum ? totals.attempted / minimum : 0), 2),
      contributingAttempts: totals.attempted,
      requiredAttempts: minimum,
      includedSubjects: [...new Set(gradedRows.map((row) => row.subject))],
      selectedSubjects: catalogSubjects.map((row) => row.name),
      subjectEvidence: selectedEvidence,
      formulaVersion: DIRI_FORMULA_VERSION,
      pillars: null,
      constraints: ["minimum_subject_evidence_not_met"],
    };
  }

  const overallAccuracy = weightedAccuracy(gradedRows, now);
  const includedSubjects = [...new Set(gradedRows.map((row) => row.subject))];
  const subjectFloorMinimum = focusedSubject ? 10 : 20;
  const subjectAccuracies = includedSubjects.map((subject) => {
    const rows = gradedRows.filter((row) => row.subject === subject);
    return {
      subject,
      attempted: sumRows(rows).attempted,
      accuracy: weightedAccuracy(rows, now),
    };
  }).filter((row) => row.attempted >= subjectFloorMinimum);
  const weakestSubjectAccuracy = subjectAccuracies.length ?
    Math.min(...subjectAccuracies.map((row) => row.accuracy)) : overallAccuracy;
  const mastery = .8 * overallAccuracy + .2 * weakestSubjectAccuracy;

  const activeDays = new Set(scoped.map((attempt) => dayKey(attempt.submittedAt))).size;
  const activeWeeks = new Set(scoped.map((attempt) => weekKey(attempt.submittedAt))).size;
  const latestDays = scoped.length ? Math.max(0,
      (now - Math.max(...scoped.map((attempt) => Date.parse(attempt.submittedAt)))) /
        DAY_MS) : WINDOW_DAYS;
  const activeWeekScore = Math.min(100, activeWeeks / 10 * 100);
  const activeDayScore = Math.min(100, activeDays / 24 * 100);
  const freshnessScore = 100 * .5 ** (latestDays / 14);
  const consistency = .5 * activeWeekScore + .3 * activeDayScore +
    .2 * freshnessScore;

  const subjectAttempts = {};
  const moduleAttempts = {};
  scoped.forEach((attempt) => {
    (attempt.subjects || []).forEach((row) => {
      if (subjectIncluded(row.subject)) {
        subjectAttempts[row.subject] = number(subjectAttempts[row.subject]) +
          number(row.attempted);
      }
    });
    (attempt.modules || []).forEach((row) => {
      if (subjectIncluded(row.subject)) {
        const key = `${row.subject}\u0000${row.module}`;
        moduleAttempts[key] = number(moduleAttempts[key]) + number(row.attempted);
      }
    });
  });
  // Pending assignments may support activity/breadth while their hidden scores
  // remain excluded from Mastery.
  const coverageAttempts = Object.values(subjectAttempts)
      .reduce((sum, attempted) => sum + number(attempted), 0);
  const subjectRequired = expectedDistinct(coverageAttempts, 40,
      catalogSubjects.length);
  const meaningfulSubjects = catalogSubjects.filter((subject) =>
    number(subjectAttempts[subject.name]) >= 10);
  const subjectCoverage = subjectRequired ?
    Math.min(1, meaningfulSubjects.length / subjectRequired) : 0;
  const withinSubject = meaningfulSubjects.map((descriptor) => {
    const subject = descriptor.name;
    const subjectAttemptCount = number(subjectAttempts[subject]);
    const availableModules = descriptor.modules || [];
    const requiredModules = expectedDistinct(subjectAttemptCount, 25,
        availableModules.length);
    const usedModules = availableModules.filter((module) =>
      number(moduleAttempts[`${subject}\u0000${module}`]) >= 5).length;
    const subjectSessions = scoped.filter((attempt) =>
      (attempt.subjects || []).some((row) => row.subject === subject &&
        number(row.attempted) > 0));
    const availableTests = descriptor.practiceYears || [];
    const requiredTests = expectedDistinct(subjectSessions.length, 5,
        availableTests.length);
    const usedTests = new Set(subjectSessions.flatMap((attempt) =>
      (attempt.practiceYearsBySubject &&
       attempt.practiceYearsBySubject[subject]) || attempt.practiceYears || []));
    const validTests = [...usedTests].filter((test) => availableTests.includes(test));
    return {
      module: requiredModules ? Math.min(1, usedModules / requiredModules) : 0,
      test: requiredTests ? Math.min(1, validTests.length / requiredTests) : 0,
    };
  });
  const moduleCoverage = withinSubject.length ? withinSubject.reduce(
      (sum, row) => sum + row.module, 0) / withinSubject.length : 0;
  const testCoverage = withinSubject.length ? withinSubject.reduce(
      (sum, row) => sum + row.test, 0) / withinSubject.length : 0;
  const breadth = subjectCoverage *
    (.45 + .35 * moduleCoverage + .2 * testCoverage) * 100;

  let actualSeconds = 0;
  let targetSeconds = 0;
  gradedRows.forEach((row) => {
    const target = CANONICAL_SECONDS_PER_QUESTION[row.subject];
    if (!target || !number(row.attempted) || !number(row.activeTimeSec)) return;
    actualSeconds += number(row.activeTimeSec);
    targetSeconds += number(row.attempted) * target;
  });
  const paceRatio = targetSeconds ? actualSeconds / targetSeconds : null;
  let pacingPenalty = 0;
  if (paceRatio > 1.15 && paceRatio <= 1.5) {
    pacingPenalty = (paceRatio - 1.15) / .35 * 3;
  } else if (paceRatio > 1.5 && paceRatio <= 2) {
    pacingPenalty = 3 + (paceRatio - 1.5) / .5 * 2;
  } else if (paceRatio > 2) {
    pacingPenalty = 5;
  }

  const weightedComposite = .65 * mastery + .2 * consistency + .15 * breadth;
  const masteryCeiling = mastery + 5;
  const evidenceTarget = selectedEvidence.reduce(
      (sum, row) => sum + row.matureAttempts, 0);
  const evidenceCeiling = 80 + 20 * clamp(
      (totals.attempted - minimum) / (evidenceTarget - minimum), 0, 1);
  let score = clamp(Math.min(weightedComposite, masteryCeiling,
      evidenceCeiling) - pacingPenalty);
  const constraints = [];
  const everySubjectReady = selectedEvidence.every((row) =>
    row.attempted >= row.requiredAttempts);
  const everySubjectExceptional = selectedEvidence.every((row) =>
    row.attempted >= row.matureAttempts);
  if (mastery < 80) constraints.push("mastery_below_ready_floor");
  if (consistency < 50) constraints.push("consistency_below_ready_floor");
  if (breadth < 60) constraints.push("breadth_below_ready_floor");
  if (!everySubjectReady) {
    constraints.push("selected_subject_evidence_below_ready_floor");
  }
  if (constraints.length) score = Math.min(score, 84.9);
  const highReadinessAttempts = evidenceTarget;
  if (mastery < 88 || consistency < 80 || breadth < 80 ||
      totals.attempted < highReadinessAttempts || !everySubjectExceptional) {
    constraints.push("high_readiness_evidence_incomplete");
    score = Math.min(score, 89.9);
  }
  score = round(score);
  const confidence = .5 * Math.min(1, totals.attempted /
      evidenceTarget) +
    .3 * Math.min(1, activeWeeks / 8) + .2 * breadth / 100;

  return {
    status: "estimated",
    score,
    band: score >= 85 ? "Ready" : score >= 70 ? "Almost" :
      score >= 55 ? "Building" : "Foundation",
    confidence: round(confidence, 2),
    contributingAttempts: totals.attempted,
    requiredAttempts: minimum,
    includedSubjects,
    selectedSubjects: catalogSubjects.map((row) => row.name),
    subjectEvidence: selectedEvidence,
    formulaVersion: DIRI_FORMULA_VERSION,
    constraints: [...new Set(constraints)],
    evidenceCeiling: round(evidenceCeiling),
    pillars: {
      // Keep the established response keys for web/native compatibility.
      performance: round(mastery),
      consistency: round(consistency),
      coverage: round(breadth),
    },
    diagnostics: {
      accuracy: round(overallAccuracy),
      weakestSubjectAccuracy: round(weakestSubjectAccuracy),
      activeDays,
      activeWeeks,
      latestDays: round(latestDays),
      paceRatio: paceRatio === null ? null : round(paceRatio, 2),
      pacingPenalty: round(pacingPenalty),
      subjectCoverage: round(subjectCoverage * 100),
      moduleCoverage: round(moduleCoverage * 100),
      practiceTestCoverage: round(testCoverage * 100),
    },
  };
}

module.exports = {
  CANONICAL_QUESTIONS_PER_SECTION,
  CANONICAL_SECONDS_PER_QUESTION,
  DIRI_FORMULA_VERSION,
  MINIMUM_SECTION_EQUIVALENTS,
  MATURE_SECTION_EQUIVALENTS,
  readiness,
};
