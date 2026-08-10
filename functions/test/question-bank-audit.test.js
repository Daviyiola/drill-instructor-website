"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildReport,
  inspectMarkup,
  markupTags,
  normalizedText,
} = require("../scripts/auditQuestionBank");

test("audit markup distinguishes inequalities from HTML tags", () => {
  assert.deepEqual(inspectMarkup("0 < x < 4", "question"), []);
  const findings = inspectMarkup("<b>Step 1:</b><br>Work", "explanation");
  assert.equal(findings.every((row) => row.code === "legacy_markup"), true);
});

test("audit markup reports mismatched and unsafe tags", () => {
  const mismatched = inspectMarkup("<b>answer</i>", "explanation");
  assert.ok(mismatched.some((row) => row.code === "mismatched_markup"));
  const unsafe = inspectMarkup("<script>alert(1)</script>", "question");
  assert.ok(unsafe.some((row) => row.code === "unsafe_markup"));
});

test("normalization compares visible text rather than legacy markup", () => {
  assert.equal(normalizedText("<b> A </b><br>B"), "a b");
  assert.deepEqual(markupTags("0 < x < 4; <b>A</b><br>"), {b: 2, br: 1});
});

test("audit report exposes deterministic and manual-review contracts", () => {
  const report = buildReport(["sat"], "2026-08-09T00:00:00.000Z");
  assert.equal(report.formatVersion, 1);
  assert.equal(report.generatedAt, "2026-08-09T00:00:00.000Z");
  assert.ok(report.questions.length > 100);
  assert.equal(report.questions[0].manualReview.status, "pending");
  assert.equal(
      report.questions[0].manualReview.answerVerdict,
      "not_reviewed",
  );
  assert.ok(report.summary.markupTagCounts.br > 0);
  assert.ok(report.summary.explanationStyles.prose > 0);
});
