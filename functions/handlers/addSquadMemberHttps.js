// @ts-check
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {blockRelationship} = require("./_socialPolicy");

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
 * @return {Response} Response
 */
function bad(res, code, msg, details) {
  return res.status(code).json({error: msg, details: details});
}

/**
 * Look up /users/<customId> key by firebase uid.
 * @param {Database} db Admin db
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
 * Per minute rate limit using RTDB transaction counter.
 * @param {Database} db Admin db
 * @param {string} fbUid Firebase uid
 * @param {number} limit Max per minute
 * @param {string} bucket Bucket name
 * @return {Promise<{allowed: boolean, count: number}>} state
 */
async function enforceRateLimit(db, fbUid, limit, bucket) {
  const minuteKey = String(Math.floor(Date.now() / 60000));
  const path = "rateLimits/" + bucket + "/" + fbUid + "/" + minuteKey;
  const ref = db.ref(path);

  let allowed = true;
  let countNow = 0;

  await ref.transaction((cur) => {
    const base = (typeof cur === "number") ? cur : 0;
    const n = base + 1;
    countNow = n;

    if (n > limit) {
      allowed = false;
      return cur;
    }
    return n;
  });

  return {allowed: allowed, count: countNow};
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
 * Adds a squad member to the caller's squad list.
 * Truth lives in cloud at:
 * users/<myCustomId>/squadMembers/<memberId> = true
 *
 * Request body:
 * { memberId: "user_abc..." }
 *
 * Response 200:
 * { ok: true, memberId, state: "added"|"already" }
 *
 * @param {Request} req Express request
 * @param {Response} res Express response
 * @return {Promise<Response|void>} Response
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

    // Calm rate limit (adds are rarer, but still protect)
    const rl = await enforceRateLimit(db, fbUid, 20, "addSquadMember");
    if (!rl.allowed) {
      return res.status(429).json({
        error: "RATE_LIMITED",
        retryAfterSeconds: 60,
      });
    }

    const myCustomId = await getCustomIdByFirebaseUid(db, fbUid);
    if (!myCustomId) return bad(res, 403, "PERMISSION_DENIED");

    const body = req.body || {};
    const memberId = normalizeCustomId(body.memberId);

    if (!memberId) return bad(res, 400, "INVALID_ARGUMENT", ["memberId"]);
    if (memberId === myCustomId) {
      return res.status(200).json({ok: true, memberId, state: "already"});
    }

    const relationship = await blockRelationship(db, myCustomId, memberId);
    if (relationship.blocked) {
      return bad(res, 404, "STUDENT_UNAVAILABLE");
    }

    // Optional: enforce only students can be added (based on /roles)
    const roleSnap = await db.ref("roles/" + memberId).once("value");
    const role = roleSnap.val();
    if (role !== "student") {
      return bad(res, 412, "FAILED_PRECONDITION", ["Not a student"]);
    }

    // Optional: respect profilePermissions
    const permSnap = await db
        .ref("users/" + memberId + "/profilePermissions")
        .once("value");
    if (permSnap.val() !== true) {
      return bad(res, 404, "STUDENT_UNAVAILABLE");
    }

    // Keep squad size reasonable
    const countSnap = await db
        .ref("users/" + myCustomId + "/squadMembers")
        .limitToFirst(200)
        .once("value");
    const current = countSnap.val() || {};
    const currentCount = Object.keys(current).length;
    if (currentCount >= 50) {
      return bad(res, 412, "FAILED_PRECONDITION", ["Squad limit reached"]);
    }

    const ref = db.ref("users/" + myCustomId + "/squadMembers/" + memberId);

    let state = "added";
    await ref.transaction((cur) => {
      if (cur === true) {
        state = "already";
        return cur;
      }
      state = "added";
      return true;
    });

    return res.status(200).json({ok: true, memberId: memberId, state: state});
  } catch (e) {
    /** @type {{ message?: unknown }} */
    const maybe = (typeof e === "object" && e !== null) ? e : {};
    const msg = (typeof maybe.message === "string") ?
    maybe.message : "Internal error";
    return res.status(500).json({error: msg});
  }
};
