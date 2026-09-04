"use strict";
/* eslint-disable require-jsdoc */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {buildReport} = require("../scripts/auditQuestionBank");
const {pilotQuestions} = require("../scripts/prepareQuestionReview");
const {
  canonicalSerialize,
  contentFingerprint,
  datasetVersionsFor,
  validateReviewResults,
} = require("../scripts/questionReviewIdentity");

const REVIEW = require(path.resolve(
    __dirname,
    "..",
    "..",
    "question-reviews",
    "academic-pilot-v1.json",
));

function currentQuestions() {
  return pilotQuestions(buildReport(["act", "sat"], "fixed"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validDocument(questions) {
  const datasets = datasetVersionsFor(questions);
  return {
    formatVersion: 1,
    selectionSeed: "academic-pilot-v1",
    rubric: "docs/QUESTION_REVIEW_RUBRIC.md",
    datasets,
    questionCount: questions.length,
    reviews: questions.map((question) => ({
      legacyId: question.legacyId,
      contentFingerprint: contentFingerprint(question, datasets),
    })),
  };
}

test("canonical serialization ignores object insertion order", () => {
  assert.equal(
      canonicalSerialize({b: [2, {z: 1, a: 0}], a: "first"}),
      canonicalSerialize({a: "first", b: [2, {a: 0, z: 1}]}),
  );
});

function changedQuestion(field, mutate) {
  const question = clone(currentQuestions()[0]);
  if (mutate) mutate(question);
  else question[field] = `${question[field]} changed`;
  return question;
}

test("unchanged reviewed questions retain valid approval", () => {
  assert.equal(validateReviewResults(REVIEW, currentQuestions()), true);
});

test("changing only the prompt invalidates a review", () => {
  const original = currentQuestions()[0];
  const document = validDocument([original]);
  assert.throws(() => validateReviewResults(
      document, [changedQuestion("prompt")]), /Reviewed content changed/);
});

test("changing one option invalidates a review", () => {
  const original = currentQuestions()[0];
  const document = validDocument([original]);
  assert.throws(() => validateReviewResults(document, [changedQuestion(
      null, (question) => question.options[0] += " changed",
  )]), /Reviewed content changed/);
});

test("reordering options invalidates a review", () => {
  const original = currentQuestions()[0];
  const document = validDocument([original]);
  assert.throws(() => validateReviewResults(document, [changedQuestion(
      null, (question) => question.options.reverse(),
  )]), /Reviewed content changed/);
});

test("changing the configured answer invalidates a review", () => {
  const original = currentQuestions()[0];
  const document = validDocument([original]);
  assert.throws(() => validateReviewResults(document, [changedQuestion(
      null, (question) => {
        question.configuredAnswerIndex = 0;
        question.configuredAnswer = question.options[0];
      },
  )]), /Reviewed content changed/);
});

test("changing the explanation invalidates a review", () => {
  const original = currentQuestions()[0];
  const document = validDocument([original]);
  assert.throws(() => validateReviewResults(
      document, [changedQuestion("explanation")]), /Reviewed content changed/);
});

test("changing an image reference invalidates a review", () => {
  const original = currentQuestions()[0];
  const document = validDocument([original]);
  assert.throws(() => validateReviewResults(document, [changedQuestion(
      null, (question) => question.imageSources.push("assets/replacement.webp"),
  )]), /Reviewed content changed/);
});

test("changing a passage invalidates a review", () => {
  const original = currentQuestions()[0];
  const document = validDocument([original]);
  assert.throws(() => validateReviewResults(
      document, [changedQuestion("passage")]), /Reviewed content changed/);
});

test("changing academic metadata invalidates a review", () => {
  const original = currentQuestions()[0];
  const document = validDocument([original]);
  assert.throws(() => validateReviewResults(
      document, [changedQuestion("module")]), /Reviewed content changed/);
});

test("reusing a legacyId for different content cannot inherit approval", () => {
  const original = currentQuestions()[0];
  const replacement = clone(currentQuestions()[1]);
  replacement.legacyId = original.legacyId;
  replacement.bootcamp = original.bootcamp;
  const document = validDocument([original]);
  assert.throws(() => validateReviewResults(
      document, [replacement]), /Reviewed content changed/);
});

test("duplicate review IDs fail closed", () => {
  const questions = currentQuestions();
  const document = validDocument(questions);
  document.reviews[1].legacyId = document.reviews[0].legacyId;
  assert.throws(() => validateReviewResults(
      document, questions), /Duplicate review legacyId/);
});

test("missing reviews fail closed", () => {
  const questions = currentQuestions();
  const document = validDocument(questions);
  document.reviews.pop();
  assert.throws(() => validateReviewResults(
      document, questions), /do not exactly cover/);
});

test("missing fingerprints fail closed", () => {
  const questions = currentQuestions();
  const document = validDocument(questions);
  delete document.reviews[0].contentFingerprint;
  assert.throws(() => validateReviewResults(
      document, questions), /Missing content fingerprint/);
});

test("dataset version mismatches fail closed", () => {
  const questions = currentQuestions();
  const document = validDocument(questions);
  document.datasets.act = "stale-version";
  assert.throws(() => validateReviewResults(
      document, questions), /dataset versions/);
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
