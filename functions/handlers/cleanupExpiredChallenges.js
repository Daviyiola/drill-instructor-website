// @ts-check
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {onSchedule} = require("firebase-functions/v2/scheduler");

/** @typedef {import('firebase-admin').database.Database} Database */
/**
 * Shape of a challenge document in /challenges/{challengeId}
 * @typedef {Object} ChallengeDoc
 * @property {string} challengeId
 * @property {string} bootcamp
 * @property {string} datasetVersion
 * @property {Array<{subject:string, questionIds:number[]}>} subjects
 * @property {string} createdAt           // ISO
 * @property {string} expiresAt           // ISO
 * @property {string} createdByCustomId
 * @property {string[]} participantsCustomIds
 * @property {Object<string, boolean>} [participantsUidsMap]
 * @property {Object<string, string>} [participantsUidsByCustomId]
 * @property {string} contentFingerprint
 * @property {string} signature
 * @property {"open"|"completed"|"expired"} status
 * @property {boolean} reveal
 * @property {string} [completedAt]
 * @property {string} [expiredAt]
 */

/** Utility: ISO string for "now".
 * @return {string}
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Mark a single challenge as expired + revealed,
 * and expire all non-completed inbox rows.
 * Safe to run repeatedly (idempotent).
 * @param {Database} db
 * @param {string} challengeId
 * @param {ChallengeDoc} ch
 * @return {Promise<void>}
 */
async function expireOneChallenge(db, challengeId, ch) {
  const ts = nowIso();

  /** @type {Record<string, unknown>} */
  const updates = {};

  // 1) Challenge doc: only flip if not already completed/expired
  if (ch.status !== "expired") {
    updates[`challenges/${challengeId}/status`] = "expired";
  }
  updates[`challenges/${challengeId}/reveal`] = true; // ensure reveal
  if (!ch.expiredAt) {
    updates[`challenges/${challengeId}/expiredAt`] = ts;
  }

  // 2) Participant inbox rows → set status "expired" if still open
  const participants = Array.isArray(ch.participantsCustomIds) ?
  ch.participantsCustomIds : [];
  for (const cid of participants) {
    const base = `users/${cid}/userChallenges/${challengeId}`;
    // We do a small read to decide whether to expire,
    // to avoid clobbering completed rows.
    // Batch reads can be heavy; in practice this is fine
    // because N (participants) is small.
    // If you want to avoid reads, you can unconditionally
    // write a merge-safe object with a guard,
    // but RTDB doesn't support server-side conditional merges.
    // We'll keep reads minimal with Promise.all below.
    updates[`${base}/expiredAt`] = ts; // harmless if already set; idempotent
  }

  // Commit challenge-level updates first (cheap)
  await db.ref().update(updates);

  // Read all inbox rows in parallel, then patch only open ones
  const rowSnaps = await Promise.all(
      participants.map((cid) =>
        db.ref(`users/${cid}/userChallenges/${challengeId}`).once("value"),
      ),
  );

  /** @type {Record<string, unknown>} */
  const inboxPatches = {};
  rowSnaps.forEach((snap, i) => {
    const cid = participants[i];
    const val = snap.val() || {};
    const status = val.status;
    // Treat these as "open" and expire them
    if (status === "sent" || status === "pending" || status === "accepted") {
      inboxPatches[
          `users/${cid}/userChallenges/${challengeId}/status`] = "expired";
      // Ensure reveal is visible in inbox if your client uses it
      inboxPatches[`users/${cid}/userChallenges/${challengeId}/reveal`] = true;
      inboxPatches[`users/${cid}/userChallenges/${challengeId}/expiredAt`] = ts;
    }
  });

  if (Object.keys(inboxPatches).length) {
    await db.ref().update(inboxPatches);
  }
}

/**
 * Housekeep dedupe keys whose expiresAt is in the past.
 * Keys live at /challengeKeys/{dedupeKey} = {challengeId, expiresAt}
 * @param {Database} db
 * @param {string} nowIsoStr - ISO timestamp used as "now".
 * @return {Promise<void>}
 */
async function cleanupExpiredKeys(db, nowIsoStr) {
  // Query all keys whose expiresAt <= now
  const qs = await db
      .ref("challengeKeys")
      .orderByChild("expiresAt")
      .endAt(nowIsoStr)
      .once("value");

  const toRemove = qs.val() || {};
  if (!toRemove || !Object.keys(toRemove).length) return;

  /** @type {Record<string, null>} */
  const del = {};
  Object.keys(toRemove).forEach((k) => {
    del[`challengeKeys/${k}`] = null;
  });
  await db.ref().update(del);
}

/**
 * Scheduled cleanup:
 * - Find open challenges whose expiresAt <= now and mark them expired + reveal.
 * - Expire all non-completed inbox rows.
 * - Remove expired dedupe keys from /challengeKeys.
 *
 * Runs every 60 minutes.
 */
exports.cleanupExpiredChallenges = onSchedule(
    {
      schedule: "every 60 minutes",
      timeZone: "America/New_York",
      region: "us-central1",
      timeoutSeconds: 60,
      memory: "256MiB",
    },
    async () => {
      const db = getDatabase();
      const now = nowIso();

      // 1) Find challenges that are past due
      // We query by expiresAt (ISO), which sorts
      // lexicographically in time order.
      const snap = await db
          .ref("challenges")
          .orderByChild("expiresAt")
          .endAt(now)
          .once("value");

      const candidates = snap.val() || {};
      const ids = Object.keys(candidates);

      // 2) Process only those that are still "open"
      const work = ids
          .map((id) => /** @type {ChallengeDoc} */ (candidates[id]))
          .filter((ch) => ch && ch.status === "open");

      // Process in bounded waves. The query intentionally includes every due
      // challenge: limiting before filtering by status lets already-expired
      // rows permanently hide older open rows from future runs.
      const CONCURRENCY = 20;
      for (let i = 0; i < work.length; i += CONCURRENCY) {
        await Promise.all(
            work.slice(i, i + CONCURRENCY)
                .map((ch) => expireOneChallenge(db, ch.challengeId, ch)),
        );
      }

      // 3) Clear out stale dedupe keys
      await cleanupExpiredKeys(db, now);
    },
);
