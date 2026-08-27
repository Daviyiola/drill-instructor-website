"use strict";
/* eslint-disable require-jsdoc */

const {compareEntitlements, writeProviderEntitlement} =
  require("./_entitlements");

async function recomputeStoreProvider(
    db,
    userId,
    bootcamp,
    provider,
    secretSalt,
    nowMs = Date.now(),
) {
  const ids = (await db.ref(
      `storeTransactionsByUser/${userId}/${bootcamp}/${provider}`,
  ).once("value")).val() || {};
  const rows = (await Promise.all(Object.keys(ids).map(async (key) =>
    (await db.ref(`storeTransactions/${provider}/${key}`)
        .once("value")).val(),
  ))).filter(Boolean).map((row) => ({
    ...row,
    provider,
    transactionId: row.originalTransactionId || row.purchaseTokenHash || "",
  }));
  const active = rows.filter((row) => row.grantsAccess === true &&
      Date.parse(row.expirationDate || "") > nowMs)
      .sort((a, b) => compareEntitlements(a, b));
  const all = [...rows].sort(compareEntitlements);
  const selected = active[0] || all[0] || {
    provider,
    status: "expired",
    grantsAccess: false,
    planType: "",
    expirationDate: new Date(nowMs).toISOString(),
  };
  return writeProviderEntitlement(
      db,
      userId,
      bootcamp,
      {...selected, provider},
      secretSalt,
      nowMs,
  );
}

module.exports = {recomputeStoreProvider};
