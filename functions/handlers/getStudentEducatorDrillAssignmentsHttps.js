"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {assertLicenseActive} = require("./_license");

/**
 * Send standardized error response.
 *
 * @param {Object} res Express response
 * @param {number} code HTTP status code
 * @param {string} msg Error message
 * @param {*} [details] Optional details
 * @return {Object}
 */
function bad(res, code, msg, details) {
  return res.status(code).json({
    ok: false,
    error: msg,
    details: details || null,
  });
}

/**
 * Clean and truncate string.
 *
 * @param {*} v Input value
 * @param {number} maxLen Maximum length
 * @return {string}
 */
function cleanStr(v, maxLen) {
  const s = (v || "").toString().trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Safe text from unknown errors.
 *
 * @param {unknown} e Error
 * @return {string}
 */
function errText(e) {
  if (!e) return "Internal error";
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const anyErr = e;
    if (typeof anyErr.message === "string" && anyErr.message) {
      return anyErr.message;
    }
  }
  try {
    return JSON.stringify(e);
  } catch (_) {
    return String(e);
  }
}

/**
 * Supports both old and new uidToCustom shapes.
 *
 * New:
 *   uidToCustom/{uid}/student = "user_..."
 *
 * Legacy possible:
 *   uidToCustom/{uid} = "user_..."
 *
 * @param {*} val uidToCustom node
 * @return {string}
 */
function normalizeUidToStudent(val) {
  if (!val) return "";
  if (typeof val === "string") return cleanStr(val, 120);
  if (typeof val === "object") return cleanStr(val.student, 120);
  return "";
}

/**
 * Return true if assignment should be shown.
 *
 * @param {Object} row Assignment row
 * @return {boolean} True if visible
 */
function isVisibleAssignment(row) {
  if (!row || typeof row !== "object") return false;

  const status = cleanStr(row.status, 40).toLowerCase();

  // Keep submitted visible so student can see that it is done.
  // Hide archived/cancelled later if we add those statuses.
  return status === "assigned" ||
    status === "started" ||
    status === "submitted" ||
    status === "late";
}

/**
 * Normalize assignment card.
 *
 * @param {string} drillId Drill id
 * @param {Object} row Assignment row
 * @return {Object} Assignment card
 */
function sanitizeAssignment(drillId, row) {
  return {
    type: "educator_drill",
    drillId,
    schoolId: cleanStr(row.schoolId, 120),
    bootcamp: cleanStr(row.bootcamp, 40).toLowerCase(),
    title: cleanStr(row.title, 180) || "Assigned Drill",
    instructions: cleanStr(row.instructions, 300),
    createdByEducatorId: cleanStr(row.createdByEducatorId, 120),
    createdByName: cleanStr(row.createdByName, 160) || "Educator",
    assignedAt: cleanStr(row.assignedAt, 80),
    dueAt: cleanStr(row.dueAt, 80),
    status: cleanStr(row.status, 40).toLowerCase() || "assigned",
    startedAt: cleanStr(row.startedAt, 80),
    submittedAt: cleanStr(row.submittedAt, 80),
    sessionId: cleanStr(row.sessionId, 140),
    attemptId: cleanStr(row.attemptId, 140),
    questionCount: Number(row.questionCount || 0),
    totalTimeMin: Number(row.totalTimeMin || 0),
    subjects: Array.isArray(row.subjects) ? row.subjects
        .map((value) => cleanStr(value, 80)).filter(Boolean) : [],
  };
}

/**
 * Sort assignments.
 *
 * Priority:
 * - unfinished first
 * - due soon first
 * - then newest assigned
 *
 * @param {Object} a Assignment
 * @param {Object} b Assignment
 * @return {number} Sort order
 */
function compareAssignments(a, b) {
  const aDone = a.status === "submitted" ? 1 : 0;
  const bDone = b.status === "submitted" ? 1 : 0;
  if (aDone !== bDone) return aDone - bDone;

  const aDue = Date.parse(a.dueAt || "");
  const bDue = Date.parse(b.dueAt || "");

  const aHasDue = Number.isNaN(aDue) ? 0 : 1;
  const bHasDue = Number.isNaN(bDue) ? 0 : 1;

  if (aHasDue !== bHasDue) return bHasDue - aHasDue;

  if (aHasDue && bHasDue && aDue !== bDue) {
    return aDue - bDue;
  }

  const aAssigned = Date.parse(a.assignedAt || "");
  const bAssigned = Date.parse(b.assignedAt || "");

  const aa = Number.isNaN(aAssigned) ? 0 : aAssigned;
  const bb = Number.isNaN(bAssigned) ? 0 : bAssigned;

  return bb - aa;
}

/**
 * Get student educator drill assignments.
 *
 * Request:
 * {
 *   bootcamp: "sat" // optional
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   studentId,
 *   assignments: [...]
 * }
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

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();

    const mapSnap = await db.ref(`uidToCustom/${callerFbUid}`).once("value");
    const studentId = normalizeUidToStudent(mapSnap.val());

    if (!studentId) {
      return bad(res, 403, "NOT_A_STUDENT");
    }

    const bootcampFilter = cleanStr(
        req.body && req.body.bootcamp,
        40,
    ).toLowerCase();

    if (!bootcampFilter) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    await assertLicenseActive(db, studentId, bootcampFilter);

    const assignmentsSnap = await db
        .ref(`users/${studentId}/assignedDrills`)
        .once("value");

    const rows = assignmentsSnap.val() || {};
    const assignments = [];

    for (const drillId of Object.keys(rows)) {
      const row = rows[drillId];

      if (!isVisibleAssignment(row)) continue;

      const item = sanitizeAssignment(drillId, row);

      if (bootcampFilter && item.bootcamp !== bootcampFilter) continue;

      assignments.push(item);
    }

    assignments.sort(compareAssignments);

    return res.status(200).json({
      ok: true,
      studentId,
      bootcamp: bootcampFilter,
      assignments,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    const details = errText(e);

    if ([400, 403, 409].includes(Number(e && e.code))) {
      return bad(res, Number(e.code), "SUBSCRIPTION_REQUIRED", details);
    }

    if (Number(e && e.code) === 401) {
      return bad(res, 401, "AUTHENTICATION_REQUIRED");
    }

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
