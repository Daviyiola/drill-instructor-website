"use strict";
/* eslint-disable require-jsdoc, max-len */

const {getDatabase} = require("firebase-admin/database");
const {defineSecret} = require("firebase-functions/params");
const {allowCors, requireBearerUid} = require("./_auth");
const {resolveStudent} = require("./_studentDrill");
const {appAccountTokenForUid} = require("./_storeAccount");
const {
  createGooglePublisher,
  googlePurchaseRecord,
  googleTokenHash,
} = require("./_googlePlay");
const {recomputeStoreProvider} = require("./_storeEntitlements");

const LICENSE_SALT = defineSecret("LICENSE_SALT");
const STORE_TOKEN_HASH_SECRET = defineSecret("STORE_TOKEN_HASH_SECRET");

async function persistGooglePurchase(input) {
  const {
    db, publisher, userId, purchaseToken, requestedProductId,
    expectedAccountId, tokenHashSecret, licenseSalt,
  } = input;
  const packageName = String(process.env.GOOGLE_PLAY_PACKAGE_NAME ||
    "com.drillinstructor.app");
  const response = await publisher.purchases.subscriptionsv2.get({
    packageName,
    token: purchaseToken,
  });
  const purchase = response.data || {};
  const tokenHash = googleTokenHash(purchaseToken, tokenHashSecret);
  const record = googlePurchaseRecord(purchase, tokenHash, Date.now());
  if (requestedProductId && record.productId !== requestedProductId) {
    const error = new Error("The Google Play product does not match");
    error.status = 400;
    throw error;
  }
  const external = purchase.externalAccountIdentifiers || {};
  const accountId = String(external.obfuscatedExternalAccountId || "");
  record.obfuscatedAccountId = accountId;
  const ref = db.ref(`storeTransactions/play_store/${tokenHash}`);
  const existing = (await ref.once("value")).val() || {};
  if (existing.userId && existing.userId !== userId) {
    const error = new Error("This Google Play purchase belongs to another account");
    error.status = 409;
    throw error;
  }
  if ((!existing.userId && !accountId) ||
      (accountId && expectedAccountId && accountId !== expectedAccountId)) {
    const error = new Error("This Google Play purchase is not linked to this account");
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
    [`storeTransactions/play_store/${tokenHash}`]: {...record, userId},
    [`storeTransactionsByUser/${userId}/${record.bootcamp}/play_store/` +
      tokenHash]: true,
    [`storePurchaseSecrets/play_store/${tokenHash}/purchaseToken`]:
      purchaseToken,
    [`storePurchaseSecrets/play_store/${tokenHash}/updatedAt`]:
      new Date().toISOString(),
  });

  if (purchase.linkedPurchaseToken) {
    const linkedHash = googleTokenHash(
        purchase.linkedPurchaseToken, tokenHashSecret,
    );
    const linkedRef = db.ref(`storeTransactions/play_store/${linkedHash}`);
    const linked = (await linkedRef.once("value")).val() || {};
    if (linked.userId === userId) {
      await linkedRef.update({
        grantsAccess: false,
        status: "replaced",
        replacedBy: tokenHash,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  const aggregate = await recomputeStoreProvider(
      db, userId, record.bootcamp, "play_store", licenseSalt, Date.now(),
  );
  if (purchase.acknowledgementState !==
      "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" &&
      record.grantsAccess === true) {
    await publisher.purchases.subscriptions.acknowledge({
      packageName,
      subscriptionId: record.productId,
      token: purchaseToken,
      requestBody: {
        externalAccountIds: {obfuscatedAccountId: expectedAccountId},
      },
    });
    await ref.update({
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      acknowledgedAt: new Date().toISOString(),
    });
  }
  return {aggregate, record, tokenHash};
}

async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }
  try {
    const uid = await requireBearerUid(req);
    const purchaseToken = String(req.body && req.body.purchaseToken || "");
    const productId = String(req.body && req.body.productId || "");
    if (!purchaseToken || !productId) {
      return res.status(400).json({error: "Product and purchase token are required"});
    }
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const accountId = appAccountTokenForUid(uid);
    const result = await persistGooglePurchase({
      db,
      publisher: createGooglePublisher(),
      userId: studentId,
      purchaseToken,
      requestedProductId: productId,
      expectedAccountId: accountId,
      tokenHashSecret: STORE_TOKEN_HASH_SECRET.value(),
      licenseSalt: LICENSE_SALT.value(),
    });
    await db.ref(`storeAccountTokens/google/${accountId}`).set({
      userId: studentId,
      updatedAt: new Date().toISOString(),
    });
    return res.status(200).json({
      ok: true,
      hasActiveLicense: Boolean(result.aggregate.license),
      bootcamp: result.record.bootcamp,
      status: result.record.status,
      expirationDate: result.record.expirationDate,
    });
  } catch (error) {
    console.error("GOOGLE_PLAY_PURCHASE_VERIFICATION_FAILED", {
      message: String(error && error.message || "Unknown error"),
    });
    return res.status(Number(error && error.status) || 400).json({
      error: Number(error && error.status) ? error.message :
        "Unable to verify the Google Play purchase",
    });
  }
}

module.exports = {handler, persistGooglePurchase};
