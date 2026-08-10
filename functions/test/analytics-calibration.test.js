"use strict";
/* eslint-disable max-len */

const test = require("node:test");
const assert = require("node:assert/strict");
const {aggregateAnalytics, readiness} = require("../handlers/_analytics");
const {NOW, makeAttempt, personas} = require("./fixtures/analyticsPersonas");

const catalog = {subjects: [
  {name: "Math", modules: ["Algebra", "Geometry"], practiceYears: [1, 2]},
  {name: "Science", modules: ["Biology", "Chemistry"], practiceYears: [1, 2]},
]};
const options = {
  bootcamp: "act",
  startAt: new Date(NOW - 89 * 86400000).toISOString(),
  endAt: new Date(NOW).toISOString(),
  timezone: "UTC",
  source: "all",
  subject: "",
  granularity: "week",
};

test("all deterministic calibration personas produce explainable readiness", () => {
  Object.entries(personas).forEach(([name, attempts]) => {
    const result = aggregateAnalytics(attempts, options, catalog, NOW);
    assert.ok(result.readiness.status, name);
    if (result.readiness.status === "estimated") {
      assert.ok(result.readiness.pillars, name);
      assert.equal(Object.keys(result.readiness.pillars).length, 3, name);
    } else {
      assert.equal(result.readiness.score, null, name);
    }
  });
});

test("volume has diminishing readiness returns", () => {
  const score = (volume) => readiness([
    makeAttempt({attempted: volume, accuracy: 80}),
  ], catalog, NOW).pillars.consistency;
  assert.ok(score(200) - score(100) > score(500) - score(400));
});

test("small accuracy changes do not create readiness cliffs", () => {
  const low = readiness([makeAttempt({accuracy: 79})], catalog, NOW);
  const high = readiness([makeAttempt({accuracy: 80})], catalog, NOW);
  assert.ok(high.score >= low.score);
  assert.ok(high.score - low.score <= 2);
});

test("releasing an assignment score changes only withheld performance", () => {
  const pending = personas.pendingAssignment[0];
  const released = personas.releasedScoreHiddenCorrections[0];
  const before = aggregateAnalytics([pending], options, catalog, NOW);
  const after = aggregateAnalytics([released], options, catalog, NOW);
  assert.equal(before.overview.attempts, after.overview.attempts);
  assert.equal(before.overview.activeTimeSec, after.overview.activeTimeSec);
  assert.equal(before.activity.current, after.activity.current);
  assert.equal(before.overview.accuracy, null);
  assert.ok(after.overview.accuracy > 0);
});
