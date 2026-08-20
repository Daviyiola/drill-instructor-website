"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {rankingEnabled} = require("../handlers/aggregateUnitPoints");

test("disabled school units cannot contribute to ranking aggregates", () => {
  assert.equal(rankingEnabled({platoonPermissions: false}), false);
  assert.equal(rankingEnabled({platoonPermissions: true}), true);
  assert.equal(rankingEnabled({}), true);
});
