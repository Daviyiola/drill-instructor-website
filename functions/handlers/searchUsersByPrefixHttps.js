// @ts-check
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {blockSetsFor, isBlockedBySets, studentIdForUid} =
  require("./_socialPolicy");

/** @typedef {import("express").Request} Request */
/** @typedef {import("express").Response} Response */
/** @typedef {import("firebase-admin").database.Database} Database */

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
 * Simple per minute rate limit using RTDB.
 * @param {Database} db
 * @param {string} fbUid
 * @param {number} limit
 * @return {Promise<{allowed: boolean, count: number}>}
 */
async function enforceRateLimit(db, fbUid, limit) {
  const minuteKey = String(Math.floor(Date.now() / 60000));
  const ref = db.ref(`rateLimits/searchUsersByPrefix/${fbUid}/${minuteKey}`);

  let allowed = true;
  let countNow = 0;

  await ref.transaction((cur) => {
    const n = (typeof cur === "number" ? cur : 0) + 1;
    countNow = n;

    if (n > limit) {
      allowed = false;
      return cur; // do not increment further
    }
    return n;
  });

  return {allowed, count: countNow};
}

/**
 * HTTPS handler: prefix match search against /roles and then fetch /users.
 *
 * Body:
 *  { prefix: "user_abc", role: "student" }
 *
 * Response 200:
 *  { ok: true, results: [{ id, firstName, lastName,
 * totalPoints, platoonName }] }
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
    /** @type {{ prefix?: unknown, role?: unknown }} */
    const body = req.body || {};

    const prefix = typeof body.prefix === "string" ? body.prefix : "";
    const role = typeof body.role === "string" ? body.role : "student";

    if (!prefix || prefix.length < 6) {
      return bad(res, 400, "INVALID_ARGUMENT", ["prefix"]);
    }
    if (role !== "student" && role !== "educator") {
      return bad(res, 400, "INVALID_ARGUMENT", ["role"]);
    }

    const db = getDatabase();

    const callerStudentId = await studentIdForUid(db, fbUid);
    const callerBlocks = callerStudentId ?
      await blockSetsFor(db, callerStudentId) : null;

    const rl = await enforceRateLimit(db, fbUid, 20);
    if (!rl.allowed) {
      return res.status(429).json({
        error: "RATE_LIMITED", retryAfterSeconds: 60});
    }

    const rolesSnap = await db
        .ref("roles")
        .orderByKey()
        .startAt(prefix)
        .endAt(prefix + "\uf8ff")
        .limitToFirst(50)
        .once("value");

    const rolesVal = rolesSnap.val() || {};
    const ids = Object.keys(rolesVal).filter((id) => rolesVal[id] === role);
    const topIds = ids.slice(0, 20);

    const userSnaps = await Promise.all(
        topIds.map((id) => db.ref(`users/${id}`).once("value")),
    );

    /** @type {Array<{id:string, firstName:string,
     * lastName:string, totalPoints:number, platoonName:string}>} */
    const results = [];

    for (let i = 0; i < userSnaps.length; i++) {
      const id = topIds[i];
      const u = userSnaps[i].val() || {};

      if (u.profilePermissions !== true) continue;
      if (id === callerStudentId) continue;
      if (callerBlocks && isBlockedBySets(callerBlocks, id)) continue;

      results.push({
        id,
        firstName: u.firstName || "",
        lastName: u.lastName || "",
        platoonName: u.platoonName || "",
        rankNum: Math.min(10, Math.max(1, Number(u.currentRankNum) || 1)),
      });

      if (results.length >= 20) break;
    }

    return res.status(200).json({ok: true, results});
  } catch (e) {
    const err = /** @type {any} */ (e);
    const status = Number(err && err.code) === 401 ? 401 : 500;
    const msg =
      err && typeof err.message === "string" ?
        err.message :
        "Internal error";

    return res.status(status).json({
      error: status === 401 ? "Authentication failed" : msg,
    });
  }
};
