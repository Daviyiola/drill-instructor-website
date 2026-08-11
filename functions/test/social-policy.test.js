"use strict";
/* eslint-disable require-jsdoc, max-len */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LEGACY_DEFAULT_AUDIENCE,
  NEW_ACCOUNT_DEFAULT_AUDIENCE,
  canSendChallenge,
  normalizeChallengeAudience,
} = require("../handlers/_socialPolicy");

function fakeDb(values) {
  return {
    ref(path) {
      return {
        async once() {
          const exists = Object.prototype.hasOwnProperty.call(values, path) &&
            values[path] !== null && values[path] !== undefined;
          return {
            exists: () => exists,
            val: () => exists ? values[path] : null,
          };
        },
      };
    },
  };
}

test("social defaults preserve existing accounts and protect new accounts", () => {
  assert.equal(LEGACY_DEFAULT_AUDIENCE, "anyone");
  assert.equal(NEW_ACCOUNT_DEFAULT_AUDIENCE, "squad_only");
  assert.equal(normalizeChallengeAudience(undefined), "anyone");
  assert.equal(normalizeChallengeAudience("squad_only"), "squad_only");
});

test("squad-only challenge permission is controlled by the recipient", async () => {
  const sender = "user_sender";
  const recipient = "user_recipient";
  const denied = await canSendChallenge(fakeDb({
    [`studentSocial/${recipient}/settings/challengeAudience`]: "squad_only",
  }), sender, recipient);
  assert.equal(denied.allowed, false);

  const allowed = await canSendChallenge(fakeDb({
    [`studentSocial/${recipient}/settings/challengeAudience`]: "squad_only",
    [`users/${recipient}/squadMembers/${sender}`]: true,
  }), sender, recipient);
  assert.equal(allowed.allowed, true);
});

test("a block in either direction prevents challenges", async () => {
  const sender = "user_sender";
  const recipient = "user_recipient";
  const outgoing = await canSendChallenge(fakeDb({
    [`studentSocial/${sender}/blocks/${recipient}`]: {createdAt: 1},
  }), sender, recipient);
  assert.equal(outgoing.allowed, false);

  const incoming = await canSendChallenge(fakeDb({
    [`studentSocial/${recipient}/blocks/${sender}`]: {createdAt: 1},
  }), sender, recipient);
  assert.equal(incoming.allowed, false);
});

test("nobody rejects and missing legacy settings allow challenges", async () => {
  const sender = "user_sender";
  const recipient = "user_recipient";
  assert.equal((await canSendChallenge(fakeDb({}), sender, recipient)).allowed, true);
  assert.equal((await canSendChallenge(fakeDb({
    [`studentSocial/${recipient}/settings/challengeAudience`]: "nobody",
  }), sender, recipient)).allowed, false);
});
