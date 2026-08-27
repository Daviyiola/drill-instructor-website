"use strict";
/* eslint-disable require-jsdoc */

const crypto = require("crypto");

const PROVIDERS = new Set([
  "access_code",
  "stripe",
  "app_store",
  "play_store",
  "admin",
]);

const STATUS_STRENGTH = Object.freeze({
  active: 50,
  trialing: 50,
  grace: 40,
  past_due: 40,
  canceled: 20,
  paused: 15,
  on_hold: 10,
  pending: 5,
  expired: 0,
  revoked: 0,
});

function iso(value) {
  const millis = typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(millis) ? new Date(millis).toISOString() : "";
}

function normalizeEntitlement(value, provider) {
  const row = value && typeof value === "object" ? value : {};
  const source = String(provider || row.provider || "").trim();
  if (!PROVIDERS.has(source)) return null;
  return {
    provider: source,
    productId: String(row.productId || ""),
    planType: String(row.planType || ""),
    status: String(row.status || "expired"),
    grantsAccess: row.grantsAccess === true,
    activationDate: iso(row.activationDate),
    expirationDate: iso(row.expirationDate),
    autoRenews: row.autoRenews === true,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
    paymentNeedsAttention: row.paymentNeedsAttention === true,
    transactionId: String(row.transactionId || row.subscriptionId || ""),
    updatedAt: iso(row.updatedAt) || new Date().toISOString(),
  };
}

function entitlementIsActive(row, nowMs = Date.now()) {
  if (!row || row.grantsAccess !== true) return false;
  const expirationMs = Date.parse(row.expirationDate || "");
  return Number.isFinite(expirationMs) && expirationMs > nowMs;
}

function compareEntitlements(left, right) {
  const strength = (STATUS_STRENGTH[right.status] || 0) -
    (STATUS_STRENGTH[left.status] || 0);
  if (strength) return strength;
  return Date.parse(right.expirationDate || "") -
    Date.parse(left.expirationDate || "");
}

function aggregateProviderRows(rows, nowMs = Date.now()) {
  const normalized = Object.entries(rows || {})
      .map(([provider, value]) => normalizeEntitlement(value, provider))
      .filter(Boolean);
  const active = normalized.filter((row) => entitlementIsActive(row, nowMs))
      .sort((a, b) => {
        const expiration = Date.parse(b.expirationDate) -
          Date.parse(a.expirationDate);
        return expiration || compareEntitlements(a, b);
      });
  const all = [...normalized].sort(compareEntitlements);
  return {
    active,
    selected: active[0] || all[0] || null,
    activeProviders: [...new Set(active.map((row) => row.provider))].sort(),
  };
}

function signedLicense(userId, bootcamp, entitlement, secretSalt, nowMs) {
  if (!secretSalt) throw new Error("LICENSE_SALT is not configured");
  if (!entitlement || !entitlementIsActive(entitlement, nowMs)) return null;
  const planType = entitlement.planType || "monthly";
  const activationDate = entitlement.activationDate ||
    new Date(nowMs).toISOString();
  const expirationDate = entitlement.expirationDate;
  const payload = `${planType}|${bootcamp}|${activationDate}|` +
    `${expirationDate}|${userId}`;
  return {
    planType,
    bootcamp,
    activationDate,
    expirationDate,
    licenseHash: crypto.createHmac("sha256", secretSalt)
        .update(payload).digest("hex"),
    source: entitlement.provider,
    status: entitlement.status,
    autoRenews: entitlement.autoRenews,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    paymentNeedsAttention: entitlement.paymentNeedsAttention,
    providerTransactionId: entitlement.transactionId,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

async function recomputeCanonicalLicense(
    db,
    userId,
    bootcamp,
    secretSalt,
    nowMs = Date.now(),
) {
  const [rowsSnap, legacySnap] = await Promise.all([
    db.ref(`userEntitlements/${userId}/${bootcamp}`).once("value"),
    db.ref(`users/${userId}/testdata/${bootcamp}/license`).once("value"),
  ]);
  const rows = rowsSnap.val() || {};
  const legacy = legacySnap.val() || {};
  const legacyProvider = PROVIDERS.has(String(legacy.source || "")) ?
    String(legacy.source) : (legacy.code ? "access_code" : "");
  if (legacyProvider && !rows[legacyProvider]) {
    const migrated = normalizeEntitlement({
      provider: legacyProvider,
      productId: "",
      planType: legacy.planType,
      status: legacy.status || "active",
      grantsAccess: Date.parse(legacy.expirationDate || "") > nowMs,
      activationDate: legacy.activationDate,
      expirationDate: legacy.expirationDate,
      autoRenews: legacy.autoRenews === true,
      cancelAtPeriodEnd: legacy.cancelAtPeriodEnd === true,
      paymentNeedsAttention: legacy.paymentNeedsAttention === true,
      transactionId: legacy.stripeSubscriptionId || "legacy",
      updatedAt: legacy.updatedAt || new Date(nowMs).toISOString(),
    }, legacyProvider);
    if (migrated) {
      rows[legacyProvider] = migrated;
      await db.ref(
          `userEntitlements/${userId}/${bootcamp}/${legacyProvider}`,
      ).set(migrated);
    }
  }
  const aggregate = aggregateProviderRows(rows, nowMs);
  const license = signedLicense(
      userId,
      bootcamp,
      aggregate.active[0] || null,
      secretSalt,
      nowMs,
  );
  await db.ref(`users/${userId}/testdata/${bootcamp}/license`)
      .set(license);
  return {...aggregate, license};
}

async function writeProviderEntitlement(
    db,
    userId,
    bootcamp,
    entitlement,
    secretSalt,
    nowMs = Date.now(),
) {
  const normalized = normalizeEntitlement(entitlement, entitlement.provider);
  if (!normalized) throw new Error("Unsupported entitlement provider");
  await db.ref(
      `userEntitlements/${userId}/${bootcamp}/${normalized.provider}`,
  ).set(normalized);
  return recomputeCanonicalLicense(
      db, userId, bootcamp, secretSalt, nowMs,
  );
}

module.exports = {
  PROVIDERS,
  STATUS_STRENGTH,
  aggregateProviderRows,
  compareEntitlements,
  entitlementIsActive,
  normalizeEntitlement,
  recomputeCanonicalLicense,
  signedLicense,
  writeProviderEntitlement,
};
