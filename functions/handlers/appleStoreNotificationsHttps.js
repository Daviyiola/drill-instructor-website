"use strict";
/* eslint-disable require-jsdoc, max-len */

const {getDatabase} = require("firebase-admin/database");
const {defineSecret} = require("firebase-functions/params");
const {cleanSegment} = require("./_stripeBilling");
const {appleTransactionRecord, createAppleVerifier} = require("./_appleStore");
const {persistAppleTransaction} = require("./verifyApplePurchaseHttps");

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
  try {
    const verifier = createAppleVerifier({
      rootCertificates: APPLE_ROOT_CERTIFICATES_BASE64.value(),
      bundleId: process.env.APPLE_BUNDLE_ID,
      appAppleId: process.env.APPLE_APP_ID,
      environment: process.env.APPLE_ENVIRONMENT,
    });
    const notification = await verifier.verifyAndDecodeNotification(
        signedPayload,
    );
    const eventId = cleanSegment(notification.notificationUUID, 180);
    if (!eventId) return res.status(400).send("Missing notification ID");
    const db = getDatabase();
    const eventRef = db.ref(`storeNotificationEvents/app_store/${eventId}`);
    const claim = await eventRef.transaction((current) => current ? undefined : {
      status: "processing",
      type: String(notification.notificationType || ""),
      receivedAt: new Date().toISOString(),
    });
    if (!claim.committed) {
      return res.status(200).json({received: true, duplicate: true});
    }
    const signedTransaction = notification.data &&
      notification.data.signedTransactionInfo;
    if (!signedTransaction) {
      await eventRef.update({status: "ignored", processedAt: new Date().toISOString()});
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
    const existing = key ? (await db.ref(`storeTransactions/app_store/${key}`)
        .once("value")).val() || {} : {};
    const tokenOwner = record.appAccountToken ?
      (await db.ref(`storeAccountTokens/apple/${record.appAccountToken}`)
          .once("value")).val() || {} : {};
    const userId = cleanSegment(existing.userId || tokenOwner.userId, 160);
    if (!userId || (await db.ref(`deletedBillingUsers/${userId}`)
        .once("value")).exists()) {
      await eventRef.update({
        status: userId ? "deleted_user" : "awaiting_client_verification",
        processedAt: new Date().toISOString(),
      });
      return res.status(200).json({received: true});
    }
    await persistAppleTransaction(
        db, userId, record, LICENSE_SALT.value(), Date.now(),
    );
    await eventRef.update({status: "processed", processedAt: new Date().toISOString()});
    return res.status(200).json({received: true});
  } catch (error) {
    console.error("APPLE_NOTIFICATION_FAILED", {
      message: String(error && error.message || "Unknown error"),
    });
    return res.status(400).send("Invalid App Store notification");
  }
}

module.exports = {handler};
