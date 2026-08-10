"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  cleanName,
  cleanAvatar,
  editableProfile,
} = require("../handlers/updateStudentProfileHttps");
const {
  publicProfile,
  publicEntitlement,
} = require("../handlers/resolveSignInAccountHttps");
const {
  studentMembershipPath,
} = require("../handlers/deleteAccountHttps");

test("student profile names reject markup and control text", () => {
  assert.equal(cleanName("  Ada   Lovelace  "), "Ada Lovelace");
  assert.equal(cleanName("<Ada>"), "");
  assert.equal(cleanName("Ada\u0007Lovelace"), "");
  assert.equal(cleanName("   "), "");
});

test("student avatars remain within the shared mobile and web range", () => {
  assert.equal(cleanAvatar(7), 7);
  assert.equal(cleanAvatar("14"), 14);
  assert.equal(cleanAvatar(0), 1);
  assert.equal(cleanAvatar(15), 1);
});

test("student account resolution includes Firebase verification state", () => {
  const handler = fs.readFileSync(
      path.join(__dirname, "../handlers/resolveSignInAccountHttps.js"),
      "utf8",
  );
  assert.match(
      handler,
      new RegExp(
          "role:\\s*\"student\",[\\s\\S]*?customUserId," +
          "[\\s\\S]*?emailVerified,[\\s\\S]*?profile," +
          "[\\s\\S]*?entitlements,",
      ),
  );
});

test("sign-in profile excludes database branches and server secrets", () => {
  const profile = publicProfile({
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    totalPoints: 50,
    currentRank: "RECRUIT",
    uid: "firebase-secret",
    stats: {session: {correct: 10}},
    statsIndex: {session: true},
    testdata: {act: {license: {code: "RAW-CODE", licenseHash: "hash"}}},
    userChallenges: {challenge: {status: "accepted"}},
    assignedDrills: {assignment: true},
  });
  assert.deepEqual(profile, {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    currentRank: "RECRUIT",
    totalPoints: 50,
  });
  assert.equal(JSON.stringify(profile).includes("RAW-CODE"), false);
  assert.equal(JSON.stringify(profile).includes("licenseHash"), false);
});

test("sign-in entitlement excludes code and license signature", () => {
  const entitlement = publicEntitlement({
    code: "RAW-CODE",
    licenseHash: "server-signature",
    planType: "monthly",
    activationDate: "2026-08-01T00:00:00.000Z",
    expirationDate: "2026-09-01T00:00:00.000Z",
    source: "access_code",
  }, true);
  assert.deepEqual(entitlement, {
    hasActiveLicense: true,
    plan: "monthly",
    activationDate: "2026-08-01T00:00:00.000Z",
    expirationDate: "2026-09-01T00:00:00.000Z",
    source: "access_code",
  });
  assert.equal("code" in entitlement, false);
  assert.equal("licenseHash" in entitlement, false);
});

test("editable student profile exposes only profile-editor fields", () => {
  assert.deepEqual(
      editableProfile({
        firstName: "Ada",
        lastName: "Lovelace",
        avaterNumber: 4,
        profilePermissions: true,
        platoonPermissions: false,
        corpsName: "United States of America",
        battalionName: "Tennessee",
        platoonName: "Example School",
        uid: "private",
        stats: {private: true},
      }),
      {
        firstName: "Ada",
        lastName: "Lovelace",
        avatarNumber: 4,
        profilePermissions: true,
        platoonPermissions: false,
        corpsName: "United States of America",
        battalionName: "Tennessee",
        platoonName: "Example School",
      },
  );
});

test("account deletion derives the external unit membership safely", () => {
  assert.equal(
      studentMembershipPath({
        corpsName: "United States of America",
        battalionName: "Tennessee",
        platoonName: "Example School",
      }, "user_example"),
      "units/corps/United States of America/Tennessee/" +
      "Example School/members/user_example",
  );
  assert.equal(
      studentMembershipPath({corpsName: "bad/path"}, "user_example"),
      "",
  );
});

test("account deletion removes billing history and Stripe mappings", () => {
  const source = fs.readFileSync(
      path.join(__dirname, "..", "handlers", "deleteAccountHttps.js"),
      "utf8",
  );
  assert.match(source, /subscriptionEvents\/\$\{studentId\}/);
  assert.match(source, /stripeCustomers\/\$\{studentId\}/);
  assert.match(source, /stripeCustomerIndex\/\$\{stripeCustomerId\}/);
});
