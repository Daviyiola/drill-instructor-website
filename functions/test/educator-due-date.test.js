"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {normalizeFutureDueAt} = require("../handlers/_educatorDueDate");

test("educator due dates may be empty", () => {
  assert.deepEqual(normalizeFutureDueAt("", 1000), {
    ok: true, dueAt: "", error: "",
  });
});

test("educator due dates reject invalid and past values", () => {
  assert.equal(
      normalizeFutureDueAt("not-a-date", 1000).error,
      "INVALID_DUE_DATE",
  );
  assert.equal(
      normalizeFutureDueAt("1970-01-01T00:00:01.000Z", 1000).error,
      "DUE_DATE_MUST_BE_IN_FUTURE",
  );
});

test("educator due dates normalize future values", () => {
  assert.deepEqual(normalizeFutureDueAt("2030-01-02T03:04:05Z", 1000), {
    ok: true,
    dueAt: "2030-01-02T03:04:05.000Z",
    error: "",
  });
});
