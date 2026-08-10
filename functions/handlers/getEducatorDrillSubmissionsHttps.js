"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");

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
 *   uidToCustom/{uid}/educator = "educator_..."
 *
 * Legacy:
 *   uidToCustom/{uid} = "educator_..."
 *
 * @param {*} val uidToCustom node
 * @return {string}
 */
function normalizeUidToEducator(val) {
  if (!val) return "";
  if (typeof val === "string") return cleanStr(val, 120);
  if (typeof val === "object") return cleanStr(val.educator, 120);
  return "";
}

/**
 * Convert unknown value to object.
 *
 * @param {*} value Any value
 * @return {Object}
 */
function asObj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ?
    value :
    {};
}

/**
 * Build full student display name.
 *
 * @param {Object} student Student profile
 * @param {string} fallback Fallback name/id
 * @return {string}
 */
function studentDisplayName(student, fallback) {
  const first = cleanStr(student.firstName, 80);
  const last = cleanStr(student.lastName, 80);
  const full = `${first} ${last}`.trim();

  return full ||
    cleanStr(student.studentName, 160) ||
    cleanStr(student.displayName, 160) ||
    cleanStr(fallback, 160) ||
    "Student";
}

/**
 * Normalize summary object.
 *
 * @param {Object} summary Summary row
 * @return {Object}
 */
function normalizeSummary(summary) {
  const s = asObj(summary);

  const totalQ = Math.max(0, Number(s.totalQ || s.totalQuestions || 0));
  const attempted = Math.max(0, Number(s.attempted || 0));
  const correct = Math.max(0, Number(s.correct || 0));
  const wrong = Math.max(0, Number(s.wrong || attempted - correct || 0));
  const unanswered = Math.max(
      0, Number(s.unanswered || totalQ - attempted || 0));
  const usedSec = Math.max(0, Number(s.usedSec || s.timeSec || 0));
  const meanSec = Math.max(
      0,
      Number(
          s.meanSec || (attempted > 0 ? Math.floor(usedSec / attempted) : 0)),
  );
  const points = Math.max(0, Number(s.points || 0));

  return {
    totalQ,
    attempted,
    correct,
    wrong,
    unanswered,
    usedSec,
    meanSec,
    points,
    scorePct: totalQ > 0 ? Math.round((correct * 10000) / totalQ) / 100 : 0,
    accuracyPct: attempted > 0 ?
      Math.round((correct * 10000) / attempted) / 100 :
      0,
  };
}

/**
 * Count assigned students by status.
 *
 * @param {Array<Object>} rows Student rows
 * @return {Object}
 */
function countStatuses(rows) {
  const out = {
    assigned: 0,
    started: 0,
    submitted: 0,
    late: 0,
    other: 0,
  };

  for (const row of rows) {
    const status = cleanStr(row.status, 40).toLowerCase();

    if (status === "assigned") out.assigned++;
    else if (status === "started") out.started++;
    else if (status === "submitted") out.submitted++;
    else if (status === "late") out.late++;
    else out.other++;
  }

  return out;
}

/**
 * Sort submission rows.
 *
 * submitted first, then started/locked, then assigned, then late/other.
 *
 * @param {Object} a Row A
 * @param {Object} b Row B
 * @return {number}
 */
function compareSubmissionRows(a, b) {
  const rank = {
    submitted: 0,
    started: 1,
    late: 2,
    assigned: 3,
  };

  const ar = rank[a.status] === undefined ? 9 : rank[a.status];
  const br = rank[b.status] === undefined ? 9 : rank[b.status];

  if (ar !== br) return ar - br;

  const at = Date.parse(a.submittedAt || a.startedAt || a.assignedAt || "");
  const bt = Date.parse(b.submittedAt || b.startedAt || b.assignedAt || "");

  const av = Number.isNaN(at) ? 0 : at;
  const bv = Number.isNaN(bt) ? 0 : bt;

  if (av !== bv) return bv - av;

  return String(a.studentName || "").localeCompare(String(b.studentName || ""));
}

/**
 * Check educator can view this drill's submissions.
 *
 * V1 rule:
 * - creator can view
 * - adminAccess can view
 * - superAdmin can view
 *
 * @param {Object} drill Drill row
 * @param {string} educatorId Educator id
 * @param {Object} schoolEducator School educator row
 * @return {boolean}
 */
function educatorCanViewDrill(drill, educatorId, schoolEducator) {
  if (!drill || typeof drill !== "object") return false;

  if (schoolEducator && schoolEducator.superAdmin === true) return true;
  if (schoolEducator && schoolEducator.adminAccess === true) return true;

  const creator = cleanStr(drill.createdByEducatorId, 120);
  return creator && creator === educatorId;
}

/**
 * Resolve educator context.
 *
 * @param {Object} db RTDB
 * @param {string} fbUid Firebase uid
 * @return {Promise<{
 * educatorId:string, schoolId:string, schoolEducator:Object}>}
 */
async function resolveEducatorContext(db, fbUid) {
  const mapSnap = await db.ref(`uidToCustom/${fbUid}`).once("value");
  const educatorId = normalizeUidToEducator(mapSnap.val());

  if (!educatorId) {
    return {
      educatorId: "",
      schoolId: "",
      schoolEducator: {},
    };
  }

  const educatorSnap = await db.ref(`educators/${educatorId}`).once("value");
  const educator = asObj(educatorSnap.val());

  const schoolId = cleanStr(educator.schoolID || educator.schoolId, 120);

  if (!schoolId) {
    return {
      educatorId,
      schoolId: "",
      schoolEducator: {},
    };
  }

  const schoolEducatorSnap = await db
      .ref(`schools/${schoolId}/educators/${educatorId}`)
      .once("value");

  const schoolEducator = asObj(schoolEducatorSnap.val());

  return {
    educatorId,
    schoolId,
    schoolEducator,
  };
}

/**
 * Get educator drill submission list.
 *
 * Request:
 * {
 *   drillId: "..."
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   drill: {...},
 *   students: [...]
 * }
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>}
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const body = req.body || {};
    const drillId = cleanStr(body.drillId, 140);

    if (!drillId) {
      return bad(res, 400, "MISSING_DRILL_ID");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();

    const ctx = await resolveEducatorContext(db, callerFbUid);

    if (!ctx.educatorId) {
      return bad(res, 403, "NOT_AN_EDUCATOR");
    }

    if (!ctx.schoolId) {
      return bad(res, 403, "EDUCATOR_HAS_NO_SCHOOL");
    }

    const approvalStatus = cleanStr(
        ctx.schoolEducator.approvalStatus || ctx.schoolEducator.status,
        40,
    ).toLowerCase();

    if (
      approvalStatus &&
      approvalStatus !== "approved" &&
      ctx.schoolEducator.approved !== true
    ) {
      return bad(res, 403, "EDUCATOR_NOT_APPROVED");
    }

    const drillSnap = await db
        .ref(`schools/${ctx.schoolId}/educatorDrills/${drillId}`)
        .once("value");

    const drill = asObj(drillSnap.val());

    if (!drill || Object.keys(drill).length < 1) {
      return bad(res, 404, "DRILL_NOT_FOUND");
    }

    if (!educatorCanViewDrill(drill, ctx.educatorId, ctx.schoolEducator)) {
      return bad(res, 403, "EDUCATOR_CANNOT_VIEW_DRILL_SUBMISSIONS");
    }

    const assignedMap = asObj(drill.assignedStudents);
    const rows = [];

    const studentIds = Object.keys(assignedMap);

    for (const studentId of studentIds) {
      const assigned = asObj(assignedMap[studentId]);
      const status = cleanStr(assigned.status, 40).toLowerCase() || "assigned";

      let student = {};
      try {
        const studentSnap = await db.ref(`users/${studentId}`).once("value");
        student = asObj(studentSnap.val());
      } catch (_) {
        student = {};
      }

      const summary = normalizeSummary(assigned.summary || {});

      rows.push({
        studentId,
        studentName: studentDisplayName(student, studentId),
        firstName: cleanStr(student.firstName, 80),
        lastName: cleanStr(student.lastName, 80),
        avatarNumber: Number(student.avaterNumber || student.avatarNumber || 1),

        status,
        assignedAt: cleanStr(assigned.assignedAt, 80),
        startedAt: cleanStr(assigned.startedAt, 80),
        submittedAt: cleanStr(assigned.submittedAt, 80),
        attemptId: cleanStr(assigned.attemptId, 160),

        summary,
      });
    }

    rows.sort(compareSubmissionRows);

    const statusCounts = countStatuses(rows);

    return res.status(200).json({
      ok: true,
      schoolId: ctx.schoolId,
      drill: {
        drillId,
        bootcamp: cleanStr(drill.bootcamp, 40).toLowerCase(),
        title: cleanStr(drill.title, 180) || "Drill",
        instructions: cleanStr(drill.instructions, 500),
        status: cleanStr(drill.status, 40).toLowerCase(),
        createdByEducatorId: cleanStr(drill.createdByEducatorId, 120),
        createdByName: cleanStr(drill.createdByName, 160),
        assignedCount: studentIds.length,
        startedCount: statusCounts.started,
        submittedCount: statusCounts.submitted,
        lateCount: statusCounts.late,
        dueAt: cleanStr(drill.dueAt, 80),
        publishedAt: cleanStr(drill.publishedAt, 80),
      },
      statusCounts,
      students: rows,
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
