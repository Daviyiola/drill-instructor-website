"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");

/**
 * Send standardized error response.
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
 * RTDB keys sometimes cannot safely use raw path separators.
 * This is mostly for group IDs and generated IDs.
 * @param {*} v Value
 * @return {string}
 */
function safeKey(v) {
  return cleanStr(v, 180)
      .replace(/[.#$/\\[\]]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
}

/**
 * Supports both old and new uidToCustom shapes.
 * New:
 *   uidToCustom/{uid}/educator = "user_..."
 * Legacy possible:
 *   uidToCustom/{uid} = "user_..."
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
 * Make stable platoon key.
 * @param {string} corpsName Country/corps
 * @param {string} battalionName State/battalion
 * @param {string} platoonName School/platoon
 * @return {string}
 */
function makePlatoonKey(corpsName, battalionName, platoonName) {
  return [
    cleanStr(corpsName, 100),
    cleanStr(battalionName, 100),
    cleanStr(platoonName, 100),
  ].join("/");
}

/**
 * Convert object map {id:true} to array of ids.
 * @param {*} map Input map
 * @return {string[]}
 */
function trueMapKeys(map) {
  const out = [];
  if (!map || typeof map !== "object") return out;

  for (const key of Object.keys(map)) {
    if (map[key] === true) out.push(key);
  }
  return out;
}

/**
 * Return true when the school plan is active enough to serve roster data.
 * @param {Object} plan School plan
 * @return {boolean}
 */
function isActivePlan(plan) {
  const status = cleanStr(plan && plan.status, 40).toLowerCase();
  return status === "active" || status === "trial";
}

/**
 * Return true when the school plan includes the requested bootcamp.
 * @param {Object} plan School plan
 * @param {string} bootcamp Bootcamp id
 * @return {boolean}
 */
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

/**
 * Admins/superAdmins have broad bootcamp visibility. Regular educators
 * need explicit access.bootcamps permission.
 * @param {Object} schoolEducator School educator row
 * @param {string} bootcamp Bootcamp id
 * @return {boolean}
 */
function educatorHasBootcampAccess(schoolEducator, bootcamp) {
  if (!bootcamp) return true;
  if (schoolEducator.superAdmin === true) return true;
  if (schoolEducator.adminAccess === true) return true;

  const access = schoolEducator.access || {};
  const bootcamps = access.bootcamps || {};

  return bootcamps.all === true || bootcamps[bootcamp] === true;
}

/**
 * Return whether student is currently in this school.
 * @param {Object} student Student record
 * @param {Object} schoolNorm Normalized school info
 * @return {boolean}
 */
function isStudentInSchool(student, schoolNorm) {
  return (
    cleanStr(student.corpsName, 100) === schoolNorm.country &&
    cleanStr(student.battalionName, 100) === schoolNorm.state &&
    cleanStr(student.platoonName, 100) === schoolNorm.name
  );
}

/**
 * Light/sanitized student row for roster UI.
 * No stats, no statsIndex, no private heavy branches.
 *
 * @param {string} studentId Student custom id
 * @param {Object} u User node
 * @return {Object}
 */
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

/**
 * Does educator have school-side access to this student?
 *
 * Student-side rule:
 *   users/{studentId}/platoonPermissions must be true.
 *
 * Educator-side rule:
 *   adminAccess/superAdmin implies all eligible students.
 *   access.students.all also implies all eligible students.
 *   access.platoons.all also implies all eligible students in school.
 *   access.platoons[schoolPlatoonKey] allows that school/platoon.
 *   access.students[studentId] allows explicit student, but still requires
 *   current school membership + platoonPermissions.
 *
 * @param {Object} args Params
 * @return {boolean}
 */
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

/**
 * Hydrate student records from users/{studentId}, then filter safely.
 *
 * @param {Object} db Firebase DB
 * @param {string[]} candidateIds Candidate student ids
 * @param {Object} schoolNorm School info
 * @param {Object} schoolEducator School educator row
 * @param {Object} groupGrantMap Student ids granted through school groups
 * @return {Promise<{studentRows: Object[], allowedMap: Object}>}
 */
async function hydrateAllowedStudents(
    db, candidateIds, schoolNorm, schoolEducator, groupGrantMap) {
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

    const canSee = educatorCanSeeStudent({
      studentId,
      student: u,
      schoolNorm,
      schoolEducator,
      groupGranted: groupGrantMap && groupGrantMap[studentId] === true,
    });

    if (!canSee) continue;

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

/**
 * Read candidate student IDs based on educator/school scope.
 *
 * We deliberately collect candidates first, then verify each candidate through
 * educatorCanSeeStudent(). This prevents stale explicit access or stale groups
 * from leaking records after a student leaves a school/platoon.
 *
 * @param {Object} db Firebase DB
 * @param {string} schoolId School id
 * @param {Object} schoolNorm School info
 * @param {Object} schoolEducator School educator row
 * @return {Promise<{candidateIds: string[], groupGrantMap: Object}>}
 */
async function collectCandidateStudentIds(
    db,
    schoolId,
    schoolNorm,
    schoolEducator,
) {
  const access = schoolEducator.access || {};
  const candidateMap = {};
  const groupGrantMap = {};

  const schoolMembersPath =
    `units/corps/${schoolNorm.
        country}/${schoolNorm.state}/${schoolNorm.name}/members`;

  const hasAllStudents =
    schoolEducator.superAdmin === true ||
    schoolEducator.adminAccess === true ||
    (access.students && access.students.all === true) ||
    (access.platoons && access.platoons.all === true);

  if (hasAllStudents) {
    const membersSnap = await db.ref(schoolMembersPath).once("value");
    const members = membersSnap.val() || {};
    for (const id of trueMapKeys(members)) candidateMap[id] = true;
  }

  if (access.platoons && typeof access.platoons === "object") {
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

  // New admin model: selected school-wide groups grant access to the
  // current eligible students inside those groups. Final filtering still
  // happens in hydrateAllowedStudents() through educatorCanSeeStudent().
  if (access.groups && typeof access.groups === "object") {
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
    } else {
      for (const groupId of Object.keys(access.groups)) {
        if (groupId === "all") continue;
        if (access.groups[groupId] !== true) continue;

        const membersSnap = await db
            .ref(`schools/${schoolId}/groups/admin/${groupId}/members`)
            .once("value");
        const members = membersSnap.val() || {};
        for (const id of trueMapKeys(members)) {
          candidateMap[id] = true;
          groupGrantMap[id] = true;
        }
      }
    }
  }

  if (access.students && typeof access.students === "object") {
    for (const studentId of Object.keys(access.students)) {
      if (studentId === "all") continue;
      if (access.students[studentId] === true) {
        candidateMap[studentId] = true;
      }
    }
  }

  return {
    candidateIds: Object.keys(candidateMap),
    groupGrantMap,
  };
}

/**
 * Normalize a group node.
 *
 * @param {Object} args Params
 * @return {Object|null}
 */
function sanitizeGroup(args) {
  const groupId = args.groupId;
  const group = args.group || {};
  const scope = args.scope;
  const ownerEducatorId = args.ownerEducatorId || "";
  const allowedMap = args.allowedMap || {};

  const rawMembers = group.members || {};
  const visibleMemberIds = [];

  if (rawMembers && typeof rawMembers === "object") {
    for (const studentId of Object.keys(rawMembers)) {
      if (rawMembers[studentId] === true && allowedMap[studentId] === true) {
        visibleMemberIds.push(studentId);
      }
    }
  }

  visibleMemberIds.sort();

  return {
    id: `${scope}_${safeKey(ownerEducatorId || "school")}_${safeKey(groupId)}`,
    rawGroupId: groupId,
    scope,
    ownerEducatorId,
    name: cleanStr(group.name, 100) || "Untitled Group",
    description: cleanStr(group.description, 240),
    createdBy: cleanStr(group.createdBy, 120),
    createdAt: cleanStr(group.createdAt, 40),
    updatedAt: cleanStr(group.updatedAt, 40),
    memberIds: visibleMemberIds,
    memberCount: visibleMemberIds.length,
  };
}

/**
 * Read admin groups and current educator's private groups.
 *
 * School-wide groups can grant access when assigned in access.groups.
 * Every visible group member is still filtered through allowedMap,
 * which already enforces current school membership and platoonPermissions.
 *
 * Groups with zero visible members still return.
 *
 * @param {Object} db Firebase DB
 * @param {string} schoolId School id
 * @param {string} educatorId Educator id
 * @param {Object} allowedMap Student access map
 * @return {Promise<Object[]>}
 */
async function readVisibleGroups(db, schoolId, educatorId, allowedMap) {
  const [adminSnap, educatorSnap] = await Promise.all([
    db.ref(`schools/${schoolId}/groups/admin`).once("value"),
    db.ref(`schools/${schoolId}/groups/educators/${educatorId}`).once("value"),
  ]);

  const groups = [];

  const adminGroups = adminSnap.val() || {};
  if (adminGroups && typeof adminGroups === "object") {
    for (const groupId of Object.keys(adminGroups)) {
      const row = sanitizeGroup({
        groupId,
        group: adminGroups[groupId],
        scope: "admin",
        ownerEducatorId: "",
        allowedMap,
      });
      if (row) groups.push(row);
    }
  }

  const educatorGroups = educatorSnap.val() || {};
  if (educatorGroups && typeof educatorGroups === "object") {
    for (const groupId of Object.keys(educatorGroups)) {
      const row = sanitizeGroup({
        groupId,
        group: educatorGroups[groupId],
        scope: "educator",
        ownerEducatorId: educatorId,
        allowedMap,
      });
      if (row) groups.push(row);
    }
  }

  groups.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "admin" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return groups;
}

exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();

    // 1) Resolve educator custom id from Firebase UID.
    const mapSnap = await db.ref(`uidToCustom/${callerFbUid}`).once("value");
    const educatorId = normalizeUidToEducator(mapSnap.val());

    if (!educatorId) {
      return bad(res, 403, "NOT_AN_EDUCATOR");
    }

    // 2) Read educator profile.
    const educatorSnap = await db.ref(`educators/${educatorId}`).once("value");
    const educator = educatorSnap.val() || {};

    const schoolId = cleanStr(educator.schoolID || educator.schoolId, 80);
    if (!schoolId) {
      return bad(res, 403, "EDUCATOR_HAS_NO_SCHOOL");
    }

    // 3) Read school and school-specific educator permission row.
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

    const schoolNorm = {
      schoolId,
      name: cleanStr(school.name, 100),
      country: cleanStr(school.country, 100),
      state: cleanStr(school.state, 100),
    };

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

    const bootcamp = cleanStr(req.body && req.body.bootcamp, 40)
        .toLowerCase();

    if (bootcamp) {
      if (!isActivePlan(school.plan || {})) {
        return bad(res, 403, "SCHOOL_PLAN_NOT_ACTIVE", {
          planStatus: cleanStr((school.plan || {}).status, 40) || "missing",
        });
      }

      if (!planHasBootcamp(school.plan || {}, bootcamp)) {
        return bad(res, 403, "BOOTCAMP_NOT_IN_SCHOOL_PLAN", {
          bootcamp,
        });
      }

      if (!educatorHasBootcampAccess(schoolEducator, bootcamp)) {
        return bad(res, 403, "EDUCATOR_HAS_NO_BOOTCAMP_ACCESS", {
          bootcamp,
        });
      }
    }

    // 4) Collect candidates from current school membership and assigned scopes.
    const collected = await collectCandidateStudentIds(
        db,
        schoolId,
        schoolNorm,
        schoolEducator,
    );

    // 5) Hydrate and filter candidates.
    const {studentRows, allowedMap} = await hydrateAllowedStudents(
        db,
        collected.candidateIds,
        schoolNorm,
        schoolEducator,
        collected.groupGrantMap,
    );

    // 6) Read groups and filter their members through allowedMap.
    const groups = await readVisibleGroups(db,
        schoolId, educatorId, allowedMap);

    const access = schoolEducator.access || {};
    const adminAccess =
      schoolEducator.adminAccess === true ||
      schoolEducator.superAdmin === true;

    return res.status(200).json({
      ok: true,
      educatorId,
      school: {
        schoolId,
        name: schoolNorm.name,
        country: schoolNorm.country,
        state: schoolNorm.state,
      },
      bootcamp,
      access: {
        adminAccess: schoolEducator.adminAccess === true,
        superAdmin: schoolEducator.superAdmin === true,
        studentsAll: adminAccess ||
          !!(access.students && access.students.all === true),
        platoonsAll: adminAccess ||
          !!(access.platoons && access.platoons.all === true),
      },
      students: studentRows,
      groups,
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

    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      details,
    });
  }
};
