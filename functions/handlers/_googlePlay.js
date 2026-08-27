"use strict";
/* eslint-disable require-jsdoc */

const crypto = require("crypto");
const {googleProduct} = require("./_storeCatalog");

function googleTokenHash(token, secret) {
  if (!secret) throw new Error("STORE_TOKEN_HASH_SECRET is not configured");
  return crypto.createHmac("sha256", secret)
      .update(String(token || ""))
      .digest("hex");
}

function createGooglePublisher() {
  const {google} = require("googleapis");
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  return google.androidpublisher({version: "v3", auth});
}

function selectedGoogleLineItem(purchase) {
  const rows = Array.isArray(purchase && purchase.lineItems) ?
    purchase.lineItems : [];
  return [...rows].filter((row) => row && row.productId)
      .sort((a, b) => Date.parse(b.expiryTime || "") -
        Date.parse(a.expiryTime || ""))[0] || null;
}

function googlePurchaseRecord(purchase, tokenHash, nowMs = Date.now()) {
  const item = selectedGoogleLineItem(purchase);
  const basePlanId = item && item.offerDetails && item.offerDetails.basePlanId;
  const product = googleProduct(item && item.productId, basePlanId);
  if (!item || !product) throw new Error("Unsupported Google Play product");
  const state = String(purchase.subscriptionState || "");
  const expirationMs = Date.parse(item.expiryTime || "");
  const accessStates = new Set([
    "SUBSCRIPTION_STATE_ACTIVE",
    "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
    "SUBSCRIPTION_STATE_CANCELED",
  ]);
  const grantsAccess = accessStates.has(state) &&
    Number.isFinite(expirationMs) && expirationMs > nowMs;
  const autoRenews = Boolean(item.autoRenewingPlan &&
    item.autoRenewingPlan.autoRenewEnabled === true);
  const statuses = {
    SUBSCRIPTION_STATE_ACTIVE: "active",
    SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "grace",
    SUBSCRIPTION_STATE_CANCELED: "canceled",
    SUBSCRIPTION_STATE_PENDING: "pending",
    SUBSCRIPTION_STATE_PAUSED: "paused",
    SUBSCRIPTION_STATE_ON_HOLD: "on_hold",
    SUBSCRIPTION_STATE_EXPIRED: "expired",
  };
  return {
    provider: "play_store",
    bootcamp: product.bootcamp,
    productId: String(item.productId || ""),
    basePlanId: String(basePlanId || ""),
    planType: product.planType,
    status: statuses[state] || "pending",
    grantsAccess,
    activationDate: new Date(Date.parse(purchase.startTime || "") || nowMs)
        .toISOString(),
    expirationDate: new Date(
        Number.isFinite(expirationMs) ? expirationMs : nowMs,
    ).toISOString(),
    autoRenews,
    cancelAtPeriodEnd: grantsAccess && !autoRenews,
    paymentNeedsAttention: [
      "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
      "SUBSCRIPTION_STATE_ON_HOLD",
    ].includes(state),
    purchaseTokenHash: tokenHash,
    acknowledgementState: String(purchase.acknowledgementState || ""),
    environment: purchase.testPurchase ? "test" : "production",
    updatedAt: new Date(nowMs).toISOString(),
  };
}

module.exports = {
  createGooglePublisher,
  googlePurchaseRecord,
  googleTokenHash,
  selectedGoogleLineItem,
};
