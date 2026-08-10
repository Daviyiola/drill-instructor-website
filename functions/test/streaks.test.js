"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  dayKey,
  nextStreakNode,
  publicSummary,
  summarizeDays,
} = require("../handlers/_streaks");

test("streaks cross month and year boundaries", () => {
  assert.deepEqual(summarizeDays({
    "2025-12-31": true,
    "2026-01-01": true,
    "2026-01-02": true,
  }, {now: "2026-01-03T12:00:00Z"}), {
    current: 3,
    best: 3,
    lastPracticeDay: "2026-01-02",
  });
});

test("duplicate practice days do not increase the streak", () => {
  let node = nextStreakNode(null, {
    submittedAt: "2026-07-29T15:00:00Z",
    now: "2026-07-29T15:00:00Z",
  });
  node = nextStreakNode(node, {
    submittedAt: "2026-07-29T22:00:00Z",
    now: "2026-07-29T22:00:00Z",
  });
  assert.equal(Object.keys(node.days).length, 1);
  assert.equal(node.summary.current, 1);
  assert.equal(node.summary.best, 1);
});

test("delayed offline days can bridge and improve the best streak", () => {
  const node = nextStreakNode({
    days: {"2026-07-28": true, "2026-07-30": true},
  }, {
    submittedAt: "2026-07-29T18:00:00Z",
    now: "2026-07-30T20:00:00Z",
  });
  assert.equal(node.summary.current, 3);
  assert.equal(node.summary.best, 3);
});

test("timezone and numeric offset day keys agree", () => {
  const value = "2026-07-30T02:00:00Z";
  assert.equal(dayKey(value, "America/New_York"), "2026-07-29");
  assert.equal(dayKey(value, "", 240), "2026-07-29");
});

test("current streak decays while best streak remains", () => {
  assert.deepEqual(publicSummary({
    current: 5,
    best: 8,
    lastPracticeDay: "2026-07-20",
    timezone: "UTC",
  }, Date.parse("2026-07-30T12:00:00Z")), {
    current: 0,
    best: 8,
    lastPracticeDay: "2026-07-20",
    timezone: "UTC",
    timezoneOffsetMinutes: 0,
    metricVersion: "streak-v1",
  });
});
