"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {
  approvedEducatorCount,
  bad,
  buildSubjectCatalogForPlan,
  cleanStr,
  countVisibleStudents,
  errText,
  hydrateAllowedStudents,
  normalizeSchool,
  normalizeUidToEducator,
  sanitizeEducatorProfile,
  sanitizeGroup,
  sanitizePlan,
  trueMapKeys,
} = require("./_schoolAdminAccess");

/**
 * Resolve the calling educator and school from Firebase UID.
 *
 * @param {Object} db Firebase database instance
 * @param {string} callerFbUid Firebase auth UID for caller
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
 * Read all valid students currently visible at the school level.
 *
 * @param {Object} db Firebase database instance
 * @param {Object} schoolNorm Normalized school info
 * @return {Promise<Object[]>} Sanitized student rows
 */
async function readSchoolStudents(db, schoolNorm) {
  const schoolMembersPath =
    `units/corps/${schoolNorm.country}/${schoolNorm.state}/` +
    `${schoolNorm.name}/members`;

  const membersSnap = await db.ref(schoolMembersPath).once("value");
  const ids = trueMapKeys(membersSnap.val() || {});

  // Use a temporary admin-style row so hydrateAllowedStudents still enforces
  // school membership and student platoonPermissions.
  const row = {
    status: "approved",
    adminAccess: true,
    superAdmin: false,
    access: {},
  };

  const {studentRows} = await hydrateAllowedStudents(db, ids, schoolNorm, row);
  return studentRows;
}

/**
 * Read school-wide groups and filter members to valid school students.
 *
 * @param {Object} db Firebase database instance
 * @param {string} schoolId School id
 * @param {Object} allowedMap Valid student ids keyed by id
 * @return {Promise<Object[]>} Sanitized school group rows
 */
async function readSchoolGroups(db, schoolId, allowedMap) {
  const groupsSnap = await db.ref(`schools/${schoolId}/groups/admin`)
      .once("value");
  const groups = groupsSnap.val() || {};
  const rows = [];

  for (const groupId of Object.keys(groups)) {
    rows.push(sanitizeGroup(groupId, groups[groupId], allowedMap || {}, false));
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();
    const callerCtx = await readCallerContext(db, callerFbUid);

    if (callerCtx.error) {
      return bad(res, 403, callerCtx.error);
    }

    const {educatorId, schoolId} = callerCtx;

    const [schoolSnap, callerRowSnap] = await Promise.all([
      db.ref(`schools/${schoolId}`).once("value"),
      db.ref(`schools/${schoolId}/educators/${educatorId}`).once("value"),
    ]);

    const school = schoolSnap.val() || {};
    const callerRow = callerRowSnap.val() || {};
    const callerIsAdmin = callerRow.adminAccess === true ||
      callerRow.superAdmin === true;

    if (callerRow.status !== "approved" || !callerIsAdmin) {
      return bad(res, 403, "NOT_SCHOOL_ADMIN", {
        status: callerRow.status || "missing",
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

    const schoolEducators = school.educators || {};
    const approvedCount = approvedEducatorCount(schoolEducators);
    const plan = sanitizePlan(school.plan || {}, approvedCount);
    const subjectCatalogByBootcamp = buildSubjectCatalogForPlan(school.plan);

    const educatorIds = Object.keys(schoolEducators);
    const educatorSnaps = await Promise.all(educatorIds.map((id) => {
      return db.ref(`educators/${id}`).once("value");
    }));

    const educators = [];

    for (let i = 0; i < educatorIds.length; i++) {
      const targetEducatorId = educatorIds[i];
      const profile = educatorSnaps[i].val() || {};
      const row = schoolEducators[targetEducatorId] || {};
      const safe = sanitizeEducatorProfile(targetEducatorId, profile, row);

      safe.studentCount = await countVisibleStudents(
          db,
          schoolId,
          schoolNorm,
          row,
      );

      educators.push(safe);
    }

    educators.sort((a, b) => {
      const statusOrder = {pending: 0, approved: 1, rejected: 2};
      const ax = statusOrder[a.status] === undefined ?
      9 : statusOrder[a.status];
      const bx = statusOrder[b.status] === undefined ?
      9 : statusOrder[b.status];
      if (ax !== bx) return ax - bx;
      return (a.lastName + a.firstName).localeCompare(
          b.lastName + b.firstName,
      );
    });

    const students = await readSchoolStudents(db, schoolNorm);
    const allowedStudentMap = {};

    for (const student of students) {
      allowedStudentMap[student.id] = true;
    }

    const schoolGroups = await readSchoolGroups(
        db,
        schoolId,
        allowedStudentMap,
    );

    return res.status(200).json({
      ok: true,
      caller: {
        educatorId,
        adminAccess: callerRow.adminAccess === true,
        superAdmin: callerRow.superAdmin === true,
      },
      school: schoolNorm,
      plan,
      subjectCatalogByBootcamp,
      educators,
      students,
      schoolGroups,
      activeBootcamp: cleanStr(req.body && req.body.bootcamp, 40)
          .toLowerCase(),
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    const details = errText(e);

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
