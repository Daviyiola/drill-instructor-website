"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  bookmarkPath,
  normalizeGroups,
  publicQuestion,
} = require("../handlers/educatorBookmarksHttps");

test("educator bookmarks are scoped by school, educator, and bootcamp", () => {
  assert.equal(
      bookmarkPath("school-a", "educator-a", "act"),
      "schools/school-a/educatorBookmarks/educator-a/act",
  );
});

test("educator bookmark hydration exposes current question content", () => {
  const row = publicQuestion({
    id: "mathematics_1",
    legacyId: "Mathematics#1",
    sourceId: "1",
    subject: "Mathematics",
    module: "Algebra",
    practiceYear: 1,
    prompt: "Question",
    options: ["A", "B", "C", "D"],
    correctIndex: 2,
    explanation: "Because C.",
    passage: "Reference",
    imageSources: ["assets/Math1.webp", "assets/Math2.webp"],
    disabled: false,
  }, {bookmarkedAt: "2026-08-08T00:00:00.000Z"});
  assert.equal(row.answerIndex, 2);
  assert.equal(row.bookmarkedAt, "2026-08-08T00:00:00.000Z");
  assert.deepEqual(row.imageSources,
      ["assets/Math1.webp", "assets/Math2.webp"]);
});

test("educator bookmark groups are trimmed, unique, and bounded", () => {
  assert.deepEqual(
      normalizeGroups([" Algebra ", "Algebra", "Geometry", ""]),
      ["Algebra", "Geometry"],
  );
  assert.equal(
      normalizeGroups(Array.from({length: 25}, (_, i) => `G${i}`)).length,
      20,
  );
});
