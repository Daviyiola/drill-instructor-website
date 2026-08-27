"use strict";
/* eslint-disable require-jsdoc, max-len */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  aggregateProviderRows,
  entitlementIsActive,
  signedLicense,
} = require("../handlers/_entitlements");
const {
  claimStoreNotification,
  completeStoreNotification,
  releaseStoreNotificationClaim,
} = require("../handlers/_storeNotificationClaims");
const {appleProduct, googleProduct} = require("../handlers/_storeCatalog");
const {appleTransactionRecord, parseAppleRoots} =
  require("../handlers/_appleStore");
const {googlePurchaseRecord, googleTokenHash} =
  require("../handlers/_googlePlay");
const {appAccountTokenForUid} = require("../handlers/_storeAccount");
const {cancelStripeSubscriptions} = require("../handlers/deleteAccountHttps");
const {persistAppleTransaction} =
  require("../handlers/verifyApplePurchaseHttps");
const {persistGooglePurchase} =
  require("../handlers/verifyGooglePlayPurchaseHttps");
const {deletedBillingUser} = require("../handlers/stripeWebhookHttps");

const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const FUTURE = NOW + 31 * 24 * 60 * 60 * 1000;

function entitlement(provider, expiration = FUTURE) {
  return {
    provider,
    productId: `${provider}_product`,
    planType: "monthly",
    status: "active",
    grantsAccess: true,
    activationDate: new Date(NOW).toISOString(),
    expirationDate: new Date(expiration).toISOString(),
    autoRenews: true,
  };
}

function memoryDb(initial = {}) {
  const root = structuredClone(initial);
  const parts = (path) => String(path || "").split("/").filter(Boolean);
  const read = (path) => parts(path).reduce(
      (node, key) => node && typeof node === "object" ? node[key] : undefined,
      root,
  );
  const write = (path, value) => {
    const keys = parts(path);
    let node = root;
    keys.slice(0, -1).forEach((key) => {
      if (!node[key] || typeof node[key] !== "object") node[key] = {};
      node = node[key];
    });
    if (!keys.length) return;
    if (value === null) {
      delete node[keys.at(-1)];
    } else {
      node[keys.at(-1)] = structuredClone(value);
    }
  };
  const ref = (path = "") => ({
    once: async () => ({
      val: () => structuredClone(read(path)),
      exists: () => read(path) !== undefined && read(path) !== null,
    }),
    set: async (value) => write(path, value),
    remove: async () => write(path, null),
    update: async (updates) => {
      if (!path) {
        Object.entries(updates).forEach(([key, value]) => write(key, value));
      } else {
        Object.entries(updates).forEach(([key, value]) =>
          write(`${path}/${key}`, value));
      }
    },
    transaction: async (update) => {
      const current = structuredClone(read(path));
      const next = update(current);
      if (next === undefined) {
        return {
          committed: false,
          snapshot: {val: () => structuredClone(read(path))},
        };
      }
      write(path, next);
      return {
        committed: true,
        snapshot: {val: () => structuredClone(read(path))},
      };
    },
  });
  return {ref, root};
}

test("provider aggregation keeps access while any provider remains valid", () => {
  const result = aggregateProviderRows({
    stripe: entitlement("stripe", FUTURE),
    access_code: entitlement("access_code", FUTURE + 1000),
    app_store: {...entitlement("app_store"), grantsAccess: false},
  }, NOW);
  assert.deepEqual(result.activeProviders, ["access_code", "stripe"]);
  assert.equal(result.selected.provider, "access_code");
  assert.equal(entitlementIsActive(result.selected, NOW), true);
  assert.equal(
      signedLicense("user_demo", "act", result.selected, "secret", NOW).source,
      "access_code",
  );
});

test("canonical licenses retain provider transaction and grace details", () => {
  const license = signedLicense("user_demo", "act", {
    ...entitlement("stripe"),
    transactionId: "sub_current",
    paymentNeedsAttention: true,
    paymentGraceEndsAt: new Date(FUTURE).toISOString(),
  }, "secret", NOW);
  assert.equal(license.providerTransactionId, "sub_current");
  assert.equal(license.paymentNeedsAttention, true);
  assert.equal(license.paymentGraceEndsAt, new Date(FUTURE).toISOString());
});

test("store catalog accepts only configured products and base plans", () => {
  assert.deepEqual(appleProduct("com.drillinstructor.app.act.annual"), {
    bootcamp: "act", planType: "annual",
  });
  assert.deepEqual(googleProduct("sat_premium", "monthly"), {
    bootcamp: "sat", planType: "monthly",
  });
  assert.equal(appleProduct("wrong.product"), null);
  assert.equal(googleProduct("sat_premium", "weekly"), null);
});

test("Apple purchases fail closed for revocation and unsupported products", () => {
  const base = {
    productId: "com.drillinstructor.app.act.monthly",
    originalTransactionId: "1001",
    transactionId: "1002",
    purchaseDate: NOW,
    expiresDate: FUTURE,
    appAccountToken: "token",
  };
  assert.equal(appleTransactionRecord(base, null, NOW).grantsAccess, true);
  assert.equal(appleTransactionRecord({
    ...base, revocationDate: NOW,
  }, null, NOW).status, "revoked");
  assert.throws(
      () => appleTransactionRecord({...base, productId: "wrong"}, null, NOW),
      /Unsupported Apple product/,
  );
  assert.throws(() => parseAppleRoots(""), /not configured/);
});

test("Apple billing grace extends access only through Apple's grace date", () => {
  const expired = NOW - 60 * 60 * 1000;
  const graceEnds = NOW + 2 * 24 * 60 * 60 * 1000;
  const value = appleTransactionRecord({
    productId: "com.drillinstructor.app.act.monthly",
    originalTransactionId: "2001",
    transactionId: "2002",
    purchaseDate: NOW - 31 * 24 * 60 * 60 * 1000,
    expiresDate: expired,
  }, {
    autoRenewStatus: 1,
    isInBillingRetryPeriod: true,
    gracePeriodExpiresDate: graceEnds,
    expirationIntent: 2,
  }, NOW);
  assert.equal(value.status, "grace");
  assert.equal(value.grantsAccess, true);
  assert.equal(value.paymentNeedsAttention, true);
  assert.equal(value.expirationDate, new Date(graceEnds).toISOString());
  assert.equal(value.paymentGraceEndsAt, new Date(graceEnds).toISOString());
  assert.equal(appleTransactionRecord({
    productId: "com.drillinstructor.app.act.monthly",
    originalTransactionId: "2001",
    transactionId: "2002",
    expiresDate: expired,
  }, {
    isInBillingRetryPeriod: true,
    gracePeriodExpiresDate: NOW - 1,
  }, NOW).grantsAccess, false);
});

test("store notification claims release failures and recover stale attempts", async () => {
  const db = memoryDb();
  const first = await claimStoreNotification(
      db, "app_store", "event_one", "DID_RENEW", NOW,
  );
  assert.notEqual(first, "");
  assert.equal(await claimStoreNotification(
      db, "app_store", "event_one", "DID_RENEW", NOW + 1000,
  ), "");
  await releaseStoreNotificationClaim(
      db, "app_store", "event_one", first,
  );
  const retry = await claimStoreNotification(
      db, "app_store", "event_one", "DID_RENEW", NOW + 2000,
  );
  assert.notEqual(retry, "");
  await completeStoreNotification(
      db, "app_store", "event_one", retry, {}, NOW + 3000,
  );
  assert.equal(await claimStoreNotification(
      db, "app_store", "event_one", "DID_RENEW", NOW + 4000,
  ), "");

  db.root.storeNotificationEvents.play_store = {stale: {
    status: "processing",
    attemptId: "dead-worker",
    claimedAt: new Date(NOW - 10 * 60 * 1000).toISOString(),
  }};
  assert.notEqual(await claimStoreNotification(
      db, "play_store", "stale", "2", NOW,
  ), "");
});

test("Google Play pending, hold and expired purchases never grant access", () => {
  const purchase = (state) => ({
    subscriptionState: state,
    startTime: new Date(NOW).toISOString(),
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    lineItems: [{
      productId: "act_premium",
      expiryTime: new Date(FUTURE).toISOString(),
      offerDetails: {basePlanId: "monthly"},
      autoRenewingPlan: {autoRenewEnabled: true},
    }],
  });
  assert.equal(googlePurchaseRecord(
      purchase("SUBSCRIPTION_STATE_ACTIVE"), "hash", NOW,
  ).grantsAccess, true);
  for (const state of [
    "SUBSCRIPTION_STATE_PENDING",
    "SUBSCRIPTION_STATE_ON_HOLD",
    "SUBSCRIPTION_STATE_EXPIRED",
  ]) {
    assert.equal(googlePurchaseRecord(purchase(state), "hash", NOW)
        .grantsAccess, false);
  }
});

test("store account identifiers and purchase hashes are stable and opaque", () => {
  const token = appAccountTokenForUid("firebase-uid");
  assert.match(token, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab]/);
  assert.equal(token, appAccountTokenForUid("firebase-uid"));
  assert.notEqual(token, appAccountTokenForUid("another-uid"));
  assert.equal(
      googleTokenHash("purchase-token", "secret"),
      googleTokenHash("purchase-token", "secret"),
  );
  assert.notEqual(
      googleTokenHash("purchase-token", "secret"),
      googleTokenHash("purchase-token", "another-secret"),
  );
});

test("account deletion cancels every recoverable Stripe subscription", async () => {
  const canceled = [];
  const stripe = {
    subscriptions: {
      list: async () => ({
        data: [
          {id: "sub_active", status: "active"},
          {id: "sub_past_due", status: "past_due"},
          {id: "sub_ended", status: "canceled"},
        ],
        has_more: false,
      }),
      cancel: async (id) => canceled.push(id),
    },
  };
  assert.deepEqual(
      await cancelStripeSubscriptions(stripe, "cus_example"),
      ["sub_active", "sub_past_due"],
  );
  assert.deepEqual(canceled, ["sub_active", "sub_past_due"]);
  await assert.rejects(
      cancelStripeSubscriptions(null, "cus_example"),
      /BILLING_CANCELLATION_UNAVAILABLE/,
  );
  await assert.rejects(
      cancelStripeSubscriptions({
        subscriptions: {
          list: async () => ({data: [{id: "sub_bad", status: "active"}]}),
          cancel: async () => {
            throw new Error("Stripe unavailable");
          },
        },
      }, "cus_example"),
      /Stripe unavailable/,
  );
});

test("Apple transaction replay is idempotent and ownership is immutable", async () => {
  const db = memoryDb();
  const record = appleTransactionRecord({
    productId: "com.drillinstructor.app.act.monthly",
    originalTransactionId: "1000001",
    transactionId: "1000002",
    purchaseDate: NOW,
    expiresDate: FUTURE,
    appAccountToken: "account-token",
  }, null, NOW);
  await persistAppleTransaction(db, "user_one", record, "secret", NOW);
  await persistAppleTransaction(db, "user_one", record, "secret", NOW);
  assert.equal(
      db.root.storeTransactions.app_store["1000001"].userId,
      "user_one",
  );
  await assert.rejects(
      persistAppleTransaction(db, "user_two", record, "secret", NOW),
      /another account/,
  );
});

test("Google purchase verification rejects replay and never acknowledges pending", async () => {
  const db = memoryDb();
  const purchase = {
    subscriptionState: "SUBSCRIPTION_STATE_PENDING",
    startTime: new Date(NOW).toISOString(),
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    externalAccountIdentifiers: {obfuscatedExternalAccountId: "account-one"},
    lineItems: [{
      productId: "act_premium",
      expiryTime: new Date(FUTURE).toISOString(),
      offerDetails: {basePlanId: "monthly"},
      autoRenewingPlan: {autoRenewEnabled: true},
    }],
  };
  let acknowledgements = 0;
  const publisher = {
    purchases: {
      subscriptionsv2: {get: async () => ({data: purchase})},
      subscriptions: {acknowledge: async () => acknowledgements++},
    },
  };
  const input = {
    db,
    publisher,
    userId: "user_one",
    purchaseToken: "purchase-token",
    requestedProductId: "act_premium",
    expectedAccountId: "account-one",
    tokenHashSecret: "token-secret",
    licenseSalt: "license-secret",
  };
  await persistGooglePurchase(input);
  assert.equal(acknowledgements, 0);
  await assert.rejects(
      persistGooglePurchase({...input, userId: "user_two"}),
      /another account/,
  );
});

test("deleted-user tombstones prevent late Stripe billing writes", async () => {
  const db = memoryDb({
    deletedBillingUsers: {user_deleted: {deletedAt: new Date(NOW).toISOString()}},
  });
  assert.equal(await deletedBillingUser(db, "user_deleted"), true);
  assert.equal(await deletedBillingUser(db, "user_active"), false);
});
