// @ts-check
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");

/**
 * @typedef {import("firebase-admin").database.Database} Database
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 */

/**
 * Standard error response.
 * @param {Response} res Express response
 * @param {number} code HTTP status
 * @param {string} msg Error string
 * @param {unknown} [details] Optional details
 * @return {Response} Express response
 */
function bad(res, code, msg, details) {
  return res.status(code).json({error: msg, details: details});
}

/**
 * Look up /users/<customId> key by firebase uid.
 * @param {Database} db Admin database
 * @param {string} firebaseUid Firebase uid
 * @return {Promise<string|null>} custom id or null
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
 * Sanitizes a custom user id like "user_email@gmailcom".
 * @param {unknown} v Any input
 * @return {string} Clean id or empty
 */
function normalizeCustomId(v) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s) return "";
  if (s.length > 120) return "";
  if (s.indexOf("user_") !== 0) return "";
  return s;
}

/**
 * Removes a squad member from the caller's squad list.
 * Prevents removing yourself (caller must always remain in squad).
 *
 * Request body:
 * { memberId: "user_abc..." }
 *
 * Response 200:
 * { ok: true, memberId, removed: true }
 *
 * @param {Request} req Express request
 * @param {Response} res Express response
 * @return {Promise<Response|void>} Express response or void
 */
exports.handler = async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "Method not allowed");
    }

    const fbUid = await requireBearerUid(req);

    /** @type {Database} */
    const db = getDatabase();

    const myCustomId = await getCustomIdByFirebaseUid(db, fbUid);
    if (!myCustomId) {
      return bad(res, 403, "PERMISSION_DENIED");
    }

    const body = req.body || {};
    const memberId = normalizeCustomId(body.memberId);

    if (!memberId) {
      return bad(res, 400, "INVALID_ARGUMENT", ["memberId"]);
    }

    // Enforce "user must always be in their own squad"
    if (memberId === myCustomId) {
      return bad(res, 400, "INVALID_ARGUMENT", ["Cannot remove yourself"]);
    }

    await db
        .ref("users/" + myCustomId + "/squadMembers/" + memberId)
        .remove();

    return res.status(200).json({
      ok: true,
      memberId: memberId,
      removed: true,
    });
  } catch (e) {
    /** @type {{ message?: unknown }} */
    const maybe = (typeof e === "object" && e !== null) ? e : {};

    const msg =
      (typeof maybe.message === "string") ? maybe.message : "Internal error";

    return res.status(500).json({error: msg});
  }
};
