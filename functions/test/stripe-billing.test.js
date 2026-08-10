"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  licenseFromSubscription,
  planFromSubscription,
  priceIdFor,
  stripeLedgerEvent,
  subscriptionGrantsAccess,
  subscriptionPeriod,
  webAppUrl,
} = require("../handlers/_stripeBilling");
const {
  claimWebhookEvent,
  invoiceSubscriptionId,
  objectId,
  refundInvoiceId,
  releaseWebhookClaim,
} = require("../handlers/stripeWebhookHttps");
const {
  publicEvent,
} = require("../handlers/getStudentSubscriptionHistoryHttps");
const {
  annualUpgradeProducts,
  validateAnnualUpgrade,
} = require("../handlers/createStripeBillingPortalSessionHttps");

const FUTURE_SECONDS = Date.parse("2026-08-24T00:00:00.000Z") / 1000;
const NOW_MS = Date.parse("2026-07-24T00:00:00.000Z");

/**
 * Build a representative Stripe subscription.
 *
 * @param {Object=} overrides Fields to override
 * @return {Object} Subscription
 */
function subscription(overrides = {}) {
  return {
    id: "sub_example",
    customer: "cus_example",
    status: "active",
    cancel_at_period_end: false,
    current_period_start: Date.parse("2026-07-24T00:00:00.000Z") / 1000,
    current_period_end: FUTURE_SECONDS,
    metadata: {
      userId: "student_example",
      bootcamp: "act",
      planType: "monthly",
    },
    items: {
      data: [{
        price: {recurring: {interval: "month"}},
      }],
    },
    ...overrides,
  };
}

test("Stripe price ids are scoped by bootcamp and cadence", () => {
  const env = {
    STRIPE_PRICE_ACT_MONTHLY: "price_act_monthly",
    STRIPE_PRICE_ACT_ANNUAL: "price_act_annual",
    STRIPE_PRICE_SAT_MONTHLY: "price_sat_monthly",
    STRIPE_PRICE_SAT_ANNUAL: "price_sat_annual",
  };

  assert.equal(priceIdFor("ACT", "monthly", env), "price_act_monthly");
  assert.equal(priceIdFor("sat", "annual", env), "price_sat_annual");
  assert.equal(priceIdFor("waec", "monthly", env), "");
  assert.equal(priceIdFor("act", "quarterly", env), "");
});

test("Stripe return URL accepts only a clean HTTP origin", () => {
  assert.equal(
      webAppUrl({WEB_APP_URL: "https://app.example.com/"}),
      "https://app.example.com",
  );
  assert.equal(
      webAppUrl({WEB_APP_URL: "http://localhost:3000"}),
      "http://localhost:3000",
  );
  assert.equal(webAppUrl({WEB_APP_URL: "https://app.example.com/app"}), "");
  assert.equal(webAppUrl({WEB_APP_URL: "javascript:alert(1)"}), "");
});

test("subscription periods support item-level Stripe fields", () => {
  const value = subscription({
    current_period_start: undefined,
    current_period_end: undefined,
    items: {
      data: [{
        current_period_start: 100,
        current_period_end: 200,
        price: {recurring: {interval: "year"}},
      }],
    },
    metadata: {bootcamp: "sat"},
  });

  assert.deepEqual(subscriptionPeriod(value), {start: 100, end: 200});
  assert.equal(planFromSubscription(value), "annual");
});

test("the actual Stripe interval overrides stale checkout metadata", () => {
  const value = subscription({
    metadata: {
      userId: "student_example",
      bootcamp: "act",
      planType: "monthly",
    },
    items: {
      data: [{
        price: {id: "price_act_annual", recurring: {interval: "year"}},
      }],
    },
  });

  assert.equal(planFromSubscription(value), "annual");
});

test("annual upgrade validates student and monthly subscription", () => {
  const value = subscription({
    items: {
      data: [{
        id: "si_example",
        price: {
          id: "price_act_monthly",
          recurring: {interval: "month"},
        },
      }],
    },
  });
  const expected = {
    studentId: "student_example",
    bootcamp: "act",
    customerId: "cus_example",
    monthlyPriceId: "price_act_monthly",
  };

  assert.deepEqual(validateAnnualUpgrade(value, expected), {
    itemId: "si_example",
    customerId: "cus_example",
  });
  assert.throws(
      () => validateAnnualUpgrade(value, {
        ...expected,
        studentId: "another_student",
      }),
      /UPGRADE_OWNERSHIP_MISMATCH/,
  );
  assert.throws(
      () => validateAnnualUpgrade({
        ...value,
        cancel_at_period_end: true,
      }, expected),
      /UPGRADE_CANCELLATION_SCHEDULED/,
  );
});

test("annual upgrade supports shared and separate Stripe products", () => {
  const base = {
    monthlyPriceId: "price_monthly",
    annualPriceId: "price_annual",
  };
  assert.equal(annualUpgradeProducts({
    ...base,
    monthlyProductId: "prod_shared",
    annualProductId: "prod_shared",
  }).length, 1);
  assert.deepEqual(annualUpgradeProducts({
    ...base,
    monthlyProductId: "prod_monthly",
    annualProductId: "prod_annual",
  }).map((entry) => entry.product), ["prod_monthly", "prod_annual"]);
});

test("scheduled cancellation is paid; terminal states fail closed", () => {
  const scheduled = subscription({
    status: "active",
    cancel_at_period_end: true,
  });

  assert.equal(subscriptionGrantsAccess(scheduled, NOW_MS), true);
  assert.equal(
      subscriptionGrantsAccess(scheduled, FUTURE_SECONDS * 1000),
      false,
  );
  assert.equal(
      subscriptionGrantsAccess(subscription({status: "canceled"}), NOW_MS),
      false,
  );
  assert.equal(
      subscriptionGrantsAccess(subscription({status: "unpaid"}), NOW_MS),
      false,
  );
});

test("past-due access uses one persisted seven-day grace window", () => {
  const first = licenseFromSubscription(
      subscription({status: "past_due"}),
      "student_example",
      "license-secret",
      NOW_MS,
  );
  const threeDaysLater = NOW_MS + 3 * 24 * 60 * 60 * 1000;
  const repeated = licenseFromSubscription(
      subscription({status: "past_due"}),
      "student_example",
      "license-secret",
      threeDaysLater,
      first,
  );
  const eightDaysLater = NOW_MS + 8 * 24 * 60 * 60 * 1000;
  const expired = licenseFromSubscription(
      subscription({status: "past_due"}),
      "student_example",
      "license-secret",
      eightDaysLater,
      repeated,
  );

  assert.equal(first.paymentNeedsAttention, true);
  assert.equal(first.paymentGraceEndsAt, "2026-07-31T00:00:00.000Z");
  assert.equal(repeated.paymentGraceEndsAt, first.paymentGraceEndsAt);
  assert.equal(
      Date.parse(expired.expirationDate) <= eightDaysLater,
      true,
  );
});

test("Stripe licenses use the existing HMAC format", () => {
  const value = subscription({
    status: "active",
    cancel_at_period_end: true,
  });
  const license = licenseFromSubscription(
      value,
      "student_example",
      "license-secret",
      NOW_MS,
  );
  const payload = `${license.planType}|${license.bootcamp}|` +
    `${license.activationDate}|${license.expirationDate}|student_example`;
  const expected = crypto.createHmac("sha256", "license-secret")
      .update(payload)
      .digest("hex");

  assert.equal(license.expirationDate, "2026-08-24T00:00:00.000Z");
  assert.equal(license.cancelAtPeriodEnd, true);
  assert.equal(license.source, "stripe");
  assert.equal(license.licenseHash, expected);
});

test("refund events are recorded without exposing internal ownership", () => {
  const record = stripeLedgerEvent({
    stripeEventId: "evt_refund",
    type: "payment_refunded",
    status: "partially_refunded",
    userId: "student_private",
    bootcamp: "act",
    planType: "monthly",
    amount: 200,
    currency: "usd",
    invoiceId: "in_example",
    recordedAt: "2026-07-24T00:00:00.000Z",
  });
  const visible = publicEvent(record.eventId, record.event);

  assert.equal(record.eventId, "stripe_evt_refund");
  assert.equal(visible.amount, 200);
  assert.equal(visible.currency, "USD");
  assert.equal(Object.hasOwn(visible, "userId"), false);
  assert.equal(Object.hasOwn(visible, "stripeSubscriptionId"), false);
});

test("scheduled cancellation becomes a reader-facing history event", () => {
  const visible = publicEvent("event", {
    type: "subscription_updated",
    cancelAtPeriodEnd: true,
  });

  assert.equal(visible.type, "cancellation_scheduled");
});

test("invoice subscription ids support legacy and current shapes", () => {
  assert.equal(
      invoiceSubscriptionId({subscription: "sub_legacy"}),
      "sub_legacy",
  );
  assert.equal(invoiceSubscriptionId({
    parent: {
      subscription_details: {
        subscription: {id: "sub_current"},
      },
    },
  }), "sub_current");
  assert.equal(objectId({id: "bad/id"}), "");
});

test("refund handling does not directly rewrite subscription access", () => {
  const source = fs.readFileSync(
      path.join(__dirname, "..", "handlers", "stripeWebhookHttps.js"),
      "utf8",
  );
  const refundBody = source.slice(
      source.indexOf("async function handleRefund"),
      source.indexOf("/**\n * Stripe webhook"),
  );

  assert.match(refundBody, /payment_refunded/);
  assert.doesNotMatch(refundBody, /licenseFromSubscription/);
  assert.doesNotMatch(refundBody, /testdata\/.*license/);
});

test("refunds resolve current and legacy invoice shapes", async () => {
  assert.equal(
      await refundInvoiceId({}, {invoice: "in_legacy"}),
      "in_legacy",
  );
  const stripe = {
    invoicePayments: {
      list: async (input) => {
        assert.equal(input.payment.type, "payment_intent");
        assert.equal(input.payment.payment_intent, "pi_current");
        return {data: [{invoice: "in_current"}]};
      },
    },
  };
  assert.equal(
      await refundInvoiceId(stripe, {payment_intent: "pi_current"}),
      "in_current",
  );
});

test("Stripe webhook validates raw body and disables framework CORS", () => {
  const webhook = fs.readFileSync(
      path.join(__dirname, "..", "handlers", "stripeWebhookHttps.js"),
      "utf8",
  );
  const index = fs.readFileSync(
      path.join(__dirname, "..", "index.js"),
      "utf8",
  );

  assert.match(webhook, /constructEvent\(\s*req\.rawBody/);
  assert.match(index, /stripeWebhookHttps[\s\S]*?cors:\s*false/);
  assert.match(index, /STRIPE_WEBHOOK_SECRET/);
  assert.match(webhook, /invoice\.payment_action_required/);
  assert.match(webhook, /invoice\.finalization_failed/);
  assert.match(webhook, /subscriptions\.retrieve/);
  assert.match(index, /reconcileStripeSubscriptions/);
});

test("webhook claims serialize duplicates and release failures", async () => {
  let value = null;
  const ref = {
    transaction: async (update) => {
      const next = update(value);
      const committed = next !== undefined;
      if (committed) value = next;
      return {committed, snapshot: {val: () => value}};
    },
  };
  const db = {ref: () => ref};
  const event = {id: "evt_claim", type: "invoice.paid"};
  const first = await claimWebhookEvent(db, event, NOW_MS);
  const duplicate = await claimWebhookEvent(db, event, NOW_MS + 1000);

  assert.notEqual(first, "");
  assert.equal(duplicate, "");
  await releaseWebhookClaim(db, event.id, first);
  assert.equal(value, null);
  assert.notEqual(
      await claimWebhookEvent(db, event, NOW_MS + 2000),
      "",
  );
});

test("Checkout explicitly uses standard Stripe payments", () => {
  const checkout = fs.readFileSync(
      path.join(
          __dirname,
          "..",
          "handlers",
          "createStripeCheckoutSessionHttps.js",
      ),
      "utf8",
  );

  assert.match(checkout, /managed_payments:\s*\{enabled:\s*false\}/);
});
