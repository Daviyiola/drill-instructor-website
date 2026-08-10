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
 * @typedef {Object} UnitNode
 * @property {number} [score]
 * @property {number} [totalPoints]
 * @property {number} [memberCount]
 * @property {number} [bayesAvg]
 * @property {boolean} [platoonPermissions]
 */

/**
 * @typedef {Object} RankingRow
 * @property {string} name
 * @property {number} score
 * @property {number} totalPoints
 * @property {string} parent
 * @property {string} level
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
    const base = typeof cur === "number" ? cur : 0;
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
 * Numeric score fallback helper.
 * @param {unknown} v Incoming value
 * @return {number} Safe number
 */
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Whether this key is metadata rather than a child unit.
 * @param {string} key RTDB key
 * @return {boolean} true if metadata key
 */
function isUnitMetaKey(key) {
  return (
    key === "totalPoints" ||
    key === "members" ||
    key === "score" ||
    key === "memberCount" ||
    key === "bayesAvg" ||
    key === "platoonPermissions"
  );
}

/**
 * Push a ranking row.
 * @param {RankingRow[]} rankings Output array
 * @param {string} name Unit name
 * @param {UnitNode} node Unit node
 * @param {string} parent Parent name
 * @param {string} level Unit level
 * @return {void}
 */
function pushRanking(rankings, name, node, parent, level) {
  rankings.push({
    name: name,
    score: num(node.score),
    totalPoints: num(node.totalPoints),
    parent: parent,
    level: level,
  });
}

/**
 * Return unit rankings visible to the signed-in user.
 *
 * Response 200:
 * {
 *   ok: true,
 *   rankings: Array<{name, score, totalPoints, parent, level}>,
 *   meta: {
 *     canShowBattalions: boolean,
 *     canShowPlatoons: boolean
 *   }
 * }
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

    const rl = await enforceRateLimit(db, fbUid, 30, "getUnitRankings");
    if (!rl.allowed) {
      return res.status(429).json({
        error: "RATE_LIMITED",
        retryAfterSeconds: 60,
      });
    }

    const customId = await getCustomIdByFirebaseUid(db, fbUid);
    if (!customId) return bad(res, 403, "PERMISSION_DENIED");

    const userSnap = await db.ref("users/" + customId).once("value");
    const user = userSnap.val() || {};

    const userCorps =
      typeof user.corpsName === "string" ? user.corpsName : "";

    const userBattalion =
      typeof user.battalionName === "string" ? user.battalionName : "";

    if (!userCorps) {
      return bad(res, 412, "NO_CORPS");
    }

    const meta = {
      canShowBattalions: userCorps !== "",
      canShowPlatoons: userCorps !== "" && userBattalion !== "",
    };

    const corpsSnap = await db.ref("units/corps").once("value");
    const corpsData = corpsSnap.val() || {};

    /** @type {RankingRow[]} */
    const rankings = [];

    // 1) All corps
    Object.keys(corpsData).forEach((corpsName) => {
      if (corpsName === "members") return;

      /** @type {UnitNode} */
      const corpsNode = corpsData[corpsName] || {};
      pushRanking(rankings, corpsName, corpsNode, "", "corps");
    });

    // 2) Battalions only inside user's corps
    const myCorpsNode = corpsData[userCorps] || {};
    Object.keys(myCorpsNode).forEach((battalionName) => {
      if (isUnitMetaKey(battalionName)) return;

      /** @type {UnitNode} */
      const battalionNode = myCorpsNode[battalionName] || {};

      pushRanking(
          rankings,
          battalionName,
          battalionNode,
          userCorps,
          "battalion",
      );

      // 3) Platoons only inside user's battalion
      if (battalionName !== userBattalion) return;

      Object.keys(battalionNode).forEach((platoonName) => {
        if (isUnitMetaKey(platoonName)) return;

        /** @type {Record<string, any>} */
        const battalionChildren = /** @type {any} */ (battalionNode);

        /** @type {UnitNode} */
        const platoonNode = battalionChildren[platoonName] || {};

        if (platoonNode.platoonPermissions !== true) return;

        pushRanking(
            rankings,
            platoonName,
            platoonNode,
            userBattalion,
            "platoon",
        );
      });
    });

    rankings.sort((a, b) => {
      const as = num(a.score);
      const bs = num(b.score);
      if (bs !== as) return bs - as;

      const ap = num(a.totalPoints);
      const bp = num(b.totalPoints);
      return bp - ap;
    });

    return res.status(200).json({
      ok: true,
      rankings: rankings,
      meta: meta,
    });
  } catch (e) {
    /** @type {{ message?: unknown }} */
    const maybe = typeof e === "object" && e !== null ? e : {};

    const msg =
      typeof maybe.message === "string" ? maybe.message : "Internal error";

    return res.status(500).json({error: msg});
  }
};
