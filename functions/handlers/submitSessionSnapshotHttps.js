// @ts-check
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {assertLicenseActive} = require("./_license");
const {
  FREE_CREDITS_ALLOWANCE,
  FREE_POINTS_CEILING,
  creditFreeSession,
  creditPaidSession,
} = require("./_pointsCredit");

/** @typedef {import('firebase-admin').database.Database} Database */
/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */

/**
 * Snapshot summary numbers persisted by the client.
 * @typedef {Object} SnapshotSummary
 * @property {number} totalQ - Total questions in the session.
 * @property {number} attempted - Questions the user attempted.
 * @property {number} correct - Correct answers count.
 * @property {number} points - Points computed for this session.
 * @property {number} usedSec - Total time used in seconds.
 */

/**
 * Minimal snapshot shape used by this endpoint.
 * @typedef {Object} SessionSnapshot
 * @property {string} [bootcamp] - Bootcamp identifier.
 * @property {string} [takenAt] - ISO timestamp when the quiz started.
 * @property {string} [createdAt] - ISO timestamp when the snapshot was created.
 * @property {SnapshotSummary} summary - Summary numbers for the session.
 */

/**
 * Row stored under users/{customId}/statsIndex/{sessionId} to power the list.
 * @typedef {Object} StatsIndexRow
 * @property {string} sessionId - The session id.
 * @property {string} takenAt - ISO timestamp when the quiz started.
 * @property {string} bootcamp - Bootcamp identifier.
 * @property {number} total_questions - Total questions in the session.
 * @property {number} attempted - Attempted questions.
 * @property {number} correct - Correct answers.
 * @property {number} duration_sec - Total time used (seconds).
 * @property {number} points - Points for the run.
 * @property {string} updatedAt - ISO timestamp when this index row was updated.
 */

/**
 * Result of free-credit accounting.
 * @typedef {Object} CreditFreeResult
 * @property {number} delta - Points actually credited (after caps).
 * @property {boolean} consumedCredit - True if one free credit was consumed.
 * @property {"ok"|"no_improvement"|
 * "free_credits_exhausted"|"cap_reached"} reason - Outcome reason.
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
 * Resolve your app's customId from a Firebase auth UID.
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
 * Map totalPoints to a rank name + numeric tier.
 * (Thresholds normalized to UPPER-CASE name.)
 * @param {number} totalPoints
 * @return {{rankName: string, rankNum: number}}
 */
function getUserRank(totalPoints) {
  let rankName = "";
  let rankNum = 0;

  if (totalPoints < 100) {
    rankName = "Recruit";
    rankNum = 1;
  } else if (totalPoints < 250) {
    rankName = "Corporal";
    rankNum = 2;
  } else if (totalPoints < 450) {
    rankName = "Sergeant";
    rankNum = 3;
  } else if (totalPoints < 800) {
    rankName = "Warrant Officer";
    rankNum = 4;
  } else if (totalPoints < 1300) {
    rankName = "Lieutenant";
    rankNum = 5;
  } else if (totalPoints < 1950) {
    rankName = "Captain";
    rankNum = 6;
  } else if (totalPoints < 3000) {
    rankName = "Major";
    rankNum = 7;
  } else if (totalPoints < 4500) {
    rankName = "Colonel";
    rankNum = 8;
  } else if (totalPoints < 7000) {
    rankName = "Major General";
    rankNum = 9;
  } else {
    rankName = "General";
    rankNum = 10;
  }

  return {rankName: rankName.toUpperCase(), rankNum};
}

/**
 * Read the user's current totalPoints (after crediting).
 * @param {Database} db
 * @param {string} customId
 * @return {Promise<number>}
 */
async function getTotalPointsNow(db, customId) {
  const s = await db.ref(`users/${customId}/totalPoints`).get();
  return Number(s.val() || 0);
}

/**
 * HTTPS handler to upload a session snapshot, save it to user history,
 * credit points (paid or free budget), and update the user's current rank.
 *
 * Request body:
 *   { sessionId: string, snapshot: SessionSnapshot }
 *
 * Response (200):
 *   {
 *     ok: true,
 *     creditMode: "paid" | "free",
 *     deltaPoints: number,
 *     freeCreditConsumed: boolean,
 *     reason: "ok" | "no_improvement" |
 * "free_credits_exhausted" | "cap_reached"
 *   }
 *
 * Possible error codes: 400, 403, 405, 500
 */
/**
 * @param {Request} req
 * @param {Response} res
 * @return {Promise<void>}
 */
async function handler(req, res) {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") {
      bad(res, 405, "Method not allowed");
      return;
    }

    const fbUid = await requireBearerUid(req);
    /** @type {{ sessionId?: unknown, snapshot?: unknown }} */
    const body = req.body || {};

    const sessionId = /** @type {string|undefined} */ (body.sessionId);
    const snapshot = /** @type {SessionSnapshot|undefined} */ (body.snapshot);

    /** @type {string[]} */
    const errs = [];
    if (typeof sessionId !== "string" ||
        sessionId.length === 0) errs.push("sessionId");
    if (typeof snapshot !== "object" ||
        snapshot === null) errs.push("snapshot");

    const sum = /** @type {SnapshotSummary|Record<string, unknown>} */ (
      (snapshot && snapshot.summary) || {}
    );

    /** @type {Array<[string, unknown]>} */
    const requiredNums = [
      ["summary.totalQ", sum.totalQ],
      ["summary.attempted", sum.attempted],
      ["summary.correct", sum.correct],
      ["summary.points", sum.points],
      ["summary.usedSec", sum.usedSec],
    ];
    requiredNums.forEach(([k, v]) => {
      if (!(Number.isFinite(/** @type {number} */ (v)) &&
      /** @type {number} */ (v) >= 0)) {
        errs.push(k);
      }
    });

    if (errs.length) {
      bad(res, 400, "INVALID_ARGUMENT", errs);
      return;
    }

    // ---- Narrow types after validation ----
    /** @type {string} */
    const sessionIdStr = /** @type {string} */ (sessionId);
    /** @type {SessionSnapshot} */
    const snap = /** @type {SessionSnapshot} */ (snapshot);
    /** @type {SnapshotSummary} */
    const sumStrict = /** @type {SnapshotSummary} */ (snap.summary);

    // cheap sanity
    if (sumStrict.correct > sumStrict.attempted ||
        sumStrict.attempted > sumStrict.totalQ) {
      bad(res, 400, "INVALID_ARGUMENT", ["inconsistent totals"]);
      return;
    }

    const db = getDatabase();
    const customId = await getCustomIdByFirebaseUid(db, fbUid);
    if (!customId) {
      bad(res, 403, "PERMISSION_DENIED");
      return;
    }

    const bootcamp = snap.bootcamp || "";
    const takenAt = snap.takenAt || snap.createdAt || new Date().toISOString();
    const createdAt = snap.createdAt || new Date().toISOString();

    // Save snapshot + index first (so history is kept even if no credit)
    const nowIso = new Date().toISOString();
    /** @type {StatsIndexRow} */
    const indexRow = {
      sessionId: sessionIdStr,
      takenAt,
      bootcamp,
      total_questions: sumStrict.totalQ,
      attempted: sumStrict.attempted,
      correct: sumStrict.correct,
      duration_sec: sumStrict.usedSec,
      points: sumStrict.points,
      updatedAt: nowIso,
    };

    /** @type {Record<string, unknown>} */
    const updates = {};
    updates[`users/${customId}/stats/${sessionIdStr}`] = {
      ...snap,
      takenAt,
      createdAt,
      updatedAt: nowIso,
    };
    updates[`users/${customId}/statsIndex/${sessionIdStr}`] = indexRow;
    await db.ref().update(updates);

    // Decide credit mode
    let creditMode = "free";
    try {
      await assertLicenseActive(db, customId, bootcamp);
      creditMode = "paid";
    } catch (_) {
      creditMode = "free";
    }

    let deltaPoints = 0;
    let freeConsumed = false;
    let reason = "ok";
    let freeCreditsUsed = null;
    let freeCreditsRemaining = null;

    if (creditMode === "paid") {
      deltaPoints = await creditPaidSession(db, customId,
          sessionIdStr, sumStrict.points);
    } else {
      const r = await creditFreeSession(
          db,
          customId,
          sessionIdStr,
          sumStrict.points,
          FREE_POINTS_CEILING,
          FREE_CREDITS_ALLOWANCE,
      );
      deltaPoints = r.delta;
      freeConsumed = r.consumedCredit;
      reason = r.reason;

      const usedSnap = await db
          .ref(`users/${customId}/freeBudget/creditsUsed`)
          .get();

      freeCreditsUsed = Number(usedSnap.val() || 0);
      freeCreditsRemaining = Math.max(
          0,
          FREE_CREDITS_ALLOWANCE - freeCreditsUsed,
      );
    }

    // Mark whether this record actually got credited.
    // This now applies to both paid and free users.
    await db
        .ref(`users/${customId}/statsIndex/${sessionIdStr}/credited`)
        .set(deltaPoints > 0);

    // ----- Rank update (AFTER points are credited) -----
    const totalPointsNow = await getTotalPointsNow(db, customId);
    const {rankName, rankNum} = getUserRank(totalPointsNow);
    await db.ref(`users/${customId}`).update({
      currentRank: rankName, // e.g., "WARRANT OFFICER"
      currentRankNum: rankNum, // numeric tier 1..10 (optional)
      currentRankUpdatedAt: nowIso, // audit stamp (optional)
    });

    res.status(200).json({
      ok: true,
      creditMode,
      deltaPoints,
      totalPoints: totalPointsNow,
      currentRank: rankName,
      currentRankNum: rankNum,
      freeCreditConsumed: freeConsumed,
      reason,
      freeCreditsUsed,
      freeCreditsLimit: FREE_CREDITS_ALLOWANCE,
      freeCreditsRemaining,
    });
  } catch (e) {
  /** @type {{ code?: unknown, message?: unknown }} */
    const maybe = (typeof e === "object" && e !== null) ? e : {};

    // Force a real number type via narrowing
    let statusCode = 500;
    if (typeof maybe.code === "number" && Number.isInteger(maybe.code)) {
      statusCode = maybe.code;
    } else if (typeof maybe.code === "string") {
      const parsed = Number(maybe.code);
      if (Number.isInteger(parsed)) statusCode = parsed;
    }

    // Optional: keep it within valid HTTP range
    if (statusCode < 100 || statusCode > 599) statusCode = 500;

    const msg =
    typeof maybe.message === "string" ?
      maybe.message :
      (e instanceof Error ? e.message : "Internal error");

    res.status(statusCode).json({error: msg});
    return;
  }
}

exports.handler = handler;
