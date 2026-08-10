"use strict";

const {getDatabase} = require("firebase-admin/database");
const {defineSecret} = require("firebase-functions/params");
const crypto = require("crypto");
const {requireBearerUid, allowCors} = require("./_auth");
const {assertLicenseActive} = require("./_license");

const CHALLENGE_SIGNING_SECRET = defineSecret("CHALLENGE_SIGNING_SECRET");

/**
 * Send a standardized JSON error response.
 *
 * @param {!Object} res Express response object.
 * @param {number} code HTTP status code.
 * @param {string} msg Error message identifier.
 * @param {(Array|Object|string)=} details Optional extra error info.
 * @return {!Object} JSON response with error info.
 */
function bad(res, code, msg, details) {
  return res.status(code).json({error: msg, details});
}

/**
 * Look up a user's custom ID (key under /users) using a Firebase UID.
 *
 * @param {!Object} db Realtime Database instance.
 * @param {string} firebaseUid Firebase UID from the verified token.
 * @return {!Promise<?string>} Resolves to the custom user ID or null.
 */
async function getCustomIdByFirebaseUid(db, firebaseUid) {
  const snap = await db
      .ref("users")
      .orderByChild("uid")
      .equalTo(firebaseUid)
      .limitToFirst(1)
      .once("value");
  const val = snap.val() || {};
  const keys = Object.keys(val);
  return keys.length ? keys[0] : null;
}

/**
 * Compute HMAC-SHA256 as a hex string.
 *
 * @param {string} secret Secret key.
 * @param {string} data Message to sign.
 * @return {string} Hex-encoded HMAC digest.
 */
function hmac(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

/**
 * HTTPS handler to complete a challenge attempt.
 *
 * Validates caller, challenge state, license, signature; writes the user's
 * result and marks completion. If all participants have completed, sets
 * challenge to completed and reveals scores. If expired, marks expired.
 *
 * @param {!Object} req HTTP request.
 * @param {!Object} res HTTP response.
 * @return {!Promise<void>}
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") return bad(res, 405, "Method not allowed");

    const fbUid = await requireBearerUid(req);
    const body = req.body || {};
    const challengeId = body.challengeId;
    const correct = body.correct;
    const wrong = body.wrong;
    const unanswered = body.unanswered;
    const timeMs = body.timeMs;

    const errs = [];
    if (!challengeId) errs.push("challengeId");
    if (!(Number.isFinite(correct) && correct >= 0)) errs.push("correct>=0");
    if (!(Number.isFinite(wrong) && wrong >= 0)) errs.push("wrong>=0");
    if (!(Number.isFinite(unanswered) && unanswered >= 0)) {
      errs.push("unanswered>=0");
    }
    if (!(Number.isFinite(timeMs) && timeMs >= 0)) errs.push("timeMs>=0");
    if (errs.length) return bad(res, 400, "INVALID_ARGUMENT", errs);

    const db = getDatabase();
    const customId = await getCustomIdByFirebaseUid(db, fbUid);
    if (!customId) return bad(res, 403, "PERMISSION_DENIED");

    const chSnap = await db.ref(`challenges/${challengeId}`).once("value");
    const ch = chSnap.val();
    if (!ch) return bad(res, 404, "NOT_FOUND");
    if (ch.status !== "open") return bad(res, 412, "FAILED_PRECONDITION");

    const nowMs = Date.now();
    const expMs = new Date(ch.expiresAt).getTime();
    if (nowMs > expMs) {
      await db.ref(`challenges/${challengeId}`).update({
        status: "expired",
        reveal: true,
        expiredAt: new Date().toISOString(),
      });
      return bad(res, 408, "DEADLINE_EXCEEDED");
    }

    const list = ch.participantsCustomIds;
    if (!Array.isArray(list) || list.indexOf(customId) === -1) {
      return bad(res, 403, "PERMISSION_DENIED", ["Not a participant"]);
    }

    // license: completing user must be licensed for this bootcamp
    await assertLicenseActive(db, customId, ch.bootcamp);

    // verify signature over content fingerprint
    const expected = hmac(CHALLENGE_SIGNING_SECRET.value(),
        ch.contentFingerprint);
    if (expected !== ch.signature) {
      return bad(res, 412, "FAILED_PRECONDITION", ["Signature mismatch"]);
    }

    const finishedAt = new Date().toISOString();

    const updates = {};
    // store results keyed by Firebase uid (so rule `auth.uid === $uid` works)
    updates[`challengeResults/${challengeId}/${fbUid}`] = {
      correct: correct,
      wrong: wrong,
      unanswered: unanswered,
      timeMs: timeMs,
      finishedAt: finishedAt,
    };
    updates[`users/${customId}/userChallenges/${challengeId}/status`] =
      "completed";
    updates[`users/${customId}/userChallenges/${challengeId}/completedAt`] =
      finishedAt;

    await db.ref().update(updates);

    // if everyone is done → reveal + mark completed
    const doneFlags = await Promise.all(
        (ch.participantsCustomIds || []).map(async (cid) => {
          const s = await db
              .ref(
                  "users/" +
              cid +
              "/userChallenges/" +
              challengeId +
              "/status",
              )
              .once("value");
          return s.val() === "completed";
        }),
    );
    const allDone = doneFlags.every(Boolean);

    if (allDone) {
      await db.ref(`challenges/${challengeId}`).update({
        status: "completed",
        reveal: true,
        completedAt: new Date().toISOString(),
      });
    }

    return res.status(200).json({ok: true, allDone: allDone});
  } catch (e) {
    const code = Number.isInteger(e.code) ? e.code : 500;
    return res.status(code).json({error: e.message || "Internal error"});
  }
};
