"use strict";
/* eslint-disable require-jsdoc, max-len */

const NOW = Date.parse("2026-07-29T12:00:00.000Z");

function makeAttempt(options = {}) {
  const attempted = Number(options.attempted || 100);
  const accuracy = Number(options.accuracy === undefined ? 80 : options.accuracy);
  const correct = Math.round(attempted * accuracy / 100);
  const subjects = options.subjects || ["Math", "Science"];
  const share = attempted / subjects.length;
  const correctShare = correct / subjects.length;
  const seconds = Number(options.secondsPerQuestion || 50);
  const release = options.release || null;
  return {
    attemptId: options.id || "synthetic",
    studentId: options.studentId || "synthetic_student",
    bootcamp: "act",
    source: options.source || "solo",
    sourceId: options.sourceId || options.id || "synthetic",
    submittedAt: new Date(
        NOW - Number(options.daysAgo || 1) * 86400000,
    ).toISOString(),
    activity: {
      totalQuestions: attempted,
      attempted,
      activeTimeSec: attempted * seconds,
      elapsedTimeSec: attempted * seconds,
    },
    performance: {
      correct,
      wrong: attempted - correct,
      unanswered: 0,
      points: correct * 3 + attempted - correct,
    },
    subjects: subjects.map((subject) => ({
      subject,
      totalQuestions: share,
      attempted: share,
      correct: correctShare,
      wrong: share - correctShare,
      unanswered: 0,
      activeTimeSec: share * seconds,
      allocatedTimeSec: share * 60,
    })),
    modules: subjects.map((subject) => ({
      subject,
      module: subject === "Math" ? "Algebra" : "Biology",
      totalQuestions: share,
      attempted: share,
      correct: correctShare,
      wrong: share - correctShare,
      unanswered: 0,
      activeTimeSec: share * seconds,
      allocatedTimeSec: share * 60,
    })),
    practiceYears: [1, 2],
    release,
  };
}

const pendingRelease = {
  scorePolicy: "manual",
  correctionPolicy: "manual",
  scoreReleasedAt: null,
  correctionsReleasedAt: null,
};

const releasedScore = {
  scorePolicy: "manual",
  correctionPolicy: "manual",
  scoreReleasedAt: "2026-07-28T12:00:00.000Z",
  correctionsReleasedAt: null,
};

const personas = {
  noData: [],
  insufficient: [makeAttempt({attempted: 25, accuracy: 80})],
  strongBalanced: [makeAttempt({attempted: 160, accuracy: 88})],
  strongStale: [makeAttempt({attempted: 160, accuracy: 88, daysAgo: 80})],
  highVolumeWeak: [makeAttempt({attempted: 500, accuracy: 48})],
  highAccuracyLowVolume: [makeAttempt({attempted: 30, accuracy: 96})],
  oneSubjectCramming: [makeAttempt({
    attempted: 180,
    accuracy: 88,
    subjects: ["Math"],
  })],
  consistentImprovement: [
    makeAttempt({id: "old", attempted: 60, accuracy: 62, daysAgo: 45}),
    makeAttempt({id: "new", attempted: 60, accuracy: 84, daysAgo: 3}),
  ],
  recentDecline: [
    makeAttempt({id: "old", attempted: 60, accuracy: 88, daysAgo: 45}),
    makeAttempt({id: "new", attempted: 60, accuracy: 58, daysAgo: 3}),
  ],
  fastLowAccuracy: [makeAttempt({accuracy: 45, secondsPerQuestion: 15})],
  slowHighAccuracy: [makeAttempt({accuracy: 92, secondsPerQuestion: 100})],
  pendingAssignment: [makeAttempt({
    source: "assignment",
    release: pendingRelease,
  })],
  releasedScoreHiddenCorrections: [makeAttempt({
    source: "assignment",
    release: releasedScore,
  })],
};

module.exports = {NOW, makeAttempt, pendingRelease, personas, releasedScore};
