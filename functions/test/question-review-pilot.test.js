"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {buildReport} = require("../scripts/auditQuestionBank");
const {
  pilotQuestions,
  reviewTemplate,
} = require("../scripts/prepareQuestionReview");

test("academic pilot is stable and covers every current subject", () => {
  const report = buildReport(["act", "sat"], "fixed");
  const first = pilotQuestions(report);
  const second = pilotQuestions(report);
  assert.deepEqual(
      first.map((question) => question.legacyId),
      second.map((question) => question.legacyId),
  );
  const subjects = new Set(first.map((question) =>
    `${question.bootcamp}:${question.subject}`));
  assert.deepEqual(subjects, new Set([
    "act:Mathematics",
    "act:Science",
    "act:English",
    "sat:Math",
    "sat:Read. & Writ.",
  ]));
  assert.ok(first.every((question) => question.findings.some((item) =>
    item.severity === "error") || first.filter((row) =>
    row.bootcamp === question.bootcamp &&
    row.subject === question.subject).length >= 4));
});

test("academic review template keeps judgments explicitly pending", () => {
  assert.deepEqual(reviewTemplate(), {
    independentlyDeterminedAnswerIndex: null,
    answerVerdict: "not_reviewed",
    explanationVerdict: "not_reviewed",
    wordingVerdict: "not_reviewed",
    formattingVerdict: "not_reviewed",
    confidence: null,
    notes: "",
    proposedChanges: null,
  });
});
