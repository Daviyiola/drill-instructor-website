/* eslint-disable require-jsdoc */
"use strict";

/**
 * Shared helpers for Drill Instructor school admin endpoints.
 * Keep this file dependency-light so handlers can reuse permission logic.
 */

const ACTIVE_PLAN_STATUSES = {
  active: true,
  trial: true,
};

const VALID_EDUCATOR_STATUSES = {
  pending: true,
  approved: true,
  rejected: true,
};

// Server-side catalog. Do not trust the client for valid bootcamps/subjects.
// Keep this synced with bootcampModel.js drills list.
const BOOTCAMP_SUBJECTS = {
  act: [
    "English",
    "Mathematics",
    "Reading",
    "Science",
  ],
  utme: [
    "English",
    "Mathematics",
    "Biology",
    "Chemistry",
    "Physics",
    "Literature",
    "CRS",
    "Government",
    "History",
    "Economics",
    "Commerce",
    "Accounts",
    "Computer",
    "Geography",
  ],
  sat: [
    "Read. & Writ.",
    "Math",
  ],
};

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
  if (typeof e === "object" && typeof e.message === "string") {
    return e.message;
  }
  try {
    return JSON.stringify(e);
  } catch (_) {
    return String(e);
  }
}

function safeKey(v) {
  return cleanStr(v, 180)
      .replace(/[.#$/\\[\]]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
}

function normalizeUidToEducator(val) {
  if (!val) return "";
  if (typeof val === "string") return cleanStr(val, 120);
  if (typeof val === "object") return cleanStr(val.educator, 120);
  return "";
}

function trueMapKeys(map) {
  const out = [];
  if (!map || typeof map !== "object") return out;

  for (const key of Object.keys(map)) {
    if (map[key] === true) out.push(key);
  }
  return out;
}

function isObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isActivePlan(plan) {
  const status = cleanStr(plan && plan.status, 40).toLowerCase();
  return ACTIVE_PLAN_STATUSES[status] === true;
}

function normalizeStatus(v, fallback) {
  const s = cleanStr(v, 40).toLowerCase() || fallback || "pending";
  return VALID_EDUCATOR_STATUSES[s] === true ? s : "";
}

function makePlatoonKey(corpsName, battalionName, platoonName) {
  return [
    cleanStr(corpsName, 100),
    cleanStr(battalionName, 100),
    cleanStr(platoonName, 100),
  ].join("/");
}

function normalizeSchool(schoolId, school) {
  return {
    schoolId: cleanStr(schoolId, 80),
    name: cleanStr(school && school.name, 100),
    country: cleanStr(school && school.country, 100),
    state: cleanStr(school && school.state, 100),
  };
}

function isStudentInSchool(student, schoolNorm) {
  return (
    cleanStr(student.corpsName, 100) === schoolNorm.country &&
    cleanStr(student.battalionName, 100) === schoolNorm.state &&
    cleanStr(student.platoonName, 100) === schoolNorm.name
  );
}

function sanitizeStudent(studentId, u) {
  return {
    id: studentId,
    firstName: cleanStr(u.firstName, 60),
    lastName: cleanStr(u.lastName, 60),
    totalPoints: Number(u.totalPoints || 0),
    platoonName: cleanStr(u.platoonName, 100),
    battalionName: cleanStr(u.battalionName, 100),
    corpsName: cleanStr(u.corpsName, 100),
    currentRank: cleanStr(u.currentRank, 40) || "RECRUIT",
    avaterNumber: Number(u.avaterNumber || u.avatarNumber || 1),
  };
}

function sanitizeEducatorProfile(educatorId, profile, schoolRow) {
  const access = schoolRow.access || {};
  return {
    id: educatorId,
    firstName: cleanStr(profile.firstName, 60),
    lastName: cleanStr(profile.lastName, 60),
    email: cleanStr(profile.email, 120),
    schoolID: cleanStr(profile.schoolID || profile.schoolId, 80),
    schoolName: cleanStr(profile.schoolName, 120),
    createdAt: cleanStr(schoolRow.createdAt || profile.createdAt, 40),
    approvedAt: cleanStr(schoolRow.approvedAt, 40),
    approvedBy: cleanStr(schoolRow.approvedBy, 120),
    statusUpdatedAt: cleanStr(schoolRow.statusUpdatedAt, 40),
    status: cleanStr(schoolRow.status, 40) || "pending",
    adminAccess: schoolRow.adminAccess === true,
    superAdmin: schoolRow.superAdmin === true,
    role: cleanStr(schoolRow.role, 40) || "educator",
    access,
  };
}

function sanitizeGroup(groupId, group, allowedMap, includeAllMembers) {
  const rawMembers = group.members || {};
  const memberIds = [];

  if (rawMembers && typeof rawMembers === "object") {
    for (const studentId of Object.keys(rawMembers)) {
      const allowed = includeAllMembers || allowedMap[studentId] === true;
      if (rawMembers[studentId] === true && allowed) memberIds.push(studentId);
    }
  }

  memberIds.sort();

  return {
    id: safeKey(groupId),
    rawGroupId: groupId,
    scope: "admin",
    ownerEducatorId: "",
    name: cleanStr(group.name, 100) || "Untitled Group",
    description: cleanStr(group.description, 240),
    createdBy: cleanStr(group.createdBy, 120),
    createdAt: cleanStr(group.createdAt, 40),
    updatedAt: cleanStr(group.updatedAt, 40),
    memberIds,
    memberCount: memberIds.length,
  };
}

function educatorHasBootcampAccess(schoolEducator, bootcamp) {
  if (!bootcamp) return true;
  if (schoolEducator.superAdmin === true) return true;
  if (schoolEducator.adminAccess === true) return true;

  const access = schoolEducator.access || {};
  const bootcamps = access.bootcamps || {};
  return bootcamps.all === true || bootcamps[bootcamp] === true;
}

function planHasBootcamp(plan, bootcamp) {
  if (!isActivePlan(plan)) return false;
  if (!bootcamp) return true;
  if (!plan || typeof plan !== "object") return false;
  if (!plan.bootcamps || typeof plan.bootcamps !== "object") return false;

  const row = plan.bootcamps[bootcamp];
  if (!row || typeof row !== "object") return false;
  if (row.enabled !== true) return false;

  const startAt = cleanStr(row.startAt || plan.startAt, 40);
  if (startAt) {
    const startMs = Date.parse(startAt);
    if (!Number.isNaN(startMs) && Date.now() < startMs) return false;
  }

  const endAt = cleanStr(row.endAt || plan.endAt, 40);
  if (endAt) {
    const endMs = Date.parse(endAt);
    if (!Number.isNaN(endMs) && Date.now() > endMs) return false;
  }

  return true;
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

  if (args.groupGranted === true) return true;

  if (access.students && access.students.all === true) return true;
  if (access.platoons && access.platoons.all === true) return true;

  if (
    access.platoons &&
    access.platoons[studentPlatoonKey] === true
  ) {
    return true;
  }

  if (
    access.students &&
    access.students[studentId] === true
  ) {
    return true;
  }

  return false;
}

async function addSchoolMemberCandidates(db, schoolNorm, candidateMap) {
  const schoolMembersPath =
    `units/corps/${schoolNorm.country}/${schoolNorm.state}/` +
    `${schoolNorm.name}/members`;

  const membersSnap = await db.ref(schoolMembersPath).once("value");
  const members = membersSnap.val() || {};
  for (const id of trueMapKeys(members)) candidateMap[id] = true;
}

async function addPlatoonCandidates(db, access, candidateMap) {
  if (!access.platoons || typeof access.platoons !== "object") return;

  for (const platoonKey of Object.keys(access.platoons)) {
    if (platoonKey === "all") continue;
    if (access.platoons[platoonKey] !== true) continue;

    const parts = platoonKey.split("/");
    if (parts.length !== 3) continue;

    const c = cleanStr(parts[0], 100);
    const b = cleanStr(parts[1], 100);
    const p = cleanStr(parts[2], 100);

    const membersSnap = await db
        .ref(`units/corps/${c}/${b}/${p}/members`)
        .once("value");

    const members = membersSnap.val() || {};
    for (const id of trueMapKeys(members)) candidateMap[id] = true;
  }
}

async function addGroupCandidates(
    db, schoolId, access, candidateMap, groupGrantMap) {
  if (!access.groups || typeof access.groups !== "object") return;

  if (access.groups.all === true) {
    const groupsSnap = await db.ref(`schools/${schoolId}/groups/admin`)
        .once("value");
    const groups = groupsSnap.val() || {};

    for (const groupId of Object.keys(groups)) {
      const members = groups[groupId] && groups[groupId].members;
      for (const id of trueMapKeys(members)) {
        candidateMap[id] = true;
        groupGrantMap[id] = true;
      }
    }
    return;
  }

  const groupIds = Object.keys(access.groups)
      .filter((id) => id !== "all" && access.groups[id] === true);

  const snaps = await Promise.all(groupIds.map((groupId) => {
    return db.ref(`schools/${schoolId}/groups/admin/${groupId}/members`)
        .once("value");
  }));

  for (const snap of snaps) {
    const members = snap.val() || {};
    for (const id of trueMapKeys(members)) {
      candidateMap[id] = true;
      groupGrantMap[id] = true;
    }
  }
}

function addExplicitStudentCandidates(access, candidateMap) {
  if (!access.students || typeof access.students !== "object") return;

  for (const studentId of Object.keys(access.students)) {
    if (studentId === "all") continue;
    if (access.students[studentId] === true) candidateMap[studentId] = true;
  }
}

async function collectCandidateStudentIds(db, schoolId, schoolNorm, row) {
  const access = row.access || {};
  const candidateMap = {};
  const groupGrantMap = {};

  const hasAllStudents =
    row.superAdmin === true ||
    row.adminAccess === true ||
    (access.students && access.students.all === true) ||
    (access.platoons && access.platoons.all === true);

  if (hasAllStudents) {
    await addSchoolMemberCandidates(db, schoolNorm, candidateMap);
  }

  await addPlatoonCandidates(db, access, candidateMap);
  await addGroupCandidates(db, schoolId, access, candidateMap, groupGrantMap);
  addExplicitStudentCandidates(access, candidateMap);

  return {
    candidateIds: Object.keys(candidateMap),
    groupGrantMap,
  };
}

async function hydrateAllowedStudents(
    db, candidateIds, schoolNorm, row, groupGrantMap) {
  const uniqueIds = Array.from(new Set(candidateIds.filter(Boolean)));

  const snaps = await Promise.all(
      uniqueIds.map((id) => db.ref(`users/${id}`).once("value")),
  );

  const studentRows = [];
  const allowedMap = {};

  for (let i = 0; i < uniqueIds.length; i++) {
    const studentId = uniqueIds[i];
    const u = snaps[i].val();

    if (!u || typeof u !== "object") continue;

    if (!educatorCanSeeStudent({
      studentId,
      student: u,
      schoolNorm,
      schoolEducator: row,
      groupGranted: groupGrantMap && groupGrantMap[studentId] === true,
    })) {
      continue;
    }

    allowedMap[studentId] = true;
    studentRows.push(sanitizeStudent(studentId, u));
  }

  studentRows.sort((a, b) => {
    const p = Number(b.totalPoints || 0) - Number(a.totalPoints || 0);
    if (p !== 0) return p;
    return (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName);
  });

  return {studentRows, allowedMap};
}

async function countVisibleStudents(db, schoolId, schoolNorm, row) {
  const collected = await collectCandidateStudentIds(
      db,
      schoolId,
      schoolNorm,
      row,
  );

  const {studentRows} = await hydrateAllowedStudents(
      db,
      collected.candidateIds,
      schoolNorm,
      row,
      collected.groupGrantMap,
  );

  return studentRows.length;
}

function normalizeTrueMap(input, maxKeys) {
  const out = {};
  if (!input || typeof input !== "object") return out;

  const keys = Object.keys(input).slice(0, maxKeys || 500);
  for (const key of keys) {
    const clean = cleanStr(key, 180);
    if (!clean) continue;
    if (input[key] === true) out[clean] = true;
  }
  return out;
}

function normalizeAccess(
    input, existingAccess, activeBootcamp, autoGrantActiveBootcamp) {
  const src = input && typeof input === "object" ? input : existingAccess || {};

  const bootcamps = normalizeTrueMap(src.bootcamps, 50);
  const groups = normalizeTrueMap(src.groups, 500);
  const students = normalizeTrueMap(src.students, 3000);
  const platoons = normalizeTrueMap(src.platoons, 500);
  const subjectsByBootcamp = {};

  if (src.subjectsByBootcamp && typeof src.subjectsByBootcamp === "object") {
    for (const bootcamp of Object.keys(src.subjectsByBootcamp)) {
      const cleanBootcamp = cleanStr(bootcamp, 40).toLowerCase();
      if (!cleanBootcamp) continue;
      subjectsByBootcamp[cleanBootcamp] = normalizeTrueMap(
          src.subjectsByBootcamp[bootcamp],
          200,
      );
    }
  }

  if (
    autoGrantActiveBootcamp === true &&
    activeBootcamp &&
    bootcamps[activeBootcamp] !== true
  ) {
    bootcamps[activeBootcamp] = true;
  }

  return {
    bootcamps,
    subjectsByBootcamp,
    groups,
    students,
    platoons,
  };
}

function validateAccessAgainstPlan(access, plan) {
  if (!access || typeof access !== "object") return null;

  const bootcamps = access.bootcamps || {};
  const subjectsByBootcamp = access.subjectsByBootcamp || {};

  for (const bootcamp of Object.keys(bootcamps)) {
    if (bootcamp === "all") continue;
    if (bootcamps[bootcamp] !== true) continue;

    if (!planHasBootcamp(plan, bootcamp)) {
      return {
        error: "BOOTCAMP_NOT_IN_SCHOOL_PLAN",
        bootcamp,
      };
    }
  }

  for (const bootcamp of Object.keys(subjectsByBootcamp)) {
    const subjectMap = subjectsByBootcamp[bootcamp] || {};
    const hasAny = Object.keys(subjectMap)
        .some((k) => subjectMap[k] === true);

    if (!hasAny) continue;

    if (!planHasBootcamp(plan, bootcamp)) {
      return {
        error: "SUBJECT_BOOTCAMP_NOT_IN_SCHOOL_PLAN",
        bootcamp,
      };
    }

    const validSubjects = BOOTCAMP_SUBJECTS[bootcamp] || [];
    const validMap = {};
    for (const s of validSubjects) validMap[s] = true;

    for (const subject of Object.keys(subjectMap)) {
      if (subject === "all") continue;
      if (subjectMap[subject] !== true) continue;
      if (validMap[subject] !== true) {
        return {
          error: "INVALID_SUBJECT_FOR_BOOTCAMP",
          bootcamp,
          subject,
        };
      }
    }
  }

  return null;
}

function sanitizePlan(plan, approvedCount) {
  const raw = plan && typeof plan === "object" ? plan : {};
  const bootcamps = {};

  if (raw.bootcamps && typeof raw.bootcamps === "object") {
    for (const id of Object.keys(raw.bootcamps)) {
      const row = raw.bootcamps[id] || {};
      const bootcamp = cleanStr(id, 40).toLowerCase();
      if (!bootcamp) continue;

      bootcamps[bootcamp] = {
        enabled: row.enabled === true,
        startAt: cleanStr(row.startAt, 40),
        endAt: cleanStr(row.endAt, 40),
      };
    }
  }

  return {
    status: cleanStr(raw.status, 40) || "missing",
    startAt: cleanStr(raw.startAt, 40),
    endAt: cleanStr(raw.endAt, 40),
    educatorSeatLimit: Number(raw.educatorSeatLimit || 0),
    educatorSeatsUsed: Number(approvedCount || 0),
    bootcamps,
  };
}

function buildSubjectCatalogForPlan(plan) {
  const out = {};
  const bootcamps = plan && plan.bootcamps ? plan.bootcamps : {};

  for (const bootcamp of Object.keys(bootcamps)) {
    if (!planHasBootcamp(plan, bootcamp)) continue;
    out[bootcamp] = BOOTCAMP_SUBJECTS[bootcamp] || [];
  }

  return out;
}

function approvedEducatorCount(schoolEducators) {
  let count = 0;
  const rows = schoolEducators || {};

  for (const educatorId of Object.keys(rows)) {
    if (rows[educatorId] && rows[educatorId].status === "approved") {
      count += 1;
    }
  }

  return count;
}

function hasAnotherActiveAdmin(rows, targetEducatorId) {
  for (const educatorId of Object.keys(rows || {})) {
    if (educatorId === targetEducatorId) continue;
    const row = rows[educatorId] || {};
    const activeAdmin = row.status === "approved" &&
      (row.adminAccess === true || row.superAdmin === true);
    if (activeAdmin) return true;
  }
  return false;
}

module.exports = {
  ACTIVE_PLAN_STATUSES,
  BOOTCAMP_SUBJECTS,
  VALID_EDUCATOR_STATUSES,
  addSchoolMemberCandidates,
  approvedEducatorCount,
  bad,
  buildSubjectCatalogForPlan,
  cleanStr,
  collectCandidateStudentIds,
  countVisibleStudents,
  educatorHasBootcampAccess,
  errText,
  hasAnotherActiveAdmin,
  hydrateAllowedStudents,
  isActivePlan,
  isObject,
  normalizeAccess,
  normalizeSchool,
  normalizeStatus,
  normalizeUidToEducator,
  planHasBootcamp,
  safeKey,
  sanitizeEducatorProfile,
  sanitizeGroup,
  sanitizePlan,
  sanitizeStudent,
  trueMapKeys,
  validateAccessAgainstPlan,
};
