"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CATALOG,
  enabledPlanBootcamps,
  normalizeBootcamp,
  preferencePath,
  resolveBootcampAccount,
  studentTestdataBootcamps,
  visibleBootcamps,
} = require("../handlers/_bootcampVisibility");
const setBootcampVisibility = require(
    "../handlers/setBootcampVisibilityHttps",
);

/**
 * Build the smallest RTDB mock needed by account resolution.
 *
 * @param {Object} values Values keyed by RTDB path
 * @return {Object} Database mock
 */
function fakeDatabase(values) {
  return {
    ref(path) {
      return {
        once: async () => ({val: () => values[path]}),
      };
    },
  };
}

test("normalizes only catalog bootcamps", () => {
  assert.equal(normalizeBootcamp(" SAT "), "sat");
  assert.equal(normalizeBootcamp("unknown"), "");
  assert.deepEqual(CATALOG, ["act", "sat", "utme", "waec"]);
});

test("reads enabled educator plan entries in both supported shapes", () => {
  assert.deepEqual(enabledPlanBootcamps({
    SAT: {enabled: true},
    act: true,
    utme: {enabled: false},
    unsupported: {enabled: true},
  }), ["act", "sat"]);
});

test("derives initial student visibility from existing test data", () => {
  assert.deepEqual(studentTestdataBootcamps({
    SAT: {progress: {}},
    act: {license: {}},
    notes: {},
  }), ["act", "sat"]);
});

test("preserves explicit empty visibility after initialization", () => {
  assert.deepEqual(visibleBootcamps({sat: false}), []);
  assert.deepEqual(visibleBootcamps({sat: true, ACT: true}), ["act", "sat"]);
});

test("separates student and educator preference scopes", () => {
  assert.equal(preferencePath({role: "student", customUserId: "user_a"}),
      "accountPreferences/student/user_a/bootcamps");
  assert.equal(preferencePath({role: "educator", customUserId: "user_a"}),
      "accountPreferences/educator/user_a/bootcamps");
});

test("students discover the catalog and seed from test data", async () => {
  const account = await resolveBootcampAccount(fakeDatabase({
    "uidToCustom/firebase_1": {student: "user_1"},
    "users/user_1/testdata": {SAT: {}, waec: {}},
  }), "firebase_1");
  assert.deepEqual(account, {
    role: "student",
    customUserId: "user_1",
    available: CATALOG,
    entitled: ["sat", "waec"],
  });
});

test("educators use enabled school plan bootcamps", async () => {
  const account = await resolveBootcampAccount(fakeDatabase({
    "uidToCustom/firebase_2": {educator: "educator_1"},
    "educators/educator_1": {schoolID: "school_1"},
    "schools/school_1/educators/educator_1": {status: "approved"},
    "schools/school_1/plan/bootcamps": {
      sat: {enabled: true},
      act: {enabled: false},
    },
  }), "firebase_2");
  assert.deepEqual(account, {
    role: "educator",
    customUserId: "educator_1",
    available: ["sat"],
    entitled: ["sat"],
  });
});

test("visibility preflight runs before authentication", async () => {
  const headers = {};
  let statusCode = 0;
  let body = null;
  const response = {
    set(name, value) {
      headers[name] = value;
    },
    status(value) {
      statusCode = value;
      return this;
    },
    send(value) {
      body = value;
      return this;
    },
  };

  await setBootcampVisibility({method: "OPTIONS", headers: {}}, response);

  assert.equal(statusCode, 204);
  assert.equal(body, "");
  assert.equal(headers["Access-Control-Allow-Origin"], "*");
  assert.match(headers["Access-Control-Allow-Headers"], /Authorization/);
});
