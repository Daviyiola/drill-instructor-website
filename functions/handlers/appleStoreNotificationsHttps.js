"use strict";
/* eslint-disable require-jsdoc, max-len */

const {getDatabase} = require("firebase-admin/database");
const {defineSecret} = require("firebase-functions/params");
const {cleanSegment} = require("./_stripeBilling");
const {appleTransactionRecord, verifyApplePayload} = require("./_appleStore");
const {persistAppleTransaction} = require("./verifyApplePurchaseHttps");
const {
  claimStoreNotification,
  completeStoreNotification,
  releaseStoreNotificationClaim,
} = require("./_storeNotificationClaims");

const APPLE_ROOT_CERTIFICATES_BASE64 = defineSecret(
    "APPLE_ROOT_CERTIFICATES_BASE64",
);
const LICENSE_SALT = defineSecret("LICENSE_SALT");

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }
  const signedPayload = String(req.body && req.body.signedPayload || "");
  if (!signedPayload) return res.status(400).send("Missing signed payload");
  let processingFailure = false;
  try {
    const verification = await verifyApplePayload({
      rootCertificates: APPLE_ROOT_CERTIFICATES_BASE64.value(),
      bundleId: process.env.APPLE_BUNDLE_ID,
      appAppleId: process.env.APPLE_APP_ID,
      environment: process.env.APPLE_ENVIRONMENT,
    }, "verifyAndDecodeNotification", signedPayload);
    const verifier = verification.verifier;
    const notification = verification.value;
    const eventId = cleanSegment(notification.notificationUUID, 180);
    if (!eventId) return res.status(400).send("Missing notification ID");
    const db = getDatabase();
    const attemptId = await claimStoreNotification(
        db,
        "app_store",
        eventId,
        notification.notificationType,
    );
    if (!attemptId) {
      return res.status(200).json({received: true, duplicate: true});
    }
    try {
      const signedTransaction = notification.data &&
        notification.data.signedTransactionInfo;
      if (!signedTransaction) {
        await completeStoreNotification(
            db, "app_store", eventId, attemptId, {status: "ignored"},
        );
        return res.status(200).json({received: true});
      }
      const transaction = await verifier.verifyAndDecodeTransaction(
          signedTransaction,
      );
      const renewal = notification.data.signedRenewalInfo ?
        await verifier.verifyAndDecodeRenewalInfo(
            notification.data.signedRenewalInfo,
        ) : null;
      const record = appleTransactionRecord(transaction, renewal, Date.now());
      const key = cleanSegment(record.originalTransactionId, 180);
      const existing = key ? (await db.ref(
          `storeTransactions/app_store/${key}`,
      ).once("value")).val() || {} : {};
      const tokenOwner = record.appAccountToken ?
        (await db.ref(`storeAccountTokens/apple/${record.appAccountToken}`)
            .once("value")).val() || {} : {};
      const userId = cleanSegment(existing.userId || tokenOwner.userId, 160);
      if (!userId || (await db.ref(`deletedBillingUsers/${userId}`)
          .once("value")).exists()) {
        await completeStoreNotification(
            db,
            "app_store",
            eventId,
            attemptId,
            {status: userId ? "deleted_user" : "awaiting_client_verification"},
        );
        return res.status(200).json({received: true});
      }
      await persistAppleTransaction(
          db, userId, record, LICENSE_SALT.value(), Date.now(),
      );
      await completeStoreNotification(
          db, "app_store", eventId, attemptId,
      );
      return res.status(200).json({received: true});
    } catch (processingError) {
      processingFailure = true;
      await releaseStoreNotificationClaim(
          db, "app_store", eventId, attemptId,
      );
      throw processingError;
    }
  } catch (error) {
    console.error("APPLE_NOTIFICATION_FAILED", {
      message: String(error && error.message || "Unknown error"),
    });
    return res.status(processingFailure ? 500 : 400).send(
        processingFailure ? "App Store notification processing failed" :
          "Invalid App Store notification",
    );
  }
}

module.exports = {handler};
