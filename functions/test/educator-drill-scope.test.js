"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  drillVisibleToCaller,
  resolveDrillScope,
} = require("../handlers/getEducatorDrillsHttps");

test("educator drill directories default to the caller's own drills", () => {
  assert.equal(resolveDrillScope("", {adminAccess: true}), "own");
  assert.equal(resolveDrillScope("own", {superAdmin: true}), "own");
  assert.equal(
      drillVisibleToCaller(
          {createdByEducatorId: "educator-a"},
          "educator-a",
          {},
          "own",
      ),
      true,
  );
  assert.equal(
      drillVisibleToCaller(
          {createdByEducatorId: "educator-b"},
          "educator-a",
          {},
          "own",
      ),
      false,
  );
});

test("only school administrators can request the school-wide scope", () => {
  assert.equal(resolveDrillScope("school", {}), "own");
  assert.equal(resolveDrillScope("school", {adminAccess: true}), "school");
  assert.equal(resolveDrillScope("school", {superAdmin: true}), "school");
  assert.equal(
      drillVisibleToCaller(
          {createdByEducatorId: "educator-b"},
          "educator-a",
          {adminAccess: true},
          "school",
      ),
      true,
  );
});
