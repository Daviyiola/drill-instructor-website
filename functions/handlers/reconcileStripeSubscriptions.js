"use strict";

const Stripe = require("stripe");
const {getDatabase} = require("firebase-admin/database");
const {defineSecret} = require("firebase-functions/params");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {cleanSegment} = require("./_stripeBilling");
const {syncSubscription} = require("./stripeWebhookHttps");

const LICENSE_SALT = defineSecret("LICENSE_SALT");
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");

/**
 * Refresh every indexed Stripe subscription from Stripe's current state.
 *
 * @param {Object} stripe Stripe client
 * @param {Object} db Firebase database
 * @param {number=} nowMs Run time
 * @return {Promise<Object>} Reconciliation summary
 */
async function reconcileSubscriptions(stripe, db, nowMs = Date.now()) {
  const indexes = (await db.ref("stripeSubscriptions")
      .once("value")).val() || {};
  const summary = {
    checked: 0,
    repaired: 0,
    failed: 0,
    failures: [],
    ranAt: new Date(nowMs).toISOString(),
  };

  for (const rawId of Object.keys(indexes).slice(0, 1000)) {
    const subscriptionId = cleanSegment(rawId, 180);
    if (!subscriptionId) continue;
    summary.checked += 1;
    try {
      const subscription = await stripe.subscriptions.retrieve(
          subscriptionId,
      );
      const result = await syncSubscription(db, subscription, {
        id: `reconcile_${subscriptionId}`,
        created: Math.floor(nowMs / 1000),
      }, false);
      if (result) summary.repaired += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        subscriptionId,
        message: String(error && error.message || "Unknown error")
            .slice(0, 240),
      });
    }
  }

  const runId = String(nowMs);
  await db.ref(`stripeReconciliationRuns/${runId}`).set(summary);
  return summary;
}

exports.reconcileStripeSubscriptions = onSchedule(
    {
      schedule: "17 3 * * *",
      timeZone: "UTC",
      region: "us-central1",
      timeoutSeconds: 540,
      memory: "256MiB",
      cpu: "gcf_gen1",
      maxInstances: 1,
      secrets: [STRIPE_SECRET_KEY, LICENSE_SALT],
    },
    async () => {
      const secret = STRIPE_SECRET_KEY.value();
      if (!secret) throw new Error("STRIPE_SECRET_KEY is not configured");
      const summary = await reconcileSubscriptions(
          new Stripe(secret),
          getDatabase(),
      );
      console.log("STRIPE_RECONCILIATION_COMPLETE", summary);
    },
);

module.exports.reconcileSubscriptions = reconcileSubscriptions;
