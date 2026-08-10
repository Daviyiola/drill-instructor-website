"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  answerContent,
  indexedOption,
  optionDistribution,
} = require("../handlers/getEducatorDrillAnalyticsHttps");

test("educator option indexes do not treat unanswered as option A", () => {
  const options = ["Alpha", "Bravo", "Charlie", "Delta"];
  assert.equal(indexedOption(options, null), "");
  assert.equal(indexedOption(options, undefined), "");
  assert.equal(indexedOption(options, -1), "");
  assert.equal(indexedOption(options, 0), "Alpha");
});

test("educator analytics preserves existing payload options", () => {
  const content = answerContent({
    payload: {
      question: "Choose one",
      option1: "Alpha",
      option2: "Bravo",
      option3: "Charlie",
      option4: "Delta",
      subject: "Mathematics",
      module: "inequalities",
    },
  });

  assert.deepEqual(content.options, ["Alpha", "Bravo", "Charlie", "Delta"]);
  assert.equal(content.payload.question, "Choose one");
  assert.equal(content.payload.module, "inequalities");
});

test("educator option distribution includes complete performance data", () => {
  const rows = optionDistribution({
    option1: "Alpha",
    option2: "Bravo",
    option3: "Charlie",
    option4: "Delta",
    attempted: 4,
    correctAnswer: "Bravo",
    optionMap: {
      Alpha: {answer: "Alpha", count: 1},
      Bravo: {answer: "Bravo", count: 3},
    },
  });

  assert.deepEqual(rows.map((row) => ({
    label: row.label,
    count: row.count,
    percentage: row.percentage,
    isCorrect: row.isCorrect,
  })), [
    {label: "A", count: 1, percentage: 25, isCorrect: false},
    {label: "B", count: 3, percentage: 75, isCorrect: true},
    {label: "C", count: 0, percentage: 0, isCorrect: false},
    {label: "D", count: 0, percentage: 0, isCorrect: false},
  ]);
});
