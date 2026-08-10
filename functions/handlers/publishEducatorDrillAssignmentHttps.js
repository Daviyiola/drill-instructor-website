"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {
  bad,
  cleanStr,
  errText,
  normalizeDrillStatus,
  readEducatorSchoolContext,
  sanitizeDrillSettings,
  sanitizeDrillListRow,
} = require("./_schoolDrillsAccess");

/**
 * Convert unknown value to object.
 *
 * @param {*} value Any value
 * @return {Object} Object or empty object
 */
function asObj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ?
    value :
    {};
}

/**
 * Convert unknown value to clean string array.
 *
 * @param {*} value Any value
 * @param {number=} maxLen Max string length
 * @param {number=} maxItems Max item count
 * @return {string[]} Clean strings
 */
function cleanStringArray(value, maxLen = 120, maxItems = 500) {
  if (!Array.isArray(value)) return [];

  const out = [];
  const seen = new Set();

  for (const item of value) {
    const s = cleanStr(item, maxLen);
    if (!s || seen.has(s)) continue;

    seen.add(s);
    out.push(s);

    if (out.length >= maxItems) break;
  }

  return out;
}

/**
 * Parse group key.
 *
 * Supported:
 * - "admin_groupId"
 * - "educator_groupId"
 * - "admin:groupId"
 * - "educator:groupId"
 *
 * @param {string} raw Raw group key
 * @return {{scope:string, groupId:string, groupKey:string}|null} Parsed
 */
function parseGroupKey(raw) {
  const key = cleanStr(raw, 180);
  if (!key) return null;

  let scope = "";
  let groupId = "";

  if (key.indexOf(":") !== -1) {
    const parts = key.split(":");
    scope = cleanStr(parts[0], 40).toLowerCase();
    groupId = cleanStr(parts.slice(1).join(":"), 140);
  } else if (key.indexOf("_") !== -1) {
    const parts = key.split("_");
    scope = cleanStr(parts[0], 40).toLowerCase();
    groupId = cleanStr(parts.slice(1).join("_"), 140);
  }

  if (scope !== "admin" && scope !== "educator") return null;
  if (!groupId) return null;

  return {
    scope,
    groupId,
    groupKey: `${scope}_${groupId}`,
  };
}

/**
 * Return true if caller can publish/view this drill.
 *
 * V1:
 * - creator can publish own draft
 * - admin/superAdmin can publish any school draft
 *
 * @param {Object} row Drill row
 * @param {string} educatorId Caller educator id
 * @param {Object} schoolEducator Caller school educator row
 * @return {boolean} True if allowed
 */
function callerCanPublish(row, educatorId, schoolEducator) {
  if (schoolEducator && schoolEducator.superAdmin === true) return true;
  if (schoolEducator && schoolEducator.adminAccess === true) return true;

  const createdBy = cleanStr(row && row.createdByEducatorId, 120);
  return createdBy === educatorId;
}

/**
 * Count questions in blueprint.
 *
 * @param {Object} blueprint Drill blueprint
 * @return {number} Total question count
 */
function countBlueprintQuestions(blueprint) {
  const subjects = Array.isArray(blueprint && blueprint.subjects) ?
    blueprint.subjects :
    [];

  let total = 0;

  for (const subject of subjects) {
    const ids = Array.isArray(subject && subject.questionIds) ?
      subject.questionIds :
      [];

    total += ids.length;
  }

  return total;
}

/**
 * Validate blueprint has usable question IDs.
 *
 * @param {Object} blueprint Blueprint.
 * @return {{
 * ok: boolean, error: string, questionCount: number}} Validation result.
 */
function validateBlueprint(blueprint) {
  if (!blueprint || typeof blueprint !== "object") {
    return {ok: false, error: "MISSING_BLUEPRINT"};
  }

  if (!Array.isArray(blueprint.subjects) || blueprint.subjects.length < 1) {
    return {ok: false, error: "MISSING_BLUEPRINT_SUBJECTS"};
  }

  const questionCount = countBlueprintQuestions(blueprint);

  if (questionCount < 1) {
    return {ok: false, error: "BLUEPRINT_HAS_NO_QUESTIONS"};
  }

  for (const subject of blueprint.subjects) {
    const subjectName = cleanStr(subject && subject.subject, 80);
    const questionIds = Array.isArray(subject && subject.questionIds) ?
      subject.questionIds :
      [];

    if (!subjectName) {
      return {ok: false, error: "BLUEPRINT_SUBJECT_MISSING_NAME"};
    }

    if (questionIds.length < 1) {
      return {ok: false, error: "BLUEPRINT_SUBJECT_HAS_NO_QUESTIONS"};
    }
  }

  return {ok: true, questionCount};
}

/**
 * Read a group row from the same paths used by getEducatorRosterHttps.
 *
 * @param {Object} db RTDB
 * @param {string} schoolId School id
 * @param {string} educatorId Current educator id
 * @param {{scope:string,groupId:string}} ref Group ref
 * @return {Promise<Object|null>} Group row
 */
async function readSchoolGroup(db, schoolId, educatorId, ref) {
  let path = "";

  if (ref.scope === "admin") {
    path = `schools/${schoolId}/groups/admin/${ref.groupId}`;
  } else {
    path = `schools/${schoolId}/groups/educators/${educatorId}/${ref.groupId}`;
  }

  const snap = await db.ref(path).once("value");
  const row = snap.val();

  return row && typeof row === "object" ? row : null;
}

/**
 * Extract member ids from a group row.
 *
 * Supports:
 * - members: {studentId:true}
 * - memberIds: {studentId:true}
 * - students: {studentId:true}
 * - studentIds: ["studentId"]
 *
 * @param {Object} group Group row
 * @return {string[]} Student ids
 */
function extractGroupMemberIds(group) {
  const out = [];
  const seen = new Set();

  /**
 * Add a unique cleaned ID to the output list.
 *
 * @param {*} id Raw ID.
 * @return {void}
 */
  function add(id) {
    const clean = cleanStr(id, 120);
    if (!clean || seen.has(clean)) return;

    seen.add(clean);
    out.push(clean);
  }

  const objectSources = [
    asObj(group.members),
    asObj(group.memberIds),
    asObj(group.students),
  ];

  for (const source of objectSources) {
    for (const id of Object.keys(source)) {
      if (source[id] === false || source[id] === null) continue;
      add(id);
    }
  }

  if (Array.isArray(group.studentIds)) {
    for (const id of group.studentIds) add(id);
  }

  return out;
}

/**
 * Make stable platoon key.
 *
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
 * Return whether student is currently in this school.
 *
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
 * Does educator have school-side access to this student?
 *
 * Same logic as getEducatorRosterHttps.
 *
 * @param {Object} args Params
 * @return {boolean}
 */
function educatorCanAssignStudent(args) {
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
 * Read basic user profile.
 *
 * @param {Object} db RTDB
 * @param {string} studentId Student custom id
 * @return {Promise<Object>} User row
 */
async function readUser(db, studentId) {
  const snap = await db.ref(`users/${studentId}`).once("value");
  return asObj(snap.val());
}

/**
 * Sum per-subject time limits in a blueprint.
 *
 * @param {Object} blueprint Drill blueprint
 * @return {number} Total time in minutes
 */
function totalBlueprintTimeMin(blueprint) {
  const subjects = Array.isArray(blueprint && blueprint.subjects) ?
    blueprint.subjects :
    [];

  let total = 0;

  for (const subject of subjects) {
    total += Number(subject && subject.timeLimitMin || 0);
  }

  return total;
}

/**
 * Resolve all selected students from explicit ids and group ids.
 *
 * @param {Object} db RTDB.
 * @param {string} schoolId School id.
 * @param {string} schoolNorm Normalized school id.
 * @param {string} educatorId Educator id.
 * @param {Object} schoolEducator Caller school educator row.
 * @param {string[]} explicitStudentIds Explicit student ids.
 * @param {string[]} groupKeys Group keys.
 * @return {
 * Promise<Object>} Resolved student ids, rejected rows, and source groups.
 */
async function resolveAssignableStudents(
    db,
    schoolId,
    schoolNorm,
    educatorId,
    schoolEducator,
    explicitStudentIds,
    groupKeys,
) {
  const candidateSet = new Set();
  const rejected = [];
  const sourceGroups = {};

  for (const id of explicitStudentIds) {
    candidateSet.add(id);
  }

  for (const key of groupKeys) {
    const ref = parseGroupKey(key);

    if (!ref) {
      rejected.push({
        type: "group",
        id: key,
        reason: "INVALID_GROUP_KEY",
      });
      continue;
    }

    const group = await readSchoolGroup(db, schoolId, educatorId, ref);

    if (!group) {
      rejected.push({
        type: "group",
        id: key,
        reason: "GROUP_NOT_FOUND",
      });
      continue;
    }

    sourceGroups[ref.groupKey] = true;

    const members = extractGroupMemberIds(group);
    for (const studentId of members) {
      candidateSet.add(studentId);
    }
  }

  const finalIds = [];

  for (const studentId of Array.from(candidateSet)) {
    const user = await readUser(db, studentId);

    const groupGranted = false;

    const canAssign = educatorCanAssignStudent({
      studentId,
      student: user,
      schoolNorm,
      schoolEducator,
      groupGranted,
    });

    if (!canAssign) {
      rejected.push({
        type: "student",
        id: studentId,
        reason: "STUDENT_NOT_IN_SCHOOL_OR_PERMISSION_OFF_OR_NO_ACCESS",
      });
      continue;
    }

    finalIds.push(studentId);
  }

  finalIds.sort();

  return {
    studentIds: finalIds,
    rejected,
    sourceGroups,
  };
}

/**
 * Build student inbox row.
 *
 * @param {Object} params Params
 * @return {Object} Inbox row
 */
function buildStudentInboxRow(params) {
  return {
    type: "educator_drill",
    drillId: params.drillId,
    schoolId: params.schoolId,
    bootcamp: params.bootcamp,
    title: params.title,
    instructions: params.instructions,
    createdByEducatorId: params.createdByEducatorId,
    createdByName: params.createdByName,
    assignedAt: params.assignedAt,
    dueAt: params.dueAt || "",
    status: "assigned",
    startedAt: "",
    submittedAt: "",
    attemptId: "",
    questionCount: params.questionCount,
    totalTimeMin: Number(params.totalTimeMin || 0),
    subjects: Array.isArray(params.subjects) ? params.subjects : [],
  };
}

/**
 * Publish educator drill assignment.
 *
 * Request:
 * {
 *   bootcamp: "sat",
 *   drillId: "...",
 *   studentIds: ["student1"],
 *   groupKeys: ["admin_group1", "educator_group2"]
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   drillId,
 *   assignedCount,
 *   rejected: [...]
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

    const body = req.body || {};
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
    const drillId = cleanStr(body.drillId, 140);

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    if (!drillId) {
      return bad(res, 400, "MISSING_DRILL_ID");
    }

    const explicitStudentIds = cleanStringArray(body.studentIds, 120, 1000);
    const groupKeys = cleanStringArray(body.groupKeys, 180, 200);

    if (explicitStudentIds.length < 1 && groupKeys.length < 1) {
      return bad(res, 400, "NO_ASSIGNMENT_TARGETS");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();

    const ctx = await readEducatorSchoolContext(db, callerFbUid, bootcamp);

    if (ctx.error) {
      return bad(res, 403, ctx.error, ctx.details || null);
    }

    const {
      educatorId,
      schoolId,
      schoolEducator,
    } = ctx;

    const schoolSnap = await db.ref(`schools/${schoolId}`).once("value");
    const school = schoolSnap.val() || {};

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

    const drillRef = db.ref(`schools/${schoolId}/educatorDrills/${drillId}`);
    const drillSnap = await drillRef.once("value");
    const drill = drillSnap.val();

    if (!drill || typeof drill !== "object") {
      return bad(res, 404, "DRILL_NOT_FOUND");
    }

    const drillBootcamp = cleanStr(drill.bootcamp, 40).toLowerCase();
    if (drillBootcamp !== bootcamp) {
      return bad(res, 403, "DRILL_BOOTCAMP_MISMATCH", {
        requestedBootcamp: bootcamp,
        drillBootcamp,
      });
    }

    if (!callerCanPublish(drill, educatorId, schoolEducator)) {
      return bad(res, 403, "CANNOT_PUBLISH_THIS_DRILL");
    }

    const status = normalizeDrillStatus(drill.status, "draft");

    if (status !== "draft") {
      return bad(res, 409, "ONLY_DRAFT_DRILLS_CAN_BE_PUBLISHED", {
        status,
      });
    }

    const blueprint = drill.blueprint && typeof drill.blueprint === "object" ?
      drill.blueprint :
      null;

    const bpCheck = validateBlueprint(blueprint);
    const totalTimeMin = totalBlueprintTimeMin(blueprint);

    if (!bpCheck.ok) {
      return bad(res, 400, bpCheck.error);
    }

    const resolved = await resolveAssignableStudents(
        db,
        schoolId,
        schoolNorm,
        educatorId,
        schoolEducator,
        explicitStudentIds,
        groupKeys,
    );

    if (resolved.studentIds.length < 1) {
      return bad(res, 400, "NO_VALID_STUDENTS_TO_ASSIGN", {
        rejected: resolved.rejected,
      });
    }

    const nowIso = new Date().toISOString();

    const title = cleanStr(drill.title, 160) || "Assigned Drill";
    const instructions = cleanStr(drill.instructions, 1600);
    const dueAt = cleanStr(drill.dueAt, 80);
    const settings = sanitizeDrillSettings(drill.settings || {}, {});
    if (!dueAt && (settings.scorePolicy === "on_due_date" ||
        settings.correctionPolicy === "on_due_date")) {
      return bad(res, 400, "DUE_DATE_REQUIRED_FOR_RELEASE_POLICY");
    }
    const createdByEducatorId = cleanStr(drill.createdByEducatorId, 120) ||
      educatorId;
    const createdByName = cleanStr(drill.createdByName, 160) ||
      cleanStr(schoolEducator.displayName, 160) ||
      "Educator";

    const assignedStudents = {};
    const updates = {};

    for (const studentId of resolved.studentIds) {
      assignedStudents[studentId] = {
        status: "assigned",
        assignedAt: nowIso,
        startedAt: "",
        submittedAt: "",
        attemptId: "",
      };

      updates[
          `users/${studentId}/assignedDrills/${drillId}`
      ] = buildStudentInboxRow({
        drillId,
        schoolId,
        bootcamp,
        title,
        instructions,
        createdByEducatorId,
        createdByName,
        assignedAt: nowIso,
        dueAt,
        questionCount: bpCheck.questionCount,
        totalTimeMin,
        subjects: blueprint.subjects.map((row) => cleanStr(row.subject, 80))
            .filter(Boolean),
      });
    }

    updates[`schools/${schoolId}/educatorDrills/${drillId}/status`] =
      "published";
    updates[`schools/${schoolId}/educatorDrills/${drillId}/publishedAt`] =
      nowIso;
    updates[`schools/${schoolId}/educatorDrills/${drillId}/updatedAt`] =
      nowIso;
    updates[`schools/${schoolId}/educatorDrills/${drillId}/assignedStudents`] =
      assignedStudents;
    updates[`schools/${schoolId}/educatorDrills/${drillId}/settings`] =
      settings;
    updates[`schools/${schoolId}/educatorDrills/${drillId}/release`] = {
      scorePolicy: settings.scorePolicy,
      correctionPolicy: settings.correctionPolicy,
      scoreReleasedAt: null,
      correctionsReleasedAt: null,
    };
    updates[`schools/${schoolId}/educatorDrills/${drillId}/sourceGroups`] =
      resolved.sourceGroups;
    updates[`schools/${schoolId}/educatorDrills/${drillId}/summary`] = {
      assignedCount: resolved.studentIds.length,
      startedCount: 0,
      submittedCount: 0,
      averageAccuracy: 0,
      averageTimeSec: 0,
    };

    await db.ref().update(updates);

    const updatedSnap = await drillRef.once("value");
    const updatedDrill = updatedSnap.val() || {};

    return res.status(200).json({
      ok: true,
      drillId,
      assignedCount: resolved.studentIds.length,
      rejected: resolved.rejected,
      drill: sanitizeDrillListRow(drillId, updatedDrill),
      syncedAt: nowIso,
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
