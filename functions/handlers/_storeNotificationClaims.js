"use strict";
/* eslint-disable require-jsdoc */

const crypto = require("crypto");

const STORE_NOTIFICATION_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

async function claimStoreNotification(
    db,
    provider,
    eventId,
    type = "",
    nowMs = Date.now(),
) {
  const attemptId = crypto.randomUUID();
  const ref = db.ref(`storeNotificationEvents/${provider}/${eventId}`);
  const result = await ref.transaction((current) => {
    if (current && (current.status === "processed" || current.processedAt)) {
      return;
    }
    const claimedAtMs = Date.parse(current && current.claimedAt || "");
    if (current && current.status === "processing" &&
        Number.isFinite(claimedAtMs) &&
        claimedAtMs > nowMs - STORE_NOTIFICATION_CLAIM_TIMEOUT_MS) {
      return;
    }
    return {
      status: "processing",
      attemptId,
      type: String(type || ""),
      claimedAt: new Date(nowMs).toISOString(),
    };
  });
  const value = result.snapshot && result.snapshot.val();
  return result.committed && value && value.attemptId === attemptId ?
    attemptId : "";
}

async function releaseStoreNotificationClaim(
    db,
    provider,
    eventId,
    attemptId,
) {
  await db.ref(`storeNotificationEvents/${provider}/${eventId}`)
      .transaction((current) => {
        if (!current || current.status !== "processing" ||
            current.attemptId !== attemptId) return;
        return null;
      });
}

async function completeStoreNotification(
    db,
    provider,
    eventId,
    attemptId,
    result = {},
    nowMs = Date.now(),
) {
  let completed = false;
  await db.ref(`storeNotificationEvents/${provider}/${eventId}`)
      .transaction((current) => {
        if (!current || current.status !== "processing" ||
            current.attemptId !== attemptId) return;
        completed = true;
        return {
          ...current,
          ...result,
          status: String(result.status || "processed"),
          processedAt: new Date(nowMs).toISOString(),
        };
      });
  if (!completed) throw new Error("STORE_NOTIFICATION_CLAIM_LOST");
}

module.exports = {
  STORE_NOTIFICATION_CLAIM_TIMEOUT_MS,
  claimStoreNotification,
  completeStoreNotification,
  releaseStoreNotificationClaim,
};
