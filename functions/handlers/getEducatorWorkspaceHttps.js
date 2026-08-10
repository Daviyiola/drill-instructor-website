"use strict";
/* eslint-disable require-jsdoc */

const {getDatabase} = require("firebase-admin/database");
const {requireVerifiedBearerUid, allowCors} = require("./_auth");
const {
  BOOTCAMP_SUBJECTS,
  approvedEducatorCount,
  bad,
  cleanStr,
  educatorHasBootcampAccess,
  errText,
  isActivePlan,
  isObject,
  normalizeSchool,
  normalizeUidToEducator,
  planHasBootcamp,
  sanitizePlan,
} = require("./_schoolAdminAccess");

function cleanAvatar(value) {
  const avatar = Number(value);
  return Number.isInteger(avatar) && avatar >= 1 && avatar <= 14 ? avatar : 1;
}

function selectedSubjects(row, bootcamp) {
  const catalog = BOOTCAMP_SUBJECTS[bootcamp] || [];
  if (row.superAdmin === true || row.adminAccess === true) return catalog;
  const byBootcamp = isObject(row.access) &&
    isObject(row.access.subjectsByBootcamp) ?
    row.access.subjectsByBootcamp : {};
  const selected = isObject(byBootcamp[bootcamp]) ?
    byBootcamp[bootcamp] : {};
  if (selected.all === true) return catalog;
  return catalog.filter((subject) => selected[subject] === true);
}

async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") return bad(res, 405, "METHOD_NOT_ALLOWED");
    const uid = await requireVerifiedBearerUid(req);
    const db = getDatabase();
    const map = (await db.ref(`uidToCustom/${uid}`).once("value")).val();
    const educatorId = normalizeUidToEducator(map);
    if (!educatorId) return bad(res, 403, "NOT_AN_EDUCATOR");

    const educator = (await db.ref(`educators/${educatorId}`)
        .once("value")).val() || {};
    if (educator.uid && educator.uid !== uid) {
      return bad(res, 403, "PROFILE_OWNERSHIP_MISMATCH");
    }
    const schoolId = cleanStr(educator.schoolID || educator.schoolId, 80);
    if (!schoolId) return bad(res, 403, "EDUCATOR_HAS_NO_SCHOOL");

    const [schoolSnap, rowSnap] = await Promise.all([
      db.ref(`schools/${schoolId}`).once("value"),
      db.ref(`schools/${schoolId}/educators/${educatorId}`).once("value"),
    ]);
    const school = schoolSnap.val() || {};
    const row = rowSnap.val() || {};
    if (row.status !== "approved") {
      return bad(res, 403, "EDUCATOR_NOT_APPROVED", {
        status: cleanStr(row.status, 40) || "missing",
      });
    }
    const schoolNorm = normalizeSchool(schoolId, school);
    if (!schoolNorm.name || !schoolNorm.country || !schoolNorm.state) {
      return bad(res, 400, "SCHOOL_RECORD_INCOMPLETE");
    }
    const plan = isObject(school.plan) ? school.plan : {};
    if (!isActivePlan(plan)) {
      return bad(res, 403, "SCHOOL_PLAN_NOT_ACTIVE", {
        status: cleanStr(plan.status, 40) || "missing",
      });
    }

    const bootcamps = Object.keys(plan.bootcamps || {})
        .map((value) => cleanStr(value, 40).toLowerCase())
        .filter((bootcamp) => planHasBootcamp(plan, bootcamp) &&
          educatorHasBootcampAccess(row, bootcamp))
        .sort();
    const subjectsByBootcamp = {};
    for (const bootcamp of bootcamps) {
      subjectsByBootcamp[bootcamp] = selectedSubjects(row, bootcamp);
    }
    const access = isObject(row.access) ? row.access : {};

    return res.status(200).json({
      ok: true,
      educator: {
        educatorId,
        firstName: cleanStr(educator.firstName, 60),
        lastName: cleanStr(educator.lastName, 60),
        email: cleanStr(educator.email, 120),
        avatarNumber: cleanAvatar(
            educator.avatarNumber || educator.avaterNumber || 1),
        approvalStatus: "approved",
      },
      school: schoolNorm,
      caller: {
        adminAccess: row.adminAccess === true,
        superAdmin: row.superAdmin === true,
      },
      bootcamps,
      subjectsByBootcamp,
      access: {
        studentsAll: row.adminAccess === true || row.superAdmin === true ||
          !!(access.students && access.students.all === true),
        groupsAll: row.adminAccess === true || row.superAdmin === true ||
          !!(access.groups && access.groups.all === true),
        studentIds: Object.keys(access.students || {})
            .filter((id) => id !== "all" && access.students[id] === true),
        groupIds: Object.keys(access.groups || {})
            .filter((id) => id !== "all" && access.groups[id] === true),
      },
      plan: sanitizePlan(plan, approvedEducatorCount(school.educators || {})),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const status = Number(error && error.code);
    if (status === 401) return bad(res, 401, "AUTHENTICATION_REQUIRED");
    if (status === 403 && error.message === "EMAIL_VERIFICATION_REQUIRED") {
      return bad(res, 403, "EMAIL_VERIFICATION_REQUIRED");
    }
    return bad(res, 500, "INTERNAL", errText(error));
  }
}

module.exports = handler;
module.exports.handler = handler;
