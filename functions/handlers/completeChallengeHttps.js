// @ts-check
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {defineSecret} = require("firebase-functions/params");
const crypto = require("crypto");
const {requireBearerUid, allowCors} = require("./_auth");
const {assertLicenseActive} = require("./_license");

const CHALLENGE_SIGNING_SECRET = defineSecret("CHALLENGE_SIGNING_SECRET");

/** @typedef {import('firebase-admin').database.Database} Database */
/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */

/**
 * Optional participant metadata provided by the client.
 * If omitted or incomplete, the server will look it up from /users.
 * @typedef {Object} ParticipantMetaIn
 * @property {string} [displayName]
 * @property {number} [avatarNumber]
 * @property {number} [avaterNumber] - Legacy typo
 */

/**
 * Participant metadata stored with the result.
 * @typedef {Object} ParticipantMetaOut
 * @property {string} customId
 * @property {string} displayName
 * @property {number} avatarNumber
 * @property {number} rankNum
 * @property {string} rankName
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
 * Look up a user's custom ID (key under /users) using a Firebase UID.
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
 * Compute HMAC-SHA256 as a hex string.
 * @param {string} secret
 * @param {string} data
 * @return {string}
 */
function hmac(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

/**
 * Normalize an authoritative, server-graded drill result for the challenge.
 * @param {Object} result
 * @return {{correct:number, wrong:number, unanswered:number,
 * timeMs:number, points:number, attempted:number, totalQ:number}}
 */
function summarizeSubmittedResult(result) {
  const s = result && result.summary &&
    typeof result.summary === "object" ? result.summary : {};
  const totalQ = Math.max(0, Number(s.totalQ || 0));
  const attempted = Math.max(0, Number(s.attempted || 0));
  const correct = Math.max(0, Number(s.correct || 0));
  const wrong = Math.max(0, attempted - correct);
  const unanswered = Math.max(0, totalQ - attempted);
  const usedSec = Math.max(0, Number(s.usedSec || 0));
  const timeMs = usedSec ? Math.floor(usedSec * 1000) : 0;
  const points = (3 * correct) + wrong;
  return {correct, wrong, unanswered, timeMs, points, attempted, totalQ};
}

/**
 * Resolve participant metadata: display name, avatar number, and rank.
 * Prefers client-provided values; falls back to /users lookups.
 * Accepts both "avaterNumber" (legacy typo) and "avatarNumber".
 *
 * @param {Database} db
 * @param {string} customId
 * @param {ParticipantMetaIn|undefined} provided
 * @return {Promise<ParticipantMetaOut>}
 */
async function resolveParticipantMeta(db, customId, provided) {
  let name =
    provided && typeof provided.displayName === "string" ?
      provided.displayName :
      "";

  let avatarNum =
    provided && Number.isFinite(Number(provided.avatarNumber)) ?
      Number(provided.avatarNumber) :
      NaN;

  // also accept legacy client field if present
  if (!Number.isFinite(avatarNum) && provided &&
  Number.isFinite(Number(provided.avaterNumber))) {
    avatarNum = Number(provided.avaterNumber);
  }

  const userRef = db.ref("users/" + customId);
  const [fnSnap, lnSnap, av1Snap, av2Snap,
    rankNameSnap, rankNumSnap] = await Promise.all([
    userRef.child("firstName").once("value"),
    userRef.child("lastName").once("value"),
    userRef.child("avaterNumber").once("value"), // legacy typo
    userRef.child("avatarNumber").once("value"), // future-proof
    userRef.child("currentRank").once("value"),
    userRef.child("currentRankNum").once("value"),
  ]);

  if (!name) {
    const first = String(fnSnap.val() || "").trim();
    const last = String(lnSnap.val() || "").trim();
    name = (first + " " + last).trim() || customId;
  }

  if (!Number.isFinite(avatarNum)) {
    const raw = Number(av1Snap.val()) || Number(av2Snap.val()) || Number.NaN;
    avatarNum = Number.isFinite(raw) ? raw : 0;
  }

  const rankName = (rankNameSnap.val() || "").toString();
  const rankNum = Number(rankNumSnap.val() || 0);

  /** @type {ParticipantMetaOut} */
  const out = {
    customId,
    displayName: name,
    avatarNumber: avatarNum,
    rankName,
    rankNum,
  };
  return out;
}


/**
 * HTTPS handler to complete a challenge attempt.
 *
 * Request body:
 *   - challengeId: string (required)
 *   - sessionId: canonical submitted drill session id (required)
 *
 * Response body (200): { ok: true, allDone: boolean }
 *
 * @param {Request} req
 * @param {Response} res
 * @return {Promise<void>}
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") {
      bad(res, 405, "Method not allowed");
      return;
    }

    const fbUid = await requireBearerUid(req);
    /** @type {{challengeId?: unknown; sessionId?: unknown}} */
    const body = req.body || {};

    const challengeId =
      typeof body.challengeId === "string" ? body.challengeId : "";
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId : "";

    /** @type {string[]} */
    const errs = [];
    if (!challengeId) errs.push("challengeId");
    if (!sessionId) errs.push("sessionId");
    if (errs.length) {
      bad(res, 400, "INVALID_ARGUMENT", errs);
      return;
    }

    const db = getDatabase();
    const customId = await getCustomIdByFirebaseUid(db, fbUid);
    if (!customId) {
      bad(res, 403, "PERMISSION_DENIED");
      return;
    }

    // Load challenge
    const chSnap = await db.ref("challenges/" + challengeId).once("value");
    const ch = chSnap.val();
    if (!ch) {
      bad(res, 404, "NOT_FOUND");
      return;
    }
    if (ch.status === "completed") {
      const existing = await db.ref(
          "challengeResults/" + challengeId + "/" + customId,
      ).once("value");
      if (existing.exists()) {
        res.status(200).json({ok: true, allDone: true, duplicate: true});
        return;
      }
    }
    if (ch.status !== "open") {
      bad(res, 412, "FAILED_PRECONDITION");
      return;
    }

    // Expired?
    const nowMs = Date.now();
    const expMs = new Date(ch.expiresAt).getTime();
    if (nowMs > expMs) {
      await db.ref("challenges/" + challengeId).update({
        status: "expired",
        reveal: true,
        expiredAt: new Date().toISOString(),
      });
      bad(res, 408, "DEADLINE_EXCEEDED");
      return;
    }

    // Participant?
    const list = ch.participantsCustomIds;
    if (!Array.isArray(list) || list.indexOf(customId) === -1) {
      bad(res, 403, "PERMISSION_DENIED", ["Not a participant"]);
      return;
    }

    // License: participant must be licensed for this bootcamp
    await assertLicenseActive(db, customId, ch.bootcamp);

    // Verify content signature (anti-tamper)
    const expected = hmac(
        CHALLENGE_SIGNING_SECRET.value(),
        ch.contentFingerprint,
    );
    if (!ch.contentFingerprint || !ch.signature) {
      bad(res, 412, "FAILED_PRECONDITION", ["Missing content signature"]);
      return;
    }
    if (expected !== ch.signature) {
      bad(res, 412, "FAILED_PRECONDITION", ["Signature mismatch"]);
      return;
    }

    const sessionSnap = await db.ref(
        "studentDrills/" + customId + "/" + sessionId,
    ).once("value");
    const session = sessionSnap.val();
    if (!session) {
      bad(res, 404, "DRILL_SESSION_NOT_FOUND");
      return;
    }
    if (session.status !== "submitted" || !session.result) {
      bad(res, 412, "DRILL_SESSION_NOT_SUBMITTED");
      return;
    }
    if (String(session.challengeId || "") !== challengeId) {
      bad(res, 403, "SESSION_CHALLENGE_MISMATCH");
      return;
    }
    if (String(session.bootcamp || "").toLowerCase() !==
        String(ch.bootcamp || "").toLowerCase()) {
      bad(res, 412, "SESSION_BOOTCAMP_MISMATCH");
      return;
    }

    const mini = summarizeSubmittedResult(session.result);
    if (mini.correct > mini.attempted || mini.attempted > mini.totalQ) {
      bad(res, 412, "INVALID_SERVER_RESULT");
      return;
    }

    // Resolve participant metadata from the server-owned profile.
    const meta = await resolveParticipantMeta(
        db,
        customId,
        undefined,
    );
    const usedSec = Math.round(mini.timeMs / 1000);

    // Write compatibility scalars plus the authoritative server result.
    const finishedAt = new Date().toISOString();
    /** @type {Record<string, unknown>} */
    const updates = {};
    updates["challengeResults/" + challengeId + "/" + customId] = {
      correct: mini.correct,
      wrong: mini.wrong,
      unanswered: mini.unanswered,
      timeMs: mini.timeMs,
      usedSec,
      points: mini.points,
      attempted: mini.attempted,
      totalQ: mini.totalQ,
      finishedAt: finishedAt,
      snapshot: session.result,
      sessionId,
      participant: {
        displayName: meta.displayName || "",
        avaterNumber: Number(meta.avatarNumber || 0),
        currentRank: meta.rankName || "",
      },
    };
    updates[
        "users/" + customId + "/userChallenges/" + challengeId + "/status"
    ] = "completed";
    updates[
        "users/" + customId + "/userChallenges/" + challengeId + "/completedAt"
    ] = finishedAt;

    await db.ref().update(updates);

    // If everyone is done → reveal + mark completed
    /** @type {string[]} */
    const participantIds = Array.isArray(
        ch.participantsCustomIds) /** @type {string[]} */ ?
  (ch.participantsCustomIds) :
  [];

    const doneFlags = await Promise.all(
        participantIds.map(async (/** @type {string} */ cid) => {
          const s = await db
              .ref("users/" + cid + "/userChallenges/" +
                challengeId + "/status")
              .once("value");
          return s.val() === "completed";
        }),
    );

    const allDone = doneFlags.every(Boolean);

    if (allDone) {
      await db.ref("challenges/" + challengeId).update({
        status: "completed",
        reveal: true,
        completedAt: new Date().toISOString(),
      });
    }

    res.status(200).json({ok: true, allDone: allDone});
  } catch (e) {
  /** @type {{ code?: unknown, message?: unknown }} */
    const maybe = (typeof e === "object" && e !== null) ? e : {};

    const code =
    Number.isInteger(maybe.code) ? /** @type {number} */ (maybe.code) : 500;

    const msg =
    typeof maybe.message === "string" ?
      maybe.message :
      (e instanceof Error ? e.message : "Internal error");

    res.status(code).json({error: msg});
  }
};
