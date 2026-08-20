"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  attributedUsedSec,
} = require("../handlers/getEducatorDrillSubmissionsHttps");
const {
  normalizeAnswers,
} = require("../handlers/getEducatorDrillSubmissionDetailHttps");

test("submission rows use subject timing when available", () => {
  assert.equal(attributedUsedSec({
    subjects: [{usedSec: 674}],
    answers: [{timeSpentSec: 7}, {timeSpentSec: 667}],
  }, 681), 674);
});

test("submission rows fall back to answer and then session timing", () => {
  assert.equal(attributedUsedSec({
    answers: [{timeSpentSec: 12}, {timeTakenMs: 8500}],
  }, 30), 20.5);
  assert.equal(attributedUsedSec({}, 30), 30);
});

test("educator review retains canonical answered and unanswered rows", () => {
  const rows = normalizeAnswers([
    {
      id: "math_1",
      subject: "Mathematics",
      module: "Functions",
      prompt: "Answered question",
      options: ["A", "B", "C", "D"],
      selectedIndex: 1,
      correctIndex: 1,
      isCorrect: true,
      explanation: "Because B is correct.",
    },
    {
      id: "math_2",
      subject: "Mathematics",
      module: "Functions",
      prompt: "Unanswered question",
      options: ["W", "X", "Y", "Z"],
      selectedIndex: null,
      correctIndex: 2,
      isCorrect: false,
      explanation: "Y is correct.",
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].questionId, "math_1");
  assert.equal(rows[0].selectedIndex, 1);
  assert.equal(rows[1].questionId, "math_2");
  assert.equal(rows[1].selectedIndex, null);
  assert.equal(rows[1].correctIndex, 2);
  assert.equal(rows[1].selectedAnswer, "");
});
