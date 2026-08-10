/* eslint-disable require-jsdoc */
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireVerifiedBearerUid} = require("./_auth");

function bad(res, code, msg, details) {
  return res.status(code).json({
    ok: false,
    error: msg,
    details: details || null,
  });
}

function cleanStr(v, maxLen) {
  const s = (v || "").toString().trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function errText(e) {
  if (!e) return "Internal error";
  if (typeof e === "string") return e;
  if (typeof e === "object" && e.message) return e.message;
  try {
    return JSON.stringify(e);
  } catch (_) {
    return String(e);
  }
}

function normalizeUidToEducator(val) {
  if (!val) return "";
  if (typeof val === "string") return cleanStr(val, 120);
  if (typeof val === "object") return cleanStr(val.educator, 120);
  return "";
}

function safeGroupName(v) {
  return cleanStr(v, 100);
}

function safeDescription(v) {
  return cleanStr(v, 240);
}

function makePlatoonKey(corpsName, battalionName, platoonName) {
  return [
    cleanStr(corpsName, 100),
    cleanStr(battalionName, 100),
    cleanStr(platoonName, 100),
  ].join("/");
}

function isStudentInSchool(student, schoolNorm) {
  return (
    cleanStr(student.corpsName, 100) === schoolNorm.country &&
    cleanStr(student.battalionName, 100) === schoolNorm.state &&
    cleanStr(student.platoonName, 100) === schoolNorm.name
  );
}

function educatorCanSeeStudent(args) {
  const studentId = args.studentId;
  const student = args.student || {};
  const schoolNorm = args.schoolNorm || {};
  const schoolEducator = args.schoolEducator || {};
  const access = schoolEducator.access || {};

  if (student.platoonPermissions !== true) return false;
  if (!isStudentInSchool(student, schoolNorm)) return false;

  const studentPlatoonKey = makePlatoonKey(
      student.corpsName,
      student.battalionName,
      student.platoonName,
  );

  if (schoolEducator.superAdmin === true) return true;
  if (schoolEducator.adminAccess === true) return true;

  if (access.students && access.students.all === true) return true;
  if (access.platoons && access.platoons.all === true) return true;

  if (access.platoons && access.platoons[studentPlatoonKey] === true) {
    return true;
  }

  if (access.students && access.students[studentId] === true) {
    return true;
  }

  return false;
}

async function getApprovedEducatorContext(req) {
  const callerFbUid = await requireVerifiedBearerUid(req);
  const db = getDatabase();

  const mapSnap = await db.ref(`uidToCustom/${callerFbUid}`).once("value");
  const educatorId = normalizeUidToEducator(mapSnap.val());

  if (!educatorId) {
    const err = new Error("NOT_AN_EDUCATOR");
    err.statusCode = 403;
    throw err;
  }

  const educatorSnap = await db.ref(`educators/${educatorId}`).once("value");
  const educator = educatorSnap.val() || {};

  const schoolId = cleanStr(educator.schoolID || educator.schoolId, 80);
  if (!schoolId) {
    const err = new Error("EDUCATOR_HAS_NO_SCHOOL");
    err.statusCode = 403;
    throw err;
  }

  const [schoolSnap, schoolEducatorSnap] = await Promise.all([
    db.ref(`schools/${schoolId}`).once("value"),
    db.ref(`schools/${schoolId}/educators/${educatorId}`).once("value"),
  ]);

  const school = schoolSnap.val() || {};
  const schoolEducator = schoolEducatorSnap.val() || {};

  if (schoolEducator.status !== "approved") {
    const err = new Error("EDUCATOR_NOT_APPROVED");
    err.statusCode = 403;
    err.details = {status: schoolEducator.status || "missing"};
    throw err;
  }

  const schoolNorm = {
    schoolId,
    name: cleanStr(school.name, 100),
    country: cleanStr(school.country, 100),
    state: cleanStr(school.state, 100),
  };

  if (!schoolNorm.name || !schoolNorm.country || !schoolNorm.state) {
    const err = new Error("SCHOOL_RECORD_INCOMPLETE");
    err.statusCode = 400;
    err.details = {
      schoolId,
      missing: {
        name: !schoolNorm.name,
        country: !schoolNorm.country,
        state: !schoolNorm.state,
      },
    };
    throw err;
  }

  return {
    db,
    callerFbUid,
    educatorId,
    educator,
    schoolId,
    schoolNorm,
    schoolEducator,
    isAdmin: schoolEducator.adminAccess === true ||
      schoolEducator.superAdmin === true,
  };
}

async function filterAllowedMemberIds(
    db, memberIds, schoolNorm, schoolEducator) {
  const requested = Array.isArray(memberIds) ? memberIds : [];
  const cleaned = [];

  for (let i = 0; i < requested.length; i++) {
    const id = cleanStr(requested[i], 120);
    if (id && !cleaned.includes(id)) cleaned.push(id);
  }

  const allowed = {};
  const rejected = [];

  const snaps = await Promise.all(
      cleaned.map((id) => db.ref(`users/${id}`).once("value")),
  );

  for (let i = 0; i < cleaned.length; i++) {
    const studentId = cleaned[i];
    const student = snaps[i].val();

    if (
      student &&
      typeof student === "object" &&
      educatorCanSeeStudent({studentId, student, schoolNorm, schoolEducator})
    ) {
      allowed[studentId] = true;
    } else {
      rejected.push(studentId);
    }
  }

  return {allowed, rejected};
}

function groupPathForScope(schoolId, educatorId, scope, groupId) {
  if (scope === "admin") {
    return `schools/${schoolId}/groups/admin/${groupId}`;
  }

  return `schools/${schoolId}/groups/educators/${educatorId}/${groupId}`;
}

function sanitizeScope(v) {
  const scope = cleanStr(v, 20).toLowerCase();
  return scope === "admin" ? "admin" : "educator";
}

module.exports = {
  bad,
  cleanStr,
  errText,
  safeGroupName,
  safeDescription,
  getApprovedEducatorContext,
  filterAllowedMemberIds,
  groupPathForScope,
  sanitizeScope,
};
