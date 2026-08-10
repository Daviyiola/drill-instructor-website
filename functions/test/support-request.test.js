"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  HOUR_MS,
  enforceHourlyLimit,
  hashIdentifier,
  requestIp,
} = require("../handlers/submitSupportRequestHttps");

/**
 * Build the small RTDB surface needed by the limiter tests.
 * @return {Object} In-memory database stub
 */
function fakeDatabase() {
  const rows = new Map();
  return {
    ref(path) {
      return {
        async transaction(update) {
          const stored = rows.get(path);
          const current = stored === undefined ? null : stored;
          const next = update(current);
          if (next !== undefined) rows.set(path, next);
          return {committed: next !== undefined};
        },
      };
    },
  };
}

test("support rate limit blocks and resets after its window", async () => {
  const db = fakeDatabase();
  const now = 1000000;

  assert.equal((await enforceHourlyLimit(
      db, "email", "student@example.com", 2, now)).allowed, true);
  assert.equal((await enforceHourlyLimit(
      db, "email", "student@example.com", 2, now + 1)).allowed, true);

  const blocked = await enforceHourlyLimit(
      db, "email", "student@example.com", 2, now + 2);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);

  const reset = await enforceHourlyLimit(
      db, "email", "student@example.com", 2, now + HOUR_MS);
  assert.equal(reset.allowed, true);
});

test("support rate-limit identifiers do not expose their source", () => {
  const source = "student@example.com";
  const digest = hashIdentifier(source);
  assert.equal(digest.length, 64);
  assert.equal(digest.includes(source), false);
  assert.equal(digest, hashIdentifier(source));
});

test("support request IP uses the first forwarded address", () => {
  assert.equal(requestIp({
    headers: {"x-forwarded-for": "203.0.113.8, 10.0.0.1"},
    ip: "127.0.0.1",
  }), "203.0.113.8");
});
