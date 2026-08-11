// @ts-check
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {assertLicenseActive} = require("./_license");
const {blockRelationship} = require("./_socialPolicy");

/** @typedef {import("firebase-admin").database.Database} Database */
/** @typedef {import("express").Request} Request */
/** @typedef {import("express").Response} Response */

/**
 * Minimal challenge fields used by this handler.
 * @typedef {Object} Challenge
 * @property {string} [status]
 * @property {string} [expiresAt]
 * @property {string} [bootcamp]
 * @property {string[]} [participantsCustomIds]
 */

/**
 * Minimal user challenge row used by this handler.
 * @typedef {Object} UserChallengeRow
 * @property {string} [status]
 * @property {string} [acceptedAt]
 * @property {string} [declinedAt]
 * @property {string} [declineReason]
 * @property {string} [updatedAt]
 */

/**
 * Send a standardized JSON error response.
 * @param {Response} res
 * @param {number} code
 * @param {string} msg
 * @param {unknown} [details]
 * @return {Response}
 */
function bad(res, code, msg, details) {
  return res.status(code).json({error: msg, details});
}

/**
 * Look up a user's custom ID (the key under /users) using a Firebase UID.
 * @param {Database} db
 * @param {string} firebaseUid
 * @return {Promise<string|null>}
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
 * HTTPS handler to accept or reject a challenge.
 *
 * Request body:
 *   {
 *     challengeId: string,
 *     decision: "accept" | "reject",
 *     reason?: string
 *   }
 *
 * Response (200):
 *   { ok: true, state: "accepted" | "declined" | "unchanged" }
 *
 * @param {Request} req
 * @param {Response} res
 * @return {Promise<Response|void>}
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") return bad(res, 405, "Method not allowed");

    const fbUid = await requireBearerUid(req);

    /** @type {{ challengeId?: unknown, decision?:
     * unknown, reason?: unknown }} */
    const body = req.body || {};

    const challengeId = typeof body.challengeId === "string" ?
    body.challengeId : "";
    const decision =
      typeof body.decision === "string" ? body.decision.toLowerCase() : "";
    const reason = typeof body.reason === "string" ? body.reason : "";

    /** @type {string[]} */
    const errs = [];
    if (!challengeId) errs.push("challengeId");
    if (decision !== "accept" && decision !== "reject") errs.push("decision");
    if (errs.length) return bad(res, 400, "INVALID_ARGUMENT", errs);

    /** @type {Database} */
    const db = getDatabase();

    const customId = await getCustomIdByFirebaseUid(db, fbUid);
    if (!customId) return bad(res, 403, "PERMISSION_DENIED");

    // Load challenge
    const chSnap = await db.ref(`challenges/${challengeId}`).once("value");
    /** @type {Challenge|null} */
    const ch = chSnap.val();

    if (!ch) return bad(res, 404, "NOT_FOUND");
    if (ch.status !== "open") return bad(res, 412, "FAILED_PRECONDITION");
    if (!ch.expiresAt) {
      return bad(
          res, 412, "FAILED_PRECONDITION", ["Missing expiresAt"]);
    }

    // Expiry
    const expMs = new Date(ch.expiresAt).getTime();
    if (Number.isFinite(expMs) && Date.now() > expMs) {
      return bad(res, 408, "DEADLINE_EXCEEDED");
    }

    // Participant?
    const list = ch.participantsCustomIds;
    if (!Array.isArray(list) || list.indexOf(customId) === -1) {
      return bad(res, 403, "PERMISSION_DENIED", ["Not a participant"]);
    }

    // License only required to ACCEPT (you can reject without a license)
    if (decision === "accept") {
      const creatorId = String(ch.createdByCustomId || "");
      const relationship = await blockRelationship(db, customId, creatorId);
      if (relationship.blocked) {
        return bad(res, 404, "CHALLENGE_UNAVAILABLE");
      }
      await assertLicenseActive(db, customId, ch.bootcamp || "");
    }

    // Atomic status update on the participant's row
    const rowRef = db.ref(`users/${customId}/userChallenges/${challengeId}`);
    const nowIso = new Date().toISOString();

    /** @type {"accepted"|"declined"|"unchanged"} */
    let finalState = "unchanged";

    await rowRef.transaction((cur) => {
      if (!cur || typeof cur !== "object") return cur;

      /** @type {UserChallengeRow} */
      const row = /** @type {any} */ (cur);

      const s = row.status;

      if (decision === "accept") {
        if (s === "accepted") {
          finalState = "accepted";
          return row;
        }
        if (s === "completed") {
          finalState = "unchanged";
          return row;
        }

        row.status = "accepted";
        row.acceptedAt = row.acceptedAt || nowIso;
        row.updatedAt = nowIso;
        finalState = "accepted";
        return row;
      }

      // decision === "reject"
      if (s === "declined") {
        finalState = "declined";
        return row;
      }
      if (s === "completed") {
        finalState = "unchanged";
        return row;
      }

      row.status = "declined";
      row.declinedAt = row.declinedAt || nowIso;
      if (reason) row.declineReason = String(reason).slice(0, 200);
      row.updatedAt = nowIso;
      finalState = "declined";
      return row;
    });

    return res.status(200).json({ok: true, state: finalState});
  } catch (e) {
    /** @type {{ code?: unknown, message?: unknown }} */
    const maybe = typeof e === "object" && e !== null ? e : {};

    const code = Number.isInteger(
        maybe.code) ? /** @type {number} */ (maybe.code) : 500;

    const msg =
      typeof maybe.message === "string" ?
        maybe.message :
        e instanceof Error ?
          e.message :
          "Internal error";

    return res.status(code).json({error: msg});
  }
};
