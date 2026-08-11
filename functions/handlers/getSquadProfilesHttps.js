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
 * Normalize and cap incoming ids.
 * @param {unknown} memberIds Incoming memberIds
 * @param {number} cap Max count
 * @return {string[]} Clean ids
 */
function normalizeIds(memberIds, cap) {
  if (!Array.isArray(memberIds)) return [];

  const out = [];
  for (let i = 0; i < memberIds.length; i++) {
    const v = memberIds[i];
    if (typeof v !== "string") continue;

    const s = v.trim();
    if (!s) continue;
    if (s.length > 120) continue;

    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Convert a legacy total into the existing rank tier without exposing that
 * total to challenge recipients.
 * @param {unknown} totalPoints
 * @return {number}
 */
function rankNumberForPoints(totalPoints) {
  const total = Math.max(0, Number(totalPoints) || 0);
  const thresholds = [100, 250, 450, 800, 1300, 1950, 3000, 4500, 7000];
  const index = thresholds.findIndex((threshold) => total < threshold);
  return index < 0 ? 10 : index + 1;
}

/**
 * Batch return squad profiles.
 * Request body:
 * { memberIds: string[], audience?: "challenge_picker" }
 * Response 200:
 * { ok: true, results: Array<{id, firstName, lastName, platoonName,
 * rankNum?: number, totalPoints?: number}> }
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

    const rl = await enforceRateLimit(db, fbUid, 20, "getSquadProfiles");
    if (!rl.allowed) {
      return res.status(429).json({
        error: "RATE_LIMITED",
        retryAfterSeconds: 60,
      });
    }

    const customId = await getCustomIdByFirebaseUid(db, fbUid);
    if (!customId) return bad(res, 403, "PERMISSION_DENIED");

    const body = req.body || {};
    const ids = normalizeIds(body.memberIds, 20);
    const challengePicker = body.audience === "challenge_picker";
    if (!ids.length) {
      return res.status(200).json({ok: true, results: []});
    }

    const [membershipSnap, blockSets] = await Promise.all([
      db.ref(`users/${customId}/squadMembers`).once("value"),
      blockSetsFor(db, customId),
    ]);
    const memberships = membershipSnap.val() || {};
    const allowedIds = ids.filter((id) =>
      (id === customId || memberships[id] === true) &&
      (id === customId || !isBlockedBySets(blockSets, id)),
    );
    const snaps = await Promise.all(
        allowedIds.map((id) => {
          return db.ref("users/" + id).once("value");
        }),
    );

    const results = [];
    for (let i = 0; i < snaps.length; i++) {
      const id = allowedIds[i];
      const u = snaps[i].val() || {};

      const rankNum = Math.min(10, Math.max(1,
          Number(u.currentRankNum) || rankNumberForPoints(u.totalPoints)));
      const profile = challengePicker ? {
        id: id,
        firstName: u.firstName || "",
        lastName: u.lastName || "",
        platoonName: u.platoonName || "",
        rankNum: rankNum,
      } : {
        id: id,
        firstName: u.firstName || "",
        lastName: u.lastName || "",
        platoonName: u.platoonName || "",
        rankNum: rankNum,
        // Squad leaderboards still use the score internally for ordering and
        // local caching. Clients do not render it in profile rows.
        totalPoints: Math.max(0, Number(u.totalPoints) || 0),
      };
      // Recipient selection needs identity only. Keep leaderboard/ranking
      // fields out of that response unless a caller explicitly needs them.
      results.push(profile);
    }

    return res.status(200).json({ok: true, results: results});
  } catch (e) {
    /** @type {{ message?: unknown }} */
    const maybe = (typeof e === "object" && e !== null) ? e : {};

    const msg = (typeof maybe.message === "string") ?
      maybe.message :
      "Internal error";

    return res.status(500).json({error: msg});
  }
};
