"use strict";
/* eslint-disable require-jsdoc */

const {appleProduct} = require("./_storeCatalog");

function appleEnvironment(value) {
  const normalized = String(value || "Production").toLowerCase();
  if (normalized === "sandbox") return "Sandbox";
  if (normalized === "xcode") return "Xcode";
  return "Production";
}

function parseAppleRoots(value) {
  let rows;
  try {
    rows = JSON.parse(String(value || ""));
  } catch (_) {
    rows = String(value || "").split(",").map((item) => item.trim());
  }
  const certificates = (Array.isArray(rows) ? rows : [])
      .filter(Boolean)
      .map((item) => Buffer.from(String(item), "base64"))
      .filter((item) => item.length > 0);
  if (!certificates.length) {
    throw new Error("APPLE_ROOT_CERTIFICATES_BASE64 is not configured");
  }
  return certificates;
}

function createAppleVerifier(config) {
  const {Environment, SignedDataVerifier} =
    require("@apple/app-store-server-library");
  const bundleId = String(config.bundleId || "").trim();
  if (!bundleId) throw new Error("APPLE_BUNDLE_ID is not configured");
  const environment = appleEnvironment(config.environment);
  const appAppleId = Number(config.appAppleId || 0);
  if (environment === Environment.PRODUCTION && !appAppleId) {
    throw new Error("APPLE_APP_ID is required in Production");
  }
  return new SignedDataVerifier(
      parseAppleRoots(config.rootCertificates),
      true,
      environment,
      bundleId,
      appAppleId || undefined,
  );
}

function appleTransactionRecord(transaction, renewal, nowMs = Date.now()) {
  const product = appleProduct(transaction && transaction.productId);
  if (!product) throw new Error("Unsupported Apple product");
  const expirationMs = Number(transaction.expiresDate || 0);
  const graceExpirationMs = Number(renewal &&
    renewal.gracePeriodExpiresDate || 0);
  const revoked = Number(transaction.revocationDate || 0) > 0;
  const upgraded = transaction.isUpgraded === true;
  const transactionActive = !revoked && !upgraded && expirationMs > nowMs;
  const graceActive = !revoked && !upgraded &&
    graceExpirationMs > nowMs && expirationMs <= nowMs;
  const active = transactionActive || graceActive;
  const billingRetry = renewal &&
    Number(renewal.isInBillingRetryPeriod || 0) === 1;
  const paymentNeedsAttention = Boolean(billingRetry || graceActive ||
    Number(renewal && renewal.expirationIntent || 0) === 2);
  const autoRenews = renewal ? Number(renewal.autoRenewStatus || 0) === 1 :
    active;
  return {
    provider: "app_store",
    bootcamp: product.bootcamp,
    productId: String(transaction.productId || ""),
    planType: product.planType,
    status: revoked ? "revoked" : (graceActive ? "grace" :
      (transactionActive ? "active" :
        (paymentNeedsAttention ? "past_due" : "expired"))),
    grantsAccess: active,
    activationDate: new Date(Number(transaction.originalPurchaseDate ||
      transaction.purchaseDate || nowMs)).toISOString(),
    expirationDate: new Date(graceActive ? graceExpirationMs :
      (expirationMs || nowMs)).toISOString(),
    autoRenews,
    cancelAtPeriodEnd: active && !autoRenews,
    paymentNeedsAttention,
    paymentGraceEndsAt: graceExpirationMs > 0 ?
      new Date(graceExpirationMs).toISOString() : "",
    originalTransactionId: String(transaction.originalTransactionId || ""),
    transactionId: String(transaction.transactionId || ""),
    appAccountToken: String(transaction.appAccountToken || "").toLowerCase(),
    environment: String(transaction.environment || ""),
    updatedAt: new Date(nowMs).toISOString(),
  };
}

module.exports = {
  appleEnvironment,
  appleTransactionRecord,
  createAppleVerifier,
  parseAppleRoots,
};
