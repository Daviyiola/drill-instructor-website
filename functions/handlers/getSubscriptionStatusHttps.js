"use strict";

const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {assertLicenseActive} = require("./_license");

/**
 * Safe RTDB path segment.
 *
 * @param {*} value Input value
 * @param {number} maxLength Maximum length
 * @return {string} Normalized value or empty string
 */
function cleanSegment(value, maxLength = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) return "";
  if (/[.#$[\]/]/.test(normalized)) return "";
  return normalized;
}

/**
 * Return a stable public status payload without exposing the redeemed code.
 *
 * @param {Object|null} license Stored license
 * @param {string} bootcamp Requested bootcamp
 * @param {boolean} active Whether validation passed
 * @return {Object} Response payload
 */
function statusPayload(license, bootcamp, active) {
  const value = license && typeof license === "object" ? license : {};
  return {
    status: "success",
    hasActiveLicense: active === true,
    plan: String(value.planType || ""),
    bootcamp,
    activationDate: String(value.activationDate || ""),
    expirationDate: String(value.expirationDate || ""),
    source: String(value.source || "access_code"),
    stripeManaged: String(value.source || "") === "stripe",
    cancelAtPeriodEnd: value.cancelAtPeriodEnd === true,
    subscriptionStatus: String(value.status || ""),
    paymentNeedsAttention: value.paymentNeedsAttention === true,
    paymentGraceEndsAt: String(value.paymentGraceEndsAt || ""),
  };
}

/**
 * Subscription-status endpoint.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return res.status(405).json({error: "Method not allowed"});
    }

    const callerUid = await requireBearerUid(req);
    const body = req.body || {};
    const userId = cleanSegment(body.userId, 160);
    const bootcamp = cleanSegment(body.bootcamp, 80).toLowerCase();

    if (!userId || !bootcamp) {
      return res.status(400).json({error: "Missing or invalid parameters"});
    }

    const db = getDatabase();
    const storedUid = (await db.ref(`users/${userId}/uid`)
        .once("value")).val();

    if (!storedUid || storedUid !== callerUid) {
      return res.status(403).json({error: "Unauthorized access"});
    }

    const license = (await db.ref(
        `users/${userId}/testdata/${bootcamp}/license`,
    ).once("value")).val();

    if (!license) {
      return res.status(200).json(statusPayload(null, bootcamp, false));
    }

    try {
      await assertLicenseActive(db, userId, bootcamp);
      return res.status(200).json(statusPayload(license, bootcamp, true));
    } catch (err) {
      const validationCode = Number(err && err.code);
      if (![400, 403, 409].includes(validationCode)) throw err;

      console.warn("SUBSCRIPTION_LICENSE_REJECTED", {
        userId,
        bootcamp,
        reason: err && err.message || "Invalid license",
      });
      return res.status(200).json(statusPayload(license, bootcamp, false));
    }
  } catch (err) {
    const code = Number(err && err.code);
    const errorCode = String(err && err.code || "");

    if (errorCode.startsWith("auth/") || code === 401) {
      return res.status(401).json({error: "Authentication failed"});
    }

    console.error("SUBSCRIPTION_STATUS_FAILED", {
      message: err && err.message || "Unknown error",
    });
    return res.status(500).json({
      error: "Unable to retrieve subscription status",
    });
  }
}

module.exports = handler;
module.exports.handler = handler;
module.exports.cleanSegment = cleanSegment;
module.exports.statusPayload = statusPayload;
