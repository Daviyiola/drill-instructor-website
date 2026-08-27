"use strict";
/* eslint-disable require-jsdoc, max-len */

const {getDatabase} = require("firebase-admin/database");
const {defineSecret} = require("firebase-functions/params");
const {createGooglePublisher, googleTokenHash} = require("./_googlePlay");
const {persistGooglePurchase} = require("./verifyGooglePlayPurchaseHttps");

const LICENSE_SALT = defineSecret("LICENSE_SALT");
const STORE_TOKEN_HASH_SECRET = defineSecret("STORE_TOKEN_HASH_SECRET");

async function verifyPubSubIdentity(req) {
  const {google} = require("googleapis");
  const audience = String(process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE || "");
  const allowedEmail = String(process.env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT || "");
  if (!audience || !allowedEmail) {
    throw new Error("Google Play Pub/Sub identity is not configured");
  }
  const authorization = String(req.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ?
    authorization.slice(7) : "";
  if (!token) throw new Error("Missing Pub/Sub identity token");
  const ticket = await new google.auth.OAuth2().verifyIdToken({
    idToken: token,
    audience,
  });
  const payload = ticket.getPayload() || {};
  if (payload.email !== allowedEmail || payload.email_verified !== true) {
    throw new Error("Untrusted Pub/Sub service account");
  }
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }
  try {
    await verifyPubSubIdentity(req);
    const message = req.body && req.body.message || {};
    const messageId = String(message.messageId || "");
    const decoded = JSON.parse(Buffer.from(String(message.data || ""), "base64")
        .toString("utf8"));
    const subscription = decoded.subscriptionNotification || {};
    const purchaseToken = String(subscription.purchaseToken || "");
    const packageName = String(decoded.packageName || "");
    if (!messageId || !purchaseToken || packageName !==
        String(process.env.GOOGLE_PLAY_PACKAGE_NAME || "com.drillinstructor.app")) {
      return res.status(400).send("Invalid notification");
    }
    const db = getDatabase();
    const eventRef = db.ref(`storeNotificationEvents/play_store/${messageId}`);
    const claim = await eventRef.transaction((current) => current ? undefined : {
      status: "processing",
      receivedAt: new Date().toISOString(),
    });
    if (!claim.committed) {
      return res.status(200).json({received: true, duplicate: true});
    }
    const tokenHash = googleTokenHash(
        purchaseToken, STORE_TOKEN_HASH_SECRET.value(),
    );
    const existing = (await db.ref(`storeTransactions/play_store/${tokenHash}`)
        .once("value")).val() || {};
    let userId = String(existing.userId || "");
    let accountId = "";
    const publisher = createGooglePublisher();
    if (!userId) {
      const purchaseResponse = await publisher.purchases.subscriptionsv2.get({
        packageName,
        token: purchaseToken,
      });
      accountId = String(purchaseResponse.data &&
        purchaseResponse.data.externalAccountIdentifiers &&
        purchaseResponse.data.externalAccountIdentifiers
            .obfuscatedExternalAccountId || "");
      const owner = accountId ? (await db.ref(
          `storeAccountTokens/google/${accountId}`,
      ).once("value")).val() || {} : {};
      userId = String(owner.userId || "");
    }
    if (!userId || (await db.ref(`deletedBillingUsers/${userId}`)
        .once("value")).exists()) {
      await eventRef.update({
        status: userId ? "deleted_user" : "awaiting_client_verification",
        processedAt: new Date().toISOString(),
      });
      return res.status(200).json({received: true});
    }
    await persistGooglePurchase({
      db,
      publisher,
      userId,
      purchaseToken,
      requestedProductId: "",
      expectedAccountId: accountId || String(existing.obfuscatedAccountId || ""),
      tokenHashSecret: STORE_TOKEN_HASH_SECRET.value(),
      licenseSalt: LICENSE_SALT.value(),
    });
    await eventRef.update({status: "processed", processedAt: new Date().toISOString()});
    return res.status(200).json({received: true});
  } catch (error) {
    console.error("GOOGLE_PLAY_NOTIFICATION_FAILED", {
      message: String(error && error.message || "Unknown error"),
    });
    return res.status(400).send("Invalid Google Play notification");
  }
}

module.exports = {handler, verifyPubSubIdentity};
