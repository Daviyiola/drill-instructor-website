"use strict";
/* eslint-disable require-jsdoc, max-len */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateAnalytics,
  aggregateGroup,
  activitySessions,
  analyticsAttemptFromResult,
  readiness,
  resolveAssignmentRelease,
} = require("../handlers/_analytics");

const NOW = Date.parse("2026-07-29T12:00:00.000Z");
const catalog = {
  subjects: [
    {name: "Math", modules: ["Algebra", "Geometry"], practiceYears: [1, 2]},
    {name: "Science", modules: ["Biology", "Chemistry"], practiceYears: [1, 2]},
  ],
};

function attempt({
  id = "attempt",
  daysAgo = 1,
  attempted = 100,
  correct = 80,
  subjects = ["Math", "Science"],
  source = "solo",
  release = null,
} = {}) {
  const perSubject = attempted / subjects.length;
  const correctPerSubject = correct / subjects.length;
  return {
    attemptId: id,
    studentId: "student",
    bootcamp: "act",
    source,
    sourceId: id,
    submittedAt: new Date(NOW - daysAgo * 86400000).toISOString(),
    activity: {
      totalQuestions: attempted,
      attempted,
      activeTimeSec: attempted * 50,
      elapsedTimeSec: attempted * 55,
    },
    performance: {
      correct,
      wrong: attempted - correct,
      unanswered: 0,
      points: correct * 3 + attempted - correct,
    },
    subjects: subjects.map((subject) => ({
      subject,
      totalQuestions: perSubject,
      attempted: perSubject,
      correct: correctPerSubject,
      wrong: perSubject - correctPerSubject,
      unanswered: 0,
      activeTimeSec: perSubject * 50,
      allocatedTimeSec: perSubject * 60,
    })),
    modules: subjects.map((subject) => ({
      subject,
      module: subject === "Math" ? "Algebra" : "Biology",
      totalQuestions: perSubject,
      attempted: perSubject,
      correct: correctPerSubject,
      wrong: perSubject - correctPerSubject,
      unanswered: 0,
      activeTimeSec: perSubject * 50,
      allocatedTimeSec: perSubject * 60,
    })),
    practiceYears: [1, 2],
    release,
  };
}

function options() {
  return {
    bootcamp: "act",
    startAt: new Date(NOW - 89 * 86400000).toISOString(),
    endAt: new Date(NOW).toISOString(),
    timezone: "UTC",
    source: "all",
    subject: "",
    granularity: "week",
  };
}

test("canonical records contain aggregates but no correction payloads", () => {
  const result = {
    sessionId: "s1",
    bootcamp: "act",
    createdAt: new Date(NOW).toISOString(),
    summary: {totalQ: 2, attempted: 1, correct: 1, wrong: 0,
      unanswered: 1, points: 3, usedSec: 70},
    subjects: [{subject: "Math", totalQ: 2, attempted: 1, correct: 1,
      wrong: 0, unanswered: 1, usedSec: 20, timeLimitSec: 120}],
    modules: [{subject: "Math", module: "Algebra", totalQ: 2,
      attempted: 1, correct: 1, wrong: 0, unanswered: 1, usedSec: 20}],
    answers: [{id: "secret", correctIndex: 2, explanation: "secret"}],
  };
  const row = analyticsAttemptFromResult({
    result,
    session: {sessionId: "s1", bootcamp: "act", questions: []},
    studentId: "student",
    source: "solo",
    sourceId: "s1",
  });
  assert.equal(row.activity.activeTimeSec, 20);
  assert.equal(row.activity.elapsedTimeSec, 70);
  assert.equal(JSON.stringify(row).includes("secret"), false);
});

test("release policy is irreversible in projection and corrections imply score", () => {
  assert.deepEqual(resolveAssignmentRelease({
    scorePolicy: "manual",
    correctionPolicy: "manual",
    scoreReleasedAt: null,
    correctionsReleasedAt: new Date(NOW - 1000).toISOString(),
  }, null, NOW), {
    scorePolicy: "manual",
    correctionPolicy: "manual",
    scoreReleasedAt: null,
    correctionsReleasedAt: new Date(NOW - 1000).toISOString(),
    scoreReleased: true,
    correctionsReleased: true,
  });
});

test("assignment score releases at due date while corrections stay private", () => {
  assert.deepEqual(resolveAssignmentRelease({
    scorePolicy: "manual",
    correctionPolicy: "manual",
    scoreReleasedAt: null,
    correctionsReleasedAt: null,
  }, new Date(NOW - 1000).toISOString(), NOW), {
    scorePolicy: "manual",
    correctionPolicy: "manual",
    scoreReleasedAt: null,
    correctionsReleasedAt: null,
    scoreReleased: true,
    correctionsReleased: false,
  });
});

test("pending assignments contribute activity but not performance", () => {
  const base = attempt({id: "solo", attempted: 100, correct: 80});
  const pending = attempt({
    id: "pending",
    attempted: 20,
    correct: 0,
    source: "assignment",
    release: {
      scorePolicy: "manual",
      correctionPolicy: "manual",
      scoreReleasedAt: null,
      correctionsReleasedAt: null,
    },
  });
  const without = aggregateAnalytics([base], options(), catalog, NOW);
  const withPending = aggregateAnalytics([base, pending], options(), catalog, NOW);
  assert.equal(withPending.overview.accuracy, without.overview.accuracy);
  assert.equal(withPending.overview.attempts, without.overview.attempts + 20);
  assert.equal(withPending.excludedPendingScores, 1);
  assert.equal(withPending.readiness.pillars.performance,
      without.readiness.pillars.performance);
});

test("DIRI uses the full recent window while respecting a focused subject", () => {
  const displayOptions = {
    ...options(),
    startAt: new Date(NOW - 2 * 86400000).toISOString(),
    endAt: new Date(NOW).toISOString(),
    subject: "Math",
  };
  const result = aggregateAnalytics([
    attempt({id: "recent", daysAgo: 1, attempted: 10, correct: 8,
      subjects: ["Math"]}),
    attempt({id: "math-history", daysAgo: 30, attempted: 100, correct: 80,
      subjects: ["Math"]}),
    attempt({id: "science-history", daysAgo: 30, attempted: 100, correct: 80,
      subjects: ["Science"]}),
  ], displayOptions, catalog, NOW);
  assert.equal(result.overview.attempts, 10);
  assert.equal(result.readiness.contributingAttempts, 110);
  assert.equal(result.readiness.status, "estimated");
});

test("subject and module recommendations are exposed independently", () => {
  const rows = ["Algebra", "Geometry", "Trigonometry"].map(
      (module, index) => {
        const row = attempt({id: `math-${index}`, attempted: 2, correct: 1,
          subjects: ["Math"]});
        row.modules[0].module = module;
        return row;
      },
  );
  const result = aggregateAnalytics(rows, options(), catalog, NOW);
  assert.equal(result.subjectFocusAreas.length, 1);
  assert.equal(result.subjectFocusAreas[0].level, "subject");
  assert.equal(result.subjectFocusAreas[0].subject, "Math");
  assert.equal(result.subjectFocusAreas[0].module, "");
  assert.equal(result.moduleFocusAreas.length, 3);
  assert.equal(result.focusAreas.length, 3);
});

test("activity session cache rows are answer-free and honor display filters", () => {
  const math = attempt({id: "math-session", subjects: ["Math"]});
  const science = attempt({id: "science-session", subjects: ["Science"]});
  math.practiceYears = [1, 2];
  science.practiceYears = [3];
  const rows = activitySessions([math, science], {
    ...options(), subject: "Math",
  });
  assert.deepEqual(rows, [{
    attemptId: "math-session",
    submittedAt: math.submittedAt,
    source: "solo",
    subjects: ["Math"],
    practiceYears: [1, 2],
  }]);
});

test("group analytics returns compact threshold comprehension", () => {
  const strong = attempt({id: "strong", attempted: 100, correct: 80});
  const needsWork = attempt({
    id: "needs-work",
    attempted: 50,
    correct: 20,
    subjects: ["Math"],
  });
  const result = aggregateGroup({
    strong: [strong],
    needsWork: [needsWork],
  }, {
    ...options(),
    thresholdMetric: "accuracy",
    threshold: 60,
  }, catalog, NOW);

  const math = result.comprehension.subjects.find(
      (row) => row.name === "Math");
  const science = result.comprehension.subjects.find(
      (row) => row.name === "Science");
  assert.equal(math.met, 1);
  assert.equal(math.total, 2);
  assert.equal(math.below[0].studentId, "needsWork");
  assert.deepEqual(science.noData, ["needsWork"]);
  assert.equal(result.students[0].analytics.trend, undefined);
  assert.equal(result.students[0].analytics.readiness, undefined);
});

test("higher accuracy cannot lower DIRI when other inputs are fixed", () => {
  const low = readiness([attempt({correct: 65})], catalog, NOW);
  const high = readiness([attempt({correct: 85})], catalog, NOW);
  assert.ok(high.score >= low.score);
  assert.ok(high.pillars.performance > low.pillars.performance);
});

test("fresh distributed practice outranks stale cramming", () => {
  const fresh = readiness([
    attempt({id: "a", daysAgo: 2, attempted: 50, correct: 40}),
    attempt({id: "b", daysAgo: 8, attempted: 50, correct: 40}),
  ], catalog, NOW);
  const staleCram = readiness([
    attempt({daysAgo: 80, subjects: ["Math"], attempted: 100, correct: 80}),
  ], catalog, NOW);
  assert.ok(fresh.score > staleCram.score);
  assert.ok(fresh.pillars.coverage > staleCram.pillars.coverage);
});

test("progressive coverage rewards subject, module, and test breadth", () => {
  const narrow = Array.from({length: 6}, (_, index) =>
    attempt({id: `narrow-${index}`, attempted: 20, correct: 16,
      subjects: ["Math"]}));
  narrow.forEach((row) => {
    row.practiceYears = [1];
    row.modules[0].module = "Algebra";
  });
  const broad = narrow.slice(0, 3).concat(
      Array.from({length: 3}, (_, index) => {
        const row = attempt({id: `broad-${index}`, attempted: 20, correct: 16,
          subjects: ["Science"]});
        row.practiceYears = [2];
        row.modules[0].module = "Chemistry";
        return row;
      }),
  );
  assert.ok(readiness(broad, catalog, NOW).pillars.coverage >
      readiness(narrow, catalog, NOW).pillars.coverage);
});

test("no-attempt periods use null accuracy instead of zero", () => {
  const result = aggregateAnalytics([], options(), catalog, NOW);
  assert.equal(result.overview.accuracy, null);
  assert.ok(result.trend.every((row) => row.accuracy === null));
  assert.equal(result.readiness.status, "insufficient_data");
  assert.equal(result.readiness.score, null);
});
