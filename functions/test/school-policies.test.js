"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isValidTimezone,
  studentEnrollmentOpen,
} = require("../handlers/_schoolPolicies");

test("legacy schools remain open until enrollment is explicitly closed", () => {
  assert.equal(studentEnrollmentOpen(undefined), true);
  assert.equal(studentEnrollmentOpen({}), true);
  assert.equal(studentEnrollmentOpen({platoonPermissions: true}), true);
  assert.equal(studentEnrollmentOpen({platoonPermissions: false}), false);
});

test("school settings accept IANA timezones and reject arbitrary text", () => {
  assert.equal(isValidTimezone("Africa/Lagos"), true);
  assert.equal(isValidTimezone("America/New_York"), true);
  assert.equal(isValidTimezone("not/a-timezone"), false);
  assert.equal(isValidTimezone(""), false);
});
