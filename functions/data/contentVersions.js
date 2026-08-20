"use strict";

/**
 * Immutable content coordinates for the question banks shipped by Functions.
 *
 * Bumping correctionRevision changes only the cumulative correction overlay.
 * Moving a question between subjects/modules/practice tests requires a new
 * datasetVersion instead.
 * 
 * When does schemaVersion change?
 * Only when the structure of the content files changes—not when a question changes.
 * Examples that require a schema bump:
 * Changing imageSource: "a.png|b.png" into imageSources: ["a.webp", "b.webp"].
 * Replacing option1, option2 with an options array.
 * Changing the manifest or ZIP directory structure.
 * Renaming/removing fields that the native content reader expects.
 * Changing a field’s type, such as a string becoming an object.
 * These do not require a schema bump:
 * Correcting a typo.
 * Changing a question, answer, explanation, passage, or image.
 * Adding/removing a question.
 * Moving a question to a different module or practice test.
 * 
 * Full dataset release:
 *
 * 1. Edit functions/data/{bootcamp}Data.js.
 * 2. Increment datasetVersion.
 * 3. Keep schemaVersion at 2 unless the content structure changes.
 * 4. From the repository root, run:
 *
 * set FUNCTIONS_DISCOVERY_TIMEOUT=120
 * npm.cmd run content:release -- --bootcamp all --project drill-instructor-pro
 *
 * Use "act" or "sat" instead of "all" when releasing only one bootcamp.
 *
 * The command builds, publishes, deploys Functions, and verifies the registry.
 *
 * One-time authentication, if required:
 * gcloud.cmd auth application-default login
 * firebase.cmd login
 */
const CONTENT_VERSIONS = Object.freeze({
  act: Object.freeze({
    datasetVersion: "2026.08.4",
    schemaVersion: 2,
    correctionRevision: 0,
    freePracticeTests: Object.freeze([1, 2]),
  }),
  sat: Object.freeze({
    datasetVersion: "2026.08.2",
    schemaVersion: 2,
    correctionRevision: 0,
    freePracticeTests: Object.freeze([1, 2]),
  }),
});

/**
 * @param {*} value Bootcamp identifier
 * @return {Object|null} Immutable version descriptor
 */
function contentVersionFor(value) {
  return CONTENT_VERSIONS[String(value || "").trim().toLowerCase()] || null;
}

module.exports = {CONTENT_VERSIONS, contentVersionFor};
