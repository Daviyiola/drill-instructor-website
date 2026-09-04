"use strict";
/* eslint-disable require-jsdoc, max-len */

const {getDatabase} = require("firebase-admin/database");
const {defineSecret} = require("firebase-functions/params");
const {allowCors, requireBearerUid} = require("./_auth");
const {resolveStudent} = require("./_studentDrill");
const {cleanSegment} = require("./_stripeBilling");
const {appAccountTokenForUid} = require("./_storeAccount");
const {appleTransactionRecord, verifyApplePayload} = require("./_appleStore");
const {recomputeStoreProvider} = require("./_storeEntitlements");

const APPLE_ROOT_CERTIFICATES_BASE64 = defineSecret(
    "APPLE_ROOT_CERTIFICATES_BASE64",
);
const LICENSE_SALT = defineSecret("LICENSE_SALT");

async function persistAppleTransaction(
    db, userId, record, secretSalt, nowMs = Date.now(),
) {
  const key = cleanSegment(record.originalTransactionId, 180);
  if (!key) throw new Error("Apple original transaction ID is missing");
  const ref = db.ref(`storeTransactions/app_store/${key}`);
  const existing = (await ref.once("value")).val() || {};
  if (existing.userId && existing.userId !== userId) {
    const error = new Error("This App Store purchase belongs to another account");
    error.status = 409;
    throw error;
  }
  if ((await db.ref(`deletedBillingUsers/${userId}`)
      .once("value")).exists()) {
    const error = new Error("The billing account has been deleted");
    error.status = 410;
    throw error;
  }
  await db.ref().update({
    [`storeTransactions/app_store/${key}`]: {...record, userId},
    [`storeTransactionsByUser/${userId}/${record.bootcamp}/app_store/${key}`]:
      true,
  });
  return recomputeStoreProvider(
      db, userId, record.bootcamp, "app_store", secretSalt, nowMs,
  );
}

async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }
  try {
    const uid = await requireBearerUid(req);
    const signedTransactionInfo = String(
        req.body && req.body.signedTransactionInfo || "",
    ).trim();
    if (!signedTransactionInfo) {
      return res.status(400).json({error: "A signed transaction is required"});
    }
    const verification = await verifyApplePayload({
      rootCertificates: APPLE_ROOT_CERTIFICATES_BASE64.value(),
      bundleId: process.env.APPLE_BUNDLE_ID,
      appAppleId: process.env.APPLE_APP_ID,
      environment: process.env.APPLE_ENVIRONMENT,
    }, "verifyAndDecodeTransaction", signedTransactionInfo);
    const transaction = verification.value;
    const expectedToken = appAccountTokenForUid(uid).toLowerCase();
    if (String(transaction.appAccountToken || "").toLowerCase() !==
        expectedToken) {
      return res.status(409).json({
        error: "This App Store purchase is not linked to this account",
      });
    }
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const record = appleTransactionRecord(transaction, null, Date.now());
    const aggregate = await persistAppleTransaction(
        db, studentId, record, LICENSE_SALT.value(), Date.now(),
    );
    await db.ref(`storeAccountTokens/apple/${expectedToken}`).set({
      userId: studentId,
      updatedAt: new Date().toISOString(),
    });
    return res.status(200).json({
      ok: true,
      hasActiveLicense: Boolean(aggregate.license),
      bootcamp: record.bootcamp,
      expirationDate: record.expirationDate,
    });
  } catch (error) {
    console.error("APPLE_PURCHASE_VERIFICATION_FAILED", {
      message: String(error && error.message || "Unknown error"),
    });
    return res.status(Number(error && error.status) || 400).json({
      error: Number(error && error.status) ? error.message :
        "Unable to verify the App Store purchase",
    });
  }
}

module.exports = {handler, persistAppleTransaction};
