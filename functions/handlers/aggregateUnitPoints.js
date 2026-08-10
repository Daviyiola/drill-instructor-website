// @ts-check
"use strict";

const {onSchedule} = require("firebase-functions/v2/scheduler");
const {getDatabase} = require("firebase-admin/database");

/**
 * @typedef {import("firebase-admin").database.Database} Database
 */

/**
 * Safe number.
 * @param {unknown} v Any value
 * @return {number} Number or 0
 */
function num(v) {
  return (typeof v === "number" && Number.isFinite(v)) ? v : 0;
}

/**
 * Clamp a number.
 * @param {number} v Value
 * @param {number} lo Lower bound
 * @param {number} hi Upper bound
 * @return {number} Clamped
 */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Normalize to 1..100 (inclusive-ish) using min/max scaling.
 * If all values are equal, returns 50 for everyone.
 * @param {number} v Value
 * @param {number} minV Min
 * @param {number} maxV Max
 * @return {number} Score in [1,100]
 */
function toScore100(v, minV, maxV) {
  const span = maxV - minV;
  if (!(span > 0)) return 50;
  const t = (v - minV) / span;
  return clamp(1 + 99 * t, 1, 100);
}

/**
 * Normalize a custom user id like "user_email@gmailcom".
 * @param {unknown} v Any input
 * @return {string} Clean id or empty string
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
 * Compute bayesian per-member average with shrinkage.
 * bayesAvg = (points + k * globalAvg) / (members + k)
 * @param {number} points Unit points
 * @param {number} members Unit members
 * @param {number} globalAvg Global avg points per member
 * @param {number} k Shrink strength
 * @return {number} Bayesian avg
 */
function bayesAvg(points, members, globalAvg, k) {
  const kk = Math.max(0, k);
  const denom = Math.max(1e-9, members + kk);
  return (points + kk * globalAvg) / denom;
}

/**
 * Returns object keys safely.
 * @param {unknown} obj Any
 * @return {string[]} Keys
 */
function keys(obj) {
  return (obj && typeof obj === "object") ? Object.keys(obj) : [];
}

/**
 * Scheduled aggregation:
 * - Computes totalPoints + memberCount for platoon, battalion, corps
 * - Computes Bayesian shrinkage score per level
 * - Normalizes Bayesian values into 1..100 "score"
 */
exports.aggregateUnitPoints = onSchedule(
    {
      schedule: "every 60 minutes",
      timeZone: "UTC",
      region: "us-central1",
      memory: "256MiB",
      timeoutSeconds: 60,
    },
    async () => {
    /** @type {Database} */
      const db = getDatabase();

      const [corpsSnap, usersSnap] = await Promise.all([
        db.ref("units/corps").once("value"),
        db.ref("users").once("value"),
      ]);

      /** @type {Record<string, any>} */
      const corpsData = corpsSnap.val() || {};
      /** @type {Record<string, any>} */
      const usersData = usersSnap.val() || {};

      /**
     * Get user total points from in-memory snapshot.
     * @param {string} uid Custom user id
     * @return {number} Points
     */
      function getUserPoints(uid) {
        const u = usersData[uid];
        return num(u && u.totalPoints);
      }

      const K = {
        platoon: 100,
        battalion: 50000,
        corps: 1500000,
      };

      /** @type {Record<string, any>} */
      const updates = {};

      // Store raw bayesAvg values for normalization after traversal.
      /** @type {Array<{
       * path: string, level: "platoon"|"battalion"|"corps", bayes: number}>} */
      const bayesList = [];

      // Global totals per level for globalAvg calculation.
      const global = {
        platoon: {points: 0, members: 0},
        battalion: {points: 0, members: 0},
        corps: {points: 0, members: 0},
      };

      // First pass:
      // compute totalPoints + memberCount, and accumulate global totals.
      for (const corpsName of keys(corpsData)) {
        const battalions = corpsData[corpsName];
        if (!battalions || typeof battalions !== "object") continue;

        let corpsTotal = 0;
        let corpsMembersCount = 0;

        // Prevent double counting across levels within this corps.
        const seenUsers = new Set();

        for (const battalionName of keys(battalions)) {
          if (battalionName === "totalPoints" || battalionName === "members") {
            continue;
          }

          const battalion = battalions[battalionName];
          if (!battalion || typeof battalion !== "object") continue;

          let battalionTotal = 0;
          let battalionMembersCount = 0;

          // Platoons
          for (const platoonName of keys(battalion)) {
            if (platoonName === "totalPoints" || platoonName === "members") {
              continue;
            }

            const platoon = battalion[platoonName];
            if (!platoon || typeof platoon !== "object") continue;

            let platoonTotal = 0;

            const memberObj = platoon.members || {};
            const memberIds = keys(memberObj).filter((
                uid) => memberObj[uid] === true);

            for (const uidRaw of memberIds) {
              const uid = normalizeCustomId(uidRaw);
              if (!uid) continue;
              platoonTotal += getUserPoints(uid);
              // For this corps traversal, mark as seen.
              seenUsers.add(uid);
            }

            const platoonMemberCount = memberIds
                .map((u) => normalizeCustomId(u))
                .filter((u) => !!u).length;

            battalionTotal += platoonTotal;
            battalionMembersCount += platoonMemberCount;

            updates[
                `units/corps/${corpsName}/` +
                `${battalionName}/${platoonName}/totalPoints`
            ] = platoonTotal;

            updates[
                `units/corps/${corpsName}/` +
                `${battalionName}/${platoonName}/memberCount`
            ] = platoonMemberCount;

            global.platoon.points += platoonTotal;
            global.platoon.members += platoonMemberCount;
          }

          // Battalion-level members (not already counted at platoon)
          const battalionMemberObj = battalion.members || {};
          const battalionMemberIds = keys(battalionMemberObj).filter(
              (uid) => battalionMemberObj[uid] === true,
          );

          for (const uidRaw of battalionMemberIds) {
            const uid = normalizeCustomId(uidRaw);
            if (!uid) continue;
            if (seenUsers.has(uid)) continue;

            battalionTotal += getUserPoints(uid);
            battalionMembersCount += 1;
            seenUsers.add(uid);
          }

          updates[`units/corps/${corpsName}/`+
            `${battalionName}/totalPoints`] = battalionTotal;
          updates[`units/corps/${corpsName}/`+
            `${battalionName}/memberCount`] = battalionMembersCount;

          global.battalion.points += battalionTotal;
          global.battalion.members += battalionMembersCount;

          corpsTotal += battalionTotal;
          corpsMembersCount += battalionMembersCount;
        }

        // Corps-level members (not already counted)
        const corpsMemberObj = battalions.members || {};
        const corpsMemberIds = keys(
            corpsMemberObj).filter((uid) => corpsMemberObj[uid] === true);

        for (const uidRaw of corpsMemberIds) {
          const uid = normalizeCustomId(uidRaw);
          if (!uid) continue;
          if (seenUsers.has(uid)) continue;

          corpsTotal += getUserPoints(uid);
          corpsMembersCount += 1;
          seenUsers.add(uid);
        }

        updates[`units/corps/${corpsName}/totalPoints`] = corpsTotal;
        updates[`units/corps/${corpsName}/memberCount`] = corpsMembersCount;

        global.corps.points += corpsTotal;
        global.corps.members += corpsMembersCount;
      }

      const globalAvg = {
        platoon: global.platoon.points / Math.max(1, global.platoon.members),
        battalion: global.battalion.points / Math.max(
            1, global.battalion.members),
        corps: global.corps.points / Math.max(1, global.corps.members),
      };

      // Second pass: compute bayesAvg per unit
      // (needs memberCount + totalPoints)
      console.log("Bayesian rankings snapshot:", bayesList.slice(0, 10));

      const platoonBayes = [];
      const battalionBayes = [];
      const corpsBayes = [];

      for (const path of Object.keys(updates)) {
        if (!path.endsWith("/totalPoints")) continue;

        const basePath = path.slice(0, -("/totalPoints".length));
        const points = num(updates[path]);
        const members = num(updates[`${basePath}/memberCount`]);

        const parts = basePath.split("/").filter((p) => p.length);

        let level = "corps";
        if (parts.length === 4) level = "battalion";
        if (parts.length === 5) level = "platoon";

        // Hard rule: empty units should not get rewarded
        if (members <= 0) {
          updates[`${basePath}/bayesAvg`] = 0;
          updates[`${basePath}/score`] = 0;
          continue;
        }

        if (level === "platoon") {
          const b = bayesAvg(points, members, globalAvg.platoon, K.platoon);
          platoonBayes.push({path: basePath, bayes: b, members: members});
        } else if (level === "battalion") {
          const b = bayesAvg(points, members, globalAvg.battalion, K.battalion);
          battalionBayes.push({path: basePath, bayes: b, members: members});
        } else {
          const b = bayesAvg(points, members, globalAvg.corps, K.corps);
          corpsBayes.push({path: basePath, bayes: b, members: members});
        }
      }


      /**
 * Write normalized scores for one level.
 * Excludes memberCount = 0 from scaling and assigns them score = 0.
 * Also guards against tiny spans that cause extreme 1..100 jumps.
 * @param {Array<{path: string, bayes: number, members: number}>} arr List
 */
      function writeScores(arr) {
        if (!arr.length) return;

        // Separate non-empty vs empty
        const nonEmpty = arr.filter((x) => num(x.members) > 0);
        const empty = arr.filter((x) => num(x.members) <= 0);

        // Empty units always score 0 (or set to 1 if you prefer)
        for (const it of empty) {
          updates[`${it.path}/score`] = 0;
          updates[`${it.path}/bayesAvg`] = it.bayes;
        }

        // If nothing non-empty, stop
        if (!nonEmpty.length) return;

        // Compute min/max on non-empty only
        let minV = nonEmpty[0].bayes;
        let maxV = nonEmpty[0].bayes;

        for (const it of nonEmpty) {
          if (it.bayes < minV) minV = it.bayes;
          if (it.bayes > maxV) maxV = it.bayes;
        }

        // Guard against tiny ranges
        const span = maxV - minV;
        const minSpan = 1; // 1 point of bayesAvg range minimum. You can tune
        const safeMin = minV;
        const safeMax = (span < minSpan) ? (minV + minSpan) : maxV;

        for (const it of nonEmpty) {
          const score = toScore100(it.bayes, safeMin, safeMax);
          updates[`${it.path}/score`] = score;
          updates[`${it.path}/bayesAvg`] = it.bayes;
        }
      }


      writeScores(platoonBayes);
      writeScores(battalionBayes);
      writeScores(corpsBayes);

      // One atomic update.
      await db.ref().update(updates);
      console.log("Aggregation + Bayesian scoring complete.");
    },
);
