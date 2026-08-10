"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {buildReport} = require("../scripts/auditQuestionBank");
const {pilotQuestions} = require("../scripts/prepareQuestionReview");

const REVIEW = require(path.resolve(
    __dirname,
    "..",
    "..",
    "question-reviews",
    "academic-pilot-v1.json",
));

test("pilot review results cover the deterministic blind selection", () => {
  const report = buildReport(["act", "sat"], "fixed");
  const expected = pilotQuestions(report).map((question) => question.legacyId);
  const actual = REVIEW.reviews.map((review) => review.legacyId);
  assert.deepEqual(actual, expected);
  assert.equal(REVIEW.questionCount, actual.length);
});

test("pilot review results use only calibrated rubric verdicts", () => {
  const answers = new Set([
    "correct", "incorrect", "ambiguous", "unverifiable",
  ]);
  const explanations = new Set([
    "strong", "adequate", "thin", "incorrect", "missing",
  ]);
  const wording = new Set(["clear", "minor_edit", "ambiguous", "invalid"]);
  const formatting = new Set(["clean", "cleanup", "blocking"]);
  const confidence = new Set(["high", "medium", "low"]);
  REVIEW.reviews.forEach((review) => {
    assert.ok(answers.has(review.answerVerdict));
    assert.ok(explanations.has(review.explanationVerdict));
    assert.ok(wording.has(review.wordingVerdict));
    assert.ok(formatting.has(review.formattingVerdict));
    assert.ok(confidence.has(review.confidence));
  });
});
