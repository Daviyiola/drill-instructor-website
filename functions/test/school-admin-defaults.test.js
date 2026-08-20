"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRecommendedEducatorAccess,
} = require("../handlers/_schoolAdminAccess");

test("recommended access covers active plan and school scope", () => {
  const access = buildRecommendedEducatorAccess({
    status: "active",
    startAt: "2026-01-01T00:00:00.000Z",
    endAt: "2027-01-01T00:00:00.000Z",
    bootcamps: {
      act: {enabled: true},
      sat: {enabled: true},
      utme: {enabled: false},
    },
  });

  assert.deepEqual(access.bootcamps, {act: true, sat: true});
  assert.deepEqual(access.subjectsByBootcamp, {
    act: {all: true},
    sat: {all: true},
  });
  assert.deepEqual(access.students, {all: true});
  assert.deepEqual(access.groups, {all: true});
});

test("first-approval defaults do not grant inactive or expired plans", () => {
  const access = buildRecommendedEducatorAccess({
    status: "inactive",
    bootcamps: {act: {enabled: true}},
  });

  assert.deepEqual(access.bootcamps, {});
  assert.deepEqual(access.subjectsByBootcamp, {});
});
