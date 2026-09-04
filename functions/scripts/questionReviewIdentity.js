"use strict";

const crypto = require("crypto");
const assert = require("node:assert/strict");
const {CONTENT_VERSIONS} = require("../data/contentVersions");

/**
 * Serialize JSON-compatible data with recursively sorted object keys.
 * Array order is intentionally preserved.
 *
 * @param {*} value JSON-compatible value
 * @return {string} Canonical JSON
 */
function canonicalSerialize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSerialize).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`,
  ).join(",")}}`;
}

/**
 * Return the current immutable dataset coordinates for selected questions.
 *
 * @param {Object[]} questions Selected audited questions
 * @return {Object} Bootcamp-to-version map
 */
function datasetVersionsFor(questions) {
  const result = {};
  [...new Set(questions.map((question) => question.bootcamp))]
      .sort()
      .forEach((bootcamp) => {
        const version = CONTENT_VERSIONS[bootcamp];
        if (!version) throw new Error(`Unknown bootcamp: ${bootcamp}`);
        result[bootcamp] = version.datasetVersion;
      });
  return result;
}

/**
 * Bind a review to every academically meaningful field and its dataset.
 * legacyId is deliberately not part of the payload: an identifier reused for
 * different content must produce a different fingerprint.
 *
 * @param {Object} question Audited question
 * @param {Object} datasets Bootcamp-to-version map
 * @return {string} Prefixed SHA-256 fingerprint
 */
function contentFingerprint(
    question,
    datasets = datasetVersionsFor([question]),
) {
  const payload = {
    bootcamp: String(question.bootcamp || ""),
    datasetVersion: String(datasets[question.bootcamp] || ""),
    subject: String(question.subject || ""),
    module: String(question.module || ""),
    practiceTest: Number(question.practiceTest || 0),
    prompt: String(question.prompt || ""),
    passage: String(question.passage || ""),
    options: Array.isArray(question.options) ?
      question.options.map((option) => String(option)) : [],
    configuredAnswer: String(question.configuredAnswer || ""),
    configuredAnswerIndex: question.configuredAnswerIndex === null ? null :
      Number(question.configuredAnswerIndex),
    explanation: String(question.explanation || ""),
    imageSources: Array.isArray(question.imageSources) ?
      question.imageSources.map((source) => String(source)) : [],
  };
  return `sha256:${crypto.createHash("sha256")
      .update(canonicalSerialize(payload), "utf8").digest("hex")}`;
}

/**
 * Fail closed unless committed reviews exactly cover and match the selection.
 *
 * @param {Object} document Committed review document
 * @param {Object[]} questions Current deterministic selection
 * @return {boolean} True when every binding is valid
 */
function validateReviewResults(document, questions) {
  const expectedDatasets = datasetVersionsFor(questions);
  assert.equal(document.formatVersion, 1,
      "Unsupported academic review format version");
  assert.equal(document.selectionSeed, "academic-pilot-v1",
      "Academic review selection seed does not match");
  assert.equal(document.rubric, "docs/QUESTION_REVIEW_RUBRIC.md",
      "Academic review rubric reference does not match");
  assert.deepEqual(document.datasets, expectedDatasets,
      "Reviewed dataset versions do not match the current content versions");
  assert.equal(document.questionCount, questions.length,
      "Review questionCount does not match the deterministic selection");
  assert.ok(Array.isArray(document.reviews), "Review records are missing");

  const reviewsById = new Map();
  document.reviews.forEach((review) => {
    assert.ok(review && review.legacyId, "A review is missing legacyId");
    assert.equal(reviewsById.has(review.legacyId), false,
        `Duplicate review legacyId: ${review.legacyId}`);
    reviewsById.set(review.legacyId, review);
  });
  assert.equal(reviewsById.size, questions.length,
      "Review records do not exactly cover the deterministic selection");

  questions.forEach((question) => {
    const review = reviewsById.get(question.legacyId);
    assert.ok(review, `Missing review for ${question.legacyId}`);
    assert.match(String(review.contentFingerprint || ""),
        /^sha256:[a-f0-9]{64}$/,
        `Missing content fingerprint for ${question.legacyId}`);
    assert.equal(
        review.contentFingerprint,
        contentFingerprint(question, expectedDatasets),
        `Reviewed content changed for ${question.legacyId}`,
    );
    if (review.answerVerdict === "correct") {
      assert.equal(
          review.independentlyDeterminedAnswerIndex,
          question.configuredAnswerIndex,
          `Independent answer does not match ${question.legacyId}`,
      );
    }
  });
  return true;
}

module.exports = {
  canonicalSerialize,
  contentFingerprint,
  datasetVersionsFor,
  validateReviewResults,
};
