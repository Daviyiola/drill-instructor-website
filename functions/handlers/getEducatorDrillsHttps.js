"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {
  bad,
  cleanStr,
  errText,
  readEducatorSchoolContext,
  sanitizeDrillListRow,
} = require("./_schoolDrillsAccess");

/**
 * Return true if row belongs in the requested bootcamp.
 *
 * @param {Object} row Drill row
 * @param {string} bootcamp Requested bootcamp
 * @return {boolean} True if included
 */
function drillMatchesBootcamp(row, bootcamp) {
  if (!bootcamp) return true;

  const rowBootcamp = cleanStr(row && row.bootcamp, 40).toLowerCase();
  return rowBootcamp === bootcamp;
}

/**
 * Return the authorized directory scope for this caller.
 *
 * @param {string} requested Requested scope
 * @param {Object} schoolEducator School educator permission row
 * @return {string} "own" or "school"
 */
function resolveDrillScope(requested, schoolEducator) {
  const wantsSchool = cleanStr(requested, 20).toLowerCase() === "school";
  const isAdmin = schoolEducator &&
    (schoolEducator.superAdmin === true ||
      schoolEducator.adminAccess === true);

  return wantsSchool && isAdmin ? "school" : "own";
}

/**
 * Return true if row belongs in the caller's authorized directory scope.
 *
 * @param {Object} row Drill row
 * @param {string} educatorId Caller educator id
 * @param {Object} schoolEducator School educator permission row
 * @param {string} scope Resolved directory scope
 * @return {boolean} True if visible
 */
function drillVisibleToCaller(row, educatorId, schoolEducator, scope) {
  if (resolveDrillScope(scope, schoolEducator) === "school") return true;

  const createdBy = cleanStr(row && row.createdByEducatorId, 120);
  return createdBy === educatorId;
}

/**
 * Sort drill rows for dashboard.
 *
 * @param {Object} a First row
 * @param {Object} b Second row
 * @return {number} Sort result
 */
function sortDrills(a, b) {
  const statusRank = {
    draft: 0,
    published: 1,
    closed: 2,
  };

  const ar = statusRank[a.status] !== undefined ? statusRank[a.status] : 9;
  const br = statusRank[b.status] !== undefined ? statusRank[b.status] : 9;

  if (ar !== br) return ar - br;

  const ad = Date.parse(a.updatedAt || a.publishedAt || a.createdAt || "");
  const bd = Date.parse(b.updatedAt || b.publishedAt || b.createdAt || "");

  const ams = Number.isNaN(ad) ? 0 : ad;
  const bms = Number.isNaN(bd) ? 0 : bd;

  return bms - ams;
}

/**
 * Return true if due date is in the past.
 *
 * @param {string} dueAt Due date ISO/string
 * @return {boolean}
 */
function isPastDue(dueAt) {
  const raw = cleanStr(dueAt, 80);
  if (!raw) return false;

  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return false;

  return Date.now() > ms;
}

/**
 * Compute live drill stats from assignedStudents.
 *
 * @param {Object} row Drill row
 * @return {Object}
 */
function computeDrillListStats(row) {
  const assignedMap =
    row && row.assignedStudents && typeof row.assignedStudents === "object" ?
      row.assignedStudents :
      {};

  const stats = {
    assignedCount: 0,
    startedCount: 0,
    submittedCount: 0,
    lateCount: 0,
    assignedOnlyCount: 0,
    averageAccuracy: 0,
    averageTimeSec: 0,
  };

  let accuracySum = 0;
  let accuracyN = 0;
  let meanSecSum = 0;
  let meanSecN = 0;

  for (const studentId of Object.keys(assignedMap)) {
    const assigned = assignedMap[studentId] || {};
    const status = cleanStr(assigned.status, 40).toLowerCase() || "assigned";

    stats.assignedCount += 1;

    if (status === "submitted") {
      stats.submittedCount += 1;
    } else if (status === "started") {
      stats.startedCount += 1;
    } else if (status === "late") {
      stats.lateCount += 1;
    } else {
      stats.assignedOnlyCount += 1;
    }

    const summary =
      assigned.summary && typeof assigned.summary === "object" ?
        assigned.summary :
        {};

    if (status === "submitted") {
      const acc = Number(summary.accuracyPct || 0);
      const meanSec = Number(summary.meanSec || 0);

      if (!Number.isNaN(acc)) {
        accuracySum += acc;
        accuracyN += 1;
      }

      if (!Number.isNaN(meanSec)) {
        meanSecSum += meanSec;
        meanSecN += 1;
      }
    }
  }

  stats.averageAccuracy =
    accuracyN > 0 ? Math.round((accuracySum / accuracyN) * 100) / 100 : 0;

  stats.averageTimeSec =
    meanSecN > 0 ? Math.round(meanSecSum / meanSecN) : 0;

  return stats;
}

/**
 * HTTPS handler to get educator drills for the caller's school.
 *
 * Request body:
 *   {
 *     bootcamp: "sat"
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     school: {...},
 *     caller: {...},
 *     bootcamp: "sat",
 *     drills: [...]
 *   }
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const body = req.body || {};
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();

    const ctx = await readEducatorSchoolContext(db, callerFbUid, bootcamp);

    if (ctx.error) {
      return bad(res, 403, ctx.error, ctx.details || null);
    }

    const {
      educatorId,
      educatorName,
      schoolId,
      schoolNorm,
      schoolEducator,
    } = ctx;
    const scope = resolveDrillScope(body.scope, schoolEducator);

    const drillsSnap = await db
        .ref(`schools/${schoolId}/educatorDrills`)
        .once("value");

    const drillsMap = drillsSnap.val() || {};
    const drills = [];

    for (const drillId of Object.keys(drillsMap)) {
      const row = drillsMap[drillId] || {};

      if (!drillMatchesBootcamp(row, bootcamp)) continue;
      if (!drillVisibleToCaller(
          row,
          educatorId,
          schoolEducator,
          scope,
      )) continue;

      const stats = computeDrillListStats(row);
      const cleanRow = sanitizeDrillListRow(drillId, row);
      cleanRow.archived =
        cleanRow.status === "closed" &&
        Boolean(row.archivedBy && row.archivedBy[educatorId] === true);

      const assignedCount = Number(stats.assignedCount || 0);
      const submittedCount = Number(stats.submittedCount || 0);
      const startedCount = Number(stats.startedCount || 0);
      const lateCount = Number(stats.lateCount || 0);

      cleanRow.assignedCount = assignedCount;
      cleanRow.startedCount = startedCount;
      cleanRow.submittedCount = submittedCount;
      cleanRow.lateCount = lateCount;
      cleanRow.averageAccuracy = stats.averageAccuracy;
      cleanRow.averageTimeSec = stats.averageTimeSec;

      // Informational only. Never rewrite lifecycle status.
      cleanRow.isPastDue =
    cleanRow.status === "published" &&
    isPastDue(cleanRow.dueAt);

      cleanRow.isFullySubmitted =
    assignedCount > 0 &&
    submittedCount >= assignedCount;

      drills.push(cleanRow);
    }

    drills.sort(sortDrills);

    return res.status(200).json({
      ok: true,
      caller: {
        educatorId,
        educatorName,
        adminAccess: schoolEducator.adminAccess === true,
        superAdmin: schoolEducator.superAdmin === true,
      },
      school: {
        schoolId,
        name: schoolNorm.name,
        country: schoolNorm.country,
        state: schoolNorm.state,
      },
      bootcamp,
      scope,
      drills,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    const details = errText(e);

    if (
      details.includes("auth/id-token-expired") ||
      details.includes("Firebase ID token has expired")
    ) {
      return bad(res, 401, "ID_TOKEN_EXPIRED", details);
    }

    if (
      details.includes("auth/argument-error") ||
      details.includes("Decoding Firebase ID token failed")
    ) {
      return bad(res, 401, "INVALID_ID_TOKEN", details);
    }

    return bad(res, 500, "INTERNAL", details);
  }
};

exports.drillVisibleToCaller = drillVisibleToCaller;
exports.resolveDrillScope = resolveDrillScope;
