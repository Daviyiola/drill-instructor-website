"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canArchiveDrill,
} = require("../handlers/setEducatorDrillArchivedHttps");

test("drill creator can archive their own visible drill", () => {
  assert.equal(
      canArchiveDrill(
          {createdByEducatorId: "educator-a"},
          "educator-a",
          {},
      ),
      true,
  );
});

test("regular educator cannot archive another educator's drill", () => {
  assert.equal(
      canArchiveDrill(
          {createdByEducatorId: "educator-a"},
          "educator-b",
          {},
      ),
      false,
  );
});

test("administrators can archive visible school drills personally", () => {
  assert.equal(
      canArchiveDrill(
          {createdByEducatorId: "educator-a"},
          "educator-b",
          {adminAccess: true},
      ),
      true,
  );
  assert.equal(
      canArchiveDrill(
          {createdByEducatorId: "educator-a"},
          "educator-b",
          {superAdmin: true},
      ),
      true,
  );
});
