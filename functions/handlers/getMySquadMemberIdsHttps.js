// @ts-check
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {blockSetsFor, isBlockedBySets} = require("./_socialPolicy");

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
 * Return my squad member ids from RTDB truth.
 * Ensures caller is always included in their own squad.
 *
 * Response 200:
 * { ok: true, memberIds: string[] }
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

    const customId = await getCustomIdByFirebaseUid(db, fbUid);
    if (!customId) {
      return bad(res, 403, "PERMISSION_DENIED");
    }

    // Enforce self membership in squad.
    await db
        .ref("users/" + customId + "/squadMembers/" + customId)
        .set(true);

    const snap = await db
        .ref("users/" + customId + "/squadMembers")
        .once("value");

    const obj = snap.val() || {};
    const blockSets = await blockSetsFor(db, customId);
    const memberIds = Object.keys(obj).filter((k) =>
      obj[k] === true &&
      (k === customId || !isBlockedBySets(blockSets, k)),
    );

    if (memberIds.indexOf(customId) < 0) {
      memberIds.unshift(customId);
    }

    return res.status(200).json({ok: true, memberIds: memberIds});
  } catch (e) {
    /** @type {{ message?: unknown }} */
    const maybe = (typeof e === "object" && e !== null) ? e : {};

    const msg =
      (typeof maybe.message === "string") ? maybe.message : "Internal error";

    return res.status(500).json({error: msg});
  }
};
