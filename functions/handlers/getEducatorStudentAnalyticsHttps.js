"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {aggregateAnalytics} = require("./_analytics");
const {buildCatalog} = require("./_studentDrill");
const {
  bad,
  cleanStr,
  collectCandidateStudentIds,
  educatorHasBootcampAccess,
  errText,
  hydrateAllowedStudents,
  isActivePlan,
  normalizeSchool,
  normalizeUidToEducator,
  planHasBootcamp,
} = require("./_schoolAdminAccess");

/**
 * Resolve calling educator and school from Firebase UID.
 *
 * @param {Object} db Firebase database instance
 * @param {string} callerFbUid Firebase auth UID
 * @return {Promise<Object>} Caller context or error
 */
async function readCallerContext(db, callerFbUid) {
  const mapSnap = await db.ref(`uidToCustom/${callerFbUid}`).once("value");
  const educatorId = normalizeUidToEducator(mapSnap.val());

  if (!educatorId) {
    return {error: "NOT_AN_EDUCATOR"};
  }

  const educatorSnap = await db.ref(`educators/${educatorId}`).once("value");
  const educator = educatorSnap.val() || {};
  const schoolId = cleanStr(educator.schoolID || educator.schoolId, 80);

  if (!schoolId) {
    return {error: "EDUCATOR_HAS_NO_SCHOOL"};
  }

  return {educatorId, educator, schoolId};
}

/**
 * Normalize date/time input to milliseconds.
 *
 * @param {*} v Date-ish value
 * @return {number} Milliseconds, or 0 when invalid
 */
function dateMs(v) {
  if (!v) return 0;

  if (typeof v === "number") {
    return v < 1000000000000 ? v * 1000 : v;
  }

  const parsed = Date.parse(String(v));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Return true when target student appears in visible student rows.
 *
 * @param {Object[]} studentRows Visible students
 * @param {string} targetStudentId Target student id
 * @return {boolean} True if visible
 */
function targetStudentIsVisible(studentRows, targetStudentId) {
  for (const row of studentRows || []) {
    if (row && row.id === targetStudentId) return true;
  }
  return false;
}

/**
 * Find sanitized student row.
 *
 * @param {Object[]} studentRows Visible students
 * @param {string} targetStudentId Target student id
 * @return {Object} Student row
 */
function findStudentRow(studentRows, targetStudentId) {
  for (const row of studentRows || []) {
    if (row && row.id === targetStudentId) return row;
  }
  return null;
}

exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const body = req.body || {};
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
    const targetStudentId = cleanStr(body.studentId, 120);
    const startMs = dateMs(body.startAt);
    const endMs = dateMs(body.endAt);

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    if (!targetStudentId) {
      return bad(res, 400, "MISSING_STUDENT_ID");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();
    const callerCtx = await readCallerContext(db, callerFbUid);

    if (callerCtx.error) {
      return bad(res, 403, callerCtx.error);
    }

    const {educatorId, schoolId} = callerCtx;

    const [schoolSnap, schoolEducatorSnap] = await Promise.all([
      db.ref(`schools/${schoolId}`).once("value"),
      db.ref(`schools/${schoolId}/educators/${educatorId}`).once("value"),
    ]);

    const school = schoolSnap.val() || {};
    const schoolEducator = schoolEducatorSnap.val() || {};

    if (schoolEducator.status !== "approved") {
      return bad(res, 403, "EDUCATOR_NOT_APPROVED", {
        status: schoolEducator.status || "missing",
      });
    }

    const plan = school.plan || {};
    if (!isActivePlan(plan)) {
      return bad(res, 403, "SCHOOL_PLAN_NOT_ACTIVE", {
        planStatus: cleanStr(plan.status, 40) || "missing",
      });
    }

    if (!planHasBootcamp(plan, bootcamp)) {
      return bad(res, 403, "BOOTCAMP_NOT_IN_SCHOOL_PLAN", {
        bootcamp,
      });
    }

    if (!educatorHasBootcampAccess(schoolEducator, bootcamp)) {
      return bad(res, 403, "EDUCATOR_HAS_NO_BOOTCAMP_ACCESS", {
        bootcamp,
      });
    }

    const schoolNorm = normalizeSchool(schoolId, school);
    if (!schoolNorm.name || !schoolNorm.country || !schoolNorm.state) {
      return bad(res, 400, "SCHOOL_RECORD_INCOMPLETE", {
        schoolId,
        missing: {
          name: !schoolNorm.name,
          country: !schoolNorm.country,
          state: !schoolNorm.state,
        },
      });
    }

    const candidateResult = await collectCandidateStudentIds(
        db,
        schoolId,
        schoolNorm,
        schoolEducator,
    );

    const candidateIds = Array.isArray(candidateResult) ?
      candidateResult :
      candidateResult.candidateIds || [];

    const groupGrantMap = Array.isArray(candidateResult) ?
      {} :
      candidateResult.groupGrantMap || {};

    const {studentRows} = await hydrateAllowedStudents(
        db,
        candidateIds,
        schoolNorm,
        schoolEducator,
        groupGrantMap,
    );

    const attemptTree = (await db.ref(`users/${targetStudentId}/statsIndex`)
        .once("value")).val() || {};
    const allAttempts = Object.values(attemptTree);
    const visibleByPermission = targetStudentIsVisible(
        studentRows,
        targetStudentId,
    );
    const hasSchoolAssignment = allAttempts.some((attempt) =>
      attempt.source === "assignment" && attempt.schoolId === schoolId);
    if (!visibleByPermission && !hasSchoolAssignment) {
      return bad(res, 403, "STUDENT_NOT_VISIBLE_TO_EDUCATOR", {
        studentId: targetStudentId,
      });
    }

    let student = findStudentRow(studentRows, targetStudentId);
    if (!student) {
      const profile = (await db.ref(`users/${targetStudentId}`)
          .once("value")).val() || {};
      student = {
        id: targetStudentId,
        firstName: cleanStr(profile.firstName, 60),
        lastName: cleanStr(profile.lastName, 60),
        platoonName: cleanStr(profile.platoonName, 100),
      };
    }
    const attempts = visibleByPermission ? allAttempts :
      allAttempts.filter((attempt) => attempt.source === "assignment" &&
        attempt.schoolId === schoolId);
    const startAt = new Date(startMs || Date.now() - 29 * 86400000)
        .toISOString();
    const endAt = new Date(endMs || Date.now()).toISOString();
    const analytics = aggregateAnalytics(attempts, {
      bootcamp,
      startAt,
      endAt,
      timezone: cleanStr(body.timezone, 80) || "UTC",
      source: cleanStr(body.source, 30) || "all",
      subject: cleanStr(body.subject, 120),
      granularity: ["week", "month"].includes(body.granularity) ?
        body.granularity : "day",
      educator: true,
    }, buildCatalog(bootcamp));

    return res.status(200).json({
      ok: true,
      bootcamp,
      student,
      analytics,
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
