"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {allowCors} = require("../handlers/_auth");
const {
  creditFreeSession,
  creditPaidSession,
  promoteFreeSessionToPaid,
} = require("../handlers/_pointsCredit");
const {
  accessCodeActivationPayload,
  buildAccessCodeHistoryEvent,
  buildLicense,
  claimAccessCode,
  cleanSegment,
} = require("../handlers/verifyAccessCodeHttps");
const {
  statusPayload,
} = require("../handlers/getSubscriptionStatusHttps");

/**
 * Clone JSON-compatible data.
 *
 * @param {*} value Input
 * @return {*} Clone
 */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** In-memory serialized transaction reference. */
class TransactionRef {
  /**
   * Create a reference.
   *
   * @param {*} initial Initial value
   */
  constructor(initial) {
    this.value = clone(initial);
    this.tail = Promise.resolve();
  }

  /**
   * Serialize fake transactions like RTDB.
   *
   * @param {Function} update Update callback
   * @return {Promise<Object>} Result
   */
  transaction(update) {
    const work = this.tail.then(() => {
      const next = update(clone(this.value));
      const committed = next !== undefined;
      if (committed) this.value = clone(next);
      return {
        committed,
        snapshot: {val: () => clone(this.value)},
      };
    });
    this.tail = work.then(() => undefined);
    return work;
  }

  /**
   * Read the current value before a transaction.
   *
   * @return {Promise<Object>} Snapshot promise
   */
  once() {
    return Promise.resolve({val: () => clone(this.value)});
  }
}

test("CORS handles browser preflight", () => {
  const headers = {};
  let status = 0;
  let body = null;
  const res = {
    set: (name, value) => {
      headers[name] = value;
    },
    status: (value) => {
      status = value;
      return res;
    },
    send: (value) => {
      body = value;
      return res;
    },
  };

  assert.equal(allowCors({method: "OPTIONS"}, res), true);
  assert.equal(status, 204);
  assert.equal(body, "");
  assert.equal(headers["Access-Control-Allow-Origin"], "*");
  assert.match(headers["Access-Control-Allow-Headers"], /Authorization/);
});

test("license generation fails closed without a secret", () => {
  assert.throws(() => buildLicense({
    code: "CODE",
    planType: "monthly",
    userId: "user_example",
    bootcamp: "sat",
  }, ""), /not configured/);
});

test("license generation is deterministic for a fixed activation time", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const license = buildLicense({
    code: "CODE",
    planType: "monthly",
    userId: "user_example",
    bootcamp: "sat",
  }, "secret", now);

  assert.equal(license.activationDate, "2026-01-01T00:00:00.000Z");
  assert.equal(license.expirationDate, "2026-02-01T00:00:00.000Z");
  assert.equal(license.licenseHash.length, 64);
});

test(
    "access-code claim blocks another user and permits same-user repair",
    async () => {
      const ref = new TransactionRef({used: false});
      const claimRef = new TransactionRef(null);
      const payload = {
        assignedTo: "user_one",
        bootcamp: "sat",
        claimedAt: "2026-01-01T00:00:00.000Z",
        activationDate: "2026-01-01T00:00:00.000Z",
        expirationDate: "2026-02-01T00:00:00.000Z",
        licenseHash: "abc",
      };

      const first = await claimAccessCode(ref, claimRef, payload);
      assert.equal(first.ok, true);
      assert.equal(first.value.claimed, true);

      const blocked = await claimAccessCode(ref, claimRef, {
        ...payload,
        assignedTo: "user_two",
      });
      assert.equal(blocked.ok, false);

      const retry = await claimAccessCode(ref, claimRef, payload);
      assert.equal(retry.ok, true);
      assert.equal(retry.reason, "retry");
    },
);

test("a finalized code cannot be replayed by the same user", async () => {
  const ref = new TransactionRef({
    used: true,
    assignedTo: "user_one",
    bootcamp: "sat",
  });
  const result = await claimAccessCode(ref, new TransactionRef(null), {
    assignedTo: "user_one",
    bootcamp: "sat",
    claimedAt: "2026-01-01T00:00:00.000Z",
    activationDate: "2026-01-01T00:00:00.000Z",
    expirationDate: "2026-02-01T00:00:00.000Z",
    licenseHash: "abc",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "used");
});

test("manually entered boolean access codes remain compatible", async () => {
  const available = new TransactionRef(false);
  const claim = await claimAccessCode(
      available,
      new TransactionRef(null), {
        assignedTo: "user_one",
        bootcamp: "act",
        claimedAt: "2026-07-28T00:00:00.000Z",
        activationDate: "2026-07-28T00:00:00.000Z",
        expirationDate: "2026-08-28T00:00:00.000Z",
        licenseHash: "abc",
      });
  assert.equal(claim.ok, true);
  assert.equal(claim.value.used, false);
  assert.equal(claim.value.claimed, true);

  const consumed = await claimAccessCode(
      new TransactionRef(true),
      new TransactionRef(null), {
        assignedTo: "user_one",
        bootcamp: "act",
      });
  assert.equal(consumed.ok, false);
  assert.equal(consumed.reason, "used");
});

test("a missing code is rejected before opening a transaction", async () => {
  const missing = new TransactionRef(null);
  let transactionCalled = false;
  missing.transaction = () => {
    transactionCalled = true;
    throw new Error("transaction should not run");
  };

  const result = await claimAccessCode(
      missing,
      new TransactionRef(null), {
        assignedTo: "user_one",
        bootcamp: "act",
      });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_found");
  assert.equal(transactionCalled, false);
});

test("subscription payload never exposes the redeemed code", () => {
  const payload = statusPayload({
    planType: "yearly",
    activationDate: "a",
    expirationDate: "b",
    code: "SENSITIVE",
  }, "sat", true);

  assert.equal(payload.hasActiveLicense, true);
  assert.equal(Object.hasOwn(payload, "code"), false);
});

test("access-code activation returns a non-secret entitlement contract", () => {
  const payload = accessCodeActivationPayload({
    code: "SENSITIVE",
    planType: "monthly",
    bootcamp: "act",
    activationDate: "2026-07-28T00:00:00.000Z",
    expirationDate: "2026-08-28T00:00:00.000Z",
  });

  assert.equal(payload.hasActiveLicense, true);
  assert.equal(payload.plan, "monthly");
  assert.equal(payload.source, "access_code");
  assert.equal(Object.hasOwn(payload, "code"), false);
});

test("mobile gates use the centralized entitlement contract", () => {
  const qmlRoot = path.join(__dirname, "..", "..", "Drill_Instructor", "qml");
  const main = fs.readFileSync(path.join(qmlRoot, "Main.qml"), "utf8");
  assert.match(main, /function cacheSubscriptionStatus\(/);
  assert.match(main, /function hasActiveSubscription\(/);
  assert.match(main, /function refreshSubscriptionStatus\(/);

  for (const file of [
    "Drills.qml",
    "TestandBookmarks.qml",
    "Results.qml",
    "SquadDrills.qml",
  ]) {
    const source = fs.readFileSync(
        path.join(qmlRoot, "Student", "Bootcamps", file),
        "utf8",
    );
    assert.match(source, /hasActiveSubscription\(/);
    assert.match(source, /refreshSubscriptionStatus\(/);
    assert.doesNotMatch(source, /currentAccessCode/);
  }

  const subscriptions = fs.readFileSync(
      path.join(qmlRoot, "Student", "Bootcamps", "Subscriptions.qml"),
      "utf8",
  );
  assert.match(subscriptions, /cacheSubscriptionStatus\(/);
  assert.doesNotMatch(subscriptions, /result\.code/);
});

test("access-code activation creates a code-safe history event", () => {
  const license = {
    code: "sensitive-code",
    planType: "monthly",
    bootcamp: "act",
    activationDate: "2026-07-24T00:00:00.000Z",
    expirationDate: "2026-08-24T00:00:00.000Z",
  };
  const first = buildAccessCodeHistoryEvent(
      license,
      "student_1",
      "2026-07-24T00:00:01.000Z",
  );
  const retry = buildAccessCodeHistoryEvent(
      license,
      "student_1",
      "2026-07-24T00:00:02.000Z",
  );

  assert.equal(first.eventId, retry.eventId);
  assert.equal(first.event.source, "access_code");
  assert.equal(first.event.bootcamp, "act");
  assert.equal(Object.hasOwn(first.event, "code"), false);
  assert.doesNotMatch(JSON.stringify(first), /sensitive-code/);
});

test(
    "subscription endpoints use the Firebase Admin modular database API",
    () => {
      for (const file of [
        "getSubscriptionStatusHttps.js",
        "verifyAccessCodeHttps.js",
      ]) {
        const source = fs.readFileSync(
            path.join(__dirname, "..", "handlers", file),
            "utf8",
        );
        assert.match(source, /firebase-admin\/database/);
        assert.match(source, /getDatabase\(\)/);
        assert.doesNotMatch(source, /admin\.database\(\)/);
      }
    },
);

test("path segments reject Firebase separators", () => {
  assert.equal(cleanSegment("sat"), "sat");
  assert.equal(cleanSegment("sat/other"), "");
  assert.equal(cleanSegment("bad.code"), "");
});

test("paid credit serializes duplicate concurrent delivery", async () => {
  const ref = new TransactionRef({totalPoints: 0});
  const db = {ref: () => ref};
  const deltas = await Promise.all([
    creditPaidSession(db, "user", "session", 100),
    creditPaidSession(db, "user", "session", 100),
  ]);

  assert.equal(deltas.reduce((sum, value) => sum + value, 0), 100);
  assert.equal(ref.value.totalPoints, 100);
  assert.equal(ref.value.pointsBySession.session, 100);
});

test("free credit serializes allowance enforcement", async () => {
  const ref = new TransactionRef({totalPoints: 0});
  const db = {ref: () => ref};
  const results = await Promise.all(
      Array.from({length: 12}, (_, index) =>
        creditFreeSession(db, "user", `session-${index}`, 100)),
  );

  assert.equal(results.filter((value) => value.consumedCredit).length, 10);
  assert.equal(ref.value.freeBudget.creditsUsed, 10);
  assert.equal(ref.value.totalPoints, 1000);
});

test("paid recovery awards blocked points exactly once", async () => {
  const ref = new TransactionRef({
    totalPoints: 1000,
    freeBudget: {creditsUsed: 10},
  });
  const db = {ref: () => ref};

  const first = await promoteFreeSessionToPaid(
      db,
      "user",
      "blocked-session",
      15,
  );
  const retry = await promoteFreeSessionToPaid(
      db,
      "user",
      "blocked-session",
      15,
  );

  assert.equal(first.deltaApplied, 15);
  assert.equal(retry.deltaApplied, 0);
  assert.equal(first.awardedPoints, 15);
  assert.equal(retry.awardedPoints, 15);
  assert.equal(ref.value.totalPoints, 1015);
  assert.equal(ref.value.pointsBySession["blocked-session"], 15);
});

test("paid recovery refunds a consumed free-practice credit", async () => {
  const ref = new TransactionRef({
    totalPoints: 1015,
    pointsBySession: {"free-session": 15},
    freeBudget: {creditsUsed: 10},
    freeCreditUsedForSessions: {"free-session": true},
  });
  const db = {ref: () => ref};

  const result = await promoteFreeSessionToPaid(
      db,
      "user",
      "free-session",
      15,
  );

  assert.equal(result.deltaApplied, 0);
  assert.equal(result.freeCreditRefunded, true);
  assert.equal(ref.value.totalPoints, 1015);
  assert.equal(ref.value.freeBudget.creditsUsed, 9);
  assert.equal(
      Object.hasOwn(ref.value.freeCreditUsedForSessions, "free-session"),
      false,
  );
});
