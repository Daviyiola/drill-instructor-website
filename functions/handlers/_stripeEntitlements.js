"use strict";
/* eslint-disable require-jsdoc, max-len */

const {
  cleanSegment,
  planFromSubscription,
  subscriptionAccessDetails,
  subscriptionPeriod,
} = require("./_stripeBilling");
const {
  compareEntitlements,
  writeProviderEntitlement,
} = require("./_entitlements");

function stripeObjectId(value) {
  return cleanSegment(
      value && typeof value === "object" ? value.id : value,
      180,
  );
}

function stripeSubscriptionRecord(subscription, previous = {}, nowMs = Date.now()) {
  const period = subscriptionPeriod(subscription);
  const access = subscriptionAccessDetails(subscription, nowMs, previous);
  const activationMs = period.start > 0 ? period.start * 1000 : nowMs;
  const bootcamp = cleanSegment(
      subscription && subscription.metadata &&
      subscription.metadata.bootcamp,
      20,
  ).toLowerCase();
  return {
    userId: cleanSegment(
        subscription && subscription.metadata &&
        subscription.metadata.userId,
        160,
    ),
    customerId: stripeObjectId(subscription && subscription.customer),
    subscriptionId: stripeObjectId(subscription && subscription.id),
    bootcamp,
    productId: stripeObjectId(
        subscription && subscription.items &&
        subscription.items.data && subscription.items.data[0] &&
        subscription.items.data[0].price,
    ),
    planType: planFromSubscription(subscription),
    status: String(subscription && subscription.status || ""),
    grantsAccess: access.grantsAccess,
    activationDate: new Date(activationMs).toISOString(),
    expirationDate: new Date(access.expirationMs).toISOString(),
    autoRenews: subscription && subscription.cancel_at_period_end !== true &&
      ["active", "trialing", "past_due"].includes(
          String(subscription && subscription.status || ""),
      ),
    cancelAtPeriodEnd: subscription &&
      subscription.cancel_at_period_end === true,
    pastDueSince: access.pastDueSince,
    paymentGraceEndsAt: access.paymentGraceEndsAt,
    paymentNeedsAttention: access.paymentNeedsAttention,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

function bestStripeRecord(records, nowMs = Date.now()) {
  const normalized = (records || []).filter(Boolean).map((row) => ({
    ...row,
    provider: "stripe",
    transactionId: row.subscriptionId,
  }));
  const active = normalized.filter((row) => row.grantsAccess === true &&
    Date.parse(row.expirationDate || "") > nowMs);
  active.sort((a, b) => {
    const status = compareEntitlements(a, b);
    if (status) return status;
    return Date.parse(b.expirationDate) - Date.parse(a.expirationDate);
  });
  const all = [...normalized].sort(compareEntitlements);
  return {active, selected: active[0] || all[0] || null};
}

async function recomputeStripeEntitlement(
    db,
    userId,
    bootcamp,
    secretSalt,
    nowMs = Date.now(),
) {
  const ids = (await db.ref(
      `stripeSubscriptionsByUser/${userId}/${bootcamp}`,
  ).once("value")).val() || {};
  const records = (await Promise.all(Object.keys(ids).map(async (id) =>
    (await db.ref(`stripeSubscriptions/${id}`).once("value")).val(),
  ))).filter(Boolean);
  const result = bestStripeRecord(records, nowMs);
  const duplicatePath =
    `billingRemediation/duplicateStripeSubscriptions/${userId}/${bootcamp}`;
  if (result.active.length > 1) {
    const duplicate = {
      detectedAt: new Date(nowMs).toISOString(),
      subscriptionIds: result.active.map((row) => row.subscriptionId),
      count: result.active.length,
    };
    await db.ref(duplicatePath).set(duplicate);
    console.warn("DUPLICATE_ACTIVE_STRIPE_SUBSCRIPTIONS", {
      userId,
      bootcamp,
      count: result.active.length,
    });
  } else {
    await db.ref(duplicatePath).remove();
  }

  const row = result.selected || {
    provider: "stripe",
    planType: "",
    status: "expired",
    grantsAccess: false,
    activationDate: "",
    expirationDate: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
  };
  return writeProviderEntitlement(
      db,
      userId,
      bootcamp,
      {...row, provider: "stripe", transactionId: row.subscriptionId || ""},
      secretSalt,
      nowMs,
  );
}

module.exports = {
  bestStripeRecord,
  recomputeStripeEntitlement,
  stripeObjectId,
  stripeSubscriptionRecord,
};
