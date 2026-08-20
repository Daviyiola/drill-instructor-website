"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizedEmail,
  validEmail,
  sha256,
} = require("../handlers/requestAccountDeletionHttps");
const {
  tokenHash,
  validToken,
} = require("../handlers/confirmAccountDeletionHttps");

test("public account deletion normalizes and validates email", () => {
  assert.equal(normalizedEmail("  User@Example.COM "), "user@example.com");
  assert.equal(validEmail("user@example.com"), true);
  assert.equal(validEmail("not-an-email"), false);
});

test("account deletion accepts generated base64url tokens only", () => {
  const token = "a".repeat(43);
  assert.equal(validToken(token), true);
  assert.equal(validToken("short"), false);
  assert.equal(validToken(`${"a".repeat(42)}!`), false);
});

test("request and confirmation use the same deterministic token hash", () => {
  const token = "safe-token_value-with-enough-characters-123456";
  assert.equal(tokenHash(token), sha256(token));
  assert.match(tokenHash(token), /^[a-f0-9]{64}$/);
});
