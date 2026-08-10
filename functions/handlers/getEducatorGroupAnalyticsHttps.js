"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {aggregateGroup} = require("./_analytics");
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
  trueMapKeys,
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
 * Return true if school admin group is visible to this educator.
 *
 * @param {Object} schoolEducator School educator permission row
 * @param {string} rawGroupId School/admin group id
 * @return {boolean} True if visible
 */
function canSeeAdminGroup(schoolEducator, rawGroupId) {
  const access = schoolEducator.access || {};
  const groups = access.groups || {};

  if (schoolEducator.superAdmin === true) return true;
  if (schoolEducator.adminAccess === true) return true;
  if (groups.all === true) return true;
  if (groups[rawGroupId] === true) return true;

  return false;
}

/**
 * Read the requested group and enforce visibility.
 *
 * @param {Object} db Firebase database instance
 * @param {string} schoolId School id
 * @param {string} callerEducatorId Caller educator id
 * @param {Object} schoolEducator School educator row
 * @param {Object} body Request body
 * @return {Promise<Object>} Group result or error
 */
async function readRequestedGroup(
    db,
    schoolId,
    callerEducatorId,
    schoolEducator,
    body,
) {
  const rawGroupId = cleanStr(
      body.rawGroupId || body.groupId || body.groupKey,
      180,
  );
  const scope = cleanStr(body.scope || "admin", 40).toLowerCase();
  const ownerEducatorId = cleanStr(
      body.ownerEducatorId || callerEducatorId,
      120,
  );

  if (!rawGroupId) {
    return {error: "MISSING_GROUP_ID"};
  }

  if (scope === "educator") {
    if (ownerEducatorId !== callerEducatorId) {
      return {error: "EDUCATOR_GROUP_NOT_VISIBLE"};
    }

    const snap = await db
        .ref(`schools/${schoolId}/groups/educators/` +
          `${callerEducatorId}/${rawGroupId}`)
        .once("value");

    if (!snap.exists()) {
      return {error: "GROUP_NOT_FOUND"};
    }

    const group = snap.val() || {};

    return {
      group,
      groupMeta: {
        id: `educator_${rawGroupId}`,
        rawGroupId,
        scope: "educator",
        ownerEducatorId: callerEducatorId,
        name: cleanStr(group.name, 100) || "Untitled Group",
      },
    };
  }

  if (!canSeeAdminGroup(schoolEducator, rawGroupId)) {
    return {error: "ADMIN_GROUP_NOT_VISIBLE"};
  }

  const snap = await db
      .ref(`schools/${schoolId}/groups/admin/${rawGroupId}`)
      .once("value");

  if (!snap.exists()) {
    return {error: "GROUP_NOT_FOUND"};
  }

  const group = snap.val() || {};

  return {
    group,
    groupMeta: {
      id: `admin_${rawGroupId}`,
      rawGroupId,
      scope: "admin",
      ownerEducatorId: "",
      name: cleanStr(group.name, 100) || "Untitled Group",
    },
  };
}

/**
 * Build a map of visible sanitized student rows.
 *
 * @param {Object[]} studentRows Sanitized visible students
 * @return {Object} Map by id
 */
function buildStudentRowMap(studentRows) {
  const out = {};

  for (const row of studentRows || []) {
    if (row && row.id) out[row.id] = row;
  }

  return out;
}

/**
 * Filter group members to visible/allowed students.
 *
 * @param {Object} group Group node
 * @param {Object} allowedMap Allowed student id map
 * @param {Object} studentRowMap Visible student row map
 * @return {Object[]} Visible group members
 */
function visibleGroupMembers(group, allowedMap, studentRowMap) {
  const membersMap = group.members || {};
  const ids = trueMapKeys(membersMap);
  const rows = [];

  ids.sort();

  for (const studentId of ids) {
    if (allowedMap[studentId] !== true) continue;
    if (!studentRowMap[studentId]) continue;
    rows.push(studentRowMap[studentId]);
  }

  return rows;
}

exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const body = req.body || {};
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
    const startMs = dateMs(body.startAt);
    const endMs = dateMs(body.endAt);

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
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

    const groupResult = await readRequestedGroup(
        db,
        schoolId,
        educatorId,
        schoolEducator,
        body,
    );

    if (groupResult.error) {
      return bad(res, 403, groupResult.error);
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

    const {studentRows, allowedMap} = await hydrateAllowedStudents(
        db,
        candidateIds,
        schoolNorm,
        schoolEducator,
        groupGrantMap,
    );

    const studentRowMap = buildStudentRowMap(studentRows);
    const members = visibleGroupMembers(
        groupResult.group,
        allowedMap,
        studentRowMap,
    );
    const includedIds = new Set(members.map((student) => student.id));
    const rawMemberIds = trueMapKeys(groupResult.group.members || {});
    for (const studentId of rawMemberIds) {
      if (includedIds.has(studentId)) continue;
      const attemptTree = (await db.ref(`users/${studentId}/statsIndex`)
          .once("value")).val() || {};
      const hasSchoolAssignment = Object.values(attemptTree)
          .some((attempt) => attempt.source === "assignment" &&
            attempt.schoolId === schoolId);
      if (!hasSchoolAssignment) continue;
      const profile = (await db.ref(`users/${studentId}`)
          .once("value")).val() || {};
      members.push({
        id: studentId,
        firstName: cleanStr(profile.firstName, 60),
        lastName: cleanStr(profile.lastName, 60),
        platoonName: cleanStr(profile.platoonName, 100),
      });
      includedIds.add(studentId);
    }

    const attemptSnaps = await Promise.all(members.map((student) =>
      db.ref(`users/${student.id}/statsIndex`).once("value")));
    const attemptsByStudent = {};
    members.forEach((student, index) => {
      const rows = Object.values(attemptSnaps[index].val() || {});
      attemptsByStudent[student.id] = allowedMap[student.id] === true ? rows :
        rows.filter((attempt) => attempt.source === "assignment" &&
          attempt.schoolId === schoolId);
    });
    const analytics = aggregateGroup(attemptsByStudent, {
      bootcamp,
      startAt: new Date(startMs || Date.now() - 29 * 86400000)
          .toISOString(),
      endAt: new Date(endMs || Date.now()).toISOString(),
      timezone: cleanStr(body.timezone, 80) || "UTC",
      source: cleanStr(body.source, 30) || "all",
      subject: cleanStr(body.subject, 120),
      granularity: ["week", "month"].includes(body.granularity) ?
        body.granularity : "day",
      educator: true,
      threshold: body.threshold === undefined ?
        undefined : Number(body.threshold),
      thresholdMetric: cleanStr(body.thresholdMetric, 30),
    }, buildCatalog(bootcamp));

    return res.status(200).json({
      ok: true,
      bootcamp,
      group: {
        id: groupResult.groupMeta.id,
        rawGroupId: groupResult.groupMeta.rawGroupId,
        scope: groupResult.groupMeta.scope,
        ownerEducatorId: groupResult.groupMeta.ownerEducatorId,
        name: groupResult.groupMeta.name,
        studentCount: members.length,
      },
      students: members.map((student) => {
        return {
          id: student.id,
          firstName: cleanStr(student.firstName, 60),
          lastName: cleanStr(student.lastName, 60),
          platoonName: cleanStr(student.platoonName, 100),
        };
      }),
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
