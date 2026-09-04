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
 * Read one bounded, resumable subscription-index page.
 *
 * @param {Object} db Firebase database
 * @param {string} cursor Last processed subscription id
 * @param {number=} limit Maximum records
 * @param {boolean=} allowWrap Whether an exhausted checkpoint wraps to start
 * @return {Promise<{ids:string[], nextCursor:string}>} Index page
 */
async function readSubscriptionBatch(
    db, cursor, limit = 100, allowWrap = true,
) {
  const read = async (start) => {
    let query = db.ref("stripeSubscriptions").orderByKey();
    if (start) query = query.startAt(start);
    return (await query.limitToFirst(limit + 1).once("value")).val() || {};
  };
  let rows = await read(cursor);
  let ids = Object.keys(rows).sort()
      .filter((id) => !cursor || id > cursor)
      .slice(0, limit);
  if (!ids.length && cursor && allowWrap) {
    rows = await read("");
    ids = Object.keys(rows).sort().slice(0, limit);
  }
  return {ids, nextCursor: ids.length === limit ? ids[ids.length - 1] : ""};
}

/**
 * Refresh one bounded page of indexed Stripe subscriptions.
 *
 * @param {Object} stripe Stripe client
 * @param {Object} db Firebase database
 * @param {number=} nowMs Run time
 * @return {Promise<Object>} Reconciliation summary
 */
async function reconcileSubscriptions(stripe, db, nowMs = Date.now()) {
  const checkpointRef = db.ref("scheduledJobCheckpoints/stripeReconciliation");
  const checkpoint = (await checkpointRef.once("value")).val() || {};
  let cursor = cleanSegment(checkpoint.cursor, 180);
  const summary = {
    checked: 0,
    repaired: 0,
    failed: 0,
    failures: [],
    ranAt: new Date(nowMs).toISOString(),
  };

  // Preserve the previous 1,000-subscription ceiling, but read it as ten
  // bounded pages so a single daily invocation never downloads the root.
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const batch = await readSubscriptionBatch(
        db, cursor, 100, pageNumber === 0);
    if (!batch.ids.length) {
      cursor = "";
      break;
    }
    for (const rawId of batch.ids) {
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
    cursor = batch.nextCursor;
    if (!cursor) break;
  }

  const runId = String(nowMs);
  await db.ref().update({
    [`stripeReconciliationRuns/${runId}`]: summary,
    "scheduledJobCheckpoints/stripeReconciliation": {
      cursor,
      updatedAt: summary.ranAt,
      checked: summary.checked,
      failed: summary.failed,
    },
  });
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
module.exports.readSubscriptionBatch = readSubscriptionBatch;
