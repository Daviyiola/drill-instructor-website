"use strict";

const crypto = require("crypto");
const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {LICENSE_SALT} = require("./_license");
const {sendSubscriptionSuccessEmail} = require("./_email");

const DAYS_BY_PLAN = Object.freeze({
  monthly: 31,
  quarterly: 93,
  yearly: 372,
});

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
 * Build a signed license record.
 *
 * @param {Object} input License inputs
 * @param {string} secretSalt HMAC secret
 * @param {Date} now Activation time
 * @return {Object} License record
 */
function buildLicense(input, secretSalt, now = new Date()) {
  if (!secretSalt) {
    const err = new Error("LICENSE_SALT is not configured");
    err.code = 500;
    throw err;
  }

  const durationDays = DAYS_BY_PLAN[input.planType];
  if (!durationDays) {
    const err = new Error("Invalid planType");
    err.code = 400;
    throw err;
  }

  const activationDate = now.toISOString();
  const expirationDate = new Date(
      now.getTime() + durationDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const payload = `${input.planType}|${input.bootcamp}|` +
    `${activationDate}|${expirationDate}|${input.userId}`;
  const licenseHash = crypto
      .createHmac("sha256", secretSalt)
      .update(payload)
      .digest("hex");

  return {
    code: input.code,
    planType: input.planType,
    bootcamp: input.bootcamp,
    activationDate,
    expirationDate,
    licenseHash,
  };
}

/**
 * Build an idempotent subscription-history entry without storing the raw code.
 *
 * @param {Object} license Finalized license
 * @param {string} userId Custom student id
 * @param {string} finalizedAt Event recording time
 * @return {{eventId:string, event:Object}} History entry
 */
function buildAccessCodeHistoryEvent(license, userId, finalizedAt) {
  const fingerprint = crypto.createHash("sha256")
      .update(`${license.planType}|${license.code}`)
      .digest("hex")
      .slice(0, 32);
  return {
    eventId: `access_code_${fingerprint}`,
    event: {
      eventVersion: 1,
      type: "subscription_activated",
      source: "access_code",
      status: "active",
      userId,
      bootcamp: license.bootcamp,
      planType: license.planType,
      activationDate: license.activationDate,
      expirationDate: license.expirationDate,
      recordedAt: finalizedAt,
    },
  };
}

/**
 * Return the non-secret entitlement contract consumed by web and mobile.
 *
 * @param {Object} license Finalized access-code license
 * @return {Object} Public activation response
 */
function accessCodeActivationPayload(license) {
  return {
    status: "success",
    hasActiveLicense: true,
    plan: license.planType,
    bootcamp: license.bootcamp,
    activationDate: license.activationDate,
    expirationDate: license.expirationDate,
    source: "access_code",
  };
}

/**
 * Claim an access code. A same-user retry may reuse an existing claim so an
 * interrupted license write can be finalized safely.
 *
 * @param {Object} codeRef RTDB access-code reference
 * @param {Object} claimRef RTDB single-use claim reference
 * @param {Object} claim Claim payload
 * @return {Promise<Object>} Claim result
 */
async function claimAccessCode(codeRef, claimRef, claim) {
  let reason = "";

  const initialSnapshot = await codeRef.once("value");
  const initialValue = initialSnapshot.val();
  if (initialValue === null || initialValue === undefined) {
    return {ok: false, reason: "not_found", value: null};
  }

  // Backward compatibility for access codes entered manually in RTDB:
  // false = available, true = already used.
  const codeValue = initialValue === false ? {used: false} : initialValue;
  if (initialValue === true || codeValue.used === true) {
    return {ok: false, reason: "used", value: codeValue};
  }
  if (!codeValue || typeof codeValue !== "object") {
    return {ok: false, reason: "not_found", value: null};
  }

  const legacySameClaim = codeValue.claimed === true &&
    String(codeValue.assignedTo || "") === claim.assignedTo &&
    String(codeValue.bootcamp || "") === claim.bootcamp;
  if (codeValue.claimed === true && !legacySameClaim) {
    return {ok: false, reason: "claimed", value: codeValue};
  }

  const result = await claimRef.transaction((current) => {
    const sameClaim = current &&
      String(current.assignedTo || "") === claim.assignedTo &&
      String(current.bootcamp || "") === claim.bootcamp;
    if (current && !sameClaim) {
      reason = "claimed";
      return;
    }

    reason = current || legacySameClaim ? "retry" : "claimed";
    return current || {
      assignedTo: claim.assignedTo,
      bootcamp: claim.bootcamp,
      claimedAt: claim.claimedAt,
      activationDate: claim.activationDate,
      expirationDate: claim.expirationDate,
      licenseHash: claim.licenseHash,
    };
  }, undefined, false);

  const marker = result.snapshot ? result.snapshot.val() : null;
  return {
    ok: result.committed === true,
    reason,
    value: marker ?
      {...codeValue, ...marker, claimed: true, used: false} : null,
  };
}

/**
 * Access-code activation endpoint.
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
    const code = cleanSegment(body.code, 200);
    const planType = cleanSegment(body.planType, 40).toLowerCase();
    const userId = cleanSegment(body.userId, 160);
    const bootcamp = cleanSegment(body.bootcamp, 80).toLowerCase();

    if (!code || !planType || !userId || !bootcamp) {
      return res.status(400).json({error: "Missing or invalid parameters"});
    }

    if (!DAYS_BY_PLAN[planType]) {
      return res.status(400).json({error: "Invalid planType"});
    }

    const db = getDatabase();
    const storedUidSnap = await db.ref(`users/${userId}/uid`).once("value");

    if (storedUidSnap.val() !== callerUid) {
      return res.status(403).json({error: "Unauthorized access"});
    }

    const licenseRef = db.ref(`users/${userId}/testdata/${bootcamp}/license`);
    const existingLicense = (await licenseRef.once("value")).val();
    const existingExpiry = Date.parse(
        existingLicense && existingLicense.expirationDate,
    );

    if (Number.isFinite(existingExpiry) && existingExpiry > Date.now()) {
      return res.status(409).json({
        error: "Active license already exists",
        errorCode: "active_license_exists",
      });
    }

    const license = buildLicense(
        {code, planType, userId, bootcamp},
        LICENSE_SALT.value(),
    );
    const codeRef = db.ref(`accessCodes/${planType}/${code}`);
    const claimRef = db.ref(`accessCodeClaims/${planType}/${code}`);
    const claim = await claimAccessCode(codeRef, claimRef, {
      assignedTo: userId,
      bootcamp,
      claimedAt: license.activationDate,
      activationDate: license.activationDate,
      expirationDate: license.expirationDate,
      licenseHash: license.licenseHash,
    });

    if (!claim.ok) {
      if (claim.reason === "not_found") {
        return res.status(404).json({
          error: "Code not found",
          errorCode: "access_code_not_found",
        });
      }
      return res.status(409).json({
        error: "Code already used",
        errorCode: "access_code_used",
      });
    }

    const claimed = claim.value || {};
    const finalizedLicense = {
      ...license,
      activationDate: claimed.activationDate || license.activationDate,
      expirationDate: claimed.expirationDate || license.expirationDate,
      licenseHash: claimed.licenseHash || license.licenseHash,
    };
    const finalizedAt = new Date().toISOString();
    const history = buildAccessCodeHistoryEvent(
        finalizedLicense,
        userId,
        finalizedAt,
    );

    await db.ref().update({
      [`users/${userId}/testdata/${bootcamp}/license`]: finalizedLicense,
      [`subscriptionEvents/${userId}/${bootcamp}/${history.eventId}`]:
        history.event,
      [`accessCodes/${planType}/${code}/claimed`]: false,
      [`accessCodes/${planType}/${code}/used`]: true,
      [`accessCodes/${planType}/${code}/usedAt`]: finalizedAt,
    });

    console.info("ACCESS_CODE_ACTIVATED", {
      userId,
      planType,
      bootcamp,
      retryFinalized: claim.reason === "retry",
    });

    try {
      await sendSubscriptionSuccessEmail({
        db,
        apiKey: process.env.RESEND_API_KEY,
        from: process.env.SUPPORT_FROM_EMAIL,
        userId,
        bootcamp,
        planType,
        expirationDate: finalizedLicense.expirationDate,
        source: "access_code",
        idempotencyKey: `access-code-${history.eventId}`,
      });
    } catch (emailError) {
      console.error("ACCESS_CODE_EMAIL_FAILED", {
        userId, bootcamp, message: emailError && emailError.message,
      });
    }

    return res.status(200).json(
        accessCodeActivationPayload(finalizedLicense),
    );
  } catch (err) {
    const code = Number(err && err.code);
    const errorCode = String(err && err.code || "");

    if (errorCode.startsWith("auth/") || code === 401) {
      return res.status(401).json({error: "Authentication failed"});
    }

    if (code === 400) {
      return res.status(400).json({error: err.message});
    }

    console.error("ACCESS_CODE_ACTIVATION_FAILED", {
      message: err && err.message || "Unknown error",
    });
    return res.status(500).json({error: "Unable to activate access code"});
  }
}

module.exports = handler;
module.exports.handler = handler;
module.exports.buildLicense = buildLicense;
module.exports.buildAccessCodeHistoryEvent = buildAccessCodeHistoryEvent;
module.exports.accessCodeActivationPayload = accessCodeActivationPayload;
module.exports.claimAccessCode = claimAccessCode;
module.exports.cleanSegment = cleanSegment;
