"use strict";

const crypto = require("crypto");
const {stripePriceEnvKey} = require("./_billingCatalog");

const SUPPORTED_BOOTCAMPS = new Set(["act", "sat"]);
const SUPPORTED_PLANS = new Set(["monthly", "annual"]);
const PAYMENT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Normalize a value that will be used in an RTDB path.
 *
 * @param {*} value Input value
 * @param {number} maxLength Maximum length
 * @return {string} Safe path segment
 */
function cleanSegment(value, maxLength = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) return "";
  if (/[.#$[\]/]/.test(normalized)) return "";
  return normalized;
}

/**
 * Return the configured recurring Stripe Price for a bootcamp and plan.
 *
 * @param {string} bootcamp Bootcamp id
 * @param {string} planType Billing cadence
 * @param {Object=} env Environment map
 * @return {string} Stripe Price id
 */
function priceIdFor(bootcamp, planType, env = process.env) {
  const normalizedBootcamp = cleanSegment(bootcamp, 20).toLowerCase();
  const normalizedPlan = cleanSegment(planType, 20).toLowerCase();
  if (!SUPPORTED_BOOTCAMPS.has(normalizedBootcamp) ||
      !SUPPORTED_PLANS.has(normalizedPlan)) {
    return "";
  }
  const key = stripePriceEnvKey(normalizedBootcamp, normalizedPlan);
  return String(env[key] || "").trim();
}

/**
 * Validate the configured web app origin used for Stripe return URLs.
 *
 * @param {Object=} env Environment map
 * @return {string} Origin without trailing slash
 */
function webAppUrl(env = process.env) {
  const value = String(env.WEB_APP_URL || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return "";
    return parsed.origin;
  } catch (_) {
    return "";
  }
}

/**
 * Resolve the billing interval stored on a Stripe subscription.
 *
 * @param {Object} subscription Stripe subscription
 * @return {string} monthly or annual
 */
function planFromSubscription(subscription) {
  const recurring = subscription && subscription.items &&
    subscription.items.data && subscription.items.data[0] &&
    subscription.items.data[0].price &&
    subscription.items.data[0].price.recurring;
  if (recurring && recurring.interval === "year") return "annual";
  if (recurring && recurring.interval === "month") return "monthly";
  const metadataPlan = String(
      subscription && subscription.metadata &&
      subscription.metadata.planType || "",
  ).toLowerCase();
  return SUPPORTED_PLANS.has(metadataPlan) ? metadataPlan : "monthly";
}

/**
 * Read period boundaries across Stripe API versions.
 *
 * @param {Object} subscription Stripe subscription
 * @return {{start:number, end:number}} Unix seconds
 */
function subscriptionPeriod(subscription) {
  const items = subscription && subscription.items &&
    Array.isArray(subscription.items.data) ? subscription.items.data : [];
  const starts = items.map((item) => Number(item.current_period_start || 0))
      .filter((value) => value > 0);
  const ends = items.map((item) => Number(item.current_period_end || 0))
      .filter((value) => value > 0);
  return {
    start: Number(subscription && subscription.current_period_start || 0) ||
      (starts.length ? Math.min(...starts) : 0),
    end: Number(subscription && subscription.current_period_end || 0) ||
      (ends.length ? Math.max(...ends) : 0),
  };
}

/**
 * Resolve the access window for the current Stripe subscription state.
 *
 * Scheduled cancellations remain `active` until their paid period ends.
 * `past_due` receives one persisted seven-day grace window; terminal states
 * fail closed.
 *
 * @param {Object} subscription Stripe subscription
 * @param {number=} nowMs Current time in milliseconds
 * @param {Object=} previousLicense Previously stored license
 * @return {Object} Access decision and warning fields
 */
function subscriptionAccessDetails(
    subscription,
    nowMs = Date.now(),
    previousLicense = {},
) {
  const period = subscriptionPeriod(subscription);
  const status = String(subscription && subscription.status || "");
  const periodEndMs = period.end * 1000;
  if (["active", "trialing"].includes(status)) {
    return {
      grantsAccess: periodEndMs > nowMs,
      expirationMs: periodEndMs > nowMs ? periodEndMs : nowMs,
      pastDueSince: "",
      paymentGraceEndsAt: "",
      paymentNeedsAttention: false,
    };
  }
  if (status === "past_due") {
    const storedSince = previousLicense &&
      previousLicense.status === "past_due" ?
      Date.parse(previousLicense.pastDueSince || "") : NaN;
    const pastDueSinceMs = Number.isFinite(storedSince) ? storedSince : nowMs;
    const graceEndMs = pastDueSinceMs + PAYMENT_GRACE_MS;
    return {
      grantsAccess: graceEndMs > nowMs,
      expirationMs: graceEndMs > nowMs ? graceEndMs : nowMs,
      pastDueSince: new Date(pastDueSinceMs).toISOString(),
      paymentGraceEndsAt: new Date(graceEndMs).toISOString(),
      paymentNeedsAttention: true,
    };
  }
  return {
    grantsAccess: false,
    expirationMs: nowMs,
    pastDueSince: "",
    paymentGraceEndsAt: "",
    paymentNeedsAttention: [
      "incomplete",
      "incomplete_expired",
      "paused",
      "unpaid",
    ].includes(status),
  };
}

/**
 * Whether current Stripe state grants access.
 *
 * @param {Object} subscription Stripe subscription
 * @param {number=} nowMs Current time in milliseconds
 * @param {Object=} previousLicense Previously stored license
 * @return {boolean} Access decision
 */
function subscriptionGrantsAccess(
    subscription,
    nowMs = Date.now(),
    previousLicense = {},
) {
  return subscriptionAccessDetails(
      subscription,
      nowMs,
      previousLicense,
  ).grantsAccess;
}

/**
 * Build a signed license compatible with the existing entitlement verifier.
 *
 * @param {Object} subscription Stripe subscription
 * @param {string} userId Custom student id
 * @param {string} secretSalt License HMAC secret
 * @param {number=} nowMs Current time in milliseconds
 * @param {Object=} previousLicense Previously stored license
 * @return {Object} License record
 */
function licenseFromSubscription(
    subscription,
    userId,
    secretSalt,
    nowMs = Date.now(),
    previousLicense = {},
) {
  if (!secretSalt) throw new Error("LICENSE_SALT is not configured");
  const metadata = subscription && subscription.metadata || {};
  const bootcamp = cleanSegment(metadata.bootcamp, 20).toLowerCase();
  if (!SUPPORTED_BOOTCAMPS.has(bootcamp)) {
    throw new Error("Stripe subscription bootcamp metadata is invalid");
  }
  const planType = planFromSubscription(subscription);
  const period = subscriptionPeriod(subscription);
  const access = subscriptionAccessDetails(
      subscription,
      nowMs,
      previousLicense,
  );
  const activationMs = period.start > 0 ? period.start * 1000 : nowMs;
  const expirationMs = access.expirationMs;
  const activationDate = new Date(activationMs).toISOString();
  const expirationDate = new Date(expirationMs).toISOString();
  const payload = `${planType}|${bootcamp}|${activationDate}|` +
    `${expirationDate}|${userId}`;
  const licenseHash = crypto.createHmac("sha256", secretSalt)
      .update(payload)
      .digest("hex");
  return {
    planType,
    bootcamp,
    activationDate,
    expirationDate,
    licenseHash,
    source: "stripe",
    status: String(subscription.status || ""),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    pastDueSince: access.pastDueSince,
    paymentGraceEndsAt: access.paymentGraceEndsAt,
    paymentNeedsAttention: access.paymentNeedsAttention,
    stripeCustomerId: String(subscription.customer || ""),
    stripeSubscriptionId: String(subscription.id || ""),
    updatedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * Build a safe, idempotent event-ledger entry.
 *
 * @param {Object} input Event input
 * @return {{eventId:string, event:Object}} RTDB event record
 */
function stripeLedgerEvent(input) {
  const stripeEventId = cleanSegment(input.stripeEventId, 180);
  if (!stripeEventId) throw new Error("Stripe event id is invalid");
  return {
    eventId: `stripe_${stripeEventId}`,
    event: {
      eventVersion: 1,
      type: String(input.type || "subscription_updated"),
      source: "stripe",
      status: String(input.status || ""),
      userId: cleanSegment(input.userId, 160),
      bootcamp: cleanSegment(input.bootcamp, 20).toLowerCase(),
      planType: String(input.planType || ""),
      activationDate: String(input.activationDate || ""),
      expirationDate: String(input.expirationDate || ""),
      amount: Number(input.amount || 0),
      currency: String(input.currency || "").toUpperCase(),
      invoiceId: cleanSegment(input.invoiceId, 180),
      receiptUrl: String(input.receiptUrl || ""),
      invoicePdf: String(input.invoicePdf || ""),
      stripeSubscriptionId: cleanSegment(input.stripeSubscriptionId, 180),
      cancelAtPeriodEnd: input.cancelAtPeriodEnd === true,
      recordedAt: String(input.recordedAt || new Date().toISOString()),
    },
  };
}

module.exports = {
  PAYMENT_GRACE_MS,
  SUPPORTED_BOOTCAMPS,
  SUPPORTED_PLANS,
  cleanSegment,
  licenseFromSubscription,
  planFromSubscription,
  priceIdFor,
  stripeLedgerEvent,
  subscriptionAccessDetails,
  subscriptionGrantsAccess,
  subscriptionPeriod,
  webAppUrl,
};
